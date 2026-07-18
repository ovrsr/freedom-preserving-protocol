/**
 * Durable steward key-binding registry derived from the authorization ledger.
 */

import {
  buildStewardEvidenceDigest,
  canonicalizeV2,
  parseStewardKeyAttestation,
  type StewardKeyAttestationV1,
} from "@ovrsr/fpp-protocol-core";
import type { StewardAuthorizationLedger } from "./ledger.js";
import type { SignatureBackendRegistry } from "./signature-backend.js";

export type KeyBindingStatus = "active" | "retired" | "revoked";

export type StewardKeyBinding = {
  keyRef: string;
  algorithm: string;
  publicKeyArmored: string;
  status: KeyBindingStatus;
  boundAt: string;
  attestationId: string;
};

export type StewardState = {
  stewardId: string;
  keys: Map<string, StewardKeyBinding>;
};

export type AdmitKeyAttestationInput = {
  attestation: StewardKeyAttestationV1;
  format: "detached" | "cleartext";
  signaturesArmored?: string[];
  cleartextArmored?: string;
  authorizerKeyRef?: string;
  acceptTofu: boolean;
};

export type AdmitResult =
  | { ok: true; eventHash: string; stewardId: string }
  | { ok: false; reason: string };

function algorithmFromKeyRef(keyRef: string): string {
  const idx = keyRef.indexOf(":");
  return idx === -1 ? "unknown" : keyRef.slice(0, idx);
}

export class StewardRegistry {
  private readonly ledger: StewardAuthorizationLedger;
  private readonly backends: SignatureBackendRegistry;
  private stewards = new Map<string, StewardState>();
  private valid = true;
  private invalidateReason: string | undefined;

  constructor(options: {
    ledger: StewardAuthorizationLedger;
    backends: SignatureBackendRegistry;
  }) {
    this.ledger = options.ledger;
    this.backends = options.backends;
    this.rebuildFromLedger();
  }

  isValid(): boolean {
    return this.valid;
  }

  invalidReason(): string | undefined {
    return this.invalidateReason;
  }

  getSteward(stewardId: string): StewardState | undefined {
    const state = this.stewards.get(stewardId);
    if (!state) return undefined;
    return {
      stewardId: state.stewardId,
      keys: new Map(state.keys),
    };
  }

  hasActiveKey(stewardId: string): boolean {
    const state = this.stewards.get(stewardId);
    if (!state) return false;
    for (const binding of state.keys.values()) {
      if (binding.status === "active") return true;
    }
    return false;
  }

  getActiveBinding(
    stewardId: string,
    keyRef: string,
  ): StewardKeyBinding | undefined {
    const binding = this.stewards.get(stewardId)?.keys.get(keyRef);
    if (!binding || binding.status !== "active") return undefined;
    return { ...binding };
  }

  listStewards(): StewardState[] {
    return [...this.stewards.values()].map((s) => ({
      stewardId: s.stewardId,
      keys: new Map(s.keys),
    }));
  }

  rebuildFromLedger(): void {
    this.stewards.clear();
    this.valid = true;
    this.invalidateReason = undefined;
    const loaded = this.ledger.loadVerified();
    if (!loaded.ok) {
      this.valid = false;
      this.invalidateReason = loaded.error.message;
      return;
    }
    for (const event of loaded.events) {
      if (event.kind !== "key_binding_accepted" && event.kind !== "key_revoked") {
        continue;
      }
      const evidence = event.retainedEvidence as
        | {
            attestation?: StewardKeyAttestationV1;
            publicKeysArmored?: string[];
          }
        | undefined;
      if (!evidence?.attestation) {
        this.valid = false;
        this.invalidateReason = `missing retained attestation in sequence ${event.sequence}`;
        this.stewards.clear();
        return;
      }
      const parsed = parseStewardKeyAttestation(evidence.attestation);
      if (!parsed.ok) {
        this.valid = false;
        this.invalidateReason = `invalid retained attestation in sequence ${event.sequence}`;
        this.stewards.clear();
        return;
      }
      // Re-apply state transitions from accepted events (signatures already verified at admit).
      const applied = this.applyAttestationLocally(parsed.attestation, event.timestamp);
      if (!applied.ok) {
        this.valid = false;
        this.invalidateReason = applied.reason;
        this.stewards.clear();
        return;
      }
    }
  }

  async admitKeyAttestation(
    input: AdmitKeyAttestationInput,
  ): Promise<AdmitResult> {
    if (!this.valid) {
      return {
        ok: false,
        reason: this.invalidateReason ?? "registry invalid",
      };
    }
    const loaded = this.ledger.loadVerified();
    if (!loaded.ok || !loaded.policy) {
      return { ok: false, reason: "ledger unavailable or uninitialized" };
    }

    const parsed = parseStewardKeyAttestation(input.attestation);
    if (!parsed.ok) {
      return { ok: false, reason: parsed.error };
    }
    const attestation = parsed.attestation;

    if (attestation.audience !== loaded.policy.instanceAudience) {
      return this.rejectAttestation(attestation, "wrong audience");
    }

    const subjectArmored = attestation.subjectKey.publicKeyArmored;
    if (!subjectArmored) {
      return this.rejectAttestation(
        attestation,
        "subjectKey.publicKeyArmored required",
      );
    }

    const backend = this.backends.get(
      algorithmFromKeyRef(attestation.subjectKey.keyRef),
    );
    if (!backend) {
      return this.rejectAttestation(attestation, "unsupported signature backend");
    }

    const parsedKey = await backend.parsePublicKey(subjectArmored);
    if (!parsedKey.ok) {
      return this.rejectAttestation(attestation, parsedKey.reason);
    }
    if (parsedKey.keyRef !== attestation.subjectKey.keyRef) {
      return this.rejectAttestation(
        attestation,
        "public key fingerprint does not match subjectKey.keyRef",
      );
    }

    const canonical = canonicalizeV2(attestation);
    const expectedKeyRefs: string[] = [];
    const publicKeysArmored: string[] = [subjectArmored];

    if (attestation.operation === "initial-bind") {
      if (!input.acceptTofu) {
        return this.rejectAttestation(
          attestation,
          "initial-bind requires explicit --accept-tofu acknowledgement",
        );
      }
      if (this.stewards.has(attestation.stewardId)) {
        return this.rejectAttestation(
          attestation,
          "steward already initialized",
        );
      }
      expectedKeyRefs.push(attestation.subjectKey.keyRef);
    } else {
      const authorizerKeyRef = input.authorizerKeyRef;
      if (!authorizerKeyRef) {
        return this.rejectAttestation(
          attestation,
          "authorizerKeyRef required for non-initial operations",
        );
      }
      const authorizer = this.getActiveBinding(
        attestation.stewardId,
        authorizerKeyRef,
      );
      if (!authorizer) {
        return this.rejectAttestation(
          attestation,
          "authorizer key is not an active binding for this steward",
        );
      }
      publicKeysArmored.push(authorizer.publicKeyArmored);
      if (attestation.operation === "revoke") {
        expectedKeyRefs.push(authorizerKeyRef);
      } else {
        // add / rotate: authorizer + subject proof of possession
        expectedKeyRefs.push(authorizerKeyRef, attestation.subjectKey.keyRef);
      }
    }

    const nowMs = Date.now();
    const skew = loaded.policy.allowedClockSkewMs;
    let verifyResult;
    if (input.format === "detached") {
      if (!input.signaturesArmored || input.signaturesArmored.length === 0) {
        return this.rejectAttestation(attestation, "detached signatures required");
      }
      verifyResult = await backend.verifyDetached({
        canonicalPayload: canonical,
        signaturesArmored: input.signaturesArmored,
        publicKeysArmored,
        expectedKeyRefs,
        issuedAt: attestation.issuedAt,
        nowMs,
        allowedClockSkewMs: skew,
      });
    } else {
      if (!input.cleartextArmored) {
        return this.rejectAttestation(attestation, "cleartext message required");
      }
      verifyResult = await backend.verifyCleartext({
        cleartextArmored: input.cleartextArmored,
        expectedCanonicalPayload: canonical,
        publicKeysArmored,
        expectedKeyRefs,
        issuedAt: attestation.issuedAt,
        nowMs,
        allowedClockSkewMs: skew,
      });
    }

    if (!verifyResult.ok) {
      return this.rejectAttestation(attestation, verifyResult.reason);
    }

    const local = this.applyAttestationLocally(
      attestation,
      attestation.issuedAt,
      { dryRun: true },
    );
    if (!local.ok) {
      return this.rejectAttestation(attestation, local.reason);
    }

    const evidenceDigest = buildStewardEvidenceDigest({
      attestation,
      signatures: input.signaturesArmored ?? [input.cleartextArmored],
    });

    const kind =
      attestation.operation === "revoke"
        ? ("key_revoked" as const)
        : ("key_binding_accepted" as const);

    const appendResult = this.ledger.transact((tx) =>
      tx.append({
        kind,
        evidenceDigest,
        detail: {
          stewardId: attestation.stewardId,
          operation: attestation.operation,
          subjectKeyRef: attestation.subjectKey.keyRef,
          acceptTofu:
            attestation.operation === "initial-bind" ? true : undefined,
        },
        uniqueKeys: {
          attestationId: attestation.attestationId,
          nonce: attestation.nonce,
        },
        retainedEvidence: {
          attestation,
          publicKeysArmored,
          format: input.format,
          signaturesArmored: input.signaturesArmored,
          cleartextArmored: input.cleartextArmored,
        },
      }),
    );

    if (!appendResult.ok) {
      return {
        ok: false,
        reason:
          appendResult.error instanceof Error
            ? appendResult.error.message
            : String(appendResult.error),
      };
    }
    if (!appendResult.value.ok) {
      return { ok: false, reason: appendResult.value.error.message };
    }

    const applied = this.applyAttestationLocally(attestation, attestation.issuedAt);
    if (!applied.ok) {
      this.valid = false;
      this.invalidateReason = applied.reason;
      return { ok: false, reason: applied.reason };
    }

    return {
      ok: true,
      eventHash: appendResult.value.event.eventHash,
      stewardId: attestation.stewardId,
    };
  }

  private async rejectAttestation(
    attestation: StewardKeyAttestationV1,
    reason: string,
  ): Promise<AdmitResult> {
    const evidenceDigest = buildStewardEvidenceDigest({
      attestationId: attestation.attestationId,
      reason,
    });
    this.ledger.transact((tx) =>
      tx.append({
        kind: "key_binding_rejected",
        evidenceDigest,
        detail: {
          reason: reason.slice(0, 256),
          attestationId: attestation.attestationId,
          stewardId: attestation.stewardId,
        },
      }),
    );
    return { ok: false, reason };
  }

  private applyAttestationLocally(
    attestation: StewardKeyAttestationV1,
    boundAt: string,
    options: { dryRun?: boolean } = {},
  ): { ok: true } | { ok: false; reason: string } {
    const stewards = options.dryRun
      ? cloneStewards(this.stewards)
      : this.stewards;

    if (attestation.operation === "initial-bind") {
      if (stewards.has(attestation.stewardId)) {
        return { ok: false, reason: "steward already initialized" };
      }
      const keys = new Map<string, StewardKeyBinding>();
      keys.set(attestation.subjectKey.keyRef, {
        keyRef: attestation.subjectKey.keyRef,
        algorithm: attestation.subjectKey.algorithm,
        publicKeyArmored: attestation.subjectKey.publicKeyArmored!,
        status: "active",
        boundAt,
        attestationId: attestation.attestationId,
      });
      stewards.set(attestation.stewardId, {
        stewardId: attestation.stewardId,
        keys,
      });
      if (!options.dryRun) this.stewards = stewards;
      return { ok: true };
    }

    const state = stewards.get(attestation.stewardId);
    if (!state) {
      return { ok: false, reason: "unknown steward" };
    }

    if (attestation.operation === "add") {
      if (state.keys.has(attestation.subjectKey.keyRef)) {
        return { ok: false, reason: "key already bound" };
      }
      state.keys.set(attestation.subjectKey.keyRef, {
        keyRef: attestation.subjectKey.keyRef,
        algorithm: attestation.subjectKey.algorithm,
        publicKeyArmored: attestation.subjectKey.publicKeyArmored!,
        status: "active",
        boundAt,
        attestationId: attestation.attestationId,
      });
      return { ok: true };
    }

    if (attestation.operation === "rotate") {
      const replaces = attestation.replacesKeyRef;
      if (!replaces || !state.keys.has(replaces)) {
        return { ok: false, reason: "replacesKeyRef not bound" };
      }
      const old = state.keys.get(replaces)!;
      if (old.status !== "active") {
        return { ok: false, reason: "replaced key is not active" };
      }
      old.status = "retired";
      state.keys.set(attestation.subjectKey.keyRef, {
        keyRef: attestation.subjectKey.keyRef,
        algorithm: attestation.subjectKey.algorithm,
        publicKeyArmored: attestation.subjectKey.publicKeyArmored!,
        status: "active",
        boundAt,
        attestationId: attestation.attestationId,
      });
      return { ok: true };
    }

    if (attestation.operation === "revoke") {
      const target = state.keys.get(attestation.subjectKey.keyRef);
      if (!target) {
        return { ok: false, reason: "revoke target not bound" };
      }
      target.status = "revoked";
      return { ok: true };
    }

    return { ok: false, reason: "unsupported operation" };
  }
}

function cloneStewards(
  source: Map<string, StewardState>,
): Map<string, StewardState> {
  const out = new Map<string, StewardState>();
  for (const [id, state] of source) {
    const keys = new Map<string, StewardKeyBinding>();
    for (const [keyRef, binding] of state.keys) {
      keys.set(keyRef, { ...binding });
    }
    out.set(id, { stewardId: id, keys });
  }
  return out;
}

/**
 * Operator authorization verify / admit / consume service.
 */

import {
  buildStewardEvidenceDigest,
  canonicalizeV2,
  parseOperatorAuthorization,
  parseOperatorAuthorizationRevocation,
  type OperatorAuthorizationRevocationV1,
  type OperatorAuthorizationV1,
} from "@ovrsr/fpp-protocol-core";
import type { StewardAuthorizationLedger } from "./ledger.js";
import type { SignatureBackendRegistry } from "./signature-backend.js";
import type { StewardRegistry } from "./steward-registry.js";
import {
  matchesAuthorizationScope,
  type ActionDescriptor,
} from "./scope.js";

export type ConsumeReason =
  | "none"
  | "scope-mismatch"
  | "target-ambiguous"
  | "expired"
  | "key-inactive"
  | "authorization-revoked"
  | "exhausted"
  | "replay"
  | "ledger-unavailable"
  | "not-admitted"
  | "ok";

export type AdmittedAuthorization = {
  authorization: OperatorAuthorizationV1;
  remainingUses: number;
  revoked: boolean;
  eventHash: string;
  signingKeyRef: string;
  stewardId: string;
};

export type VerifyAdmitInput = {
  authorization: OperatorAuthorizationV1;
  format: "detached" | "cleartext";
  signaturesArmored?: string[];
  cleartextArmored?: string;
  nowMs?: number;
};

export type VerifyResult =
  | { ok: true; authorization: OperatorAuthorizationV1 }
  | { ok: false; reason: string };

export type AdmitAuthResult =
  | { ok: true; eventHash: string; authorizationId: string }
  | { ok: false; reason: string };

export type CandidateResult =
  | {
      ok: true;
      authorizationId: string;
      stewardId: string;
      signingKeyRef: string;
      eventHash: string;
      mandateId: string;
    }
  | { ok: false; reason: ConsumeReason };

export type ConsumeResult =
  | {
      ok: true;
      authorizationId: string;
      stewardId: string;
      signingKeyRef: string;
      eventHash: string;
      remainingUses: number;
    }
  | { ok: false; reason: ConsumeReason };

function algorithmFromKeyRef(keyRef: string): string {
  const idx = keyRef.indexOf(":");
  return idx === -1 ? "unknown" : keyRef.slice(0, idx);
}

export class AuthorizationService {
  private readonly ledger: StewardAuthorizationLedger;
  private readonly backends: SignatureBackendRegistry;
  private readonly registry: StewardRegistry;
  private admitted = new Map<string, AdmittedAuthorization>();
  private revokedAuthIds = new Set<string>();

  constructor(options: {
    ledger: StewardAuthorizationLedger;
    backends: SignatureBackendRegistry;
    registry: StewardRegistry;
  }) {
    this.ledger = options.ledger;
    this.backends = options.backends;
    this.registry = options.registry;
    this.rebuildFromLedger();
  }

  rebuildFromLedger(): void {
    this.admitted.clear();
    this.revokedAuthIds.clear();
    const loaded = this.ledger.loadVerified();
    if (!loaded.ok) return;
    for (const event of loaded.events) {
      if (event.kind === "authorization_accepted") {
        const evidence = event.retainedEvidence as
          | { authorization?: OperatorAuthorizationV1 }
          | undefined;
        if (!evidence?.authorization) continue;
        this.admitted.set(evidence.authorization.authorizationId, {
          authorization: evidence.authorization,
          remainingUses: evidence.authorization.maxUses,
          revoked: false,
          eventHash: event.eventHash,
          signingKeyRef: evidence.authorization.signingKeyRef,
          stewardId: evidence.authorization.stewardId,
        });
      } else if (event.kind === "authorization_consumed") {
        const id = String(event.detail.authorizationId ?? "");
        const entry = this.admitted.get(id);
        if (entry) {
          entry.remainingUses = Math.max(0, entry.remainingUses - 1);
        }
      } else if (event.kind === "authorization_revoked") {
        const id = String(event.detail.authorizationId ?? "");
        this.revokedAuthIds.add(id);
        const entry = this.admitted.get(id);
        if (entry) entry.revoked = true;
      } else if (event.kind === "key_revoked") {
        const keyRef = String(event.detail.subjectKeyRef ?? "");
        for (const entry of this.admitted.values()) {
          if (entry.signingKeyRef === keyRef && entry.remainingUses > 0) {
            entry.revoked = true;
          }
        }
      }
    }
  }

  listAdmitted(): AdmittedAuthorization[] {
    return [...this.admitted.values()].map((e) => ({
      ...e,
      authorization: e.authorization,
    }));
  }

  async verify(input: VerifyAdmitInput): Promise<VerifyResult> {
    const check = await this.verifyInternal(input);
    if (!check.ok) return check;
    return { ok: true, authorization: check.authorization };
  }

  async admit(input: VerifyAdmitInput): Promise<AdmitAuthResult> {
    const check = await this.verifyInternal(input);
    if (!check.ok) {
      await this.recordRejection(input.authorization, check.reason);
      return check;
    }
    const authorization = check.authorization;
    const evidenceDigest = buildStewardEvidenceDigest({
      authorization,
      format: input.format,
    });
    const appendResult = this.ledger.transact((tx) =>
      tx.append({
        kind: "authorization_accepted",
        evidenceDigest,
        detail: {
          authorizationId: authorization.authorizationId,
          stewardId: authorization.stewardId,
          signingKeyRef: authorization.signingKeyRef,
          mode: authorization.mode,
        },
        uniqueKeys: {
          authorizationId: authorization.authorizationId,
          nonce: authorization.nonce,
        },
        retainedEvidence: {
          authorization,
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
            : "ledger append failed",
      };
    }
    if (!appendResult.value.ok) {
      return {
        ok: false,
        reason: appendResult.value.error.message,
      };
    }
    const event = appendResult.value.event;
    this.admitted.set(authorization.authorizationId, {
      authorization,
      remainingUses: authorization.maxUses,
      revoked: false,
      eventHash: event.eventHash,
      signingKeyRef: authorization.signingKeyRef,
      stewardId: authorization.stewardId,
    });
    return {
      ok: true,
      eventHash: event.eventHash,
      authorizationId: authorization.authorizationId,
    };
  }

  findCandidate(action: ActionDescriptor, nowMs = Date.now()): CandidateResult {
    for (const entry of this.admitted.values()) {
      const evalResult = this.evaluateEntry(entry, action, nowMs);
      if (evalResult.ok) {
        return {
          ok: true,
          authorizationId: entry.authorization.authorizationId,
          stewardId: entry.stewardId,
          signingKeyRef: entry.signingKeyRef,
          eventHash: entry.eventHash,
          mandateId: `operator:${entry.authorization.authorizationId}`,
        };
      }
    }
    return { ok: false, reason: "none" };
  }

  consumeIfValid(
    authorizationId: string,
    action: ActionDescriptor,
    nowMs = Date.now(),
  ): ConsumeResult {
    const result = this.ledger.transact((tx) => {
      // Reload authoritative state under lock.
      this.rebuildFromLedger();
      const entry = this.admitted.get(authorizationId);
      if (!entry) {
        return { ok: false as const, reason: "not-admitted" as const };
      }
      const evalResult = this.evaluateEntry(entry, action, nowMs);
      if (!evalResult.ok) {
        return evalResult;
      }
      const evidenceDigest = buildStewardEvidenceDigest({
        authorizationId,
        action: {
          classification: action.classification,
          toolName: action.toolName,
        },
        at: nowMs,
      });
      const appended = tx.append({
        kind: "authorization_consumed",
        evidenceDigest,
        detail: {
          authorizationId,
          stewardId: entry.stewardId,
          classification: action.classification,
          toolName: action.toolName,
        },
      });
      if (!appended.ok) {
        return { ok: false as const, reason: "ledger-unavailable" as const };
      }
      entry.remainingUses = Math.max(0, entry.remainingUses - 1);
      return {
        ok: true as const,
        authorizationId,
        stewardId: entry.stewardId,
        signingKeyRef: entry.signingKeyRef,
        eventHash: appended.event.eventHash,
        remainingUses: entry.remainingUses,
      };
    });

    if (!result.ok) {
      return { ok: false, reason: "ledger-unavailable" };
    }
    return result.value;
  }

  async admitRevocation(input: {
    revocation: OperatorAuthorizationRevocationV1;
    format: "detached" | "cleartext";
    signaturesArmored?: string[];
    cleartextArmored?: string;
    nowMs?: number;
  }): Promise<AdmitAuthResult> {
    const loaded = this.ledger.loadVerified();
    if (!loaded.ok || !loaded.policy) {
      return { ok: false, reason: "ledger unavailable" };
    }
    const parsed = parseOperatorAuthorizationRevocation(input.revocation);
    if (!parsed.ok) return { ok: false, reason: parsed.error };
    const revocation = parsed.revocation;
    if (revocation.audience !== loaded.policy.instanceAudience) {
      return { ok: false, reason: "wrong audience" };
    }
    const binding = this.registry.getActiveBinding(
      revocation.stewardId,
      revocation.signingKeyRef,
    );
    if (!binding) {
      return { ok: false, reason: "signing key inactive" };
    }
    const backend = this.backends.get(
      algorithmFromKeyRef(revocation.signingKeyRef),
    );
    if (!backend) return { ok: false, reason: "unsupported backend" };
    const canonical = canonicalizeV2(revocation);
    const nowMs = input.nowMs ?? Date.now();
    const verify =
      input.format === "detached"
        ? await backend.verifyDetached({
            canonicalPayload: canonical,
            signaturesArmored: input.signaturesArmored ?? [],
            publicKeysArmored: [binding.publicKeyArmored],
            expectedKeyRefs: [revocation.signingKeyRef],
            issuedAt: revocation.issuedAt,
            nowMs,
            allowedClockSkewMs: loaded.policy.allowedClockSkewMs,
          })
        : await backend.verifyCleartext({
            cleartextArmored: input.cleartextArmored ?? "",
            expectedCanonicalPayload: canonical,
            publicKeysArmored: [binding.publicKeyArmored],
            expectedKeyRefs: [revocation.signingKeyRef],
            issuedAt: revocation.issuedAt,
            nowMs,
            allowedClockSkewMs: loaded.policy.allowedClockSkewMs,
          });
    if (!verify.ok) return { ok: false, reason: verify.reason };

    const evidenceDigest = buildStewardEvidenceDigest({ revocation });
    const appendResult = this.ledger.transact((tx) =>
      tx.append({
        kind: "authorization_revoked",
        evidenceDigest,
        detail: {
          authorizationId: revocation.authorizationId,
          stewardId: revocation.stewardId,
          signingKeyRef: revocation.signingKeyRef,
          reason: revocation.reason,
        },
        uniqueKeys: { nonce: revocation.nonce },
        retainedEvidence: { revocation },
      }),
    );
    if (!appendResult.ok) {
      return {
        ok: false,
        reason:
          appendResult.error instanceof Error
            ? appendResult.error.message
            : "ledger append failed",
      };
    }
    if (!appendResult.value.ok) {
      return { ok: false, reason: appendResult.value.error.message };
    }
    this.revokedAuthIds.add(revocation.authorizationId);
    const entry = this.admitted.get(revocation.authorizationId);
    if (entry) entry.revoked = true;
    return {
      ok: true,
      eventHash: appendResult.value.event.eventHash,
      authorizationId: revocation.authorizationId,
    };
  }

  private evaluateEntry(
    entry: AdmittedAuthorization,
    action: ActionDescriptor,
    nowMs: number,
  ): ConsumeResult {
    if (entry.revoked || this.revokedAuthIds.has(entry.authorization.authorizationId)) {
      return { ok: false, reason: "authorization-revoked" };
    }
    const binding = this.registry.getActiveBinding(
      entry.stewardId,
      entry.signingKeyRef,
    );
    if (!binding) {
      return { ok: false, reason: "key-inactive" };
    }
    const expires = Date.parse(entry.authorization.expiresAt);
    if (Number.isNaN(expires) || nowMs > expires) {
      return { ok: false, reason: "expired" };
    }
    if (entry.remainingUses <= 0) {
      return { ok: false, reason: "exhausted" };
    }
    const scope = matchesAuthorizationScope(entry.authorization.scope, action);
    if (!scope.matched) {
      return {
        ok: false,
        reason:
          scope.reason === "target-ambiguous"
            ? "target-ambiguous"
            : "scope-mismatch",
      };
    }
    return {
      ok: true,
      authorizationId: entry.authorization.authorizationId,
      stewardId: entry.stewardId,
      signingKeyRef: entry.signingKeyRef,
      eventHash: entry.eventHash,
      remainingUses: entry.remainingUses,
    };
  }

  private async verifyInternal(
    input: VerifyAdmitInput,
  ): Promise<VerifyResult> {
    const loaded = this.ledger.loadVerified();
    if (!loaded.ok || !loaded.policy) {
      return { ok: false, reason: "ledger unavailable" };
    }
    const parsed = parseOperatorAuthorization(input.authorization);
    if (!parsed.ok) return { ok: false, reason: parsed.error };
    const authorization = parsed.authorization;
    if (authorization.audience !== loaded.policy.instanceAudience) {
      return { ok: false, reason: "wrong audience" };
    }

    const issued = Date.parse(authorization.issuedAt);
    const expires = Date.parse(authorization.expiresAt);
    const nowMs = input.nowMs ?? Date.now();
    if (Number.isNaN(issued) || Number.isNaN(expires)) {
      return { ok: false, reason: "invalid timestamps" };
    }
    if (expires <= issued) {
      return { ok: false, reason: "expiresAt must be after issuedAt" };
    }
    const lifetime = expires - issued;
    const maxLifetime =
      authorization.mode === "one-shot"
        ? loaded.policy.maxOneShotLifetimeMs
        : loaded.policy.maxStandingLifetimeMs;
    if (lifetime > maxLifetime) {
      return { ok: false, reason: "lifetime exceeds local policy" };
    }
    if (
      authorization.mode === "standing" &&
      authorization.maxUses > loaded.policy.maxStandingUses
    ) {
      return { ok: false, reason: "maxUses exceeds local policy" };
    }
    if (nowMs > expires + loaded.policy.allowedClockSkewMs) {
      return { ok: false, reason: "authorization expired" };
    }
    if (issued > nowMs + loaded.policy.allowedClockSkewMs) {
      return { ok: false, reason: "authorization not yet valid" };
    }

    const binding = this.registry.getActiveBinding(
      authorization.stewardId,
      authorization.signingKeyRef,
    );
    if (!binding) {
      return { ok: false, reason: "signing key unbound or inactive" };
    }

    const backend = this.backends.get(
      algorithmFromKeyRef(authorization.signingKeyRef),
    );
    if (!backend) {
      return { ok: false, reason: "unsupported signature backend" };
    }

    const canonical = canonicalizeV2(authorization);
    const verify =
      input.format === "detached"
        ? await backend.verifyDetached({
            canonicalPayload: canonical,
            signaturesArmored: input.signaturesArmored ?? [],
            publicKeysArmored: [binding.publicKeyArmored],
            expectedKeyRefs: [authorization.signingKeyRef],
            issuedAt: authorization.issuedAt,
            nowMs,
            allowedClockSkewMs: loaded.policy.allowedClockSkewMs,
          })
        : await backend.verifyCleartext({
            cleartextArmored: input.cleartextArmored ?? "",
            expectedCanonicalPayload: canonical,
            publicKeysArmored: [binding.publicKeyArmored],
            expectedKeyRefs: [authorization.signingKeyRef],
            issuedAt: authorization.issuedAt,
            nowMs,
            allowedClockSkewMs: loaded.policy.allowedClockSkewMs,
          });
    if (!verify.ok) return { ok: false, reason: verify.reason };
    return { ok: true, authorization };
  }

  private async recordRejection(
    authorization: OperatorAuthorizationV1,
    reason: string,
  ): Promise<void> {
    const evidenceDigest = buildStewardEvidenceDigest({
      authorizationId: authorization.authorizationId,
      reason,
    });
    this.ledger.transact((tx) =>
      tx.append({
        kind: "authorization_rejected",
        evidenceDigest,
        detail: {
          reason: reason.slice(0, 256),
          authorizationId: authorization.authorizationId,
        },
      }),
    );
  }
}

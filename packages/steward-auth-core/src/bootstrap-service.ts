/**
 * Secure steward genesis: verify a signed StewardBootstrapV1 bundle, then
 * commit ledger_initialized + key_binding_accepted atomically.
 */

import {
  buildStewardEvidenceDigest,
  bootstrapSigningFields,
  canonicalizeV2,
  containsOpenPgpSecretKeyArmor,
  parseKeyRef,
  parseStewardBootstrap,
  type StewardBootstrapV1,
} from "@ovrsr/fpp-protocol-core";
import type { StewardAuthorizationLedger } from "./ledger.js";
import type { SignatureBackendRegistry } from "./signature-backend.js";
import type { AdmitResult, StewardRegistry } from "./steward-registry.js";

export type AdmitBootstrapInput = {
  bootstrap: StewardBootstrapV1;
  /** Detached OpenPGP signature over canonicalizeV2(bootstrap). */
  signatureArmored: string;
  /** Independently supplied expected key ref (must not be derived from payload alone). */
  expectedKeyRef: string;
  /** Independently supplied instance audience the operator intends to bootstrap. */
  expectedAudience: string;
  /** Max age of bootstrap.issuedAt relative to now (default: policy.allowedClockSkewMs + 24h). */
  maxBootstrapAgeMs?: number;
  nowMs?: number;
};

function algorithmFromKeyRef(keyRef: string): string {
  const idx = keyRef.indexOf(":");
  return idx === -1 ? "unknown" : keyRef.slice(0, idx);
}

function looksLikeCleartextMessage(armored: string): boolean {
  const upper = armored.toUpperCase();
  return (
    upper.includes("BEGIN PGP SIGNED MESSAGE") ||
    (upper.includes("BEGIN PGP MESSAGE") &&
      !upper.includes("BEGIN PGP SIGNATURE"))
  );
}

export class StewardBootstrapService {
  private readonly ledger: StewardAuthorizationLedger;
  private readonly backends: SignatureBackendRegistry;
  private readonly registry: StewardRegistry;

  constructor(options: {
    ledger: StewardAuthorizationLedger;
    backends: SignatureBackendRegistry;
    registry: StewardRegistry;
  }) {
    this.ledger = options.ledger;
    this.backends = options.backends;
    this.registry = options.registry;
  }

  async admitBootstrap(input: AdmitBootstrapInput): Promise<AdmitResult> {
    const parsed = parseStewardBootstrap(input.bootstrap);
    if (!parsed.ok) {
      return { ok: false, reason: parsed.error };
    }
    const bootstrap = parsed.bootstrap;

    const expectedKey = parseKeyRef(input.expectedKeyRef);
    if (!expectedKey.ok) {
      return { ok: false, reason: "invalid expectedKeyRef" };
    }
    if (bootstrap.initialBinding.subjectKey.keyRef !== input.expectedKeyRef) {
      return {
        ok: false,
        reason: "expectedKeyRef does not match bootstrap subject key",
      };
    }

    const expectedAudience = input.expectedAudience;
    if (
      typeof expectedAudience !== "string" ||
      expectedAudience.trim().length === 0
    ) {
      return { ok: false, reason: "independent expected audience is required" };
    }
    if (bootstrap.audience !== expectedAudience) {
      return {
        ok: false,
        reason: "bootstrap audience does not match expected audience",
      };
    }
    if (bootstrap.policy.instanceAudience !== expectedAudience) {
      return {
        ok: false,
        reason: "policy.instanceAudience does not match expected audience",
      };
    }

    const armored = bootstrap.initialBinding.subjectKey.publicKeyArmored;
    if (!armored) {
      return { ok: false, reason: "publicKeyArmored required" };
    }
    if (containsOpenPgpSecretKeyArmor(armored)) {
      return {
        ok: false,
        reason: "OpenPGP secret key material is not accepted",
      };
    }
    if (looksLikeCleartextMessage(input.signatureArmored)) {
      return {
        ok: false,
        reason: "detached signature required; cleartext envelopes are not accepted for bootstrap",
      };
    }

    const backend = this.backends.get(
      algorithmFromKeyRef(bootstrap.initialBinding.subjectKey.keyRef),
    );
    if (!backend) {
      return { ok: false, reason: "unsupported signature backend" };
    }

    const parsedKey = await backend.parsePublicKey(armored);
    if (!parsedKey.ok) {
      return { ok: false, reason: parsedKey.reason };
    }
    if (parsedKey.keyRef !== input.expectedKeyRef) {
      return {
        ok: false,
        reason: "public key fingerprint does not match expectedKeyRef",
      };
    }
    if (parsedKey.keyRef !== bootstrap.initialBinding.subjectKey.keyRef) {
      return {
        ok: false,
        reason: "public key fingerprint does not match subjectKey.keyRef",
      };
    }

    const nowMs = input.nowMs ?? Date.now();
    const skew = bootstrap.policy.allowedClockSkewMs;
    const maxAge =
      input.maxBootstrapAgeMs ?? skew + 24 * 60 * 60 * 1000;
    const issued = Date.parse(bootstrap.issuedAt);
    if (Number.isNaN(issued)) {
      return { ok: false, reason: "invalid bootstrap issuedAt" };
    }
    if (issued > nowMs + skew) {
      return { ok: false, reason: "bootstrap issuedAt is in the future" };
    }
    if (nowMs - issued > maxAge + skew) {
      return { ok: false, reason: "bootstrap issuedAt is too old" };
    }

    const canonical = canonicalizeV2(bootstrapSigningFields(bootstrap));
    const verifyResult = await backend.verifyDetached({
      canonicalPayload: canonical,
      signaturesArmored: [input.signatureArmored],
      publicKeysArmored: [armored],
      expectedKeyRefs: [input.expectedKeyRef],
      issuedAt: bootstrap.issuedAt,
      nowMs,
      allowedClockSkewMs: skew,
    });
    if (!verifyResult.ok) {
      return { ok: false, reason: verifyResult.reason };
    }

    const attestation = bootstrap.initialBinding;
    const evidenceDigest = buildStewardEvidenceDigest({
      bootstrap,
      signatureArmored: input.signatureArmored,
      expectedKeyRef: input.expectedKeyRef,
    });

    const committed = this.ledger.initializeWithInitialBinding(
      {
        instanceAudience: expectedAudience,
        maxStandingLifetimeMs: bootstrap.policy.maxStandingLifetimeMs,
        maxStandingUses: bootstrap.policy.maxStandingUses,
        maxOneShotLifetimeMs: bootstrap.policy.maxOneShotLifetimeMs,
        allowedClockSkewMs: bootstrap.policy.allowedClockSkewMs,
      },
      {
        kind: "key_binding_accepted",
        evidenceDigest,
        detail: {
          stewardId: attestation.stewardId,
          operation: attestation.operation,
          subjectKeyRef: attestation.subjectKey.keyRef,
          bootstrapProfile: "interactive-fingerprint",
          expectedKeyRef: input.expectedKeyRef,
          bootstrapId: bootstrap.bootstrapId,
        },
        uniqueKeys: {
          attestationId: attestation.attestationId,
          nonce: attestation.nonce,
        },
        retainedEvidence: {
          attestation,
          bootstrap,
          publicKeysArmored: [armored],
          format: "detached",
          signaturesArmored: [input.signatureArmored],
          expectedKeyRef: input.expectedKeyRef,
          bootstrapProfile: "interactive-fingerprint",
        },
      },
    );

    if (!committed.ok) {
      return {
        ok: false,
        reason:
          committed.error instanceof Error
            ? committed.error.message
            : String(committed.error),
      };
    }

    this.registry.rebuildFromLedger();
    if (!this.registry.isValid()) {
      return {
        ok: false,
        reason: this.registry.invalidReason() ?? "registry rebuild failed",
      };
    }

    const bindingEvent = committed.events[1];
    if (!bindingEvent) {
      return { ok: false, reason: "missing binding event after bootstrap" };
    }

    return {
      ok: true,
      eventHash: bindingEvent.eventHash,
      stewardId: attestation.stewardId,
    };
  }
}

/**
 * Freshness and replay-key contracts for signed envelopes.
 *
 * Policy limits (max lifetime, clock skew) are verifier-controlled inputs.
 * This module does not implement replay-cache persistence (Plan 4).
 */

import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { canonicalizeV2 } from "./canonical-json.js";

export const FreshnessEnvelopeSchema = Type.Object(
  {
    audience: Type.String({ minLength: 1 }),
    challenge: Type.String({ minLength: 1 }),
    issuedAt: Type.String({ minLength: 1 }),
    expiresAt: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type FreshnessEnvelope = Static<typeof FreshnessEnvelopeSchema>;

export type FreshnessPolicy = {
  /** Maximum allowed (expiresAt - issuedAt) in milliseconds. */
  maxLifetimeMs: number;
  /** Allowed clock skew when comparing issuedAt/expiresAt to now. */
  allowedClockSkewMs: number;
  /** Verifier clock — not signer-controlled. */
  nowMs: number;
};

export type FreshnessValidation = {
  valid: boolean;
  reason: string;
};

export type FreshnessParseResult =
  | { ok: true; envelope: FreshnessEnvelope }
  | { ok: false; error: string };

export function parseFreshnessEnvelope(input: unknown): FreshnessParseResult {
  if (!Value.Check(FreshnessEnvelopeSchema, input)) {
    const errors = [...Value.Errors(FreshnessEnvelopeSchema, input)];
    return {
      ok: false,
      error:
        errors[0] !== undefined
          ? `${errors[0].path}: ${errors[0].message}`
          : "invalid freshness envelope",
    };
  }
  return { ok: true, envelope: input };
}

export function validateFreshness(
  envelope: FreshnessEnvelope,
  policy: FreshnessPolicy,
): FreshnessValidation {
  const issued = Date.parse(envelope.issuedAt);
  const expires = Date.parse(envelope.expiresAt);
  if (Number.isNaN(issued) || Number.isNaN(expires)) {
    return { valid: false, reason: "issuedAt/expiresAt must be ISO-8601" };
  }
  if (expires <= issued) {
    return { valid: false, reason: "expiresAt must be after issuedAt" };
  }
  const lifetime = expires - issued;
  if (lifetime > policy.maxLifetimeMs) {
    return {
      valid: false,
      reason: "lifetime exceeds verifier policy maxLifetimeMs",
    };
  }
  if (issued > policy.nowMs + policy.allowedClockSkewMs) {
    return { valid: false, reason: "issuedAt is in the future beyond skew" };
  }
  if (expires < policy.nowMs - policy.allowedClockSkewMs) {
    return { valid: false, reason: "envelope expired" };
  }
  return { valid: true, reason: "fresh" };
}

/**
 * Deterministic replay key over audience + challenge + issuedAt.
 * Persistence/dedup is deferred to Plan 4.
 */
export function buildReplayKey(envelope: FreshnessEnvelope): string {
  return bytesToHex(
    sha256(
      utf8ToBytes(
        "fpp:v2:replay\0" +
          canonicalizeV2({
            audience: envelope.audience,
            challenge: envelope.challenge,
            issuedAt: envelope.issuedAt,
          }),
      ),
    ),
  );
}

/**
 * Signed emergency override grant — mandate-shaped but mandate-separate.
 *
 * Stewards only for v1: agent-to-agent (peer) escalation without steward
 * involvement is a materially larger trust decision; not an oversight.
 */

import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { canonicalizeV2 } from "./canonical-json.js";
import { verifySignature } from "./identity.js";

export const SignedEmergencyOverrideV1Schema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    overrideId: Type.String({ minLength: 1 }),
    issuerId: Type.String({ minLength: 1 }),
    publicKey: Type.String({ minLength: 1 }),
    signature: Type.String({ minLength: 1 }),
    scope: Type.Object(
      {
        classifications: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
        capabilities: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
      },
      { additionalProperties: false },
    ),
    budgets: Type.Object(
      {
        maxActions: Type.Optional(Type.Integer({ minimum: 0 })),
        remainingActions: Type.Optional(Type.Integer({ minimum: 0 })),
      },
      { additionalProperties: false },
    ),
    validFrom: Type.String({ minLength: 1 }),
    validTo: Type.String({ minLength: 1 }),
    evidenceRef: Type.String({ minLength: 1 }),
    revoked: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export type SignedEmergencyOverrideV1 = Static<
  typeof SignedEmergencyOverrideV1Schema
>;

/** Mutable runtime counters — never part of the signed grant payload. */
export type EmergencyOverrideLedgerEntry = {
  remainingActions?: number;
  revoked?: boolean;
};

/**
 * Shared on-disk emergency override store shape.
 * `ledgers` is additive; absent keys mean unlimited budget / not revoked.
 */
export type EmergencyOverrideStoreFile = {
  schemaVersion: 1;
  overrides: SignedEmergencyOverrideV1[];
  ledgers?: Record<string, EmergencyOverrideLedgerEntry>;
};

export type EmergencyOverrideParseResult =
  | { ok: true; override: SignedEmergencyOverrideV1 }
  | { ok: false; error: string };

export type EmergencyOverrideValidityPolicy = {
  /** Verifier clock — not signer-controlled. */
  nowMs: number;
};

export type EmergencyOverrideValidity = {
  valid: boolean;
  reason: string;
};

export function parseSignedEmergencyOverride(
  input: unknown,
): EmergencyOverrideParseResult {
  if (!Value.Check(SignedEmergencyOverrideV1Schema, input)) {
    const errors = [...Value.Errors(SignedEmergencyOverrideV1Schema, input)];
    return {
      ok: false,
      error:
        errors[0] !== undefined
          ? `${errors[0].path}: ${errors[0].message}`
          : "invalid SignedEmergencyOverrideV1",
    };
  }
  return { ok: true, override: input };
}

/**
 * Temporal / revocation check for a schema-valid emergency override.
 * Budget debit and signature verification live in the enforcement store.
 */
export function validateEmergencyOverrideValidity(
  override: SignedEmergencyOverrideV1,
  policy: EmergencyOverrideValidityPolicy,
): EmergencyOverrideValidity {
  if (override.revoked === true) {
    return { valid: false, reason: "emergency override revoked" };
  }
  const from = Date.parse(override.validFrom);
  const to = Date.parse(override.validTo);
  if (Number.isNaN(from) || Number.isNaN(to)) {
    return { valid: false, reason: "validFrom/validTo must be ISO-8601" };
  }
  if (to <= from) {
    return { valid: false, reason: "validTo must be after validFrom" };
  }
  if (policy.nowMs < from) {
    return {
      valid: false,
      reason: "emergency override not yet valid (validFrom)",
    };
  }
  if (policy.nowMs > to) {
    return { valid: false, reason: "emergency override expired" };
  }
  return { valid: true, reason: "ok" };
}

/**
 * Canonical unsigned payload for emergency override signatures.
 * Excludes `signature`, `revoked`, and `budgets.remainingActions` so debit/revoke
 * can mutate an unsigned ledger without invalidating the grant.
 */
export function emergencyOverrideSigningFields(
  override: SignedEmergencyOverrideV1,
): Record<string, unknown> {
  const {
    signature: _signature,
    revoked: _revoked,
    budgets,
    ...rest
  } = override;
  void _signature;
  void _revoked;
  const signingBudgets: Record<string, unknown> = {};
  if (budgets.maxActions !== undefined) {
    signingBudgets.maxActions = budgets.maxActions;
  }
  return {
    ...rest,
    budgets: signingBudgets,
  };
}

/**
 * Verify an emergency override signature over `emergencyOverrideSigningFields`.
 */
export function verifyEmergencyOverrideSignature(
  override: SignedEmergencyOverrideV1,
): boolean {
  if (!override.publicKey || !override.signature) {
    return false;
  }
  const message = Buffer.from(
    canonicalizeV2(emergencyOverrideSigningFields(override)),
    "utf8",
  );
  const sigBytes = Buffer.from(override.signature, "hex");
  const pubBytes = Buffer.from(override.publicKey, "hex");
  if (sigBytes.length !== 64 || pubBytes.length !== 32) {
    return false;
  }
  return verifySignature(message, sigBytes, pubBytes);
}

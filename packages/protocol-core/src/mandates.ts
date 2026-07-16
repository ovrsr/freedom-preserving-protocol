/**
 * Standing mandate schema — signed or allowlist-backed authorization
 * consumed by the unattended disposition engine.
 */

import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { canonicalizeV2 } from "./canonical-json.js";
import { verifySignature } from "./identity.js";

export const MANDATE_ISSUER_CLASSES = [
  "operator",
  "peer-quorum",
  "steward-quorum",
  "standing-allowlist",
] as const;

export type MandateIssuerClass = (typeof MANDATE_ISSUER_CLASSES)[number];

export const StandingMandateV1Schema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    mandateId: Type.String({ minLength: 1 }),
    issuerClass: Type.Union(
      MANDATE_ISSUER_CLASSES.map((c) => Type.Literal(c)) as [
        ReturnType<typeof Type.Literal<(typeof MANDATE_ISSUER_CLASSES)[number]>>,
        ...ReturnType<
          typeof Type.Literal<(typeof MANDATE_ISSUER_CLASSES)[number]>
        >[],
      ],
    ),
    issuerId: Type.String({ minLength: 1 }),
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
    revocable: Type.Boolean(),
    revoked: Type.Optional(Type.Boolean()),
    evidenceRef: Type.String({ minLength: 1 }),
    quorumRef: Type.Optional(Type.String({ minLength: 1 })),
    publicKey: Type.Optional(Type.String({ minLength: 1 })),
    signature: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

export type StandingMandateV1 = Static<typeof StandingMandateV1Schema>;

/** Mutable runtime counters — never part of the signed grant payload. */
export type MandateLedgerEntry = {
  remainingActions?: number;
  revoked?: boolean;
};

/**
 * Shared on-disk mandate store shape (enforcement-core + trust-core).
 * `ledgers` is additive; absent keys mean unlimited budget / not revoked.
 */
export type MandateStoreFile = {
  schemaVersion: 1;
  mandates: StandingMandateV1[];
  ledgers?: Record<string, MandateLedgerEntry>;
};

export type MandateParseResult =
  | { ok: true; mandate: StandingMandateV1 }
  | { ok: false; error: string };

export type MandateValidityPolicy = {
  /** Verifier clock — not signer-controlled. */
  nowMs: number;
};

export type MandateValidity = {
  valid: boolean;
  reason: string;
};

export function parseStandingMandate(input: unknown): MandateParseResult {
  if (!Value.Check(StandingMandateV1Schema, input)) {
    const errors = [...Value.Errors(StandingMandateV1Schema, input)];
    return {
      ok: false,
      error:
        errors[0] !== undefined
          ? `${errors[0].path}: ${errors[0].message}`
          : "invalid StandingMandateV1",
    };
  }
  return { ok: true, mandate: input };
}

/**
 * Temporal / revocation check for a schema-valid mandate.
 * Budget debit and signature verification live in the plugin mandate store.
 */
export function validateMandateValidity(
  mandate: StandingMandateV1,
  policy: MandateValidityPolicy,
): MandateValidity {
  if (mandate.revoked === true) {
    return { valid: false, reason: "mandate revoked" };
  }
  const from = Date.parse(mandate.validFrom);
  const to = Date.parse(mandate.validTo);
  if (Number.isNaN(from) || Number.isNaN(to)) {
    return { valid: false, reason: "validFrom/validTo must be ISO-8601" };
  }
  if (to <= from) {
    return { valid: false, reason: "validTo must be after validFrom" };
  }
  if (policy.nowMs < from) {
    return { valid: false, reason: "mandate not yet valid (validFrom)" };
  }
  if (policy.nowMs > to) {
    return { valid: false, reason: "mandate expired" };
  }
  return { valid: true, reason: "ok" };
}

/**
 * Canonical unsigned payload for new mandate signatures.
 * Excludes `signature`, `revoked`, and `budgets.remainingActions` so debit/revoke
 * can mutate an unsigned ledger without invalidating the grant.
 */
export function mandateSigningFields(
  mandate: StandingMandateV1,
): Record<string, unknown> {
  const {
    signature: _signature,
    revoked: _revoked,
    budgets,
    ...rest
  } = mandate;
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

function legacySigningFields(
  mandate: StandingMandateV1,
): Record<string, unknown> {
  const { signature: _signature, ...unsigned } = mandate;
  void _signature;
  return unsigned as Record<string, unknown>;
}

function tryVerifyMandatePayload(
  mandate: StandingMandateV1,
  payload: Record<string, unknown>,
): boolean {
  if (!mandate.publicKey || !mandate.signature) {
    return false;
  }
  const message = Buffer.from(canonicalizeV2(payload), "utf8");
  const sigBytes = Buffer.from(mandate.signature, "hex");
  const pubBytes = Buffer.from(mandate.publicKey, "hex");
  if (sigBytes.length !== 64 || pubBytes.length !== 32) {
    return false;
  }
  return verifySignature(message, sigBytes, pubBytes);
}

/**
 * Dual-verify mandate signatures:
 * 1. New payload (`mandateSigningFields`) — preferred for newly issued grants.
 * 2. Legacy payload (full object minus `signature`) — undebited historical files.
 *
 * Standing-allowlist mandates are unsigned by design.
 */
export function verifyMandateSignature(mandate: StandingMandateV1): boolean {
  if (mandate.issuerClass === "standing-allowlist") {
    return true;
  }
  if (!mandate.publicKey || !mandate.signature) {
    return false;
  }
  if (tryVerifyMandatePayload(mandate, mandateSigningFields(mandate))) {
    return true;
  }
  return tryVerifyMandatePayload(mandate, legacySigningFields(mandate));
}

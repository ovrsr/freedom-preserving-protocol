/**
 * Standing mandate schema — signed or allowlist-backed authorization
 * consumed by the unattended disposition engine.
 */

import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

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

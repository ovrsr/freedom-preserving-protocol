/**
 * Conformance receipt schema (emission deferred to later plans).
 */

import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  GovernanceEpochSchema,
  GovernanceModeSchema,
} from "./governance.js";

const DigestHexSchema = Type.String({ pattern: "^[0-9a-f]{64}$" });

export const ReceiptInclusionEvidenceV1Schema = Type.Object(
  {
    evidenceVersion: Type.Literal(1),
    logKind: Type.Literal("conformance-receipt"),
    entry: Type.Object(
      {
        previousHash: DigestHexSchema,
        timestamp: Type.String({ minLength: 1 }),
        kind: Type.Literal("conformance-receipt"),
        receipt: Type.Unknown(),
        hash: DigestHexSchema,
      },
      { additionalProperties: false },
    ),
    proof: Type.Object(
      {
        leaf: DigestHexSchema,
        index: Type.Integer({ minimum: 0 }),
        path: Type.Array(
          Type.Object(
            {
              hash: DigestHexSchema,
              position: Type.Union([
                Type.Literal("left"),
                Type.Literal("right"),
              ]),
            },
            { additionalProperties: false },
          ),
        ),
        root: DigestHexSchema,
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export type ReceiptInclusionEvidenceV1 = Static<
  typeof ReceiptInclusionEvidenceV1Schema
>;

export type ReceiptInclusionEvidenceParseResult =
  | { ok: true; evidence: ReceiptInclusionEvidenceV1 }
  | { ok: false; error: string };

export function parseReceiptInclusionEvidence(
  input: unknown,
): ReceiptInclusionEvidenceParseResult {
  if (!Value.Check(ReceiptInclusionEvidenceV1Schema, input)) {
    return { ok: false, error: "invalid ReceiptInclusionEvidenceV1" };
  }
  return { ok: true, evidence: input };
}

export const ConformanceReceiptV1Schema = Type.Union([
  Type.Object(
    {
      schemaVersion: Type.Literal(1),
      receiptClass: Type.Literal("conformance"),
      actionDigest: DigestHexSchema,
      policyId: Type.String({ minLength: 1 }),
      policyVersion: Type.String({ minLength: 1 }),
      implementationVersion: Type.String({ minLength: 1 }),
      disposition: Type.Union([
        Type.Literal("allow"),
        Type.Literal("deny"),
        Type.Literal("require_approval"),
        Type.Literal("abstain"),
        Type.Literal("allow_staged"),
        Type.Literal("allow_minimal"),
      ]),
      authorization: Type.String({ minLength: 1 }),
      outcome: Type.String({ minLength: 1 }),
      issuedAt: Type.String({ minLength: 1 }),
      constitutionHash: Type.Optional(DigestHexSchema),
      classifierRulesetHash: Type.Optional(DigestHexSchema),
      effectiveConfigHash: Type.Optional(DigestHexSchema),
      // Forbidden when unpaired — both keys must be absent in this branch.
      governanceEpoch: Type.Optional(Type.Never()),
      governanceMode: Type.Optional(Type.Never()),
    },
    { additionalProperties: true },
  ),
  Type.Object(
    {
      schemaVersion: Type.Literal(1),
      receiptClass: Type.Literal("conformance"),
      actionDigest: DigestHexSchema,
      policyId: Type.String({ minLength: 1 }),
      policyVersion: Type.String({ minLength: 1 }),
      implementationVersion: Type.String({ minLength: 1 }),
      disposition: Type.Union([
        Type.Literal("allow"),
        Type.Literal("deny"),
        Type.Literal("require_approval"),
        Type.Literal("abstain"),
        Type.Literal("allow_staged"),
        Type.Literal("allow_minimal"),
      ]),
      authorization: Type.String({ minLength: 1 }),
      outcome: Type.String({ minLength: 1 }),
      issuedAt: Type.String({ minLength: 1 }),
      constitutionHash: Type.Optional(DigestHexSchema),
      classifierRulesetHash: Type.Optional(DigestHexSchema),
      effectiveConfigHash: Type.Optional(DigestHexSchema),
      /** Gateway governance binding — both fields required together. */
      governanceEpoch: GovernanceEpochSchema,
      governanceMode: GovernanceModeSchema,
    },
    { additionalProperties: true },
  ),
]);

export type ConformanceReceiptV1 = Static<typeof ConformanceReceiptV1Schema>;

export type ReceiptParseResult =
  | { ok: true; receipt: ConformanceReceiptV1 }
  | { ok: false; error: string };

export function parseConformanceReceipt(input: unknown): ReceiptParseResult {
  if (!Value.Check(ConformanceReceiptV1Schema, input)) {
    return { ok: false, error: "invalid ConformanceReceiptV1" };
  }
  const issuedAt = (input as ConformanceReceiptV1).issuedAt;
  const issuedAtMs = Date.parse(issuedAt);
  if (
    !Number.isFinite(issuedAtMs) ||
    new Date(issuedAtMs).toISOString() !== issuedAt
  ) {
    return {
      ok: false,
      error: "invalid ConformanceReceiptV1: issuedAt must be canonical ISO-8601",
    };
  }
  return { ok: true, receipt: input as ConformanceReceiptV1 };
}

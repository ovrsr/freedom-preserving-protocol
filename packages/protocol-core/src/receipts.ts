/**
 * Conformance receipt schema (emission deferred to later plans).
 */

import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export const ConformanceReceiptV1Schema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    receiptClass: Type.Literal("conformance"),
    actionDigest: Type.String({ minLength: 1 }),
    policyId: Type.String({ minLength: 1 }),
    policyVersion: Type.String({ minLength: 1 }),
    implementationVersion: Type.String({ minLength: 1 }),
    disposition: Type.Union([
      Type.Literal("allow"),
      Type.Literal("deny"),
      Type.Literal("require_approval"),
      Type.Literal("abstain"),
    ]),
    authorization: Type.String({ minLength: 1 }),
    outcome: Type.String({ minLength: 1 }),
    issuedAt: Type.String({ minLength: 1 }),
  },
  { additionalProperties: true },
);

export type ConformanceReceiptV1 = Static<typeof ConformanceReceiptV1Schema>;

export type ReceiptParseResult =
  | { ok: true; receipt: ConformanceReceiptV1 }
  | { ok: false; error: string };

export function parseConformanceReceipt(input: unknown): ReceiptParseResult {
  if (!Value.Check(ConformanceReceiptV1Schema, input)) {
    return { ok: false, error: "invalid ConformanceReceiptV1" };
  }
  return { ok: true, receipt: input };
}

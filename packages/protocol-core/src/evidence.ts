/**
 * Append-only evidence envelopes with optional correction references.
 * Global trust scores are intentionally excluded.
 */

import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { CLAIM_CLASSES } from "./claims.js";

export const EvidenceEnvelopeV1Schema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    evidenceId: Type.String({ minLength: 1 }),
    evidenceClass: Type.Union([
      Type.Literal("claim"),
      Type.Literal("receipt"),
      Type.Literal("capsule"),
      Type.Literal("adoption"),
      Type.Literal("annotation"),
    ]),
    claimClass: Type.Optional(
      Type.Union(
        CLAIM_CLASSES.map((c) => Type.Literal(c)) as [
          ReturnType<typeof Type.Literal<(typeof CLAIM_CLASSES)[number]>>,
          ...ReturnType<typeof Type.Literal<(typeof CLAIM_CLASSES)[number]>>[],
        ],
      ),
    ),
    payloadDigest: Type.String({ minLength: 1 }),
    recordedAt: Type.String({ minLength: 1 }),
    corrects: Type.Optional(Type.String({ minLength: 1 })),
    annotation: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export type EvidenceEnvelopeV1 = Static<typeof EvidenceEnvelopeV1Schema>;

export type EvidenceParseResult =
  | { ok: true; envelope: EvidenceEnvelopeV1 }
  | { ok: false; error: string };

export function parseEvidenceEnvelope(input: unknown): EvidenceParseResult {
  if (!Value.Check(EvidenceEnvelopeV1Schema, input)) {
    return { ok: false, error: "invalid EvidenceEnvelopeV1" };
  }
  return { ok: true, envelope: input };
}

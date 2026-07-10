/**
 * Trust-state capsule schema (emission deferred to later plans).
 */

import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { FreshnessEnvelopeSchema } from "./freshness.js";
import { KEY_ALGORITHM } from "./identity.js";

export const TrustStateCapsuleV2Schema = Type.Object(
  {
    schemaVersion: Type.Literal(2),
    runtimeId: Type.String({ minLength: 1 }),
    implementationVersion: Type.String({ minLength: 1 }),
    evidenceRoot: Type.String({ minLength: 1 }),
    coverage: Type.Object({
      claims: Type.Integer({ minimum: 0 }),
      receipts: Type.Integer({ minimum: 0 }),
      completeness: Type.Union([
        Type.Literal("none"),
        Type.Literal("partial"),
        Type.Literal("full"),
      ]),
    }),
    freshness: FreshnessEnvelopeSchema,
    agentId: Type.String({ minLength: 1 }),
    publicKey: Type.String({ minLength: 1 }),
    signature: Type.String({ minLength: 1 }),
    keyAlgorithm: Type.Literal(KEY_ALGORITHM),
  },
  { additionalProperties: true },
);

export type TrustStateCapsuleV2 = Static<typeof TrustStateCapsuleV2Schema>;

export type CapsuleParseResult =
  | { ok: true; capsule: TrustStateCapsuleV2 }
  | { ok: false; error: string };

export function parseTrustStateCapsule(input: unknown): CapsuleParseResult {
  if (!Value.Check(TrustStateCapsuleV2Schema, input)) {
    return { ok: false, error: "invalid TrustStateCapsuleV2" };
  }
  return { ok: true, capsule: input };
}

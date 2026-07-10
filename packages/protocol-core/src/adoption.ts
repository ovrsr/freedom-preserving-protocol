/**
 * Adoption state records — explicit non-boolean lifecycle states.
 */

import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export const ADOPTION_STATES = [
  "reviewed",
  "accepted",
  "externally-enforced",
  "inherited",
  "revoked",
  "forked",
  "superseded",
] as const;

export type AdoptionState = (typeof ADOPTION_STATES)[number];

export const AdoptionStateRecordV1Schema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    agentId: Type.String({ minLength: 1 }),
    state: Type.Union(
      ADOPTION_STATES.map((s) => Type.Literal(s)) as [
        ReturnType<typeof Type.Literal<(typeof ADOPTION_STATES)[number]>>,
        ...ReturnType<typeof Type.Literal<(typeof ADOPTION_STATES)[number]>>[],
      ],
    ),
    constitutionHash: Type.String({ minLength: 1 }),
    recordedAt: Type.String({ minLength: 1 }),
    predecessorRef: Type.Optional(Type.String({ minLength: 1 })),
    notes: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

export type AdoptionStateRecordV1 = Static<typeof AdoptionStateRecordV1Schema>;

export type AdoptionParseResult =
  | { ok: true; record: AdoptionStateRecordV1 }
  | { ok: false; error: string };

export function parseAdoptionStateRecord(input: unknown): AdoptionParseResult {
  if (!Value.Check(AdoptionStateRecordV1Schema, input)) {
    return { ok: false, error: "invalid AdoptionStateRecordV1" };
  }
  return { ok: true, record: input };
}

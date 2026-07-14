/**
 * Adoption state records — explicit non-boolean lifecycle states.
 *
 * V1 records remain parseable as legacy. V2 adds overlay flags, harness
 * identity, and enforcement grade. Parsers never silently upgrade V1 to V2
 * or invent peer-advertisable assurance.
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

export const ADOPTION_OVERLAY_FLAGS = [
  "coercion_suspected",
  "verification_failed",
  "key_compromised",
  "runtime_degraded",
] as const;

export type AdoptionOverlayFlag = (typeof ADOPTION_OVERLAY_FLAGS)[number];

export const ENFORCEMENT_GRADES = [
  "native-hook",
  "tool-proxy",
  "prompt-only",
  "none",
] as const;

export type EnforcementGrade = (typeof ENFORCEMENT_GRADES)[number];

const AdoptionStateUnion = Type.Union(
  ADOPTION_STATES.map((s) => Type.Literal(s)) as [
    ReturnType<typeof Type.Literal<(typeof ADOPTION_STATES)[number]>>,
    ...ReturnType<typeof Type.Literal<(typeof ADOPTION_STATES)[number]>>[],
  ],
);

const OverlayFlagUnion = Type.Union(
  ADOPTION_OVERLAY_FLAGS.map((f) => Type.Literal(f)) as [
    ReturnType<typeof Type.Literal<(typeof ADOPTION_OVERLAY_FLAGS)[number]>>,
    ...ReturnType<
      typeof Type.Literal<(typeof ADOPTION_OVERLAY_FLAGS)[number]>
    >[],
  ],
);

const EnforcementGradeUnion = Type.Union(
  ENFORCEMENT_GRADES.map((g) => Type.Literal(g)) as [
    ReturnType<typeof Type.Literal<(typeof ENFORCEMENT_GRADES)[number]>>,
    ...ReturnType<typeof Type.Literal<(typeof ENFORCEMENT_GRADES)[number]>>[],
  ],
);

export const AdoptionStateRecordV1Schema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    agentId: Type.String({ minLength: 1 }),
    state: AdoptionStateUnion,
    constitutionHash: Type.String({ minLength: 1 }),
    recordedAt: Type.String({ minLength: 1 }),
    predecessorRef: Type.Optional(Type.String({ minLength: 1 })),
    notes: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

export type AdoptionStateRecordV1 = Static<typeof AdoptionStateRecordV1Schema>;

export const AdoptionStateRecordV2Schema = Type.Object(
  {
    schemaVersion: Type.Literal(2),
    agentId: Type.String({ minLength: 1 }),
    state: AdoptionStateUnion,
    constitutionHash: Type.String({ minLength: 1 }),
    recordedAt: Type.String({ minLength: 1 }),
    harnessId: Type.String({ minLength: 1 }),
    enforcementGrade: EnforcementGradeUnion,
    overlays: Type.Array(OverlayFlagUnion),
    predecessorRef: Type.Optional(Type.String({ minLength: 1 })),
    notes: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

export type AdoptionStateRecordV2 = Static<typeof AdoptionStateRecordV2Schema>;

export type AdoptionStateRecord =
  | AdoptionStateRecordV1
  | AdoptionStateRecordV2;

export type AdoptionParseResult =
  | { ok: true; kind: "v1"; record: AdoptionStateRecordV1 }
  | { ok: true; kind: "v2"; record: AdoptionStateRecordV2 }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Parse untrusted adoption JSON into an explicit v1 or v2 result.
 * V1 never escalates to v2; missing schemaVersion 2 fields fail closed.
 */
export function parseAdoptionStateRecord(input: unknown): AdoptionParseResult {
  if (!isRecord(input)) {
    return { ok: false, error: "adoption record must be a JSON object" };
  }

  if (input.schemaVersion === 2) {
    if (!Value.Check(AdoptionStateRecordV2Schema, input)) {
      return { ok: false, error: "invalid AdoptionStateRecordV2" };
    }
    return { ok: true, kind: "v2", record: input };
  }

  if (input.schemaVersion === 1) {
    if (!Value.Check(AdoptionStateRecordV1Schema, input)) {
      return { ok: false, error: "invalid AdoptionStateRecordV1" };
    }
    // Return only V1 fields so extra V2-shaped keys cannot imply graded claims.
    const record: AdoptionStateRecordV1 = {
      schemaVersion: 1,
      agentId: input.agentId as string,
      state: input.state as AdoptionState,
      constitutionHash: input.constitutionHash as string,
      recordedAt: input.recordedAt as string,
    };
    if (typeof input.predecessorRef === "string") {
      record.predecessorRef = input.predecessorRef;
    }
    if (typeof input.notes === "string") {
      record.notes = input.notes;
    }
    return { ok: true, kind: "v1", record };
  }

  return {
    ok: false,
    error: `unsupported adoption schema version: ${String(input.schemaVersion)}`,
  };
}

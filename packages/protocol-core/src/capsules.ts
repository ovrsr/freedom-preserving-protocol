/**
 * Trust-state capsule schema (emission deferred to later plans).
 * Plan 13: optional adoptionDisclosure summary for peer-facing grade/assurance.
 */

import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { FreshnessEnvelopeSchema } from "./freshness.js";
import { KEY_ALGORITHM } from "./identity.js";
import {
  ADOPTION_OVERLAY_FLAGS,
  ENFORCEMENT_GRADES,
} from "./adoption.js";
import { ADOPTION_ASSURANCE_CLASSES } from "./adoption-disclosure.js";

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

const AssuranceUnion = Type.Union(
  ADOPTION_ASSURANCE_CLASSES.map((a) => Type.Literal(a)) as [
    ReturnType<typeof Type.Literal<(typeof ADOPTION_ASSURANCE_CLASSES)[number]>>,
    ...ReturnType<
      typeof Type.Literal<(typeof ADOPTION_ASSURANCE_CLASSES)[number]>
    >[],
  ],
);

/** Compact peer-facing adoption summary (no raw MEMORY/SOUL). */
export const CapsuleAdoptionDisclosureSummarySchema = Type.Object(
  {
    constitutionHash: Type.String({ minLength: 1 }),
    harnessId: Type.String({ minLength: 1 }),
    localState: Type.String({ minLength: 1 }),
    enforcementGrade: EnforcementGradeUnion,
    overlays: Type.Array(OverlayFlagUnion),
    assurance: AssuranceUnion,
  },
  { additionalProperties: false },
);

export type CapsuleAdoptionDisclosureSummary = Static<
  typeof CapsuleAdoptionDisclosureSummarySchema
>;

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
    adoptionDisclosure: Type.Optional(CapsuleAdoptionDisclosureSummarySchema),
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

export type CapsuleAdoptionConsistency = {
  ok: boolean;
  error?: string | undefined;
};

/**
 * Peer-summary contract: if adoption is advertised, disclosure summary is
 * required. Prompt-only / declaration-only cannot elevate completeness to full.
 */
export function validateCapsuleAdoptionConsistency(
  input: unknown,
): CapsuleAdoptionConsistency {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "capsule must be an object" };
  }
  const obj = input as Record<string, unknown>;
  const advertising = obj.advertisingAdoption === true;

  const disclosure = obj.adoptionDisclosure;
  if (advertising && (disclosure === undefined || disclosure === null)) {
    return {
      ok: false,
      error:
        "peer-summary adoption advertisement requires adoptionDisclosure summary",
    };
  }

  if (disclosure === undefined || disclosure === null) {
    return { ok: true };
  }

  if (!Value.Check(CapsuleAdoptionDisclosureSummarySchema, disclosure)) {
    return { ok: false, error: "invalid adoptionDisclosure summary" };
  }

  const coverage = obj.coverage as
    | { completeness?: string }
    | undefined;
  const completeness = coverage?.completeness;
  if (
    (disclosure.enforcementGrade === "prompt-only" ||
      disclosure.assurance === "declaration-only") &&
    completeness === "full"
  ) {
    return {
      ok: false,
      error:
        "prompt-only / declaration-only adoptionDisclosure cannot pair with completeness=full",
    };
  }

  if (
    disclosure.enforcementGrade === "tool-proxy" &&
    completeness === "full"
  ) {
    return {
      ok: false,
      error:
        "tool-proxy adoptionDisclosure is capped at partial completeness (grade=tool-proxy assurance=" +
        disclosure.assurance +
        ")",
    };
  }

  return { ok: true };
}

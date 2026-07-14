/**
 * AdoptionDisclosure — peer-facing summary of local adoption stance.
 *
 * Assurance classes are capped by enforcement grade. Prompt-only and none
 * cannot elevate to peer-advertisable. Aligns with EVIDENCE_SEMANTICS §7.
 */

import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  ADOPTION_OVERLAY_FLAGS,
  ENFORCEMENT_GRADES,
  type EnforcementGrade,
} from "./adoption.js";

export const ADOPTION_ASSURANCE_CLASSES = [
  "peer-advertisable",
  "declaration-only",
] as const;

export type AdoptionAssurance = (typeof ADOPTION_ASSURANCE_CLASSES)[number];

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

export const AdoptionDisclosureV1Schema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    agentId: Type.String({ minLength: 1 }),
    constitutionHash: Type.String({ minLength: 1 }),
    harnessId: Type.String({ minLength: 1 }),
    localState: Type.String({ minLength: 1 }),
    enforcementGrade: EnforcementGradeUnion,
    overlays: Type.Array(OverlayFlagUnion),
    assurance: AssuranceUnion,
    recordedAt: Type.String({ minLength: 1 }),
  },
  { additionalProperties: true },
);

export type AdoptionDisclosureV1 = Static<typeof AdoptionDisclosureV1Schema>;

export type AdoptionDisclosureParseResult =
  | { ok: true; disclosure: AdoptionDisclosureV1 }
  | { ok: false; error: string };

/**
 * Max justified conclusion per assurance class (Evidence Semantics §7).
 * Does not authorize behavioral compliance or completeness elevation.
 */
export function maxJustifiedConclusion(assurance: AdoptionAssurance): string {
  if (assurance === "declaration-only") {
    return "Agent attested local constitutional self-binding (and grade/overlays if present); not boundary coverage, completeness, or dispatcher compliance";
  }
  return "Probe-backed enforcement grade within its advertisability ceiling; not behavioral compliance or gateway non-bypassability";
}

function elevationError(
  grade: EnforcementGrade,
  assurance: AdoptionAssurance,
  overlays: readonly string[],
): string | null {
  if (assurance !== "peer-advertisable") {
    if (grade === "prompt-only" && !overlays.includes("runtime_degraded")) {
      return "prompt-only local accepted requires overlay runtime_degraded";
    }
    return null;
  }

  if (grade === "prompt-only") {
    return "prompt-only cannot elevate to peer-advertisable";
  }
  if (grade === "none") {
    return "none cannot elevate to peer-advertisable";
  }
  if (grade === "tool-proxy" && !overlays.includes("runtime_degraded")) {
    return "tool-proxy peer-advertisable requires partial/degraded disclosure (runtime_degraded)";
  }
  return null;
}

export function parseAdoptionDisclosure(
  input: unknown,
): AdoptionDisclosureParseResult {
  if (!Value.Check(AdoptionDisclosureV1Schema, input)) {
    return { ok: false, error: "invalid AdoptionDisclosureV1" };
  }
  const disclosure = input;
  const policyError = elevationError(
    disclosure.enforcementGrade,
    disclosure.assurance,
    disclosure.overlays,
  );
  if (policyError) {
    return { ok: false, error: policyError };
  }
  return { ok: true, disclosure };
}

export {
  buildTrustStateCapsule,
  isLegacyClaimMasquerading,
  validateTrustStateCapsule,
  type BuiltCapsule,
  type CapsuleBuildInput,
  type CapsuleCoverageMetrics,
  type CapsuleValidation,
  type CapsuleView,
  type CapsuleViewSummaries,
} from "@ovrsr/fpp-trust-core";

import {
  parseAdoptionDisclosure,
  validateCapsuleAdoptionConsistency,
  type CapsuleAdoptionDisclosureSummary,
} from "@ovrsr/fpp-protocol-core";
import {
  validateTrustStateCapsule as validateTrustStateCapsuleCore,
  type CapsuleValidation,
} from "@ovrsr/fpp-trust-core";
import type { FreshnessPolicy } from "@ovrsr/fpp-protocol-core";

/**
 * Peer validation for capsules that carry graded adoption disclosures.
 * Refuses elevating declaration-only / prompt-only toward completeness.
 */
export function validateCapsuleWithAdoptionDisclosure(
  input: unknown,
  policy: FreshnessPolicy,
): CapsuleValidation & {
  adoptionOk: boolean;
  adoptionReasons: string[];
} {
  const base = validateTrustStateCapsuleCore(input, policy);
  const adoptionReasons: string[] = [];

  const consistency = validateCapsuleAdoptionConsistency(input);
  if (!consistency.ok && consistency.error) {
    adoptionReasons.push(consistency.error);
  }

  if (
    input &&
    typeof input === "object" &&
    "adoptionDisclosure" in input &&
    (input as { adoptionDisclosure?: unknown }).adoptionDisclosure
  ) {
    const summary = (input as { adoptionDisclosure: CapsuleAdoptionDisclosureSummary })
      .adoptionDisclosure;
    const parsed = parseAdoptionDisclosure({
      schemaVersion: 1,
      agentId:
        typeof (input as { agentId?: string }).agentId === "string"
          ? (input as { agentId: string }).agentId
          : "unknown",
      constitutionHash: summary.constitutionHash,
      harnessId: summary.harnessId,
      localState: summary.localState,
      enforcementGrade: summary.enforcementGrade,
      overlays: summary.overlays,
      assurance: summary.assurance,
      recordedAt: new Date(0).toISOString(),
    });
    if (!parsed.ok) {
      adoptionReasons.push(parsed.error);
    }
  }

  const adoptionOk = adoptionReasons.length === 0;
  return {
    ...base,
    valid: base.valid && adoptionOk,
    reasons: [...base.reasons, ...adoptionReasons],
    adoptionOk,
    adoptionReasons,
  };
}

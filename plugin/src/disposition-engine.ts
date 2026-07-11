/**
 * Pure disposition engine — no OpenClaw imports.
 *
 * Canonical unattended flow:
 *   hard-floor → mandate/standing-allow → staged → quorum → emergency → abstain
 * Operator-present may return require_approval for approvalOn / strict overrides
 * (staged/emergency/abstain are unattended-only).
 */

import type {
  AuthorizationClass,
  DispositionDecision,
  MandateIssuerClass,
} from "@ovrsr/fpp-protocol-core";
import type { DispositionMode, FppPluginConfig } from "./config.js";
import type { ClassificationResult } from "./risk-classifier.js";
import { isReversibleClassification } from "./reversibility.js";

export type LiveMandateCoverage = {
  mandateId: string;
  issuerClass: MandateIssuerClass;
  authorization: AuthorizationClass;
};

export type ResolveDispositionInput = {
  classification: ClassificationResult;
  config: Pick<
    FppPluginConfig,
    "blockOn" | "approvalOn" | "dispositionMode" | "standingAllowOn"
  > & { dispositionMode: DispositionMode };
  liveMandate?: LiveMandateCoverage | null | undefined;
  /** When false, mandate/staged paths that need budget are skipped. Default true. */
  budgetAvailable?: boolean | undefined;
  /** Override reversibility heuristic; default uses isReversibleClassification. */
  reversible?: boolean | undefined;
  /** Plan 9 seam: true when a valid quorum-issued mandate covers this action. */
  quorumMandatePresent?: boolean | undefined;
  emergencyCriteriaMet?: boolean | undefined;
  strictOverrides?: string[] | undefined;
};

export type DispositionResult = {
  disposition: DispositionDecision;
  authorization: AuthorizationClass;
  reason: string;
  mandateId?: string | undefined;
};

function isHardFloor(
  classification: ClassificationResult,
  blockOn: string[],
): boolean {
  if (blockOn.includes(classification.classification)) return true;
  // Classifier hard-block is never silently downgraded in unattended mode.
  if (classification.decision === "block") return true;
  return false;
}

/**
 * Resolve the disposition for a classified tool call.
 * Pure function — callers own mandate debit, staged registration, and hook mapping.
 */
export function resolveDisposition(
  input: ResolveDispositionInput,
): DispositionResult {
  const {
    classification,
    config,
    liveMandate = null,
    budgetAvailable = true,
    quorumMandatePresent = false,
    emergencyCriteriaMet = false,
    strictOverrides = [],
  } = input;

  const reversible =
    input.reversible ?? isReversibleClassification(classification.classification);

  if (isHardFloor(classification, config.blockOn)) {
    return {
      disposition: "deny",
      authorization: "policy-block",
      reason: `hard-floor: ${classification.classification}`,
    };
  }

  if (liveMandate && budgetAvailable) {
    return {
      disposition: "allow",
      authorization: liveMandate.authorization,
      reason: `mandate ${liveMandate.mandateId} (${liveMandate.issuerClass})`,
      mandateId: liveMandate.mandateId,
    };
  }

  if (
    config.standingAllowOn.includes(classification.classification) &&
    budgetAvailable
  ) {
    return {
      disposition: "allow",
      authorization: "standing-allowlist",
      reason: `standing allowlist covers ${classification.classification}`,
    };
  }

  // Operator-present: keep requireApproval for approvalOn / strict / classifier approval.
  // Staged / emergency / abstain paths are unattended-only.
  if (config.dispositionMode === "operator-present") {
    if (
      config.approvalOn.includes(classification.classification) ||
      strictOverrides.includes(classification.classification) ||
      classification.decision === "approval"
    ) {
      return {
        disposition: "require_approval",
        authorization: "approved",
        reason: `operator-present approval gate: ${classification.classification}`,
      };
    }
    if (classification.decision === "allow") {
      return {
        disposition: "allow",
        authorization: "approved",
        reason: "classifier allow",
      };
    }
    return {
      disposition: "require_approval",
      authorization: "approved",
      reason: `operator-present fail-safe approval: ${classification.classification}`,
    };
  }

  if (reversible && budgetAvailable) {
    return {
      disposition: "allow_staged",
      authorization: "mandate",
      reason: `staged-allow: reversible ${classification.classification}`,
    };
  }

  // Quorum path: Plan 9 issues signed mandates; this plan only consumes the flag
  // / live mandate with quorum authorization. Prefer liveMandate above when set.
  if (quorumMandatePresent && budgetAvailable) {
    return {
      disposition: "allow",
      authorization: "quorum-mandate",
      reason: "quorum mandate present",
    };
  }

  if (emergencyCriteriaMet) {
    return {
      disposition: "allow_minimal",
      authorization: "emergency",
      reason: `emergency allow-minimal: ${classification.classification}`,
    };
  }

  // Unattended default: abstain (no requireApproval hang).
  return {
    disposition: "abstain",
    authorization: "abstain",
    reason: `abstain: no mandate/staged/emergency path for ${classification.classification}`,
  };
}

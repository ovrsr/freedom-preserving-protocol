/**
 * Quorum policy: local thresholds, eligible voters, role checks,
 * and optional minimum trust standing to cast a ballot.
 *
 * Not constitutional ratification — local operator policy only.
 */

import type { QuorumClass } from "@ovrsr/fpp-protocol-core";
import {
  isKeyValidAt,
  type KeyLifecycleLedger,
} from "./key-lifecycle.js";
import { TrustLevel } from "./trust-graph.js";

export type QuorumVoterRole = "peer" | "steward";

export type QuorumPolicyConfig = {
  /** Minimum aye votes for peer-quorum finalize. */
  peerThreshold: number;
  /** Minimum aye votes for steward-quorum finalize. */
  stewardThreshold: number;
  /** Agent IDs eligible to vote as peers (empty = none). */
  peerEligibleIds: string[];
  /** Agent IDs eligible to vote as stewards (empty = none). */
  stewardEligibleIds: string[];
  /**
   * Optional minimum TrustLevel ordinal required to cast a ballot.
   * UNKNOWN=0 … MAXIMUM=4. Omit / undefined = no standing floor.
   */
  minStandingLevel?: TrustLevel | undefined;
  /** Proposal TTL hint in ms (session may enforce separately). */
  proposalTtlMs?: number | undefined;
};

export const DEFAULT_QUORUM_POLICY: QuorumPolicyConfig = {
  peerThreshold: 2,
  stewardThreshold: 2,
  peerEligibleIds: [],
  stewardEligibleIds: [],
  proposalTtlMs: 3_600_000,
};

export type BallotEligibilityInput = {
  voterId: string;
  publicKeyHex: string;
  quorumClass: QuorumClass;
  nowMs: number;
  /** Observed standing for the voter in the relevant capability scope. */
  standingLevel?: TrustLevel | undefined;
};

export type BallotEligibilityResult =
  | { ok: true; role: QuorumVoterRole }
  | { ok: false; reason: string };

export type ThresholdCheckInput = {
  quorumClass: QuorumClass;
  ayeCount: number;
};

export type ThresholdCheckResult =
  | { ok: true; threshold: number }
  | { ok: false; reason: string; threshold: number; ayeCount: number };

function normalizeIds(ids: string[]): Set<string> {
  return new Set(ids.map((id) => id.trim()).filter((id) => id.length > 0));
}

export function parseQuorumPolicyConfig(
  raw: Partial<QuorumPolicyConfig> | undefined,
): QuorumPolicyConfig {
  const base = { ...DEFAULT_QUORUM_POLICY };
  if (!raw) return base;
  return {
    peerThreshold:
      typeof raw.peerThreshold === "number" && raw.peerThreshold >= 1
        ? Math.floor(raw.peerThreshold)
        : base.peerThreshold,
    stewardThreshold:
      typeof raw.stewardThreshold === "number" && raw.stewardThreshold >= 1
        ? Math.floor(raw.stewardThreshold)
        : base.stewardThreshold,
    peerEligibleIds: Array.isArray(raw.peerEligibleIds)
      ? [...raw.peerEligibleIds]
      : base.peerEligibleIds,
    stewardEligibleIds: Array.isArray(raw.stewardEligibleIds)
      ? [...raw.stewardEligibleIds]
      : base.stewardEligibleIds,
    ...(raw.minStandingLevel !== undefined
      ? { minStandingLevel: raw.minStandingLevel }
      : {}),
    ...(raw.proposalTtlMs !== undefined
      ? { proposalTtlMs: raw.proposalTtlMs }
      : { proposalTtlMs: base.proposalTtlMs }),
  };
}

export function thresholdFor(
  policy: QuorumPolicyConfig,
  quorumClass: QuorumClass,
): number {
  return quorumClass === "steward-quorum"
    ? policy.stewardThreshold
    : policy.peerThreshold;
}

export function evaluateThreshold(
  policy: QuorumPolicyConfig,
  input: ThresholdCheckInput,
): ThresholdCheckResult {
  const threshold = thresholdFor(policy, input.quorumClass);
  if (input.ayeCount < threshold) {
    return {
      ok: false,
      reason: `aye count ${input.ayeCount} below ${input.quorumClass} threshold ${threshold}`,
      threshold,
      ayeCount: input.ayeCount,
    };
  }
  return { ok: true, threshold };
}

/**
 * Role + eligibility + optional standing + key-lifecycle validity.
 * Revoked / compromised keys are rejected.
 */
export function evaluateBallotEligibility(
  policy: QuorumPolicyConfig,
  ledger: KeyLifecycleLedger,
  input: BallotEligibilityInput,
): BallotEligibilityResult {
  if (!isKeyValidAt(ledger, input.publicKeyHex, input.nowMs)) {
    return { ok: false, reason: "voter key revoked or not valid at cast time" };
  }

  const peers = normalizeIds(policy.peerEligibleIds);
  const stewards = normalizeIds(policy.stewardEligibleIds);

  if (input.quorumClass === "steward-quorum") {
    if (!stewards.has(input.voterId)) {
      return {
        ok: false,
        reason: "voter not in stewardEligibleIds for steward-quorum",
      };
    }
  } else {
    // peer-quorum: peers or stewards may vote (stewards are a stricter peer set)
    if (!peers.has(input.voterId) && !stewards.has(input.voterId)) {
      return {
        ok: false,
        reason: "voter not in peerEligibleIds or stewardEligibleIds",
      };
    }
  }

  if (policy.minStandingLevel !== undefined) {
    const standing = input.standingLevel ?? TrustLevel.UNKNOWN;
    if (standing < policy.minStandingLevel) {
      return {
        ok: false,
        reason: `voter standing ${standing} below minStandingLevel ${policy.minStandingLevel}`,
      };
    }
  }

  const role: QuorumVoterRole =
    input.quorumClass === "steward-quorum" || stewards.has(input.voterId)
      ? "steward"
      : "peer";

  return { ok: true, role };
}

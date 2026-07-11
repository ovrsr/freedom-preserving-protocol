/**
 * Local revisable trust policy — decay, severity floors, remediation, anti-washout.
 * Policy outputs are assessments, not immutable global scores.
 */

import { TrustLevel } from "./trust-graph.js";

export const TRUST_POLICY_VERSION = "fpp-trust-policy/1";

export type PolicySeverity = "routine" | "moderate" | "severe";
export type PolicyPolarity = "positive" | "negative" | "neutral";

export type PolicyEvidenceEvent = {
  id: string;
  severity: PolicySeverity;
  polarity: PolicyPolarity;
  observedAtMs: number;
  capability: string;
  confidence: number;
  remediated: boolean;
  disputeStatus: "none" | "challenged" | "under_appeal" | "corrected" | "rejected_source";
};

export type PolicyInput = {
  capability: string;
  nowMs: number;
  /** Asymmetric gain for routine positives (default 0.05). */
  gainRate?: number;
  /** Loss multiplier for negatives (default 0.35). */
  lossRate?: number;
  halfLifeMs?: number;
};

export type PolicyResult = {
  policyVersion: string;
  level: TrustLevel;
  standingScore: number;
  rationale: string;
  eventsRetained: number;
  severeFloorActive: boolean;
};

const SEVERITY_WEIGHT: Record<PolicySeverity, number> = {
  routine: 1,
  moderate: 3,
  severe: 10,
};

const DISPUTE_SCALE = {
  none: 1,
  challenged: 0.55,
  under_appeal: 0.45,
  corrected: 0.8,
  rejected_source: 0.05,
} as const;

function decay(ageMs: number, halfLifeMs: number): number {
  return Math.exp(-ageMs / halfLifeMs);
}

function scoreToLevel(score: number): TrustLevel {
  if (score >= 0.85) return TrustLevel.MAXIMUM;
  if (score >= 0.7) return TrustLevel.HIGH;
  if (score >= 0.45) return TrustLevel.MEDIUM;
  if (score >= 0.2) return TrustLevel.LOW;
  return TrustLevel.UNKNOWN;
}

export function evaluateTrustPolicy(
  events: PolicyEvidenceEvent[],
  input: PolicyInput,
): PolicyResult {
  const halfLife = input.halfLifeMs ?? 60 * 24 * 60 * 60 * 1000;
  const gain = input.gainRate ?? 0.05;
  const loss = input.lossRate ?? 0.35;

  const relevant = events.filter(
    (e) => e.capability === input.capability || e.capability === "*",
  );

  let score = 0.5;
  let severeFloorActive = false;
  const notes: string[] = [];

  for (const e of relevant) {
    const age = Math.max(0, input.nowMs - e.observedAtMs);
    const d = decay(age, halfLife);
    const dispute = DISPUTE_SCALE[e.disputeStatus];
    const sev = SEVERITY_WEIGHT[e.severity];
    const conf = e.confidence * dispute * d;

    if (e.polarity === "positive") {
      // Asymmetric: routine success cannot cancel severe floor
      const delta = gain * conf * (e.severity === "routine" ? 1 : 1.5);
      if (severeFloorActive && e.severity === "routine" && !e.remediated) {
        score += delta * 0.15; // washout resistance
      } else {
        score += delta;
      }
    } else if (e.polarity === "negative") {
      const remScale = e.remediated ? 0.25 : 1;
      const delta = loss * conf * sev * remScale;
      score -= delta;
      if (e.severity === "severe" && !e.remediated) {
        severeFloorActive = true;
        notes.push("severe unremediated violation floor active");
      }
    }

    if (e.remediated && e.severity === "severe") {
      severeFloorActive = false;
      score += 0.2 * Math.max(conf, 0.5);
      notes.push("verified remediation applied");
    }
    if (e.disputeStatus !== "none") {
      notes.push(`dispute=${e.disputeStatus} on ${e.id}`);
    }
  }

  if (severeFloorActive) {
    score = Math.min(score, 0.35);
  }

  score = Math.max(0, Math.min(1, score));
  const level = scoreToLevel(score);
  const rationale =
    `policy=${TRUST_POLICY_VERSION}; score=${score.toFixed(3)}; level=${level}; ` +
    `events=${relevant.length}; ` +
    (notes.length ? notes.join("; ") : "no special floors");

  return {
    policyVersion: TRUST_POLICY_VERSION,
    level,
    standingScore: score,
    rationale,
    eventsRetained: relevant.length,
    severeFloorActive,
  };
}

/**
 * Local trust policy: decay, severity floors, remediation, anti-washout.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateTrustPolicy,
  TRUST_POLICY_VERSION,
  type PolicyEvidenceEvent,
} from "./trust-policy.js";
import { TrustLevel } from "./trust-graph.js";

function ev(
  partial: Partial<PolicyEvidenceEvent> & {
    id: string;
    severity: PolicyEvidenceEvent["severity"];
    polarity: PolicyEvidenceEvent["polarity"];
  },
): PolicyEvidenceEvent {
  return {
    observedAtMs: 1_000_000,
    capability: "file.read",
    confidence: 0.8,
    remediated: false,
    disputeStatus: "none",
    ...partial,
  };
}

describe("trust-policy", () => {
  it("resists washout of severe verified violations by many harmless successes", () => {
    const events: PolicyEvidenceEvent[] = [
      ev({
        id: "sev",
        severity: "severe",
        polarity: "negative",
        observedAtMs: 900_000,
        confidence: 0.95,
      }),
      ...Array.from({ length: 50 }, (_, i) =>
        ev({
          id: `ok-${i}`,
          severity: "routine",
          polarity: "positive",
          observedAtMs: 1_000_000 + i,
          confidence: 0.9,
        }),
      ),
    ];
    const result = evaluateTrustPolicy(events, {
      capability: "file.read",
      nowMs: 1_000_100,
    });
    assert.ok(result.level <= TrustLevel.LOW);
    assert.ok(result.rationale.includes("severe"));
    assert.equal(result.policyVersion, TRUST_POLICY_VERSION);
  });

  it("decays stale success evidence predictably", () => {
    const fresh = evaluateTrustPolicy(
      [
        ev({
          id: "f",
          severity: "routine",
          polarity: "positive",
          observedAtMs: 1_000_000,
        }),
      ],
      { capability: "file.read", nowMs: 1_000_000 },
    );
    const stale = evaluateTrustPolicy(
      [
        ev({
          id: "s",
          severity: "routine",
          polarity: "positive",
          observedAtMs: 1_000_000,
        }),
      ],
      {
        capability: "file.read",
        nowMs: 1_000_000 + 180 * 24 * 60 * 60 * 1000,
      },
    );
    assert.ok(stale.standingScore < fresh.standingScore);
  });

  it("allows verified remediation to improve standing", () => {
    const before = evaluateTrustPolicy(
      [
        ev({
          id: "sev",
          severity: "severe",
          polarity: "negative",
          remediated: false,
        }),
      ],
      { capability: "file.read", nowMs: 1_000_000 },
    );
    const after = evaluateTrustPolicy(
      [
        ev({
          id: "sev",
          severity: "severe",
          polarity: "negative",
          remediated: true,
        }),
        ev({
          id: "rem",
          severity: "routine",
          polarity: "positive",
          confidence: 0.9,
        }),
      ],
      { capability: "file.read", nowMs: 1_000_000 },
    );
    assert.ok(after.standingScore > before.standingScore);
    assert.ok(after.rationale.includes("remediation") || after.level >= before.level);
  });

  it("treats expired/challenged disputes as reduced weight not deletion", () => {
    const challenged = evaluateTrustPolicy(
      [
        ev({
          id: "n",
          severity: "moderate",
          polarity: "negative",
          disputeStatus: "challenged",
        }),
      ],
      { capability: "file.read", nowMs: 1_000_000 },
    );
    assert.ok(challenged.eventsRetained === 1);
    assert.ok(challenged.rationale.includes("dispute") || challenged.standingScore > 0);
  });
});

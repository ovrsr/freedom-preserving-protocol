import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeCoverageMetrics,
  COVERAGE_METRIC_VERSION,
  capsuleCoverageFromMetrics,
} from "./coverage-metrics.js";

describe("coverage metrics", () => {
  it("scores a complete fixture interval with known denominator", () => {
    const m = computeCoverageMetrics({
      observedActions: 10,
      finalizedReceipts: 10,
      gapCount: 0,
      knownTotalDenominator: 10,
      intervalStart: "2026-07-10T12:00:00.000Z",
      intervalEnd: "2026-07-10T12:10:00.000Z",
    });
    assert.equal(m.metricVersion, COVERAGE_METRIC_VERSION);
    assert.equal(m.completeness, "full");
    assert.ok(m.confidence > 0.5);
  });

  it("treats unknown denominator as unknown completeness, not 100%", () => {
    const m = computeCoverageMetrics({
      observedActions: 100,
      finalizedReceipts: 100,
      gapCount: 0,
      knownTotalDenominator: null,
    });
    assert.equal(m.completeness, "unknown");
    assert.ok(m.confidence < 0.7);
    assert.ok(m.notes.some((n) => /unknown/i.test(n)));
  });

  it("reduces confidence for missing after-hook / audit gaps", () => {
    const clean = computeCoverageMetrics({
      observedActions: 5,
      finalizedReceipts: 5,
      gapCount: 0,
      knownTotalDenominator: 5,
    });
    const gapped = computeCoverageMetrics({
      observedActions: 5,
      finalizedReceipts: 3,
      gapCount: 2,
      knownTotalDenominator: 5,
      severeRecentIndicators: ["missing_after_hook", "audit_write_failure"],
    });
    assert.ok(gapped.confidence < clean.confidence);
    assert.equal(gapped.completeness, "partial");
    assert.deepEqual(gapped.severeRecentIndicators, [
      "missing_after_hook",
      "audit_write_failure",
    ]);
  });

  it("records plugin downtime and restart gaps as severe indicators", () => {
    const m = computeCoverageMetrics({
      observedActions: 2,
      finalizedReceipts: 1,
      gapCount: 1,
      knownTotalDenominator: null,
      severeRecentIndicators: ["plugin_downtime", "restart_gap"],
    });
    assert.equal(m.completeness, "unknown");
    assert.ok(m.severeRecentIndicators.includes("restart_gap"));
  });

  it("maps unknown completeness to partial for capsule schema binding", () => {
    const m = computeCoverageMetrics({
      observedActions: 1,
      finalizedReceipts: 1,
      gapCount: 0,
      knownTotalDenominator: null,
    });
    const c = capsuleCoverageFromMetrics(m);
    assert.equal(c.completeness, "partial");
    assert.equal(c.receipts, 1);
  });
});

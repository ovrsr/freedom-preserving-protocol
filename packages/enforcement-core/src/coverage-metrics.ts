/**
 * Coverage / completeness / audit-gap metrics for the instrumented boundary.
 *
 * Coverage and confidence are separate. An unknown total denominator yields
 * unknown completeness — never an inferred 100%.
 */

export const COVERAGE_METRIC_VERSION = 1 as const;

export type CompletenessLabel = "none" | "partial" | "full" | "unknown";

export type CoverageMetrics = {
  metricVersion: typeof COVERAGE_METRIC_VERSION;
  observedActions: number;
  finalizedReceipts: number;
  gapCount: number;
  intervalStart: string | null;
  intervalEnd: string | null;
  /** Separate from coverage — gaps and unknown denominators reduce this. */
  confidence: number;
  completeness: CompletenessLabel;
  severeRecentIndicators: string[];
  notes: string[];
};

export type CoverageInput = {
  observedActions: number;
  finalizedReceipts: number;
  gapCount: number;
  /** Total actions in interval if known from an external observer; else null. */
  knownTotalDenominator: number | null;
  intervalStart?: string | null;
  intervalEnd?: string | null;
  severeRecentIndicators?: string[];
};

export function computeCoverageMetrics(input: CoverageInput): CoverageMetrics {
  const notes: string[] = [];
  let confidence = 0.7;
  let completeness: CompletenessLabel = "unknown";

  if (input.gapCount > 0) {
    confidence -= Math.min(0.4, input.gapCount * 0.1);
    notes.push(`${input.gapCount} audit gap(s) reduce confidence`);
  }

  if (input.knownTotalDenominator === null) {
    completeness = "unknown";
    notes.push("total action denominator unknown — completeness not inferred");
    confidence = Math.min(confidence, 0.55);
  } else if (input.knownTotalDenominator === 0) {
    completeness = input.finalizedReceipts === 0 ? "full" : "partial";
  } else {
    const ratio = input.finalizedReceipts / input.knownTotalDenominator;
    if (ratio >= 1 && input.gapCount === 0) completeness = "full";
    else if (ratio <= 0) completeness = "none";
    else completeness = "partial";
    if (ratio < 1) {
      confidence -= 0.15;
      notes.push("observed receipts below known total denominator");
    }
  }

  if (input.observedActions > input.finalizedReceipts) {
    notes.push("some observed actions lack finalized receipts");
    confidence -= 0.1;
  }

  confidence = Math.max(0.05, Math.min(0.85, confidence));

  return {
    metricVersion: COVERAGE_METRIC_VERSION,
    observedActions: input.observedActions,
    finalizedReceipts: input.finalizedReceipts,
    gapCount: input.gapCount,
    intervalStart: input.intervalStart ?? null,
    intervalEnd: input.intervalEnd ?? null,
    confidence,
    completeness,
    severeRecentIndicators: input.severeRecentIndicators ?? [],
    notes,
  };
}

export function capsuleCoverageFromMetrics(metrics: CoverageMetrics): {
  claims: number;
  receipts: number;
  completeness: "none" | "partial" | "full";
} {
  // Capsule schema only allows none|partial|full — map unknown → partial.
  const completeness =
    metrics.completeness === "unknown" ? "partial" : metrics.completeness;
  return {
    claims: 0,
    receipts: metrics.finalizedReceipts,
    completeness,
  };
}

/**
 * Evidence quality scoring from coverage, independence, recency, and dispute status.
 * Count alone never inflates confidence.
 */

export type ObservationType = "direct" | "self" | "propagated" | "legacy";
export type CoverageLabel = "none" | "partial" | "full" | "unknown";
export type DisputeStatus =
  | "none"
  | "challenged"
  | "under_appeal"
  | "corrected"
  | "rejected_source";

export type QualityEvidenceItem = {
  id: string;
  sourceId: string;
  independenceGroup: string;
  observationType: ObservationType;
  coverage: CoverageLabel;
  weight: number;
  observedAtMs: number;
  disputeStatus: DisputeStatus;
};

export type EvidenceQualityResult = {
  confidence: number;
  coverageLabel: CoverageLabel;
  uniqueSources: number;
  independentGroups: number;
  explanation: string;
  factors: {
    base: number;
    independenceFactor: number;
    coverageFactor: number;
    recencyFactor: number;
    typeCeiling: number;
    disputeFactor: number;
  };
};

const TYPE_CEILINGS: Record<ObservationType, number> = {
  direct: 1.0,
  self: 0.55,
  propagated: 0.45,
  legacy: 0.4,
};

const COVERAGE_FACTOR: Record<CoverageLabel, number> = {
  full: 1.0,
  partial: 0.75,
  none: 0.35,
  unknown: 0.5,
};

const DISPUTE_FACTOR: Record<DisputeStatus, number> = {
  none: 1.0,
  challenged: 0.6,
  under_appeal: 0.5,
  corrected: 0.85,
  rejected_source: 0.1,
};

const RECENCY_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;

export function dedupeEvidence(
  items: QualityEvidenceItem[],
): QualityEvidenceItem[] {
  const seen = new Set<string>();
  const out: QualityEvidenceItem[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

function recencyFactor(observedAtMs: number, nowMs: number): number {
  const age = Math.max(0, nowMs - observedAtMs);
  return Math.exp(-age / RECENCY_HALF_LIFE_MS);
}

export function assessEvidenceQuality(
  items: QualityEvidenceItem[],
  nowMs: number,
): EvidenceQualityResult {
  const unique = dedupeEvidence(items);
  if (unique.length === 0) {
    return {
      confidence: 0,
      coverageLabel: "unknown",
      uniqueSources: 0,
      independentGroups: 0,
      explanation: "no evidence",
      factors: {
        base: 0,
        independenceFactor: 0,
        coverageFactor: 0,
        recencyFactor: 0,
        typeCeiling: 0,
        disputeFactor: 0,
      },
    };
  }

  const sources = new Set(unique.map((i) => i.sourceId));
  const groups = new Set(unique.map((i) => i.independenceGroup));
  const independenceFactor =
    groups.size / Math.max(sources.size, 1) * (groups.size >= 2 ? 1.0 : 0.7);

  let worstCoverage: CoverageLabel = "full";
  const coverageRank: CoverageLabel[] = ["none", "unknown", "partial", "full"];
  for (const i of unique) {
    if (coverageRank.indexOf(i.coverage) < coverageRank.indexOf(worstCoverage)) {
      worstCoverage = i.coverage;
    }
  }

  let weightSum = 0;
  let typeCeiling = 1;
  let disputeFactor = 1;
  let recencySum = 0;
  for (const i of unique) {
    const ceiling = TYPE_CEILINGS[i.observationType];
    typeCeiling = Math.min(typeCeiling, ceiling);
    disputeFactor = Math.min(disputeFactor, DISPUTE_FACTOR[i.disputeStatus]);
    const r = recencyFactor(i.observedAtMs, nowMs);
    recencySum += r;
    weightSum += Math.min(i.weight, ceiling) * r;
  }
  const base = weightSum / unique.length;
  const coverageFactor = COVERAGE_FACTOR[worstCoverage];
  const avgRecency = recencySum / unique.length;

  const confidence = Math.max(
    0,
    Math.min(
      1,
      base * independenceFactor * coverageFactor * disputeFactor,
    ),
  );

  const explanation =
    `confidence=${confidence.toFixed(3)} from ${unique.length} unique evidence ` +
    `(${sources.size} sources, ${groups.size} independence groups); ` +
    `coverage=${worstCoverage}; typeCeiling=${typeCeiling.toFixed(2)}; ` +
    `independence=${independenceFactor.toFixed(2)}; dispute=${disputeFactor.toFixed(2)}; ` +
    `recency=${avgRecency.toFixed(2)}`;

  return {
    confidence,
    coverageLabel: worstCoverage,
    uniqueSources: sources.size,
    independentGroups: groups.size,
    explanation,
    factors: {
      base,
      independenceFactor,
      coverageFactor,
      recencyFactor: avgRecency,
      typeCeiling,
      disputeFactor,
    },
  };
}

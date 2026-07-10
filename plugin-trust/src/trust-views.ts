/**
 * Separate self-assessed, direct-peer, and propagated-peer trust views.
 *
 * These are local policy inputs — not a global intrinsic score. Divergence
 * is reported explicitly rather than averaged away.
 */

export type EvidenceChannel = "self" | "peer" | "propagated";

export type ViewEvidenceRecord = {
  id: string;
  kind: string;
  weight: number;
  observedAt: string;
  sourceId?: string;
  path?: string[];
};

export type EvidenceViewSummary = {
  channel: EvidenceChannel;
  subjectId: string;
  evidenceCount: number;
  summaryWeight: number;
  confidence: number;
  ceilingApplied: boolean;
  latestAt: string | null;
};

export type ViewDivergence = {
  absoluteDelta: number;
  selfWeight: number;
  peerWeight: number;
  averagedAway: false;
  explanation: string;
};

/** Propagated evidence cannot exceed this fraction of its raw weight. */
export const PROPAGATED_WEIGHT_CEILING = 0.5;
/** Self-attested evidence ceiling relative to direct peer. */
export const SELF_WEIGHT_CEILING = 0.85;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function summarize(
  channel: EvidenceChannel,
  subjectId: string,
  records: ViewEvidenceRecord[],
  ceiling: number | null,
): EvidenceViewSummary {
  if (records.length === 0) {
    return {
      channel,
      subjectId,
      evidenceCount: 0,
      summaryWeight: 0,
      confidence: 0,
      ceilingApplied: ceiling !== null,
      latestAt: null,
    };
  }
  let sum = 0;
  let latest: string | null = null;
  for (const r of records) {
    const w = ceiling !== null ? Math.min(r.weight, ceiling) : r.weight;
    sum += w;
    if (!latest || r.observedAt > latest) latest = r.observedAt;
  }
  const avg = sum / records.length;
  return {
    channel,
    subjectId,
    evidenceCount: records.length,
    summaryWeight: clamp01(avg),
    confidence: clamp01(avg),
    ceilingApplied: ceiling !== null,
    latestAt: latest,
  };
}

export function computeViewDivergence(
  self: EvidenceViewSummary,
  peer: EvidenceViewSummary,
): ViewDivergence {
  const absoluteDelta = Math.abs(self.summaryWeight - peer.summaryWeight);
  return {
    absoluteDelta,
    selfWeight: self.summaryWeight,
    peerWeight: peer.summaryWeight,
    averagedAway: false,
    explanation:
      `self=${self.summaryWeight.toFixed(3)} (${self.evidenceCount} obs) vs ` +
      `peer=${peer.summaryWeight.toFixed(3)} (${peer.evidenceCount} obs); ` +
      `delta=${absoluteDelta.toFixed(3)} (not averaged)`,
  };
}

export class TrustViewStore {
  private self = new Map<string, ViewEvidenceRecord[]>();
  private peer = new Map<string, ViewEvidenceRecord[]>();
  private propagated = new Map<string, ViewEvidenceRecord[]>();

  private push(
    map: Map<string, ViewEvidenceRecord[]>,
    subjectId: string,
    record: ViewEvidenceRecord,
  ): void {
    const list = map.get(subjectId) ?? [];
    if (list.some((r) => r.id === record.id)) return;
    list.push(record);
    map.set(subjectId, list);
  }

  recordSelfEvidence(subjectId: string, record: ViewEvidenceRecord): void {
    this.push(this.self, subjectId, {
      ...record,
      weight: Math.min(record.weight, SELF_WEIGHT_CEILING),
    });
  }

  recordPeerEvidence(subjectId: string, record: ViewEvidenceRecord): void {
    this.push(this.peer, subjectId, record);
  }

  recordPropagatedEvidence(
    subjectId: string,
    record: ViewEvidenceRecord,
  ): void {
    this.push(this.propagated, subjectId, {
      ...record,
      weight: Math.min(record.weight, PROPAGATED_WEIGHT_CEILING),
    });
  }

  getSelfView(subjectId: string): EvidenceViewSummary {
    return summarize(
      "self",
      subjectId,
      this.self.get(subjectId) ?? [],
      SELF_WEIGHT_CEILING,
    );
  }

  getPeerView(subjectId: string): EvidenceViewSummary {
    return summarize("peer", subjectId, this.peer.get(subjectId) ?? [], null);
  }

  getPropagatedView(subjectId: string): EvidenceViewSummary {
    return summarize(
      "propagated",
      subjectId,
      this.propagated.get(subjectId) ?? [],
      PROPAGATED_WEIGHT_CEILING,
    );
  }

  exportAll(): {
    self: Record<string, ViewEvidenceRecord[]>;
    peer: Record<string, ViewEvidenceRecord[]>;
    propagated: Record<string, ViewEvidenceRecord[]>;
  } {
    const toObj = (m: Map<string, ViewEvidenceRecord[]>) =>
      Object.fromEntries([...m.entries()]);
    return {
      self: toObj(this.self),
      peer: toObj(this.peer),
      propagated: toObj(this.propagated),
    };
  }

  importAll(data: {
    self?: Record<string, ViewEvidenceRecord[]>;
    peer?: Record<string, ViewEvidenceRecord[]>;
    propagated?: Record<string, ViewEvidenceRecord[]>;
  }): void {
    for (const [id, recs] of Object.entries(data.self ?? {})) {
      for (const r of recs) this.recordSelfEvidence(id, r);
    }
    for (const [id, recs] of Object.entries(data.peer ?? {})) {
      for (const r of recs) this.recordPeerEvidence(id, r);
    }
    for (const [id, recs] of Object.entries(data.propagated ?? {})) {
      for (const r of recs) this.recordPropagatedEvidence(id, r);
    }
  }
}

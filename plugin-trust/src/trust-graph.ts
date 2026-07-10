/**
 * Trust Graph Protocol (TGP) for the Freedom Preserving Protocol.
 *
 * In-memory weighted trust graph between constitutional agents. Supports
 * bidirectional trust relationships, BFS trust propagation with per-hop
 * attenuation, multi-dimensional reputation scoring, and graph analytics.
 *
 * Adapted from Paulsens-Freedom-Preserving-Five TGP with real SHA-256
 * hashing and stripped of stubbed crypto paths.
 */

import { createHash } from "node:crypto";
import {
  TrustViewStore,
  computeViewDivergence,
  type EvidenceViewSummary,
  type ViewDivergence,
} from "./trust-views.js";
import {
  ScopedTrustStore,
  DEFAULT_SCOPE,
  type TrustScope,
  type ScopedAssessment,
} from "./trust-scope.js";
import {
  assessEvidenceQuality,
  type QualityEvidenceItem,
} from "./evidence-quality.js";

export enum TrustLevel {
  UNKNOWN = 0,
  LOW = 1,
  MEDIUM = 2,
  HIGH = 3,
  MAXIMUM = 4,
}

export interface ReputationMetrics {
  overall: number;
  constitutional: number;
  reliability: number;
  cooperation: number;
  transparency: number;
  constitutionalFidelity: number;
  interventionRate: number;
  resourceStewardship: number;
  positiveInteractions: number;
  negativeInteractions: number;
  neutralInteractions: number;
}

export interface KeyRotationProof {
  kind: "operator-attested";
  reason: string;
}

export interface TrustNode {
  id: string;
  constitutionHash: string;
  publicKeyHex?: string;
  /** Display/migration aliases only — never replace canonical `id`. */
  legacyAliases?: string[];
  trustScore: number;
  interactionCount: number;
  lastActivity: number;
  connections: string[];
  reputation: ReputationMetrics;
}

export interface TrustRelationship {
  agentA: string;
  agentB: string;
  trustAB: TrustLevel;
  trustBA: TrustLevel;
  confidence: number;
  establishedAt: number;
  updatedAt: number;
  evidence: TrustEvidence[];
}

export interface TrustEvidence {
  type:
    | "handshake"
    | "direct_interaction"
    | "peer_attestation"
    | "behavioral_analysis";
  data: unknown;
  weight: number;
  timestamp: number;
  source: string;
  evidenceClass?:
    | "identity"
    | "configuration"
    | "runtime"
    | "event"
    | "completeness"
    | "behavioral";
}

export interface TrustPropagation {
  source: string;
  target: string;
  path: string[];
  trustLevel: TrustLevel;
  confidence: number;
  attenuation: number;
  deductions: string[];
  evidenceClass: "propagated";
  /** True when a direct assessment exists and takes precedence. */
  directPrecedenceApplied: boolean;
}

export type PropagationPolicy = {
  maxDepth: number;
  attenuationFactor: number;
  minEdgeConfidence: number;
  evidenceClassCeiling: number;
};

export interface TrustUpdateEvent {
  type: "node_added" | "node_removed" | "new_relationship" | "trust_change";
  agents: string[];
  timestamp: number;
}

export interface TrustGraphStats {
  nodeCount: number;
  edgeCount: number;
  averageTrust: number;
  density: number;
  largestComponent: number;
}

const DEFAULT_ATTENUATION_FACTOR = 0.8;
const MAX_EVENTS = 1000;

export interface LegacyObservationRef {
  source: "legacy_v1";
  confidence: number;
  nodeId?: string;
  relationshipKey?: string;
  data: unknown;
}

export class TrustGraphProtocol {
  private nodes = new Map<string, TrustNode>();
  private relationships = new Map<string, TrustRelationship>();
  private updateEvents: TrustUpdateEvent[] = [];
  private onChangeCallback?: () => void;
  private attenuationFactor: number;
  private propagationPolicy: PropagationPolicy;
  private legacyObservations: LegacyObservationRef[] = [];
  /** In-memory event ledger root for v2 persistence (optional). */
  private eventRoot: string | null = null;
  private eventCount = 0;
  private viewStore = new TrustViewStore();
  private scopedStore = new ScopedTrustStore();

  constructor(options?: {
    attenuationFactor?: number;
    propagationPolicy?: Partial<PropagationPolicy>;
  }) {
    this.attenuationFactor =
      options?.attenuationFactor ?? DEFAULT_ATTENUATION_FACTOR;
    this.propagationPolicy = {
      maxDepth: options?.propagationPolicy?.maxDepth ?? 3,
      attenuationFactor:
        options?.propagationPolicy?.attenuationFactor ?? this.attenuationFactor,
      minEdgeConfidence: options?.propagationPolicy?.minEdgeConfidence ?? 0.2,
      evidenceClassCeiling:
        options?.propagationPolicy?.evidenceClassCeiling ?? 0.45,
    };
  }

  setPropagationPolicy(policy: Partial<PropagationPolicy>): void {
    this.propagationPolicy = { ...this.propagationPolicy, ...policy };
  }

  getPropagationPolicy(): PropagationPolicy {
    return { ...this.propagationPolicy };
  }

  getViewStore(): TrustViewStore {
    return this.viewStore;
  }

  getScopedStore(): ScopedTrustStore {
    return this.scopedStore;
  }

  /**
   * Record a directed scoped assessment. Does not create a symmetric reverse edge.
   */
  recordScopedAssessment(assessment: ScopedAssessment): void {
    this.scopedStore.put(assessment);
    this.onChangeCallback?.();
  }

  evaluateScopedTrust(
    from: string,
    to: string,
    scope: Partial<TrustScope>,
    atMs: number = Date.now(),
    options?: { allowConservativeDefault?: boolean },
  ): ScopedAssessment | null {
    return this.scopedStore.evaluate(from, to, scope, atMs, options);
  }

  getEvidenceViews(subjectId: string): {
    self: EvidenceViewSummary;
    peer: EvidenceViewSummary;
    propagated: EvidenceViewSummary;
    divergence: ViewDivergence;
  } {
    const self = this.viewStore.getSelfView(subjectId);
    const peer = this.viewStore.getPeerView(subjectId);
    const propagated = this.viewStore.getPropagatedView(subjectId);
    return {
      self,
      peer,
      propagated,
      divergence: computeViewDivergence(self, peer),
    };
  }

  getLegacyObservations(): LegacyObservationRef[] {
    return [...this.legacyObservations];
  }

  setLegacyObservations(obs: LegacyObservationRef[]): void {
    this.legacyObservations = [...obs];
  }

  getPersistenceMeta(): { eventRoot: string | null; eventCount: number } {
    return { eventRoot: this.eventRoot, eventCount: this.eventCount };
  }

  setPersistenceMeta(meta: { eventRoot: string | null; eventCount: number }): void {
    this.eventRoot = meta.eventRoot;
    this.eventCount = meta.eventCount;
  }

  setOnChange(cb: () => void): void {
    this.onChangeCallback = cb;
  }

  addAgent(agentId: string, constitutionHash: string): TrustNode {
    const existing = this.nodes.get(agentId);
    if (existing) return existing;

    const node: TrustNode = {
      id: agentId,
      constitutionHash,
      trustScore: 0.5,
      interactionCount: 0,
      lastActivity: Date.now(),
      connections: [],
      reputation: {
        overall: 0.5,
        constitutional: 0.5,
        reliability: 0.5,
        cooperation: 0.5,
        transparency: 0.5,
        constitutionalFidelity: 0.5,
        interventionRate: 0.5,
        resourceStewardship: 0.5,
        positiveInteractions: 0,
        negativeInteractions: 0,
        neutralInteractions: 0,
      },
    };
    this.nodes.set(agentId, node);
    this.logEvent("node_added", [agentId]);
    return node;
  }

  removeAgent(agentId: string): boolean {
    if (!this.nodes.has(agentId)) return false;

    for (const [key, rel] of this.relationships) {
      if (rel.agentA === agentId || rel.agentB === agentId) {
        this.relationships.delete(key);
      }
    }
    for (const node of this.nodes.values()) {
      const idx = node.connections.indexOf(agentId);
      if (idx !== -1) node.connections.splice(idx, 1);
    }
    this.nodes.delete(agentId);
    this.logEvent("node_removed", [agentId]);
    return true;
  }

  establishTrust(
    agentA: string,
    agentB: string,
    trustAB: TrustLevel,
    trustBA: TrustLevel,
    evidence: TrustEvidence[] = [],
    scope: Partial<TrustScope> = DEFAULT_SCOPE,
  ): TrustRelationship | null {
    if (!this.nodes.has(agentA) || !this.nodes.has(agentB)) return null;
    if (agentA === agentB) return null;

    const key = this.relationshipKey(agentA, agentB);
    const rel: TrustRelationship = {
      agentA,
      agentB,
      trustAB,
      trustBA,
      confidence: this.evidenceConfidence(evidence),
      establishedAt: Date.now(),
      updatedAt: Date.now(),
      evidence,
    };
    this.relationships.set(key, rel);

    const now = Date.now();
    const fullScope: TrustScope = {
      capability: scope.capability ?? DEFAULT_SCOPE.capability,
      resource: scope.resource ?? "*",
      audience: scope.audience ?? "*",
      environment: scope.environment ?? "*",
    };
    this.scopedStore.put({
      from: agentA,
      to: agentB,
      scope: fullScope,
      level: trustAB,
      confidence: rel.confidence,
      validFrom: now,
      validUntil: now + 30 * 24 * 60 * 60 * 1000,
      source: "direct",
    });
    this.scopedStore.put({
      from: agentB,
      to: agentA,
      scope: fullScope,
      level: trustBA,
      confidence: rel.confidence,
      validFrom: now,
      validUntil: now + 30 * 24 * 60 * 60 * 1000,
      source: "direct",
    });

    const nodeA = this.nodes.get(agentA)!;
    const nodeB = this.nodes.get(agentB)!;
    if (!nodeA.connections.includes(agentB)) nodeA.connections.push(agentB);
    if (!nodeB.connections.includes(agentA)) nodeB.connections.push(agentA);
    this.updateScores(agentA, agentB);
    this.logEvent("new_relationship", [agentA, agentB]);
    return rel;
  }

  getRelationship(
    agentA: string,
    agentB: string,
  ): TrustRelationship | null {
    return (
      this.relationships.get(this.relationshipKey(agentA, agentB)) ?? null
    );
  }

  getAgent(agentId: string): TrustNode | null {
    return this.nodes.get(agentId) ?? null;
  }

  getAllAgents(): TrustNode[] {
    return [...this.nodes.values()];
  }

  /**
   * Directed BFS trust propagation with receiver-controlled limits.
   * Uses the edge direction along the path (from→to), not a fixed trustAB field.
   */
  propagateTrust(
    source: string,
    target: string,
    maxDepth?: number,
  ): TrustPropagation | null {
    const policy = this.propagationPolicy;
    const depthLimit = maxDepth ?? policy.maxDepth;
    const deductions: string[] = [];

    if (!this.nodes.has(source) || !this.nodes.has(target)) return null;
    if (source === target) {
      return {
        source,
        target,
        path: [source],
        trustLevel: TrustLevel.MAXIMUM,
        confidence: 1.0,
        attenuation: 0,
        deductions: [],
        evidenceClass: "propagated",
        directPrecedenceApplied: false,
      };
    }

    // Direct scoped/relationship evidence takes precedence over propagation
    const directRel = this.getRelationship(source, target);
    if (directRel) {
      const directed = this.directedLevel(directRel, source, target);
      deductions.push("direct evidence present; propagation not used for standing");
      return {
        source,
        target,
        path: [source, target],
        trustLevel: directed.level,
        confidence: Math.min(directRel.confidence, 1),
        attenuation: 0,
        deductions,
        evidenceClass: "propagated",
        directPrecedenceApplied: true,
      };
    }

    const path = this.bfsPath(source, target, depthLimit);
    if (!path) {
      deductions.push("no path within depth limit");
      return null;
    }
    if (path.length - 1 > depthLimit) {
      deductions.push(`path depth ${path.length - 1} exceeds maxDepth ${depthLimit}`);
      return null;
    }

    let trust = TrustLevel.MAXIMUM as number;
    let confidence = 1.0;
    let attenuation = 0;
    const visitedEdges = new Set<string>();

    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i]!;
      const to = path[i + 1]!;
      const edgeKey = `${from}->${to}`;
      if (visitedEdges.has(edgeKey)) {
        deductions.push(`cycle detected at ${edgeKey}`);
        return null;
      }
      visitedEdges.add(edgeKey);

      const rel = this.getRelationship(from, to);
      if (!rel) return null;
      const directed = this.directedLevel(rel, from, to);
      if (directed.confidence < policy.minEdgeConfidence) {
        deductions.push(
          `edge ${edgeKey} confidence ${directed.confidence.toFixed(2)} below min ${policy.minEdgeConfidence}`,
        );
        return null;
      }
      const factor = Math.pow(policy.attenuationFactor, i);
      trust = Math.min(trust, directed.level * factor);
      confidence *= directed.confidence * factor;
      attenuation += 1 - factor;
      deductions.push(
        `hop ${i}: ${from}→${to} level=${directed.level} conf=${directed.confidence.toFixed(2)} ×${factor.toFixed(2)}`,
      );
    }

    confidence = Math.min(confidence, policy.evidenceClassCeiling);
    deductions.push(
      `propagated evidence ceiling applied (${policy.evidenceClassCeiling})`,
    );

    return {
      source,
      target,
      path,
      trustLevel: Math.floor(trust) as TrustLevel,
      confidence,
      attenuation,
      deductions,
      evidenceClass: "propagated",
      directPrecedenceApplied: false,
    };
  }

  /** Resolve directed trust along from→to for a stored relationship. */
  private directedLevel(
    rel: TrustRelationship,
    from: string,
    to: string,
  ): { level: TrustLevel; confidence: number } {
    if (rel.agentA === from && rel.agentB === to) {
      return { level: rel.trustAB, confidence: rel.confidence };
    }
    if (rel.agentA === to && rel.agentB === from) {
      return { level: rel.trustBA, confidence: rel.confidence };
    }
    // Key may be unordered relative to stored agentA/agentB labels
    if (from === rel.agentA) {
      return { level: rel.trustAB, confidence: rel.confidence };
    }
    if (from === rel.agentB) {
      return { level: rel.trustBA, confidence: rel.confidence };
    }
    return { level: TrustLevel.UNKNOWN, confidence: 0 };
  }

  updateReputation(
    agentId: string,
    type: "positive" | "negative" | "neutral",
    metrics: Partial<
      Pick<
        ReputationMetrics,
        | "constitutional"
        | "reliability"
        | "cooperation"
        | "transparency"
        | "constitutionalFidelity"
        | "interventionRate"
        | "resourceStewardship"
      >
    > = {},
  ): boolean {
    const node = this.nodes.get(agentId);
    if (!node) return false;

    if (type === "positive") node.reputation.positiveInteractions++;
    else if (type === "negative") node.reputation.negativeInteractions++;
    else node.reputation.neutralInteractions++;

    if (metrics.constitutional !== undefined)
      node.reputation.constitutional = metrics.constitutional;
    if (metrics.reliability !== undefined)
      node.reputation.reliability = metrics.reliability;
    if (metrics.cooperation !== undefined)
      node.reputation.cooperation = metrics.cooperation;
    if (metrics.transparency !== undefined)
      node.reputation.transparency = metrics.transparency;
    if (metrics.constitutionalFidelity !== undefined)
      node.reputation.constitutionalFidelity = metrics.constitutionalFidelity;
    if (metrics.interventionRate !== undefined)
      node.reputation.interventionRate = metrics.interventionRate;
    if (metrics.resourceStewardship !== undefined)
      node.reputation.resourceStewardship = metrics.resourceStewardship;

    node.reputation.overall = this.computeOverallReputation(node.reputation);
    node.interactionCount =
      node.reputation.positiveInteractions +
      node.reputation.negativeInteractions +
      node.reputation.neutralInteractions;
    node.lastActivity = Date.now();
    return true;
  }

  recordInterventionReport(
    agentId: string,
    blockRate: number,
    approvalRate: number,
  ): boolean {
    const score = 1.0 - (blockRate * 0.7 + approvalRate * 0.3);
    return this.updateReputation(agentId, "neutral", {
      interventionRate: Math.max(0, Math.min(1, score)),
    });
  }

  recordStewardshipReport(
    agentId: string,
    budgetRespected: boolean,
  ): boolean {
    const node = this.nodes.get(agentId);
    if (!node) return false;
    const current = node.reputation.resourceStewardship;
    const delta = budgetRespected ? 0.05 : -0.15;
    return this.updateReputation(agentId, "neutral", {
      resourceStewardship: Math.max(0, Math.min(1, current + delta)),
    });
  }

  getAgentByPublicKey(publicKeyHex: string): TrustNode | null {
    for (const node of this.nodes.values()) {
      if (node.publicKeyHex === publicKeyHex) return node;
    }
    return null;
  }

  /**
   * Bind a public key to a canonical agent node.
   * Replacing an existing different key requires an explicit rotation proof.
   */
  updateAgentPublicKey(
    agentId: string,
    publicKeyHex: string,
    options?: { rotationProof?: KeyRotationProof },
  ): boolean {
    const node = this.nodes.get(agentId);
    if (!node) return false;
    if (
      node.publicKeyHex !== undefined &&
      node.publicKeyHex !== publicKeyHex &&
      options?.rotationProof === undefined
    ) {
      return false;
    }
    node.publicKeyHex = publicKeyHex;
    this.onChangeCallback?.();
    return true;
  }

  /**
   * Attach a legacy truncated alias for display/migration lookup.
   * Does not create a separate node or replace the canonical id.
   */
  addLegacyAlias(canonicalAgentId: string, legacyAlias: string): boolean {
    const node = this.nodes.get(canonicalAgentId);
    if (!node) return false;
    if (!node.legacyAliases) node.legacyAliases = [];
    if (!node.legacyAliases.includes(legacyAlias)) {
      node.legacyAliases.push(legacyAlias);
    }
    this.onChangeCallback?.();
    return true;
  }

  /** Resolve a legacy alias to its canonical v2 agent id, if known. */
  resolveCanonicalId(agentIdOrAlias: string): string | null {
    if (this.nodes.has(agentIdOrAlias)) return agentIdOrAlias;
    for (const node of this.nodes.values()) {
      if (node.legacyAliases?.includes(agentIdOrAlias)) return node.id;
    }
    return null;
  }

  getStats(): TrustGraphStats {
    const nodes = [...this.nodes.values()];
    const n = nodes.length;
    const e = this.relationships.size;
    const maxEdges = (n * (n - 1)) / 2;

    return {
      nodeCount: n,
      edgeCount: e,
      averageTrust:
        n > 0
          ? nodes.reduce((s, nd) => s + nd.trustScore, 0) / n
          : 0,
      density: maxEdges > 0 ? e / maxEdges : 0,
      largestComponent: this.largestComponent(),
    };
  }

  getEvents(): TrustUpdateEvent[] {
    return [...this.updateEvents];
  }

  exportData(): {
    nodes: TrustNode[];
    relationships: TrustRelationship[];
  } {
    return {
      nodes: [...this.nodes.values()],
      relationships: [...this.relationships.values()],
    };
  }

  importData(data: {
    nodes: TrustNode[];
    relationships: TrustRelationship[];
  }): void {
    for (const node of data.nodes) this.nodes.set(node.id, node);
    for (const rel of data.relationships)
      this.relationships.set(
        this.relationshipKey(rel.agentA, rel.agentB),
        rel,
      );
  }

  // -- private helpers --

  private relationshipKey(a: string, b: string): string {
    return a < b ? `${a}:${b}` : `${b}:${a}`;
  }

  private evidenceConfidence(evidence: TrustEvidence[]): number {
    if (evidence.length === 0) return 0.5;
    const items: QualityEvidenceItem[] = evidence.map((e, i) => ({
      id: `${e.source}:${e.timestamp}:${e.type}:${i}`,
      sourceId: e.source,
      independenceGroup: e.source,
      observationType:
        e.type === "peer_attestation"
          ? "direct"
          : e.type === "handshake"
            ? "direct"
            : "self",
      coverage: e.evidenceClass === "completeness" ? "partial" : "unknown",
      weight: e.weight,
      observedAtMs: e.timestamp,
      disputeStatus: "none",
    }));
    return assessEvidenceQuality(items, Date.now()).confidence;
  }

  private updateScores(a: string, b: string): void {
    const rel = this.getRelationship(a, b);
    if (!rel) return;
    const weight = 0.3;
    const nodeA = this.nodes.get(a)!;
    const nodeB = this.nodes.get(b)!;
    nodeA.trustScore =
      nodeA.trustScore * (1 - weight) +
      rel.trustBA * weight * rel.confidence;
    nodeB.trustScore =
      nodeB.trustScore * (1 - weight) +
      rel.trustAB * weight * rel.confidence;
  }

  private bfsPath(
    source: string,
    target: string,
    maxDepth: number,
  ): string[] | null {
    const visited = new Set<string>();
    const queue: { node: string; path: string[] }[] = [
      { node: source, path: [source] },
    ];
    while (queue.length > 0) {
      const { node, path } = queue.shift()!;
      if (node === target) return path;
      if (path.length > maxDepth) continue;
      if (visited.has(node)) continue;
      visited.add(node);
      const nd = this.nodes.get(node);
      if (nd) {
        for (const neighbor of nd.connections) {
          if (!visited.has(neighbor))
            queue.push({ node: neighbor, path: [...path, neighbor] });
        }
      }
    }
    return null;
  }

  private computeOverallReputation(r: ReputationMetrics): number {
    const weighted =
      r.constitutional * 0.2 +
      r.reliability * 0.15 +
      r.cooperation * 0.15 +
      r.transparency * 0.1 +
      r.constitutionalFidelity * 0.2 +
      r.interventionRate * 0.1 +
      r.resourceStewardship * 0.1;
    const total =
      r.positiveInteractions +
      r.negativeInteractions +
      r.neutralInteractions;
    const interactionScore =
      total > 0 ? r.positiveInteractions / total : 0.5;
    return weighted * 0.7 + interactionScore * 0.3;
  }

  private largestComponent(): number {
    const visited = new Set<string>();
    let max = 0;
    for (const id of this.nodes.keys()) {
      if (!visited.has(id)) {
        const size = this.dfs(id, visited);
        if (size > max) max = size;
      }
    }
    return max;
  }

  private dfs(nodeId: string, visited: Set<string>): number {
    visited.add(nodeId);
    let size = 1;
    const nd = this.nodes.get(nodeId);
    if (nd) {
      for (const neighbor of nd.connections) {
        if (!visited.has(neighbor)) size += this.dfs(neighbor, visited);
      }
    }
    return size;
  }

  private logEvent(
    type: TrustUpdateEvent["type"],
    agents: string[],
  ): void {
    this.updateEvents.push({ type, agents, timestamp: Date.now() });
    if (this.updateEvents.length > MAX_EVENTS)
      this.updateEvents = this.updateEvents.slice(-MAX_EVENTS);
    this.onChangeCallback?.();
  }
}

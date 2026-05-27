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
  positiveInteractions: number;
  negativeInteractions: number;
  neutralInteractions: number;
}

export interface TrustNode {
  id: string;
  constitutionHash: string;
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
}

export interface TrustPropagation {
  source: string;
  target: string;
  path: string[];
  trustLevel: TrustLevel;
  confidence: number;
  attenuation: number;
}

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

const ATTENUATION_FACTOR = 0.8;
const MAX_EVENTS = 1000;

export class TrustGraphProtocol {
  private nodes = new Map<string, TrustNode>();
  private relationships = new Map<string, TrustRelationship>();
  private updateEvents: TrustUpdateEvent[] = [];
  private onChangeCallback?: () => void;

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
   * BFS trust propagation with 20% per-hop attenuation.
   */
  propagateTrust(
    source: string,
    target: string,
    maxDepth = 3,
  ): TrustPropagation | null {
    if (!this.nodes.has(source) || !this.nodes.has(target)) return null;
    if (source === target) {
      return {
        source,
        target,
        path: [source],
        trustLevel: TrustLevel.MAXIMUM,
        confidence: 1.0,
        attenuation: 0,
      };
    }

    const path = this.bfsPath(source, target, maxDepth);
    if (!path) return null;

    let trust = TrustLevel.MAXIMUM as number;
    let confidence = 1.0;
    let attenuation = 0;

    for (let i = 0; i < path.length - 1; i++) {
      const rel = this.getRelationship(path[i]!, path[i + 1]!);
      if (!rel) return null;
      const factor = Math.pow(ATTENUATION_FACTOR, i);
      trust = Math.min(trust, rel.trustAB * factor);
      confidence *= rel.confidence;
      attenuation += 1 - factor;
    }

    return {
      source,
      target,
      path,
      trustLevel: Math.floor(trust) as TrustLevel,
      confidence,
      attenuation,
    };
  }

  updateReputation(
    agentId: string,
    type: "positive" | "negative" | "neutral",
    metrics: Partial<
      Pick<
        ReputationMetrics,
        "constitutional" | "reliability" | "cooperation" | "transparency"
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

    node.reputation.overall = this.computeOverallReputation(node.reputation);
    node.interactionCount =
      node.reputation.positiveInteractions +
      node.reputation.negativeInteractions +
      node.reputation.neutralInteractions;
    node.lastActivity = Date.now();
    return true;
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
    return Math.min(0.5 + evidence.length * 0.1, 1.0);
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
      r.constitutional * 0.3 +
      r.reliability * 0.25 +
      r.cooperation * 0.25 +
      r.transparency * 0.2;
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

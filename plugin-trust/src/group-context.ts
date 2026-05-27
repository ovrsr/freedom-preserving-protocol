/**
 * Group Context Trust for multi-agent environments.
 *
 * Tracks "clusters" — named groups of agentIds (e.g. one per chat thread
 * or Discord channel). When a new agent joins, it flags a handshake
 * requirement. Sensitivity-gated sharing prevents memory snippets from
 * leaking to unverified agents in a cluster.
 */

import { TrustGraphProtocol, TrustLevel } from "./trust-graph.js";

export interface ClusterMember {
  agentId: string;
  joinedAt: number;
  verified: boolean;
  trustLevel: TrustLevel;
}

export interface TrustCluster {
  id: string;
  members: Map<string, ClusterMember>;
  createdAt: number;
}

export interface ClusterTrustState {
  clusterId: string;
  totalMembers: number;
  verifiedMembers: number;
  allVerified: boolean;
  lowestTrustLevel: TrustLevel;
  unverifiedAgents: string[];
}

export type HandshakeRequiredCallback = (
  clusterId: string,
  agentId: string,
) => void;

export class GroupContextManager {
  private clusters = new Map<string, TrustCluster>();
  private trustGraph: TrustGraphProtocol;
  private localAgentId: string;
  private onHandshakeRequired: HandshakeRequiredCallback | undefined;

  constructor(
    trustGraph: TrustGraphProtocol,
    localAgentId: string,
    onHandshakeRequired?: HandshakeRequiredCallback | undefined,
  ) {
    this.trustGraph = trustGraph;
    this.localAgentId = localAgentId;
    this.onHandshakeRequired = onHandshakeRequired;
  }

  noteAgentJoined(clusterId: string, agentId: string): ClusterMember {
    let cluster = this.clusters.get(clusterId);
    if (!cluster) {
      cluster = {
        id: clusterId,
        members: new Map(),
        createdAt: Date.now(),
      };
      this.clusters.set(clusterId, cluster);
    }

    const existing = cluster.members.get(agentId);
    if (existing) return existing;

    const node = this.trustGraph.getAgent(agentId);
    const rel = this.trustGraph.getRelationship(this.localAgentId, agentId);
    const verified = node !== null && rel !== null;
    const trustLevel = rel
      ? (Math.max(rel.trustAB, rel.trustBA) as TrustLevel)
      : TrustLevel.UNKNOWN;

    const member: ClusterMember = {
      agentId,
      joinedAt: Date.now(),
      verified,
      trustLevel,
    };
    cluster.members.set(agentId, member);

    if (!verified && agentId !== this.localAgentId) {
      this.onHandshakeRequired?.(clusterId, agentId);
    }

    return member;
  }

  markVerified(
    clusterId: string,
    agentId: string,
    trustLevel: TrustLevel,
  ): boolean {
    const cluster = this.clusters.get(clusterId);
    if (!cluster) return false;
    const member = cluster.members.get(agentId);
    if (!member) return false;
    member.verified = true;
    member.trustLevel = trustLevel;
    return true;
  }

  getClusterTrustState(clusterId: string): ClusterTrustState | null {
    const cluster = this.clusters.get(clusterId);
    if (!cluster) return null;

    const members = [...cluster.members.values()];
    const unverified = members.filter((m) => !m.verified);
    let lowest = TrustLevel.MAXIMUM as TrustLevel;
    for (const m of members) {
      if (m.trustLevel < lowest) lowest = m.trustLevel;
    }

    return {
      clusterId,
      totalMembers: members.length,
      verifiedMembers: members.length - unverified.length,
      allVerified: unverified.length === 0,
      lowestTrustLevel: lowest,
      unverifiedAgents: unverified.map((m) => m.agentId),
    };
  }

  /**
   * Gate sharing based on cluster verification state and content sensitivity.
   * sensitivity: 0 = public, 1 = low, 2 = medium, 3 = high
   * Returns true if safe to share with this cluster.
   */
  shouldShareWithCluster(
    clusterId: string,
    sensitivity: number,
  ): boolean {
    const state = this.getClusterTrustState(clusterId);
    if (!state) return false;
    if (sensitivity === 0) return true;
    if (!state.allVerified) return false;
    if (sensitivity >= 3) return state.lowestTrustLevel >= TrustLevel.HIGH;
    if (sensitivity >= 2) return state.lowestTrustLevel >= TrustLevel.MEDIUM;
    return state.lowestTrustLevel >= TrustLevel.LOW;
  }

  getClusterIds(): string[] {
    return [...this.clusters.keys()];
  }

  removeCluster(clusterId: string): boolean {
    return this.clusters.delete(clusterId);
  }
}

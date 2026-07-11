/**
 * Group Context Trust for multi-agent environments.
 *
 * Tracks "clusters" — named groups of agentIds (e.g. one per chat thread
 * or Discord channel). When a new agent joins, it flags a handshake
 * requirement. Sensitivity-gated sharing prevents memory snippets from
 * leaking to unverified agents in a cluster.
 *
 * Enforcement is advisory unless the OpenClaw host provides an authoritative
 * content-sharing interception point.
 */

import { TrustGraphProtocol, TrustLevel } from "./trust-graph.js";
import type { TrustScope } from "./trust-scope.js";

export interface ClusterMember {
  agentId: string;
  joinedAt: number;
  verified: boolean;
  trustLevel: TrustLevel;
  /** Scoped standing expiry; member downgraded after this time. */
  validUntil?: number;
  downgradeReason?: string;
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

export type SensitivityCheckResult = {
  allowed: boolean;
  advisory: true;
  reason: string;
  clusterId: string;
  sensitivity: number;
  enforcement: "advisory";
};

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

    const standing = this.trustGraph.evaluateScopedTrust(
      this.localAgentId,
      agentId,
      { capability: "handshake" },
      Date.now(),
    );
    const node = this.trustGraph.getAgent(agentId);
    const rel = this.trustGraph.getRelationship(this.localAgentId, agentId);
    const verified =
      standing !== null &&
      standing.level >= TrustLevel.LOW &&
      node !== null;
    const trustLevel =
      standing?.level ??
      (rel
        ? (Math.max(rel.trustAB, rel.trustBA) as TrustLevel)
        : TrustLevel.UNKNOWN);

    const member: ClusterMember = {
      agentId,
      joinedAt: Date.now(),
      verified,
      trustLevel,
    };
    if (standing?.validUntil !== undefined) {
      member.validUntil = standing.validUntil;
    }
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
    options?: { validUntil?: number; scope?: Partial<TrustScope> },
  ): boolean {
    const cluster = this.clusters.get(clusterId);
    if (!cluster) return false;
    let member = cluster.members.get(agentId);
    if (!member) {
      member = this.noteAgentJoined(clusterId, agentId);
    }
    member.verified = true;
    member.trustLevel = trustLevel;
    if (options?.validUntil !== undefined) {
      member.validUntil = options.validUntil;
    }
    delete member.downgradeReason;
    return true;
  }

  /**
   * Downgrade/revoke cluster membership standing (expiry, dispute, key compromise).
   */
  downgradeMember(
    clusterId: string,
    agentId: string,
    reason: string,
  ): boolean {
    const cluster = this.clusters.get(clusterId);
    if (!cluster) return false;
    const member = cluster.members.get(agentId);
    if (!member) return false;
    member.verified = false;
    member.trustLevel = TrustLevel.UNKNOWN;
    member.downgradeReason = reason;
    return true;
  }

  /**
   * Refresh all members against current scoped standing / expiry.
   */
  refreshClusterStanding(clusterId: string, nowMs: number = Date.now()): void {
    const cluster = this.clusters.get(clusterId);
    if (!cluster) return;
    for (const member of cluster.members.values()) {
      if (member.validUntil !== undefined && nowMs > member.validUntil) {
        this.downgradeMember(clusterId, member.agentId, "assessment-expired");
        continue;
      }
      const standing = this.trustGraph.evaluateScopedTrust(
        this.localAgentId,
        member.agentId,
        { capability: "handshake" },
        nowMs,
      );
      if (!standing || standing.level < TrustLevel.LOW) {
        this.downgradeMember(
          clusterId,
          member.agentId,
          "scoped-standing-insufficient",
        );
      } else if (member.verified) {
        member.trustLevel = standing.level;
      }
    }
  }

  getClusterTrustState(clusterId: string): ClusterTrustState | null {
    this.refreshClusterStanding(clusterId);
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
   * @deprecated Prefer checkSensitivityShare which labels advisory enforcement.
   */
  shouldShareWithCluster(clusterId: string, sensitivity: number): boolean {
    return this.checkSensitivityShare(clusterId, sensitivity).allowed;
  }

  /**
   * Advisory sensitivity check — host must enforce unless an interception hook exists.
   */
  checkSensitivityShare(
    clusterId: string,
    sensitivity: number,
  ): SensitivityCheckResult {
    const state = this.getClusterTrustState(clusterId);
    if (!state) {
      return {
        allowed: false,
        advisory: true,
        reason: "unknown cluster",
        clusterId,
        sensitivity,
        enforcement: "advisory",
      };
    }
    if (sensitivity === 0) {
      return {
        allowed: true,
        advisory: true,
        reason: "public sensitivity",
        clusterId,
        sensitivity,
        enforcement: "advisory",
      };
    }
    if (!state.allVerified) {
      return {
        allowed: false,
        advisory: true,
        reason: "not all cluster members verified",
        clusterId,
        sensitivity,
        enforcement: "advisory",
      };
    }
    let allowed = true;
    let reason = "cluster meets sensitivity threshold";
    if (sensitivity >= 3 && state.lowestTrustLevel < TrustLevel.HIGH) {
      allowed = false;
      reason = "high sensitivity requires HIGH trust";
    } else if (sensitivity >= 2 && state.lowestTrustLevel < TrustLevel.MEDIUM) {
      allowed = false;
      reason = "medium sensitivity requires MEDIUM trust";
    } else if (sensitivity >= 1 && state.lowestTrustLevel < TrustLevel.LOW) {
      allowed = false;
      reason = "low sensitivity requires LOW trust";
    }
    return {
      allowed,
      advisory: true,
      reason,
      clusterId,
      sensitivity,
      enforcement: "advisory",
    };
  }

  getClusterIds(): string[] {
    return [...this.clusters.keys()];
  }

  removeCluster(clusterId: string): boolean {
    return this.clusters.delete(clusterId);
  }
}

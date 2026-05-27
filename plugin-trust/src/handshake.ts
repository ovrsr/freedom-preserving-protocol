/**
 * Constitutional Handshake Sequence (CHS) for agent-to-agent verification.
 *
 * Multi-step state machine: two agents exchange constitutional commitments,
 * share audit chain summaries (with Merkle roots), verify each other's claims,
 * and derive a trust level. Successful handshakes update the trust graph.
 *
 * State flow:
 *   INITIATED -> COMMITMENT_EXCHANGE -> ATTESTATION_VERIFICATION
 *             -> TRUST_VERIFICATION -> COMPLETE | FAILED
 *
 * Supports signed claims (Ed25519) and Merkle proof verification for
 * proof-of-compliance. Both are opt-in via constructor options.
 */

import { createHash } from "node:crypto";
import {
  TrustGraphProtocol,
  TrustLevel,
  type TrustEvidence,
} from "./trust-graph.js";
import { verifyClaim, type SignedClaim } from "./claims.js";
import {
  verifyMerkleProof,
  type MerkleProof,
} from "./merkle-bridge.js";

export enum HandshakeState {
  INITIATED = "initiated",
  COMMITMENT_EXCHANGE = "commitment_exchange",
  ATTESTATION_VERIFICATION = "attestation_verification",
  TRUST_VERIFICATION = "trust_verification",
  COMPLETE = "complete",
  FAILED = "failed",
}

export interface ConstitutionalClaim {
  agentId: string;
  constitutionHash: string;
  adoptedAt: string;
  auditMerkleRoot: string;
  auditEntryCount: number;
  chainIntact: boolean;
  recentLaws: string[];
}

export interface HandshakeEvidence {
  type:
    | "constitutional_commitment"
    | "attestation_summary"
    | "peer_verification"
    | "trust_propagation"
    | "signature_verification"
    | "merkle_proof_verification";
  data: unknown;
  confidence: number;
  timestamp: number;
}

export interface HandshakeResult {
  success: boolean;
  trustLevel: TrustLevel;
  confidence: number;
  evidence: HandshakeEvidence[];
  sessionId: string;
  timestamp: number;
  errors: string[];
}

export interface HandshakeSession {
  sessionId: string;
  initiator: string;
  responder: string;
  state: HandshakeState;
  startTime: number;
  lastUpdate: number;
  evidence: HandshakeEvidence[];
  initiatorClaim?: ConstitutionalClaim;
  responderClaim?: ConstitutionalClaim;
  result?: HandshakeResult;
}

export interface HandshakeOptions {
  timeoutMs?: number;
  maxPropagationDepth?: number;
  requireSignedClaims?: boolean;
  requireMerkleProof?: boolean;
}

const SESSION_TIMEOUT_MS = 300_000; // 5 minutes

export class ConstitutionalHandshake {
  private sessions = new Map<string, HandshakeSession>();
  private trustGraph: TrustGraphProtocol;
  private expectedConstitutionHash: string;
  private timeoutMs: number;
  private maxPropagationDepth: number;
  private requireSignedClaims: boolean;
  private requireMerkleProof: boolean;

  constructor(
    trustGraph: TrustGraphProtocol,
    expectedConstitutionHash: string,
    options?: HandshakeOptions,
  ) {
    this.trustGraph = trustGraph;
    this.expectedConstitutionHash = expectedConstitutionHash;
    this.timeoutMs = options?.timeoutMs ?? SESSION_TIMEOUT_MS;
    this.maxPropagationDepth = options?.maxPropagationDepth ?? 3;
    this.requireSignedClaims = options?.requireSignedClaims ?? false;
    this.requireMerkleProof = options?.requireMerkleProof ?? false;
  }

  /**
   * Step 1: Initiator sends their constitutional claim.
   */
  initiate(claim: ConstitutionalClaim): HandshakeSession {
    const sessionId = this.generateSessionId(claim.agentId);
    const session: HandshakeSession = {
      sessionId,
      initiator: claim.agentId,
      responder: "",
      state: HandshakeState.INITIATED,
      startTime: Date.now(),
      lastUpdate: Date.now(),
      evidence: [],
      initiatorClaim: claim,
    };

    const evidence = this.verifyCommitment(claim);
    session.evidence.push(evidence);
    session.state = HandshakeState.COMMITMENT_EXCHANGE;
    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Step 2: Responder sends their claim; both claims are now verified.
   */
  respond(
    sessionId: string,
    claim: ConstitutionalClaim,
  ): HandshakeSession | null {
    const session = this.sessions.get(sessionId);
    if (!session || session.state !== HandshakeState.COMMITMENT_EXCHANGE)
      return null;
    if (this.isExpired(session)) return this.fail(session, "session timeout");

    session.responder = claim.agentId;
    session.responderClaim = claim;

    const evidence = this.verifyCommitment(claim);
    session.evidence.push(evidence);

    session.state = HandshakeState.ATTESTATION_VERIFICATION;
    session.lastUpdate = Date.now();

    this.verifyAttestations(session);
    return session;
  }

  /**
   * Single-shot verification of a peer claim (for tool-based handshakes).
   * Does not require a prior session — creates, processes, and completes
   * a full handshake cycle using only the peer's claim and this agent's
   * own identity.
   */
  verifyFromClaim(
    localAgentId: string,
    peerClaim: ConstitutionalClaim | SignedClaim,
    peerMerkleProof?: MerkleProof,
  ): HandshakeResult {
    const sessionId = this.generateSessionId(localAgentId);
    const evidence: HandshakeEvidence[] = [];

    const commitEvidence = this.verifyCommitment(peerClaim);
    evidence.push(commitEvidence);

    const signed = peerClaim as Partial<SignedClaim>;
    if (signed.publicKey && signed.signature) {
      const sigResult = verifyClaim(signed as SignedClaim);
      evidence.push({
        type: "signature_verification",
        data: {
          agentId: peerClaim.agentId,
          publicKey: signed.publicKey,
          valid: sigResult.valid,
          reason: sigResult.reason,
        },
        confidence: sigResult.valid ? 0.95 : 0.0,
        timestamp: Date.now(),
      });
    } else if (this.requireSignedClaims) {
      return {
        success: false,
        trustLevel: TrustLevel.UNKNOWN,
        confidence: 0,
        evidence,
        sessionId,
        timestamp: Date.now(),
        errors: ["signed claims required but peer claim is unsigned"],
      };
    }

    if (peerMerkleProof) {
      const proofValid =
        verifyMerkleProof(peerMerkleProof) &&
        peerMerkleProof.root === peerClaim.auditMerkleRoot;
      evidence.push({
        type: "merkle_proof_verification",
        data: {
          root: peerMerkleProof.root,
          claimedRoot: peerClaim.auditMerkleRoot,
          leafIndex: peerMerkleProof.index,
          valid: proofValid,
        },
        confidence: proofValid ? 0.9 : 0.0,
        timestamp: Date.now(),
      });
    } else if (this.requireMerkleProof) {
      return {
        success: false,
        trustLevel: TrustLevel.UNKNOWN,
        confidence: 0,
        evidence,
        sessionId,
        timestamp: Date.now(),
        errors: ["Merkle proof required but not provided"],
      };
    }

    const chainValid =
      peerClaim.chainIntact && peerClaim.auditEntryCount > 0;
    evidence.push({
      type: "attestation_summary",
      data: {
        chainIntact: peerClaim.chainIntact,
        entries: peerClaim.auditEntryCount,
        merkleRoot: peerClaim.auditMerkleRoot,
      },
      confidence: chainValid ? 0.85 : 0.3,
      timestamp: Date.now(),
    });

    evidence.push({
      type: "peer_verification",
      data: { peerValid: chainValid },
      confidence: chainValid ? 0.8 : 0.2,
      timestamp: Date.now(),
    });

    const existing = this.trustGraph.propagateTrust(
      localAgentId,
      peerClaim.agentId,
      this.maxPropagationDepth,
    );
    evidence.push({
      type: "trust_propagation",
      data: existing
        ? {
            path: existing.path,
            trustLevel: existing.trustLevel,
            confidence: existing.confidence,
          }
        : null,
      confidence: existing?.confidence ?? 0.5,
      timestamp: Date.now(),
    });

    const confidence = this.computeEvidenceConfidence(evidence);
    const trustLevel = this.deriveTrustLevelFromConfidence(
      localAgentId,
      peerClaim.agentId,
      confidence,
    );
    const success = confidence > 0.5;

    if (success) {
      this.trustGraph.addAgent(
        peerClaim.agentId,
        peerClaim.constitutionHash,
      );
      if (signed.publicKey) {
        this.trustGraph.updateAgentPublicKey(
          peerClaim.agentId,
          signed.publicKey,
        );
      }
      this.trustGraph.addAgent(localAgentId, this.expectedConstitutionHash);

      const trustEvidence: TrustEvidence[] = evidence.map((e) => ({
        type: "handshake" as const,
        data: e.data,
        weight: e.confidence,
        timestamp: e.timestamp,
        source: sessionId,
      }));

      this.trustGraph.establishTrust(
        localAgentId,
        peerClaim.agentId,
        trustLevel,
        trustLevel,
        trustEvidence,
      );

      this.trustGraph.updateReputation(peerClaim.agentId, "positive", {
        cooperation: confidence,
        transparency: confidence,
        constitutionalFidelity: chainValid ? confidence : 0.3,
      });
    }

    return {
      success,
      trustLevel,
      confidence,
      evidence,
      sessionId,
      timestamp: Date.now(),
      errors: success ? [] : ["confidence below threshold"],
    };
  }

  /**
   * Step 3 (internal): Verify both agents' attestation summaries, then
   * check trust propagation and complete.
   */
  private verifyAttestations(session: HandshakeSession): void {
    const iClaim = session.initiatorClaim!;
    const rClaim = session.responderClaim!;

    const iValid = iClaim.chainIntact && iClaim.auditEntryCount > 0;
    const rValid = rClaim.chainIntact && rClaim.auditEntryCount > 0;

    session.evidence.push({
      type: "attestation_summary",
      data: {
        initiator: {
          chainIntact: iClaim.chainIntact,
          entries: iClaim.auditEntryCount,
          merkleRoot: iClaim.auditMerkleRoot,
        },
        responder: {
          chainIntact: rClaim.chainIntact,
          entries: rClaim.auditEntryCount,
          merkleRoot: rClaim.auditMerkleRoot,
        },
      },
      confidence: iValid && rValid ? 0.85 : 0.3,
      timestamp: Date.now(),
    });

    session.evidence.push({
      type: "peer_verification",
      data: { initiatorValid: iValid, responderValid: rValid },
      confidence: iValid && rValid ? 0.8 : 0.2,
      timestamp: Date.now(),
    });

    session.state = HandshakeState.TRUST_VERIFICATION;
    this.completeTrustVerification(session);
  }

  private completeTrustVerification(session: HandshakeSession): void {
    const existing = this.trustGraph.propagateTrust(
      session.initiator,
      session.responder,
      this.maxPropagationDepth,
    );

    session.evidence.push({
      type: "trust_propagation",
      data: existing
        ? {
            path: existing.path,
            trustLevel: existing.trustLevel,
            confidence: existing.confidence,
          }
        : null,
      confidence: existing?.confidence ?? 0.5,
      timestamp: Date.now(),
    });

    const confidence = this.computeConfidence(session);
    const trustLevel = this.deriveTrustLevel(session, confidence);
    const success = confidence > 0.5;

    session.result = {
      success,
      trustLevel,
      confidence,
      evidence: session.evidence,
      sessionId: session.sessionId,
      timestamp: Date.now(),
      errors: success ? [] : ["confidence below threshold"],
    };

    session.state = success
      ? HandshakeState.COMPLETE
      : HandshakeState.FAILED;

    if (success) {
      this.trustGraph.addAgent(
        session.initiator,
        session.initiatorClaim!.constitutionHash,
      );
      this.trustGraph.addAgent(
        session.responder,
        session.responderClaim!.constitutionHash,
      );

      const trustEvidence: TrustEvidence[] = session.evidence.map((e) => ({
        type: "handshake" as const,
        data: e.data,
        weight: e.confidence,
        timestamp: e.timestamp,
        source: session.sessionId,
      }));

      this.trustGraph.establishTrust(
        session.initiator,
        session.responder,
        trustLevel,
        trustLevel,
        trustEvidence,
      );

      this.trustGraph.updateReputation(session.initiator, "positive", {
        cooperation: confidence,
        transparency: confidence,
      });
      this.trustGraph.updateReputation(session.responder, "positive", {
        cooperation: confidence,
        transparency: confidence,
      });
    }

    session.lastUpdate = Date.now();
  }

  getSession(sessionId: string): HandshakeSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  getActiveSessions(): HandshakeSession[] {
    return [...this.sessions.values()].filter(
      (s) =>
        s.state !== HandshakeState.COMPLETE &&
        s.state !== HandshakeState.FAILED,
    );
  }

  cleanupExpired(): number {
    let cleaned = 0;
    for (const [_id, session] of this.sessions) {
      if (this.isExpired(session)) {
        this.fail(session, "session timeout");
        cleaned++;
      }
    }
    return cleaned;
  }

  // -- private helpers --

  private verifyCommitment(claim: ConstitutionalClaim): HandshakeEvidence {
    const hashMatch =
      claim.constitutionHash === this.expectedConstitutionHash;
    return {
      type: "constitutional_commitment",
      data: {
        agentId: claim.agentId,
        constitutionHash: claim.constitutionHash,
        hashMatch,
        adoptedAt: claim.adoptedAt,
      },
      confidence: hashMatch ? 0.95 : 0.1,
      timestamp: Date.now(),
    };
  }

  private computeConfidence(session: HandshakeSession): number {
    return this.computeEvidenceConfidence(session.evidence);
  }

  private computeEvidenceConfidence(evidence: HandshakeEvidence[]): number {
    const weights: Record<string, number> = {
      constitutional_commitment: 0.25,
      attestation_summary: 0.2,
      peer_verification: 0.15,
      trust_propagation: 0.15,
      signature_verification: 0.15,
      merkle_proof_verification: 0.1,
    };

    let totalConf = 0;
    let totalWeight = 0;
    for (const e of evidence) {
      const w = weights[e.type] ?? 0.1;
      totalConf += e.confidence * w;
      totalWeight += w;
    }
    return totalWeight > 0 ? totalConf / totalWeight : 0;
  }

  private deriveTrustLevel(
    session: HandshakeSession,
    confidence: number,
  ): TrustLevel {
    return this.deriveTrustLevelFromConfidence(
      session.initiator,
      session.responder,
      confidence,
    );
  }

  private deriveTrustLevelFromConfidence(
    agentA: string,
    agentB: string,
    confidence: number,
  ): TrustLevel {
    const existing = this.trustGraph.getRelationship(agentA, agentB);
    if (existing) {
      return Math.max(existing.trustAB, existing.trustBA) as TrustLevel;
    }
    if (confidence > 0.8) return TrustLevel.HIGH;
    if (confidence > 0.6) return TrustLevel.MEDIUM;
    if (confidence > 0.4) return TrustLevel.LOW;
    return TrustLevel.UNKNOWN;
  }

  private fail(
    session: HandshakeSession,
    reason: string,
  ): HandshakeSession {
    session.state = HandshakeState.FAILED;
    session.result = {
      success: false,
      trustLevel: TrustLevel.UNKNOWN,
      confidence: 0,
      evidence: session.evidence,
      sessionId: session.sessionId,
      timestamp: Date.now(),
      errors: [reason],
    };
    session.lastUpdate = Date.now();
    return session;
  }

  private isExpired(session: HandshakeSession): boolean {
    return Date.now() - session.lastUpdate > this.timeoutMs;
  }

  private generateSessionId(agentId: string): string {
    const data = `${agentId}-${Date.now()}-${Math.random()}`;
    return (
      "chs-" +
      createHash("sha256").update(data).digest("hex").slice(0, 24)
    );
  }
}

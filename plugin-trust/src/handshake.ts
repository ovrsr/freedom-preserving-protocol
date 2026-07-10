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

import { createHash, randomBytes } from "node:crypto";
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
import {
  deriveLegacyAlias,
  type FreshnessEnvelope,
  type LegacyConstitutionalClaimV1,
  buildReplayKey,
  validateFreshness,
} from "@ovrsr/fpp-protocol-core";
import type { ReplayCache } from "./replay-cache.js";
import {
  EVIDENCE_CLASS_CEILINGS,
  SELF_ASSERTED_CONFIGURATION_CEILING,
  trustLevelCeilingFromConfidence,
  type EvidenceClass,
} from "./evidence-classes.js";

export enum HandshakeState {
  INITIATED = "initiated",
  COMMITMENT_EXCHANGE = "commitment_exchange",
  ATTESTATION_VERIFICATION = "attestation_verification",
  TRUST_VERIFICATION = "trust_verification",
  COMPLETE = "complete",
  FAILED = "failed",
}

/** Claim fields accepted by the handshake (v1 shape + optional freshness). */
export type ConstitutionalClaim = LegacyConstitutionalClaimV1 & {
  freshness?: FreshnessEnvelope;
  schemaVersion?: 2;
  claimClass?: string;
  keyAlgorithm?: string;
};

export interface HandshakeEvidence {
  type:
    | "constitutional_commitment"
    | "attestation_summary"
    | "peer_verification"
    | "trust_propagation"
    | "signature_verification"
    | "merkle_proof_verification"
    | "freshness_verification";
  data: unknown;
  confidence: number;
  timestamp: number;
  evidenceClass?: EvidenceClass;
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
  /** When true, peer claims must include a fresh, non-replayed challenge. */
  requireFreshness?: boolean;
  replayCache?: ReplayCache;
  now?: () => number;
  localAudience?: string;
  maxLifetimeMs?: number;
  allowedClockSkewMs?: number;
  defaultChallengeLifetimeMs?: number;
}

const SESSION_TIMEOUT_MS = 300_000; // 5 minutes
const DEFAULT_CHALLENGE_LIFETIME_MS = 300_000;
const DEFAULT_MAX_LIFETIME_MS = 600_000;
const DEFAULT_CLOCK_SKEW_MS = 120_000;

export class ConstitutionalHandshake {
  private sessions = new Map<string, HandshakeSession>();
  private trustGraph: TrustGraphProtocol;
  private expectedConstitutionHash: string;
  private timeoutMs: number;
  private maxPropagationDepth: number;
  private requireSignedClaims: boolean;
  private requireMerkleProof: boolean;
  private requireFreshness: boolean;
  private replayCache: ReplayCache | undefined;
  private now: () => number;
  private localAudience: string | undefined;
  private maxLifetimeMs: number;
  private allowedClockSkewMs: number;
  private defaultChallengeLifetimeMs: number;

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
    this.requireFreshness = options?.requireFreshness ?? false;
    this.replayCache = options?.replayCache;
    this.now = options?.now ?? Date.now;
    this.localAudience = options?.localAudience;
    this.maxLifetimeMs = options?.maxLifetimeMs ?? DEFAULT_MAX_LIFETIME_MS;
    this.allowedClockSkewMs =
      options?.allowedClockSkewMs ?? DEFAULT_CLOCK_SKEW_MS;
    this.defaultChallengeLifetimeMs =
      options?.defaultChallengeLifetimeMs ?? DEFAULT_CHALLENGE_LIFETIME_MS;
  }

  /**
   * Issue a challenge the peer must bind into their signed freshness envelope.
   */
  issueChallenge(
    audience: string,
    options?: { lifetimeMs?: number | undefined } | undefined,
  ): FreshnessEnvelope {
    const nowMs = this.now();
    const lifetime = options?.lifetimeMs ?? this.defaultChallengeLifetimeMs;
    return {
      audience,
      challenge: randomBytes(16).toString("hex"),
      issuedAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + lifetime).toISOString(),
    };
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
    const nowMs = this.now();

    const commitEvidence = this.verifyCommitment(peerClaim);
    evidence.push(commitEvidence);

    if (this.requireFreshness) {
      const freshnessResult = this.verifyFreshness(peerClaim, localAgentId);
      evidence.push(freshnessResult.evidence);
      if (!freshnessResult.ok) {
        return {
          success: false,
          trustLevel: TrustLevel.UNKNOWN,
          confidence: 0,
          evidence,
          sessionId,
          timestamp: nowMs,
          errors: [freshnessResult.reason],
        };
      }
    }

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
          evidenceClass: "identity",
        },
        confidence: sigResult.valid
          ? EVIDENCE_CLASS_CEILINGS.identity
          : 0.0,
        timestamp: nowMs,
        evidenceClass: "identity",
      });
    } else if (this.requireSignedClaims) {
      return {
        success: false,
        trustLevel: TrustLevel.UNKNOWN,
        confidence: 0,
        evidence,
        sessionId,
        timestamp: nowMs,
        errors: ["signed claims required but peer claim is unsigned"],
      };
    }

    if (peerMerkleProof) {
      const inclusionValid = verifyMerkleProof(peerMerkleProof);
      const rootMatch = peerMerkleProof.root === peerClaim.auditMerkleRoot;
      const proofValid = inclusionValid && rootMatch;
      evidence.push({
        type: "merkle_proof_verification",
        data: {
          root: peerMerkleProof.root,
          claimedRoot: peerClaim.auditMerkleRoot,
          leafIndex: peerMerkleProof.index,
          valid: proofValid,
          semantics: "inclusion-under-claimed-root",
          evidenceClass: "completeness",
          rootAnchored: false,
        },
        confidence: proofValid
          ? Math.min(0.9, EVIDENCE_CLASS_CEILINGS.completeness)
          : 0.0,
        timestamp: nowMs,
        evidenceClass: "completeness",
      });
    } else if (this.requireMerkleProof) {
      return {
        success: false,
        trustLevel: TrustLevel.UNKNOWN,
        confidence: 0,
        evidence,
        sessionId,
        timestamp: nowMs,
        errors: ["Merkle proof required but not provided"],
      };
    }

    // Self-asserted chain status is configuration declaration only — not proof.
    const selfAsserted =
      peerClaim.chainIntact && peerClaim.auditEntryCount > 0;
    evidence.push({
      type: "attestation_summary",
      data: {
        chainIntact: peerClaim.chainIntact,
        entries: peerClaim.auditEntryCount,
        merkleRoot: peerClaim.auditMerkleRoot,
        evidenceClass: "configuration",
        standing: "self-asserted",
      },
      confidence: selfAsserted
        ? SELF_ASSERTED_CONFIGURATION_CEILING
        : 0.15,
      timestamp: nowMs,
      evidenceClass: "configuration",
    });

    evidence.push({
      type: "peer_verification",
      data: {
        peerValid: selfAsserted,
        evidenceClass: "configuration",
        standing: "self-asserted",
      },
      confidence: selfAsserted
        ? SELF_ASSERTED_CONFIGURATION_CEILING * 0.8
        : 0.1,
      timestamp: nowMs,
      evidenceClass: "configuration",
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
      timestamp: nowMs,
    });

    const confidence = this.computeEvidenceConfidence(evidence);
    const trustLevel = this.deriveTrustLevelFromConfidence(
      localAgentId,
      peerClaim.agentId,
      confidence,
      evidence,
    );
    const hasIdentityStanding = evidence.some(
      (e) =>
        e.type === "signature_verification" && e.confidence > 0,
    );
    const hasConfigStanding = evidence.some(
      (e) =>
        e.type === "constitutional_commitment" && e.confidence >= 0.5,
    );
    const success =
      confidence > 0.4 || (hasIdentityStanding && hasConfigStanding);

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
        this.trustGraph.addLegacyAlias(
          peerClaim.agentId,
          deriveLegacyAlias(signed.publicKey),
        );
      }
      this.trustGraph.addAgent(localAgentId, this.expectedConstitutionHash);

      const trustEvidence: TrustEvidence[] = evidence.map((e) => ({
        type: "handshake" as const,
        data: e.data,
        weight: e.confidence,
        timestamp: e.timestamp,
        source: sessionId,
        ...(e.evidenceClass !== undefined
          ? { evidenceClass: e.evidenceClass }
          : {}),
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
        constitutionalFidelity: selfAsserted
          ? Math.min(confidence, SELF_ASSERTED_CONFIGURATION_CEILING)
          : 0.3,
      });
    }

    return {
      success,
      trustLevel,
      confidence,
      evidence,
      sessionId,
      timestamp: nowMs,
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

    const iSelf = iClaim.chainIntact && iClaim.auditEntryCount > 0;
    const rSelf = rClaim.chainIntact && rClaim.auditEntryCount > 0;

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
        evidenceClass: "configuration",
        standing: "self-asserted",
      },
      confidence:
        iSelf && rSelf
          ? SELF_ASSERTED_CONFIGURATION_CEILING
          : 0.15,
      timestamp: this.now(),
      evidenceClass: "configuration",
    });

    session.evidence.push({
      type: "peer_verification",
      data: {
        initiatorValid: iSelf,
        responderValid: rSelf,
        evidenceClass: "configuration",
        standing: "self-asserted",
      },
      confidence:
        iSelf && rSelf
          ? SELF_ASSERTED_CONFIGURATION_CEILING * 0.8
          : 0.1,
      timestamp: this.now(),
      evidenceClass: "configuration",
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

  private verifyFreshness(
    claim: ConstitutionalClaim,
    localAgentId: string,
  ): {
    ok: boolean;
    reason: string;
    evidence: HandshakeEvidence;
  } {
    const freshness = claim.freshness;
    const nowMs = this.now();
    if (!freshness) {
      return {
        ok: false,
        reason: "freshness envelope required but missing",
        evidence: {
          type: "freshness_verification",
          data: { valid: false, reason: "missing" },
          confidence: 0,
          timestamp: nowMs,
        },
      };
    }

    const expectedAudience = this.localAudience ?? localAgentId;
    if (freshness.audience !== expectedAudience) {
      return {
        ok: false,
        reason: "freshness audience does not match verifier",
        evidence: {
          type: "freshness_verification",
          data: {
            valid: false,
            reason: "audience mismatch",
            expected: expectedAudience,
            actual: freshness.audience,
          },
          confidence: 0,
          timestamp: nowMs,
        },
      };
    }

    const validation = validateFreshness(freshness, {
      maxLifetimeMs: this.maxLifetimeMs,
      allowedClockSkewMs: this.allowedClockSkewMs,
      nowMs,
    });
    if (!validation.valid) {
      return {
        ok: false,
        reason: validation.reason,
        evidence: {
          type: "freshness_verification",
          data: { valid: false, reason: validation.reason },
          confidence: 0,
          timestamp: nowMs,
        },
      };
    }

    if (this.replayCache) {
      const key = buildReplayKey(freshness);
      const expiresAtMs = Date.parse(freshness.expiresAt);
      if (!this.replayCache.consume(key, expiresAtMs)) {
        return {
          ok: false,
          reason: "replay detected: challenge already consumed",
          evidence: {
            type: "freshness_verification",
            data: { valid: false, reason: "replay", replayKey: key },
            confidence: 0,
            timestamp: nowMs,
          },
        };
      }
    }

    return {
      ok: true,
      reason: "fresh",
      evidence: {
        type: "freshness_verification",
        data: {
          valid: true,
          audience: freshness.audience,
          challenge: freshness.challenge,
          issuedAt: freshness.issuedAt,
          expiresAt: freshness.expiresAt,
        },
        confidence: 0.95,
        timestamp: nowMs,
      },
    };
  }

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
        evidenceClass: "configuration",
      },
      confidence: hashMatch
        ? EVIDENCE_CLASS_CEILINGS.configuration
        : 0.1,
      timestamp: this.now(),
      evidenceClass: "configuration",
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
      freshness_verification: 0.15,
    };

    let totalConf = 0;
    let totalWeight = 0;
    for (const e of evidence) {
      const w = weights[e.type] ?? 0.1;
      const classCeiling =
        e.evidenceClass !== undefined
          ? EVIDENCE_CLASS_CEILINGS[e.evidenceClass]
          : 1;
      const capped = Math.min(e.confidence, classCeiling);
      totalConf += capped * w;
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
      session.evidence,
    );
  }

  private deriveTrustLevelFromConfidence(
    agentA: string,
    agentB: string,
    confidence: number,
    evidence: HandshakeEvidence[] = [],
  ): TrustLevel {
    const existing = this.trustGraph.getRelationship(agentA, agentB);
    if (existing) {
      return Math.max(existing.trustAB, existing.trustBA) as TrustLevel;
    }

    // Cap trust by the strongest verified evidence class present.
    // Self-asserted configuration alone cannot reach HIGH.
    const verifiedClasses = evidence
      .filter(
        (e) =>
          e.evidenceClass !== undefined &&
          e.confidence > 0 &&
          !(
            e.evidenceClass === "configuration" &&
            (e.data as { standing?: string } | null)?.standing ===
              "self-asserted"
          ),
      )
      .map((e) => e.evidenceClass!);

    let classCeiling = SELF_ASSERTED_CONFIGURATION_CEILING;
    if (verifiedClasses.length > 0) {
      classCeiling = Math.max(
        ...verifiedClasses.map((c) => EVIDENCE_CLASS_CEILINGS[c]),
      );
    } else if (
      evidence.some(
        (e) =>
          e.evidenceClass === "configuration" &&
          (e.data as { standing?: string } | null)?.standing ===
            "self-asserted",
      )
    ) {
      classCeiling = SELF_ASSERTED_CONFIGURATION_CEILING;
    }

    // Signature + constitution match count as identity/configuration standing.
    if (
      evidence.some(
        (e) =>
          e.type === "signature_verification" && e.confidence >= 0.9,
      )
    ) {
      classCeiling = Math.max(classCeiling, EVIDENCE_CLASS_CEILINGS.identity);
    }
    if (
      evidence.some(
        (e) =>
          e.type === "constitutional_commitment" && e.confidence >= 0.9,
      )
    ) {
      classCeiling = Math.max(
        classCeiling,
        EVIDENCE_CLASS_CEILINGS.configuration,
      );
    }

    const cappedConfidence = Math.min(confidence, classCeiling);
    const maxLevel = trustLevelCeilingFromConfidence(classCeiling);

    let level: TrustLevel;
    if (cappedConfidence > 0.8) level = TrustLevel.HIGH;
    else if (cappedConfidence > 0.6) level = TrustLevel.MEDIUM;
    else if (cappedConfidence > 0.4) level = TrustLevel.LOW;
    else level = TrustLevel.UNKNOWN;

    return Math.min(level, maxLevel) as TrustLevel;
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
      timestamp: this.now(),
      errors: [reason],
    };
    session.lastUpdate = this.now();
    return session;
  }

  private isExpired(session: HandshakeSession): boolean {
    return this.now() - session.lastUpdate > this.timeoutMs;
  }

  private generateSessionId(agentId: string): string {
    const data = `${agentId}-${this.now()}-${Math.random()}`;
    return (
      "chs-" +
      createHash("sha256").update(data).digest("hex").slice(0, 24)
    );
  }
}

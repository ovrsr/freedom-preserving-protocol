/**
 * LLM-facing tools for the FPP trust plugin.
 *
 * Four tools registered via defineToolPlugin. Each execute() receives
 * typed params, the merged plugin config, and a ToolPluginExecutionContext
 * from the SDK. Return values are plain objects — the SDK normalises them
 * into AgentToolResult internally.
 */

import { Type, type Static } from "@sinclair/typebox";
import {
  parseClaim,
  parseFreshnessEnvelope,
  type FreshnessEnvelope,
  type QuorumBallotV1,
} from "@ovrsr/fpp-protocol-core";
import type { AgentIdentity } from "./identity.js";
import { signClaim } from "./claims.js";
import type { ConstitutionalClaim, HandshakeResult } from "./handshake.js";
import { ConstitutionalHandshake } from "./handshake.js";
import { TrustGraphProtocol, TrustLevel } from "./trust-graph.js";
import { ScopedTrustStore } from "./trust-scope.js";
import type { MerkleBridge, MerkleProof } from "./merkle-bridge.js";
import type { StrictModeManager } from "./strict-mode.js";
import type { GroupContextManager } from "./group-context.js";
import {
  verifyReceiptEvidence,
  getReceiptRoot,
  createTypedReceiptProof,
  RECEIPT_LOG_KIND,
} from "./receipt-verifier.js";
import {
  buildTrustStateCapsule,
  validateTrustStateCapsule,
  isLegacyClaimMasquerading,
} from "./capsule.js";
import type { QuorumSessionManager } from "./quorum-session.js";
import {
  computeIntendedMandateDigest,
  signQuorumBallot,
  signQuorumProposal,
} from "./quorum-session.js";

export interface ToolDependencies {
  identity: AgentIdentity;
  trustGraph: TrustGraphProtocol;
  handshake: ConstitutionalHandshake;
  merkleBridge: MerkleBridge;
  strictMode: StrictModeManager;
  groupContext: GroupContextManager;
  constitutionHash: string;
  strictModeOnHandshakeFailure: boolean;
  strictModeTtlMs: number;
  receiptLogPath?: string | undefined;
}

function textResult(text: string, details: unknown) {
  return { content: [{ type: "text" as const, text }], details };
}

function failResult(text: string) {
  return textResult(text, { status: "failed" as const });
}

/**
 * Precise verification summary for handshake outputs.
 * Signed fresh configuration establishes identity/configuration standing only —
 * never behavioral compliance. `fppVerified` is a deprecated compatibility
 * field derived from standing for one migration window.
 */
export type VerificationStanding =
  | "none"
  | "declaration-only"
  | "identity-configuration";

export type VerificationSummary = {
  identityVerified: boolean;
  configurationClaimVerified: boolean;
  freshnessVerified: boolean;
  evidenceLevel: string;
  standing: VerificationStanding;
  /** @deprecated Derived from standing; not behavioral compliance. */
  fppVerified: boolean;
};

export function summarizeHandshakeVerification(
  result: HandshakeResult,
): VerificationSummary {
  const identityVerified = result.evidence.some(
    (e) =>
      e.type === "signature_verification" &&
      e.confidence > 0 &&
      (e.data as { valid?: boolean } | null)?.valid !== false,
  );
  const configurationClaimVerified = result.evidence.some(
    (e) =>
      e.type === "constitutional_commitment" && e.confidence >= 0.5,
  );
  const freshnessEvidence = result.evidence.filter(
    (e) => e.type === "freshness_verification",
  );
  const freshnessVerified =
    freshnessEvidence.length > 0 &&
    freshnessEvidence.every((e) => e.confidence > 0);

  const classes: string[] = [];
  if (identityVerified) classes.push("identity");
  if (configurationClaimVerified) classes.push("configuration");
  if (freshnessVerified) classes.push("freshness");
  const evidenceLevel =
    classes.length > 0 ? classes.join("+") : "none";

  let standing: VerificationStanding = "none";
  if (identityVerified && configurationClaimVerified) {
    standing = "identity-configuration";
  } else if (result.success && !identityVerified) {
    standing = "declaration-only";
  }

  // Deprecated compatibility: true only when identity+configuration standing
  // is present — never a blanket "behavioral compliance verified".
  const fppVerified = standing === "identity-configuration";

  return {
    identityVerified,
    configurationClaimVerified,
    freshnessVerified,
    evidenceLevel,
    standing,
    fppVerified,
  };
}

// ── Parameter schemas ──────────────────────────────────────────────

export const HandshakeChallengeParams = Type.Object({
  audience: Type.Optional(
    Type.String({
      description:
        "Audience for the challenge (defaults to this agent's v2 id).",
    }),
  ),
  lifetimeMs: Type.Optional(
    Type.Integer({
      minimum: 10_000,
      maximum: 600_000,
      description: "Challenge lifetime in milliseconds (default 300000).",
    }),
  ),
});

export const HandshakeOfferParams = Type.Object({
  targetAgentId: Type.Optional(
    Type.String({
      description:
        "Optional identifier of the agent you intend to handshake with.",
    }),
  ),
  peerChallenge: Type.Optional(
    Type.String({
      description:
        "JSON freshness envelope from the peer's fpp_handshake_challenge. Required for hardened v2 handshakes.",
    }),
  ),
});

export const HandshakeVerifyParams = Type.Object({
  peerClaim: Type.String({
    description:
      "The JSON string of the peer's signed constitutional claim.",
  }),
  sessionKey: Type.Optional(
    Type.String({
      description:
        "Session key for strict-mode escalation on handshake failure.",
    }),
  ),
});

export const TrustStatusParams = Type.Object({
  targetAgentId: Type.String({
    description: "The agent ID to look up in the trust graph.",
  }),
  capability: Type.Optional(
    Type.String({
      description: "Capability scope to evaluate (e.g. file.read). Defaults to *.",
    }),
  ),
  environment: Type.Optional(
    Type.String({ description: "Environment scope (e.g. dev, prod)." }),
  ),
  resource: Type.Optional(
    Type.String({ description: "Resource scope filter." }),
  ),
});

export const AttestationExportParams = Type.Object({
  includeProofForIndex: Type.Optional(
    Type.Integer({
      description:
        "Zero-based index of the audit entry to generate a Merkle inclusion proof for.",
    }),
  ),
});

export const ClusterStatusParams = Type.Object({
  clusterId: Type.String({
    description: "Cluster (group/chat thread) identifier to inspect.",
  }),
});

export const SensitivityShareParams = Type.Object({
  clusterId: Type.String({
    description: "Cluster to evaluate for sharing.",
  }),
  sensitivity: Type.Integer({
    minimum: 0,
    maximum: 3,
    description: "0=public, 1=low, 2=medium, 3=high",
  }),
});

// ── Tool execute implementations ───────────────────────────────────

export function executeHandshakeChallenge(
  params: Static<typeof HandshakeChallengeParams>,
  deps: ToolDependencies,
) {
  const audience = params.audience ?? deps.identity.agentId;
  const challenge = deps.handshake.issueChallenge(
    audience,
    params.lifetimeMs !== undefined
      ? { lifetimeMs: params.lifetimeMs }
      : undefined,
  );
  const copyableJson = JSON.stringify(challenge, null, 2);
  return textResult(
    `FPP handshake challenge issued.\n` +
      `Share this JSON with the peer so they can answer via fpp_handshake_offer ` +
      `(peerChallenge parameter).\n\n` +
      "```json\n" +
      copyableJson +
      "\n```",
    {
      status: "ok",
      challenge,
      copyableJson,
    },
  );
}

export function executeHandshakeOffer(
  params: Static<typeof HandshakeOfferParams>,
  deps: ToolDependencies,
) {
  const { identity, merkleBridge, constitutionHash } = deps;
  const { root, entryCount } = merkleBridge.getCurrentRoot();
  const recentHashes = merkleBridge.getRecentLeafHashes(5);

  let freshness: FreshnessEnvelope | undefined;
  if (params.peerChallenge) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(params.peerChallenge);
    } catch {
      return failResult(
        "Failed to parse peerChallenge JSON. Expect the output of fpp_handshake_challenge.",
      );
    }
    const env = parseFreshnessEnvelope(parsed);
    if (!env.ok) {
      return failResult(`Invalid peerChallenge: ${env.error}`);
    }
    freshness = env.envelope;
  }

  const claim: ConstitutionalClaim = {
    agentId: identity.agentId,
    constitutionHash,
    adoptedAt: new Date().toISOString(),
    auditMerkleRoot: root,
    auditEntryCount: entryCount,
    chainIntact: entryCount > 0,
    recentLaws: [],
    ...(freshness !== undefined ? { freshness } : {}),
  };

  const signed = signClaim(claim, identity);
  const copyableJson = JSON.stringify(signed, null, 2);

  const target = params.targetAgentId ?? "any agent";

  return textResult(
    `FPP handshake offer generated for ${target}. ` +
      `Share the claim JSON below with the peer agent so they can verify it ` +
      `using fpp_handshake_verify.\n\n` +
      `Agent ID: ${identity.agentId}\n` +
      `Public Key: ${identity.publicKeyHex}\n` +
      `Merkle Root: ${root}\n` +
      `Audit Entries: ${entryCount}\n` +
      `Freshness bound: ${freshness ? "yes" : "no"}\n\n` +
      "```json\n" +
      copyableJson +
      "\n```",
    {
      status: "ok",
      claim: signed,
      recentAuditHashes: recentHashes,
      copyableJson,
      freshnessBound: freshness !== undefined,
    },
  );
}

export function executeHandshakeVerify(
  params: Static<typeof HandshakeVerifyParams>,
  deps: ToolDependencies,
) {
  const {
    identity,
    handshake,
    strictMode,
    strictModeOnHandshakeFailure,
    strictModeTtlMs,
    groupContext,
  } = deps;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(params.peerClaim) as Record<string, unknown>;
  } catch {
    return failResult(
      "Failed to parse peerClaim JSON. Ensure it is valid JSON from fpp_handshake_offer.",
    );
  }

  const claimParse = parseClaim(parsed);
  if (!claimParse.ok) {
    return failResult(
      `Invalid claim: ${claimParse.error}. ${claimParse.diagnostics.join("; ")}`,
    );
  }
  if (claimParse.kind === "legacy-v1") {
    // Accepted for compatibility window as declaration-only — never escalated.
  }
  const peerClaim = claimParse.claim as ConstitutionalClaim;

  const merkleProof = parsed.auditMerkleProof as MerkleProof | undefined;

  let result: HandshakeResult;
  try {
    result = handshake.verifyFromClaim(
      identity.agentId,
      peerClaim,
      merkleProof,
    );
  } catch (err) {
    return failResult(
      `Handshake verification error: ${(err as Error).message}`,
    );
  }

  if (strictModeOnHandshakeFailure && !result.success && params.sessionKey) {
    strictMode.enterStrict(
      params.sessionKey,
      `handshake failed for ${peerClaim.agentId}: ${result.errors.join(", ")}`,
      strictModeTtlMs,
    );
  }

  const trustLevelName =
    ["UNKNOWN", "LOW", "MEDIUM", "HIGH", "MAXIMUM"][result.trustLevel] ??
    "UNKNOWN";
  const summary = summarizeHandshakeVerification(result);

  if (result.success) {
    if (params.sessionKey) {
      groupContext.noteAgentJoined(params.sessionKey, peerClaim.agentId);
      groupContext.markVerified(
        params.sessionKey,
        peerClaim.agentId,
        result.trustLevel,
        { validUntil: Date.now() + 30 * 24 * 60 * 60 * 1000 },
      );
    }
    const verifiedParts: string[] = [];
    if (summary.identityVerified) verifiedParts.push("identity");
    if (summary.configurationClaimVerified) {
      verifiedParts.push("configuration");
    }
    if (summary.freshnessVerified) verifiedParts.push("freshness");
    const verifiedLabel =
      verifiedParts.length > 0
        ? verifiedParts.join("/")
        : "declaration-only";

    return textResult(
      `FPP handshake ${verifiedLabel} verified with ${peerClaim.agentId}.\n` +
        `Standing: ${summary.standing} (not behavioral compliance).\n` +
        `Evidence level: ${summary.evidenceLevel}\n` +
        `Trust Level: ${trustLevelName} (${result.trustLevel}/4)\n` +
        `Confidence: ${(result.confidence * 100).toFixed(1)}%\n` +
        `Evidence items: ${result.evidence.length}\n` +
        `Session: ${result.sessionId}` +
        (params.sessionKey
          ? `\nCluster ${params.sessionKey}: markVerified applied (scoped handshake standing)`
          : ""),
      {
        ok: true,
        peerAgentId: peerClaim.agentId,
        trustLevel: result.trustLevel,
        trustLevelName,
        confidence: result.confidence,
        evidence: result.evidence,
        identityVerified: summary.identityVerified,
        configurationClaimVerified: summary.configurationClaimVerified,
        freshnessVerified: summary.freshnessVerified,
        evidenceLevel: summary.evidenceLevel,
        standing: summary.standing,
        /** @deprecated Use standing / identityVerified fields. */
        fppVerified: summary.fppVerified,
        sessionId: result.sessionId,
        clusterMarkedVerified: Boolean(params.sessionKey),
      },
    );
  }

  return textResult(
    `FPP handshake FAILED for ${peerClaim.agentId}.\n` +
      `Standing: none (not behavioral compliance).\n` +
      `Errors: ${result.errors.join("; ")}\n` +
      `Confidence: ${(result.confidence * 100).toFixed(1)}%`,
    {
      ok: false,
      peerAgentId: peerClaim.agentId,
      trustLevel: result.trustLevel,
      confidence: result.confidence,
      errors: result.errors,
      identityVerified: summary.identityVerified,
      configurationClaimVerified: summary.configurationClaimVerified,
      freshnessVerified: summary.freshnessVerified,
      evidenceLevel: summary.evidenceLevel,
      standing: summary.standing,
      /** @deprecated Use standing / identityVerified fields. */
      fppVerified: false,
    },
  );
}

export function executeTrustStatus(
  params: Static<typeof TrustStatusParams>,
  deps: ToolDependencies,
) {
  const { identity, trustGraph } = deps;
  const targetId = params.targetAgentId;
  const node = trustGraph.getAgent(targetId);

  if (!node) {
    return textResult(
      `Agent ${targetId} is not in the trust graph. ` +
        `Use fpp_handshake_offer / fpp_handshake_verify to establish trust first.`,
      {
        known: false,
        standing: "none" as const,
        /** @deprecated Use standing. */
        fppVerified: false,
        targetAgentId: targetId,
        recommendation: "untrusted" as const,
      },
    );
  }

  const scopeReq: {
    capability: string;
    environment?: string;
    resource?: string;
  } = {
    capability: params.capability ?? "*",
  };
  if (params.environment !== undefined) scopeReq.environment = params.environment;
  if (params.resource !== undefined) scopeReq.resource = params.resource;
  const scoped = trustGraph.evaluateScopedTrust(
    identity.agentId,
    targetId,
    scopeReq,
    Date.now(),
    { allowConservativeDefault: true },
  );
  const scopeLabel = ScopedTrustStore.formatScope(scopeReq);

  const rel = trustGraph.getRelationship(identity.agentId, targetId);
  const trustLevel =
    scoped?.level ??
    (rel ? Math.max(rel.trustAB, rel.trustBA) : TrustLevel.UNKNOWN);
  // Deprecated: derived from relationship standing, not behavioral proof.
  const fppVerified = rel !== null && trustLevel >= TrustLevel.LOW;
  const standing: VerificationStanding = fppVerified
    ? "identity-configuration"
    : "none";
  const trustLevelName =
    ["UNKNOWN", "LOW", "MEDIUM", "HIGH", "MAXIMUM"][trustLevel] ?? "UNKNOWN";

  const views = trustGraph.getEvidenceViews(targetId);
  let recommendation: "trusted" | "caution" | "untrusted";
  if (trustLevel >= TrustLevel.HIGH && views.peer.summaryWeight >= 0.7) {
    recommendation = "trusted";
  } else if (trustLevel >= TrustLevel.LOW) {
    recommendation = "caution";
  } else {
    recommendation = "untrusted";
  }

  return textResult(
    `Agent ${targetId} — ${trustLevelName} trust (${trustLevel}/4)\n` +
      `Scope: ${scopeLabel}\n` +
      `Direction: ${identity.agentId} → ${targetId}\n` +
      `Assessment source: ${scoped?.source ?? "legacy-relationship"}\n` +
      `Standing: ${standing} (identity/configuration; not behavioral compliance)\n` +
      `Recommendation: ${recommendation.toUpperCase()}\n` +
      `Self view: ${(views.self.summaryWeight * 100).toFixed(0)}% (${views.self.evidenceCount} obs)\n` +
      `Peer view: ${(views.peer.summaryWeight * 100).toFixed(0)}% (${views.peer.evidenceCount} obs)\n` +
      `Propagated: ${(views.propagated.summaryWeight * 100).toFixed(0)}%\n` +
      `Divergence: ${views.divergence.explanation}\n` +
      `Legacy reputation (compat): ${(node.reputation.overall * 100).toFixed(0)}%\n` +
      `Interactions: ${node.interactionCount} (${node.reputation.positiveInteractions}+ / ${node.reputation.negativeInteractions}-)`,
    {
      known: true,
      standing,
      /** @deprecated Use standing. */
      fppVerified,
      targetAgentId: targetId,
      trustLevel,
      trustLevelName,
      recommendation,
      scope: scopeReq,
      scopeLabel,
      direction: `${identity.agentId}->${targetId}`,
      scopedAssessment: scoped,
      views,
      reputation: node.reputation,
      lastActivity: node.lastActivity,
      interactionCount: node.interactionCount,
      lastHandshakeAt: rel?.establishedAt ?? null,
      lastEvidenceAt: rel?.updatedAt ?? null,
    },
  );
}

export function executeAttestationExport(
  params: Static<typeof AttestationExportParams>,
  deps: ToolDependencies,
) {
  const { identity, merkleBridge } = deps;
  const { root, entryCount } = merkleBridge.getCurrentRoot();
  const recentHashes = merkleBridge.getRecentLeafHashes(5);

  let proof: MerkleProof | null = null;
  if (typeof params.includeProofForIndex === "number") {
    proof = merkleBridge.createProofForIndex(params.includeProofForIndex);
  }

  return textResult(
    `Agent ${identity.agentId} attestation:\n` +
      `Public Key: ${identity.publicKeyHex}\n` +
      `Merkle Root: ${root}\n` +
      `Audit Entries: ${entryCount}\n` +
      `Recent Hashes: ${recentHashes.length}\n` +
      (proof
        ? `Proof included for index ${proof.index} (${proof.path.length} steps)`
        : "No inclusion proof requested."),
    {
      agentId: identity.agentId,
      publicKey: identity.publicKeyHex,
      currentMerkleRoot: root,
      entryCount,
      recentLeafHashes: recentHashes,
      proof,
    },
  );
}

export function executeClusterStatus(
  params: Static<typeof ClusterStatusParams>,
  deps: ToolDependencies,
) {
  const { groupContext } = deps;
  const state = groupContext.getClusterTrustState(params.clusterId);

  if (!state) {
    return textResult(
      `No cluster found with id "${params.clusterId}".`,
      { known: false, clusterId: params.clusterId },
    );
  }

  const trustLevelName =
    ["UNKNOWN", "LOW", "MEDIUM", "HIGH", "MAXIMUM"][state.lowestTrustLevel] ??
    "UNKNOWN";

  return textResult(
    `Cluster ${state.clusterId}: ` +
      `${state.verifiedMembers}/${state.totalMembers} verified, ` +
      `lowest trust ${trustLevelName}\n` +
      (state.unverifiedAgents.length > 0
        ? `Unverified: ${state.unverifiedAgents.join(", ")}`
        : "All members verified."),
    {
      known: true,
      ...state,
      lowestTrustLevelName: trustLevelName,
    },
  );
}

export function executeSensitivityShareCheck(
  params: Static<typeof SensitivityShareParams>,
  deps: ToolDependencies,
) {
  const result = deps.groupContext.checkSensitivityShare(
    params.clusterId,
    params.sensitivity,
  );
  return textResult(
    `Sensitivity share check (ADVISORY): ${result.allowed ? "ALLOW" : "DENY"}\n` +
      `Cluster: ${result.clusterId} sensitivity=${result.sensitivity}\n` +
      `Reason: ${result.reason}\n` +
      `Enforcement: ${result.enforcement} — host must enforce unless interception hook exists.`,
    result,
  );
}

export const ReceiptVerifyParams = Type.Object({
  receiptJson: Type.String({ description: "JSON string of a ConformanceReceiptV1" }),
  expectedPolicyVersion: Type.Optional(Type.String()),
  expectedClassifierRulesetHash: Type.Optional(Type.String()),
});

export const ReceiptProofExportParams = Type.Object({
  index: Type.Integer({ minimum: 0 }),
  discloseRawLog: Type.Optional(
    Type.Boolean({
      description: "Opt-in: include raw ledger line (default false — privacy-preserving)",
      default: false,
    }),
  ),
});

export const CapsuleOfferParams = Type.Object({
  audience: Type.String({ minLength: 1 }),
  challenge: Type.String({ minLength: 1 }),
  ttlMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 600000 })),
  view: Type.Optional(
    Type.Union([Type.Literal("self"), Type.Literal("peer-summary")]),
  ),
});

export function executeReceiptVerify(
  params: Static<typeof ReceiptVerifyParams>,
  _deps: ToolDependencies,
) {
  let receipt: unknown;
  try {
    receipt = JSON.parse(params.receiptJson);
  } catch {
    return failResult("receiptJson is not valid JSON");
  }
  const report = verifyReceiptEvidence({
    receipt,
    expectedPolicyVersion: params.expectedPolicyVersion,
    expectedClassifierRulesetHash: params.expectedClassifierRulesetHash,
  });
  return textResult(
    report.valid
      ? `Receipt verified (${report.evidenceClass}). Ceiling=${report.confidenceCeiling}. Does NOT prove behavioral compliance or completeness.`
      : `Receipt verification failed: ${report.reasons.join("; ")}`,
    {
      ...report,
      rawLogDisclosed: false,
    },
  );
}

export function executeReceiptProofExport(
  params: Static<typeof ReceiptProofExportParams>,
  deps: ToolDependencies,
) {
  const logPath = deps.receiptLogPath;
  if (!logPath) {
    return failResult("receiptLogPath not configured on trust plugin");
  }
  const root = getReceiptRoot(logPath);
  const proof = createTypedReceiptProof(logPath, params.index);
  if (!proof) {
    return failResult(
      `No receipt at index ${params.index} (log has ${root.entryCount} entries)`,
    );
  }
  return textResult(
    `Receipt inclusion proof for index ${params.index} (logKind=${RECEIPT_LOG_KIND}). ` +
      `Proves inclusion under claimed root only — not completeness.`,
    {
      logKind: RECEIPT_LOG_KIND,
      root: root.root,
      entryCount: root.entryCount,
      proof,
      rawLogDisclosed: false,
      discloseRawLogRequested: params.discloseRawLog === true,
      note:
        params.discloseRawLog === true
          ? "Raw log disclosure requested but withheld by default privacy policy"
          : "Raw private logs not exposed",
    },
  );
}

export function executeCapsuleOffer(
  params: Static<typeof CapsuleOfferParams>,
  deps: ToolDependencies,
) {
  if (isLegacyClaimMasquerading(params)) {
    return failResult("legacy claim shape cannot masquerade as a capsule");
  }
  const { identity, merkleBridge } = deps;
  const { root, logKind } = merkleBridge.getCurrentRoot();
  const receiptRoot = deps.receiptLogPath
    ? getReceiptRoot(deps.receiptLogPath).root
    : undefined;
  const now = Date.now();
  const ttl = params.ttlMs ?? 300_000;
  const capsule = buildTrustStateCapsule({
    identity,
    runtimeId: "openclaw-fpp-trust",
    implementationVersion: "1.2.2",
    evidenceRoot: root,
    receiptRoot,
    coverageMetrics: {
      metricVersion: 1,
      finalizedReceipts: deps.receiptLogPath
        ? getReceiptRoot(deps.receiptLogPath).entryCount
        : 0,
      completeness: "unknown",
    },
    freshness: {
      audience: params.audience,
      challenge: params.challenge,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttl).toISOString(),
    },
    view: params.view ?? "peer-summary",
  });
  const validation = validateTrustStateCapsule(capsule, {
    maxLifetimeMs: ttl + 60_000,
    allowedClockSkewMs: 60_000,
    nowMs: now,
  });
  return textResult(
    `TrustStateCapsuleV2 offered (view=${capsule.view}, evidenceLogKind=${logKind}). ` +
      `Freshness+signature valid=${validation.valid}. Not a completeness claim.`,
    {
      capsule,
      validation,
      evidenceLogKind: logKind,
    },
  );
}

// ── Quorum mandate tools (Plan 9) ──────────────────────────────────
// Quorum issues StandingMandateV1 — it does not call allow directly,
// and it is not constitutional ratification.

export type QuorumToolDependencies = {
  identity: AgentIdentity;
  quorum: QuorumSessionManager;
  /** Optional override clock for tests. */
  nowMs?: (() => number) | undefined;
  mandateStorePath?: string | undefined;
};

export const MandateProposeParams = Type.Object({
  proposalId: Type.String({ minLength: 1 }),
  quorumClass: Type.Union([
    Type.Literal("peer-quorum"),
    Type.Literal("steward-quorum"),
  ]),
  classifications: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  capabilities: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  maxActions: Type.Integer({ minimum: 1 }),
  mandateValidFrom: Type.Optional(Type.String({ minLength: 1 })),
  mandateValidTo: Type.String({ minLength: 1 }),
  expiresAt: Type.Optional(Type.String({ minLength: 1 })),
});

export const MandateSecondParams = Type.Object({
  /** Signed ballot JSON from a peer (preferred cross-agent path). */
  ballotJson: Type.Optional(Type.String({ minLength: 1 })),
  /** Local cast path when this agent seconds directly. */
  proposalId: Type.Optional(Type.String({ minLength: 1 })),
  vote: Type.Optional(
    Type.Union([
      Type.Literal("aye"),
      Type.Literal("nay"),
      Type.Literal("abstain"),
    ]),
  ),
  ballotId: Type.Optional(Type.String({ minLength: 1 })),
});

export const MandateFinalizeParams = Type.Object({
  proposalId: Type.String({ minLength: 1 }),
});

export function executeMandatePropose(
  params: Static<typeof MandateProposeParams>,
  deps: QuorumToolDependencies,
) {
  const now = deps.nowMs?.() ?? Date.now();
  const scope = {
    classifications: params.classifications,
    ...(params.capabilities !== undefined
      ? { capabilities: params.capabilities }
      : {}),
  };
  const budgets = {
    maxActions: params.maxActions,
    remainingActions: params.maxActions,
  };
  const mandateValidFrom =
    params.mandateValidFrom ?? new Date(now).toISOString();
  const mandateDigest = computeIntendedMandateDigest({
    scope,
    budgets,
    mandateValidFrom,
    mandateValidTo: params.mandateValidTo,
  });
  const expiresAt =
    params.expiresAt ?? new Date(now + 3_600_000).toISOString();
  const proposal = signQuorumProposal(
    {
      schemaVersion: 1,
      proposalId: params.proposalId,
      quorumClass: params.quorumClass,
      proposerId: deps.identity.agentId,
      mandateDigest,
      scope,
      budgets,
      mandateValidFrom,
      mandateValidTo: params.mandateValidTo,
      proposedAt: new Date(now).toISOString(),
      expiresAt,
    },
    deps.identity,
  );
  const result = deps.quorum.propose(proposal);
  if (!result.ok) {
    return textResult(`Mandate propose failed: ${result.error}`, {
      ok: false,
      error: result.error,
    });
  }
  return textResult(
    `Quorum proposal ${params.proposalId} opened (${params.quorumClass}). ` +
      `Peers may call fpp_mandate_second; finalize with fpp_mandate_finalize. ` +
      `Not constitutional ratification.`,
    {
      ok: true,
      proposalId: params.proposalId,
      quorumClass: params.quorumClass,
      mandateDigest,
      proposalJson: JSON.stringify(proposal),
    },
  );
}

export function executeMandateSecond(
  params: Static<typeof MandateSecondParams>,
  deps: QuorumToolDependencies,
) {
  let ballot: QuorumBallotV1;
  if (params.ballotJson) {
    try {
      ballot = JSON.parse(params.ballotJson) as QuorumBallotV1;
    } catch {
      return textResult("ballotJson is not valid JSON", {
        ok: false,
        error: "ballotJson is not valid JSON",
      });
    }
  } else {
    if (!params.proposalId || !params.vote || !params.ballotId) {
      return textResult(
        "second requires ballotJson or proposalId+vote+ballotId",
        {
          ok: false,
          error: "second requires ballotJson or proposalId+vote+ballotId",
        },
      );
    }
    const session = deps.quorum.getSession(params.proposalId);
    if (!session) {
      return textResult(`unknown proposal ${params.proposalId}`, {
        ok: false,
        error: `unknown proposal ${params.proposalId}`,
      });
    }
    const now = deps.nowMs?.() ?? Date.now();
    ballot = signQuorumBallot(
      {
        schemaVersion: 1,
        ballotId: params.ballotId,
        proposalId: params.proposalId,
        voterId: deps.identity.agentId,
        vote: params.vote,
        mandateDigest: session.proposal.mandateDigest,
        castAt: new Date(now).toISOString(),
      },
      deps.identity,
    );
  }

  const result = deps.quorum.second(ballot);
  if (!result.ok) {
    return textResult(`Mandate second failed: ${result.error}`, {
      ok: false,
      error: result.error,
      ballotJson: JSON.stringify(ballot),
    });
  }
  return textResult(
    `Ballot recorded on ${ballot.proposalId} (ayeCount=${result.ayeCount}).`,
    {
      ok: true,
      proposalId: ballot.proposalId,
      ayeCount: result.ayeCount,
      ballotJson: JSON.stringify(ballot),
    },
  );
}

export function executeMandateFinalize(
  params: Static<typeof MandateFinalizeParams>,
  deps: QuorumToolDependencies,
) {
  const result = deps.quorum.finalize(params.proposalId, deps.identity);
  if (!result.ok) {
    return textResult(`Mandate finalize failed: ${result.error}`, {
      ok: false,
      error: result.error,
    });
  }
  return textResult(
    `Quorum mandate issued: ${result.mandate.mandateId} ` +
      `(${result.mandate.issuerClass}` +
      `${result.idempotent ? ", idempotent" : ""}). ` +
      `Disposition engine may consume as authorization=quorum-mandate.`,
    {
      ok: true,
      idempotent: result.idempotent,
      mandateId: result.mandate.mandateId,
      issuerClass: result.mandate.issuerClass,
      evidenceDigest: result.evidenceDigest,
      mandate: result.mandate,
    },
  );
}

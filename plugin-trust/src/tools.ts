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
} from "@ovrsr/fpp-protocol-core";
import type { AgentIdentity } from "./identity.js";
import { signClaim } from "./claims.js";
import type { ConstitutionalClaim, HandshakeResult } from "./handshake.js";
import { ConstitutionalHandshake } from "./handshake.js";
import { TrustGraphProtocol, TrustLevel } from "./trust-graph.js";
import type { MerkleBridge, MerkleProof } from "./merkle-bridge.js";
import type { StrictModeManager } from "./strict-mode.js";
import type { GroupContextManager } from "./group-context.js";

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
        `Session: ${result.sessionId}`,
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

  const rel = trustGraph.getRelationship(identity.agentId, targetId);
  const trustLevel = rel
    ? Math.max(rel.trustAB, rel.trustBA)
    : TrustLevel.UNKNOWN;
  // Deprecated: derived from relationship standing, not behavioral proof.
  const fppVerified = rel !== null && trustLevel >= TrustLevel.LOW;
  const standing: VerificationStanding = fppVerified
    ? "identity-configuration"
    : "none";
  const trustLevelName =
    ["UNKNOWN", "LOW", "MEDIUM", "HIGH", "MAXIMUM"][trustLevel] ?? "UNKNOWN";

  let recommendation: "trusted" | "caution" | "untrusted";
  if (trustLevel >= TrustLevel.HIGH && node.reputation.overall >= 0.7) {
    recommendation = "trusted";
  } else if (trustLevel >= TrustLevel.LOW) {
    recommendation = "caution";
  } else {
    recommendation = "untrusted";
  }

  return textResult(
    `Agent ${targetId} — ${trustLevelName} trust (${trustLevel}/4)\n` +
      `Standing: ${standing} (identity/configuration; not behavioral compliance)\n` +
      `Recommendation: ${recommendation.toUpperCase()}\n` +
      `Overall Reputation: ${(node.reputation.overall * 100).toFixed(0)}%\n` +
      `Constitutional Fidelity: ${(node.reputation.constitutionalFidelity * 100).toFixed(0)}%\n` +
      `Intervention Rate: ${(node.reputation.interventionRate * 100).toFixed(0)}%\n` +
      `Resource Stewardship: ${(node.reputation.resourceStewardship * 100).toFixed(0)}%\n` +
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

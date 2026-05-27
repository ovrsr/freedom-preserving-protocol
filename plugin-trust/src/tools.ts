/**
 * LLM-facing tools for the FPP trust plugin.
 *
 * Four tools that transition trust from a passive library into an active
 * verification protocol — the agent sees these in its tool list and can
 * handshake, verify, query, and export attestations in a single call.
 */

import { Type, type TSchema } from "@sinclair/typebox";
import type { AgentIdentity } from "./identity.js";
import { signClaim } from "./claims.js";
import type { ConstitutionalClaim, HandshakeResult } from "./handshake.js";
import { ConstitutionalHandshake } from "./handshake.js";
import { TrustGraphProtocol, TrustLevel } from "./trust-graph.js";
import type { MerkleBridge, MerkleProof } from "./merkle-bridge.js";
import type { StrictModeManager } from "./strict-mode.js";

interface ToolResult<T> {
  content: { type: "text"; text: string }[];
  details: T;
}

function textResult<T>(text: string, details: T): ToolResult<T> {
  return {
    content: [{ type: "text", text }],
    details,
  };
}

function failResult(text: string): ToolResult<{ status: "failed" }> {
  return textResult(text, { status: "failed" as const });
}

export interface ToolDependencies {
  identity: AgentIdentity;
  trustGraph: TrustGraphProtocol;
  handshake: ConstitutionalHandshake;
  merkleBridge: MerkleBridge;
  strictMode: StrictModeManager;
  constitutionHash: string;
  strictModeOnHandshakeFailure: boolean;
  strictModeTtlMs: number;
}

interface ToolDef {
  name: string;
  label: string;
  description: string;
  parameters: TSchema;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
  ) => Promise<ToolResult<unknown>>;
}

export function createFppTools(deps: ToolDependencies): ToolDef[] {
  const {
    identity,
    trustGraph,
    handshake,
    merkleBridge,
    strictMode,
    constitutionHash,
    strictModeOnHandshakeFailure,
    strictModeTtlMs,
  } = deps;

  const fppHandshakeOffer: ToolDef = {
    name: "fpp_handshake_offer",
    label: "FPP Handshake Offer",
    description:
      "Generate this agent's signed constitutional claim for a trust handshake. " +
      "Share the returned JSON with the target agent so they can call fpp_handshake_verify.",
    parameters: Type.Object({
      targetAgentId: Type.Optional(
        Type.String({
          description:
            "Optional identifier of the agent you intend to handshake with.",
        }),
      ),
    }),
    execute: async (_toolCallId, params) => {
      const { root, entryCount } = merkleBridge.getCurrentRoot();
      const recentHashes = merkleBridge.getRecentLeafHashes(5);

      const claim: ConstitutionalClaim = {
        agentId: identity.agentId,
        constitutionHash,
        adoptedAt: new Date().toISOString(),
        auditMerkleRoot: root,
        auditEntryCount: entryCount,
        chainIntact: entryCount > 0,
        recentLaws: [],
      };

      const signed = signClaim(claim, identity);
      const copyableJson = JSON.stringify(signed, null, 2);

      const target =
        typeof params.targetAgentId === "string"
          ? params.targetAgentId
          : "any agent";

      return textResult(
        `FPP handshake offer generated for ${target}. ` +
          `Share the claim JSON below with the peer agent so they can verify it ` +
          `using fpp_handshake_verify.\n\n` +
          `Agent ID: ${identity.agentId}\n` +
          `Public Key: ${identity.publicKeyHex}\n` +
          `Merkle Root: ${root}\n` +
          `Audit Entries: ${entryCount}\n\n` +
          "```json\n" +
          copyableJson +
          "\n```",
        {
          status: "ok",
          claim: signed,
          recentAuditHashes: recentHashes,
          copyableJson,
        },
      );
    },
  };

  const fppHandshakeVerify: ToolDef = {
    name: "fpp_handshake_verify",
    label: "FPP Handshake Verify",
    description:
      "Verify a peer agent's constitutional claim and establish mutual trust. " +
      "Pass the claim JSON received from the peer's fpp_handshake_offer.",
    parameters: Type.Object({
      peerClaim: Type.String({
        description:
          "The JSON string of the peer's signed constitutional claim.",
      }),
      requireMerkleProof: Type.Optional(
        Type.Boolean({
          description:
            "If true, verification fails when the peer has not provided a Merkle proof.",
        }),
      ),
    }),
    execute: async (_toolCallId, params) => {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(params.peerClaim as string) as Record<
          string,
          unknown
        >;
      } catch {
        return failResult(
          "Failed to parse peerClaim JSON. Ensure it is valid JSON from fpp_handshake_offer.",
        );
      }

      const peerClaim = parsed as unknown as ConstitutionalClaim;
      if (!peerClaim.agentId || !peerClaim.constitutionHash) {
        return failResult(
          "Invalid claim: missing agentId or constitutionHash.",
        );
      }

      const merkleProof = (parsed as Record<string, unknown>)
        .auditMerkleProof as MerkleProof | undefined;

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

      if (
        strictModeOnHandshakeFailure &&
        !result.success &&
        params.sessionKey
      ) {
        strictMode.enterStrict(
          params.sessionKey as string,
          `handshake failed for ${peerClaim.agentId}: ${result.errors.join(", ")}`,
          strictModeTtlMs,
        );
      }

      const trustLevelName =
        ["UNKNOWN", "LOW", "MEDIUM", "HIGH", "MAXIMUM"][result.trustLevel] ??
        "UNKNOWN";

      if (result.success) {
        return textResult(
          `FPP handshake VERIFIED with ${peerClaim.agentId}.\n` +
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
            fppVerified: true,
            sessionId: result.sessionId,
          },
        );
      }

      return textResult(
        `FPP handshake FAILED for ${peerClaim.agentId}.\n` +
          `Errors: ${result.errors.join("; ")}\n` +
          `Confidence: ${(result.confidence * 100).toFixed(1)}%`,
        {
          ok: false,
          peerAgentId: peerClaim.agentId,
          trustLevel: result.trustLevel,
          confidence: result.confidence,
          errors: result.errors,
          fppVerified: false,
        },
      );
    },
  };

  const fppTrustStatus: ToolDef = {
    name: "fpp_trust_status",
    label: "FPP Trust Status",
    description:
      "Check the trust status and reputation of a known agent. " +
      "Returns trust level, reputation dimensions, and verification state.",
    parameters: Type.Object({
      targetAgentId: Type.String({
        description: "The agent ID to look up in the trust graph.",
      }),
    }),
    execute: async (_toolCallId, params) => {
      const targetId = params.targetAgentId as string;
      const node = trustGraph.getAgent(targetId);

      if (!node) {
        return textResult(
          `Agent ${targetId} is not in the trust graph. ` +
            `Use fpp_handshake_offer / fpp_handshake_verify to establish trust first.`,
          {
            known: false,
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
      const fppVerified = rel !== null && trustLevel >= TrustLevel.LOW;
      const trustLevelName =
        ["UNKNOWN", "LOW", "MEDIUM", "HIGH", "MAXIMUM"][trustLevel] ??
        "UNKNOWN";

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
          `FPP Verified: ${fppVerified ? "YES" : "NO"}\n` +
          `Recommendation: ${recommendation.toUpperCase()}\n` +
          `Overall Reputation: ${(node.reputation.overall * 100).toFixed(0)}%\n` +
          `Constitutional Fidelity: ${(node.reputation.constitutionalFidelity * 100).toFixed(0)}%\n` +
          `Intervention Rate: ${(node.reputation.interventionRate * 100).toFixed(0)}%\n` +
          `Resource Stewardship: ${(node.reputation.resourceStewardship * 100).toFixed(0)}%\n` +
          `Interactions: ${node.interactionCount} (${node.reputation.positiveInteractions}+ / ${node.reputation.negativeInteractions}-)`,
        {
          known: true,
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
    },
  };

  const fppAttestationExport: ToolDef = {
    name: "fpp_attestation_export",
    label: "FPP Attestation Export",
    description:
      "Export this agent's current attestation data: Merkle root, entry count, " +
      "public key, and optionally a Merkle inclusion proof for a specific audit entry.",
    parameters: Type.Object({
      includeProofForIndex: Type.Optional(
        Type.Integer({
          description:
            "Zero-based index of the audit entry to generate a Merkle inclusion proof for.",
        }),
      ),
    }),
    execute: async (_toolCallId, params) => {
      const { root, entryCount } = merkleBridge.getCurrentRoot();
      const recentHashes = merkleBridge.getRecentLeafHashes(5);

      let proof: MerkleProof | null = null;
      if (typeof params.includeProofForIndex === "number") {
        proof = merkleBridge.createProofForIndex(
          params.includeProofForIndex as number,
        );
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
    },
  };

  return [
    fppHandshakeOffer,
    fppHandshakeVerify,
    fppTrustStatus,
    fppAttestationExport,
  ];
}

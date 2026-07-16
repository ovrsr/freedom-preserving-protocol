/**
 * index.ts — OpenClaw adapter over @ovrsr/fpp-trust-core.
 *
 * Uses defineToolPlugin so the SDK automatically wires tool discovery,
 * tool-search metadata, and registrationMode gating. Trust logic lives in
 * @ovrsr/fpp-trust-core; this file translates OpenClaw hooks/tools/CLI.
 */

import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";

import {
  createTrustStack,
  saveTrustGraph,
  saveTrustGraphSync,
} from "@ovrsr/fpp-trust-core";
import {
  workspaceFile,
  absolutizeWorkspacePath,
} from "@ovrsr/fpp-protocol-core";
import { registerFppTrustCli, FPP_TRUST_CLI_DESCRIPTORS } from "./cli.js";
import type { ToolDependencies } from "./tools.js";
import {
  HandshakeChallengeParams,
  HandshakeOfferParams,
  HandshakeVerifyParams,
  TrustStatusParams,
  AttestationExportParams,
  ClusterStatusParams,
  SensitivityShareParams,
  executeHandshakeChallenge,
  executeHandshakeOffer,
  executeHandshakeVerify,
  executeTrustStatus,
  executeAttestationExport,
  executeClusterStatus,
  executeSensitivityShareCheck,
  ReceiptVerifyParams,
  ReceiptProofExportParams,
  CapsuleOfferParams,
  executeReceiptVerify,
  executeReceiptProofExport,
  executeCapsuleOffer,
  MandateProposeParams,
  MandateSecondParams,
  MandateFinalizeParams,
  executeMandatePropose,
  executeMandateSecond,
  executeMandateFinalize,
} from "./tools.js";

// ── Re-exports (library API via trust-core) ────────────────────────

export {
  resolveVerificationPolicy,
  type VerificationPolicy,
  TrustGraphProtocol,
  TrustLevel,
  type TrustNode,
  type TrustRelationship,
  type TrustEvidence,
  type TrustPropagation,
  type TrustGraphStats,
  type ReputationMetrics,
  ConstitutionalHandshake,
  HandshakeState,
  type ConstitutionalClaim,
  type HandshakeSession,
  type HandshakeResult,
  type HandshakeEvidence,
  loadOrCreateIdentity,
  verifySignature,
  type AgentIdentity,
  signClaim,
  verifyClaim,
  canonicalize,
  type SignedClaim,
  type ClaimVerification,
  ReplayCache,
  MerkleBridge,
  computeMerkleRoot,
  createMerkleProof,
  verifyMerkleProof,
  type MerkleProof,
  type MerkleProofStep,
  StrictModeManager,
  CONSERVATIVE_STRICT_APPROVAL_ON,
  STRICT_MODE_SCHEMA_VERSION,
  type StrictSessionEntry,
  type StrictModeState,
  type StrictModeDiagnostic,
  type StrictModeDiagnosticCode,
  GroupContextManager,
  type ClusterMember,
  type TrustCluster,
  type ClusterTrustState,
  TrustEventLedger,
  appendTrustEvent,
  verifyTrustEvent,
  computeEventRoot,
  buildSnapshotFromEvents,
  verifySnapshot,
  LEGACY_CONFIDENCE_CEILING,
  type TrustEventKind,
  type SignedTrustEvent,
  type TrustSnapshotV2,
  type LegacyObservation,
  migrateV1ToV2,
  TrustViewStore,
  computeViewDivergence,
  PROPAGATED_WEIGHT_CEILING,
  SELF_WEIGHT_CEILING,
  type EvidenceViewSummary,
  type ViewDivergence,
  type EvidenceChannel,
  createTrustStack,
  mergeTrustConfig,
  type TrustStack,
  type FppTrustConfig,
  type TrustConfigDiagnostic,
} from "@ovrsr/fpp-trust-core";

const DEBOUNCE_MS = 500;

// ── Shared state (initialised once per process on first tool factory call) ──

let _stack: ReturnType<typeof createTrustStack> | null = null;
let _deps: ToolDependencies | null = null;

function initStack(api: OpenClawPluginApi): {
  stack: ReturnType<typeof createTrustStack>;
  deps: ToolDependencies;
} {
  if (_stack && _deps) return { stack: _stack, deps: _deps };

  const stack = createTrustStack(api.pluginConfig);
  const { trustGraph, handshake, identity, merkleBridge, strictMode, groupContext, config } =
    stack;

  // -- persistence (debounced) --
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;

  function scheduleSave(): void {
    dirty = true;
    if (debounceTimer !== null) return;
    debounceTimer = setTimeout(async () => {
      debounceTimer = null;
      if (!dirty) return;
      dirty = false;
      try {
        await saveTrustGraph(config.trustGraphPath, trustGraph, undefined, {
          identity,
        });
      } catch (err) {
        dirty = true;
        console.error("[fpp-trust] failed to persist trust graph:", err);
      }
    }, DEBOUNCE_MS);
  }

  function flushSync(): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (!dirty) return;
    dirty = false;
    saveTrustGraphSync(config.trustGraphPath, trustGraph, undefined, {
      identity,
    });
  }

  trustGraph.setOnChange(scheduleSave);
  process.on("beforeExit", flushSync);
  process.once("SIGTERM", flushSync);
  process.once("SIGINT", flushSync);

  const adoptionStatePath = absolutizeWorkspacePath(
    workspaceFile("fpp-adoption-state.jsonl"),
  );
  const soulPath = process.env.FPP_SOUL;

  // -- hooks --
  api.on("before_tool_call", async (_event, ctx) => {
    handshake.cleanupExpired();

    // Group-context tracking: note agents appearing in multi-agent sessions
    if (ctx.agentId && ctx.sessionKey) {
      groupContext.noteAgentJoined(ctx.sessionKey, ctx.agentId);
    }

    return undefined;
  }, { priority: 90 });

  // -- CLI --
  api.registerCli(
    (cliCtx) => {
      registerFppTrustCli(cliCtx.program as Parameters<typeof registerFppTrustCli>[0], {
        identity,
        trustGraph,
        merkleBridge,
        strictMode,
        constitutionHash: config.constitutionHash,
        handshake,
        replayCache: stack.replayCache,
        requireFreshness: config.requireFreshness,
        quorum: stack.quorum,
        adoptionStatePath,
        ...(soulPath ? { soulPath } : {}),
      });
    },
    { descriptors: FPP_TRUST_CLI_DESCRIPTORS },
  );

  // -- tool metadata (displaySummary for agent catalog) --
  api.registerToolMetadata({
    toolName: "fpp_handshake_challenge",
    displayName: "FPP Handshake Challenge",
    description:
      "Issue a one-time freshness challenge for a peer to bind into their signed claim.",
    risk: "low",
    tags: ["fpp", "trust", "handshake"],
  });
  api.registerToolMetadata({
    toolName: "fpp_handshake_offer",
    displayName: "FPP Handshake Offer",
    description: "Generate a signed constitutional claim to initiate a trust handshake with another agent.",
    risk: "low",
    tags: ["fpp", "trust", "handshake"],
  });
  api.registerToolMetadata({
    toolName: "fpp_handshake_verify",
    displayName: "FPP Handshake Verify",
    description: "Verify a peer agent's signed constitutional claim and establish mutual trust.",
    risk: "low",
    tags: ["fpp", "trust", "handshake"],
  });
  api.registerToolMetadata({
    toolName: "fpp_trust_status",
    displayName: "FPP Trust Status",
    description: "Query the trust level, reputation, and verification state of a known agent.",
    risk: "low",
    tags: ["fpp", "trust"],
  });
  api.registerToolMetadata({
    toolName: "fpp_attestation_export",
    displayName: "FPP Attestation Export",
    description: "Export this agent's Merkle root, public key, and optional inclusion proof.",
    risk: "low",
    tags: ["fpp", "trust", "attestation"],
  });
  api.registerToolMetadata({
    toolName: "fpp_cluster_status",
    displayName: "FPP Cluster Status",
    description: "Check verification state of a trust cluster (multi-agent group).",
    risk: "low",
    tags: ["fpp", "trust", "cluster"],
  });
  api.registerToolMetadata({
    toolName: "fpp_sensitivity_share_check",
    displayName: "FPP Sensitivity Share Check",
    description:
      "Advisory check whether content at a declared sensitivity may be shared with a cluster. Host must enforce.",
    risk: "low",
    tags: ["fpp", "trust", "cluster", "advisory"],
  });
  api.registerToolMetadata({
    toolName: "fpp_receipt_verify",
    displayName: "FPP Receipt Verify",
    description:
      "Verify a conformance receipt signature/schema/policy binding. Does not prove behavioral compliance or completeness.",
    risk: "low",
    tags: ["fpp", "trust", "receipt"],
  });
  api.registerToolMetadata({
    toolName: "fpp_receipt_proof",
    displayName: "FPP Receipt Proof Export",
    description:
      "Export a selective Merkle inclusion proof from the typed receipt ledger (privacy-preserving defaults).",
    risk: "low",
    tags: ["fpp", "trust", "receipt"],
  });
  api.registerToolMetadata({
    toolName: "fpp_capsule_offer",
    displayName: "FPP Trust Capsule Offer",
    description:
      "Build a fresh signed TrustStateCapsuleV2 bound to a peer challenge (not a legacy claim).",
    risk: "low",
    tags: ["fpp", "trust", "capsule"],
  });
  api.registerToolMetadata({
    toolName: "fpp_mandate_propose",
    displayName: "FPP Mandate Propose",
    description:
      "Open a peer/steward quorum proposal that can issue a StandingMandateV1 (not ratification).",
    risk: "medium",
    tags: ["fpp", "trust", "quorum", "mandate"],
  });
  api.registerToolMetadata({
    toolName: "fpp_mandate_second",
    displayName: "FPP Mandate Second",
    description:
      "Cast or accept a signed quorum ballot on an open mandate proposal.",
    risk: "medium",
    tags: ["fpp", "trust", "quorum", "mandate"],
  });
  api.registerToolMetadata({
    toolName: "fpp_mandate_finalize",
    displayName: "FPP Mandate Finalize",
    description:
      "Finalize a quorum proposal into a signed StandingMandateV1 when threshold is met.",
    risk: "medium",
    tags: ["fpp", "trust", "quorum", "mandate"],
  });

  const deps: ToolDependencies = {
    identity,
    trustGraph,
    handshake,
    merkleBridge,
    strictMode,
    groupContext,
    constitutionHash: config.constitutionHash,
    strictModeOnHandshakeFailure: config.strictModeOnHandshakeFailure,
    strictModeTtlMs: config.strictModeTtlMs,
    receiptLogPath: config.receiptLogPath,
    adoptionStatePath,
    ...(soulPath ? { soulPath } : {}),
  };

  _stack = stack;
  _deps = deps;
  return { stack, deps };
}

// ── Plugin entry ───────────────────────────────────────────────────

export default defineToolPlugin({
  id: "openclaw-fpp-trust",
  name: "Freedom Preserving Protocol — Trust & Handshake",
  description:
    "Agent-to-agent trust graph, constitutional handshake, signed claims, " +
    "Merkle audit bridging, and strict-mode signaling for multi-agent FPP verification.",
  activation: { onStartup: true },

  tools: (tool) => [
    tool({
      name: "fpp_handshake_challenge",
      label: "FPP Handshake Challenge",
      description:
        "Issue a one-time freshness challenge. Share the JSON with the peer so they " +
        "can answer via fpp_handshake_offer (peerChallenge). Verify once with fpp_handshake_verify.",
      parameters: HandshakeChallengeParams,
      execute(params, _config, ctx) {
        const { deps } = initStack(ctx.api);
        return executeHandshakeChallenge(params, deps);
      },
    }),

    tool({
      name: "fpp_handshake_offer",
      label: "FPP Handshake Offer",
      description:
        "Generate this agent's signed constitutional claim for a trust handshake. " +
        "Optionally bind a peerChallenge from fpp_handshake_challenge. " +
        "Share the returned JSON with the target agent so they can call fpp_handshake_verify.",
      parameters: HandshakeOfferParams,
      execute(params, _config, ctx) {
        const { deps } = initStack(ctx.api);
        return executeHandshakeOffer(params, deps);
      },
    }),

    tool({
      name: "fpp_handshake_verify",
      label: "FPP Handshake Verify",
      description:
        "Verify a peer agent's constitutional claim and establish mutual trust. " +
        "Pass the JSON string received from the peer's fpp_handshake_offer output. " +
        "On success the peer is added to the trust graph; on failure strict mode may activate.",
      parameters: HandshakeVerifyParams,
      execute(params, _config, ctx) {
        const { deps } = initStack(ctx.api);
        return executeHandshakeVerify(params, deps);
      },
    }),

    tool({
      name: "fpp_trust_status",
      label: "FPP Trust Status",
      description:
        "Check the trust status and reputation of a known agent. " +
        "Returns trust level, constitutional fidelity, intervention rate, " +
        "resource stewardship, and a trusted/caution/untrusted recommendation. " +
        "Use this before sharing sensitive context with another agent.",
      parameters: TrustStatusParams,
      execute(params, _config, ctx) {
        const { deps } = initStack(ctx.api);
        return executeTrustStatus(params, deps);
      },
    }),

    tool({
      name: "fpp_attestation_export",
      label: "FPP Attestation Export",
      description:
        "Export this agent's current attestation data: Merkle root, entry count, " +
        "public key, and optionally a Merkle inclusion proof for a specific audit entry. " +
        "Use this to provide cryptographic evidence of your audit trail to a verifier.",
      parameters: AttestationExportParams,
      execute(params, _config, ctx) {
        const { deps } = initStack(ctx.api);
        return executeAttestationExport(params, deps);
      },
    }),

    tool({
      name: "fpp_cluster_status",
      label: "FPP Cluster Status",
      description:
        "Check the verification state of a trust cluster (multi-agent group/chat). " +
        "Returns how many members are verified, the lowest trust level, and which " +
        "agents still need handshakes. Use to decide if sensitive data can be shared " +
        "in a group context.",
      parameters: ClusterStatusParams,
      execute(params, _config, ctx) {
        const { deps } = initStack(ctx.api);
        return executeClusterStatus(params, deps);
      },
    }),

    tool({
      name: "fpp_sensitivity_share_check",
      label: "FPP Sensitivity Share Check",
      description:
        "ADVISORY: check whether content at a declared sensitivity (0-3) may be shared " +
        "with a cluster under current scoped standing. Does not enforce; host interception required.",
      parameters: SensitivityShareParams,
      execute(params, _config, ctx) {
        const { deps } = initStack(ctx.api);
        return executeSensitivityShareCheck(params, deps);
      },
    }),

    tool({
      name: "fpp_receipt_verify",
      label: "FPP Receipt Verify",
      description:
        "Verify a conformance receipt (schema, signature, optional policy hash). " +
        "Names exactly what was verified. Does not prove behavioral compliance or completeness.",
      parameters: ReceiptVerifyParams,
      execute(params, _config, ctx) {
        const { deps } = initStack(ctx.api);
        return executeReceiptVerify(params, deps);
      },
    }),

    tool({
      name: "fpp_receipt_proof",
      label: "FPP Receipt Proof Export",
      description:
        "Export a selective Merkle inclusion proof from the typed receipt ledger. " +
        "Raw private logs are not disclosed by default.",
      parameters: ReceiptProofExportParams,
      execute(params, _config, ctx) {
        const { deps } = initStack(ctx.api);
        return executeReceiptProofExport(params, deps);
      },
    }),

    tool({
      name: "fpp_capsule_offer",
      label: "FPP Trust Capsule Offer",
      description:
        "Build a fresh signed TrustStateCapsuleV2 bound to audience+challenge. " +
        "Carries evidence/receipt roots and coverage — not raw private logs.",
      parameters: CapsuleOfferParams,
      execute(params, _config, ctx) {
        const { deps } = initStack(ctx.api);
        return executeCapsuleOffer(params, deps);
      },
    }),

    tool({
      name: "fpp_mandate_propose",
      label: "FPP Mandate Propose",
      description:
        "Open a peer or steward quorum proposal for a scoped StandingMandateV1. " +
        "Local policy only — not constitutional ratification. Peers second; then finalize.",
      parameters: MandateProposeParams,
      execute(params, _config, ctx) {
        const { stack } = initStack(ctx.api);
        return executeMandatePropose(params, {
          identity: stack.identity,
          quorum: stack.quorum,
        });
      },
    }),

    tool({
      name: "fpp_mandate_second",
      label: "FPP Mandate Second",
      description:
        "Cast an aye/nay/abstain ballot on an open quorum proposal, or accept peer ballotJson. " +
        "Revoked keys and ineligible voters are rejected.",
      parameters: MandateSecondParams,
      execute(params, _config, ctx) {
        const { stack } = initStack(ctx.api);
        return executeMandateSecond(params, {
          identity: stack.identity,
          quorum: stack.quorum,
        });
      },
    }),

    tool({
      name: "fpp_mandate_finalize",
      label: "FPP Mandate Finalize",
      description:
        "Finalize a quorum proposal into a signed StandingMandateV1 when the local " +
        "threshold is met. Writes the shared mandate store for disposition consumption.",
      parameters: MandateFinalizeParams,
      execute(params, _config, ctx) {
        const { stack } = initStack(ctx.api);
        return executeMandateFinalize(params, {
          identity: stack.identity,
          quorum: stack.quorum,
        });
      },
    }),
  ],
});

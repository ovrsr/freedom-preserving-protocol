/**
 * index.ts
 *
 * Plugin entry for the FPP Trust & Handshake plugin.
 *
 * Uses defineToolPlugin so the SDK automatically wires tool discovery,
 * tool-search metadata, and registrationMode gating. The five agent-facing
 * tools are declared in the `tools:` factory; hooks and CLI are registered
 * inside each tool factory's access to the api.
 *
 * Constitutional rationale:
 *   - Law 1 (consent): trust relationships require mutual handshake.
 *   - Law 2 (corrigibility): trust graph events are logged and inspectable.
 *   - Law 5 (scoped exploration): trust propagation has bounded depth.
 */

import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";

import { TrustGraphProtocol } from "./trust-graph.js";
import { ConstitutionalHandshake } from "./handshake.js";
import { loadTrustGraph, saveTrustGraph, saveTrustGraphSync } from "./persistence.js";
import { loadOrCreateIdentity } from "./identity.js";
import { MerkleBridge } from "./merkle-bridge.js";
import { StrictModeManager } from "./strict-mode.js";
import { GroupContextManager } from "./group-context.js";
import { registerFppTrustCli, FPP_TRUST_CLI_DESCRIPTORS } from "./cli.js";
import type { ToolDependencies } from "./tools.js";
import {
  HandshakeOfferParams,
  HandshakeVerifyParams,
  TrustStatusParams,
  AttestationExportParams,
  ClusterStatusParams,
  executeHandshakeOffer,
  executeHandshakeVerify,
  executeTrustStatus,
  executeAttestationExport,
  executeClusterStatus,
} from "./tools.js";

// ── Re-exports (library API) ──────────────────────────────────────

export { TrustGraphProtocol, TrustLevel } from "./trust-graph.js";
export type {
  TrustNode,
  TrustRelationship,
  TrustEvidence,
  TrustPropagation,
  TrustGraphStats,
  ReputationMetrics,
} from "./trust-graph.js";

export { ConstitutionalHandshake, HandshakeState } from "./handshake.js";
export type {
  ConstitutionalClaim,
  HandshakeSession,
  HandshakeResult,
  HandshakeEvidence,
} from "./handshake.js";

export { loadOrCreateIdentity, verifySignature } from "./identity.js";
export type { AgentIdentity } from "./identity.js";

export { signClaim, verifyClaim, canonicalize } from "./claims.js";
export type { SignedClaim, ClaimVerification } from "./claims.js";

export {
  MerkleBridge,
  computeMerkleRoot,
  createMerkleProof,
  verifyMerkleProof,
} from "./merkle-bridge.js";
export type { MerkleProof, MerkleProofStep } from "./merkle-bridge.js";

export { StrictModeManager } from "./strict-mode.js";
export type { StrictSessionEntry, StrictModeState } from "./strict-mode.js";

export { GroupContextManager } from "./group-context.js";
export type {
  ClusterMember,
  TrustCluster,
  ClusterTrustState,
} from "./group-context.js";

// ── Config ─────────────────────────────────────────────────────────

interface FppTrustConfig {
  constitutionHash: string;
  trustAttenuationFactor: number;
  handshakeTimeoutMs: number;
  maxPropagationDepth: number;
  trustGraphPath: string;
  identityKeyPath: string;
  auditLogPath: string;
  fallbackAuditLogPath: string | null;
  strictModeStatePath: string;
  requireSignedClaims: boolean;
  requireMerkleProof: boolean;
  strictModeOnHandshakeFailure: boolean;
  strictModeTtlMs: number;
  strictModeAddApprovalOn: string[];
}

function mergeConfig(raw: Record<string, unknown> | undefined): FppTrustConfig {
  const cfg = (raw ?? {}) as Partial<FppTrustConfig>;
  return {
    constitutionHash:
      typeof cfg.constitutionHash === "string"
        ? cfg.constitutionHash
        : "71bf60ad917c5413cc17b0f65e83c7a29218e24a2740725a819058ed9c6b1993",
    trustAttenuationFactor:
      typeof cfg.trustAttenuationFactor === "number"
        ? cfg.trustAttenuationFactor
        : 0.8,
    handshakeTimeoutMs:
      typeof cfg.handshakeTimeoutMs === "number"
        ? cfg.handshakeTimeoutMs
        : 300_000,
    maxPropagationDepth:
      typeof cfg.maxPropagationDepth === "number"
        ? cfg.maxPropagationDepth
        : 3,
    trustGraphPath:
      typeof cfg.trustGraphPath === "string"
        ? cfg.trustGraphPath
        : ".openclaw/workspace/fpp-trust-graph.json",
    identityKeyPath:
      typeof cfg.identityKeyPath === "string"
        ? cfg.identityKeyPath
        : ".openclaw/workspace/fpp-agent-identity.key",
    fallbackAuditLogPath:
      typeof cfg.fallbackAuditLogPath === "string"
        ? cfg.fallbackAuditLogPath
        : null,
    auditLogPath:
      typeof cfg.auditLogPath === "string"
        ? cfg.auditLogPath
        : ".openclaw/workspace/constitution-audit.jsonl",
    strictModeStatePath:
      typeof cfg.strictModeStatePath === "string"
        ? cfg.strictModeStatePath
        : ".openclaw/workspace/fpp-strict-sessions.json",
    requireSignedClaims:
      typeof cfg.requireSignedClaims === "boolean"
        ? cfg.requireSignedClaims
        : false,
    requireMerkleProof:
      typeof cfg.requireMerkleProof === "boolean"
        ? cfg.requireMerkleProof
        : false,
    strictModeOnHandshakeFailure:
      typeof cfg.strictModeOnHandshakeFailure === "boolean"
        ? cfg.strictModeOnHandshakeFailure
        : false,
    strictModeTtlMs:
      typeof cfg.strictModeTtlMs === "number"
        ? cfg.strictModeTtlMs
        : 3_600_000,
    strictModeAddApprovalOn: Array.isArray(cfg.strictModeAddApprovalOn)
      ? cfg.strictModeAddApprovalOn
      : [
          "fs.write.workspace",
          "fs.delete.workspace",
          "http.public-read",
          "http.public-write",
          "exec.outbound-write",
          "message.external",
        ],
  };
}

const DEBOUNCE_MS = 500;

/**
 * Create a configured trust stack (graph + handshake + identity + etc.)
 * from plugin config. Useful for programmatic access outside the plugin lifecycle.
 */
export function createTrustStack(rawConfig?: Record<string, unknown>): {
  trustGraph: TrustGraphProtocol;
  handshake: ConstitutionalHandshake;
  identity: ReturnType<typeof loadOrCreateIdentity>;
  merkleBridge: MerkleBridge;
  strictMode: StrictModeManager;
  groupContext: GroupContextManager;
  config: FppTrustConfig;
} {
  const config = mergeConfig(rawConfig);
  const trustGraph = loadTrustGraph(config.trustGraphPath, undefined, {
    attenuationFactor: config.trustAttenuationFactor,
  });
  const handshake = new ConstitutionalHandshake(trustGraph, config.constitutionHash, {
    timeoutMs: config.handshakeTimeoutMs,
    maxPropagationDepth: config.maxPropagationDepth,
    requireSignedClaims: config.requireSignedClaims,
    requireMerkleProof: config.requireMerkleProof,
  });
  const identity = loadOrCreateIdentity(config.identityKeyPath);
  const merkleBridge = new MerkleBridge(config.auditLogPath, process.cwd(), config.fallbackAuditLogPath);
  const strictMode = new StrictModeManager(config.strictModeStatePath, {
    defaultTtlMs: config.strictModeTtlMs,
    defaultAddApprovalOn: config.strictModeAddApprovalOn,
  });
  const groupContext = new GroupContextManager(trustGraph, identity.agentId);

  return { trustGraph, handshake, identity, merkleBridge, strictMode, groupContext, config };
}

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
        await saveTrustGraph(config.trustGraphPath, trustGraph);
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
    saveTrustGraphSync(config.trustGraphPath, trustGraph);
  }

  trustGraph.setOnChange(scheduleSave);
  process.on("beforeExit", flushSync);
  process.once("SIGTERM", flushSync);
  process.once("SIGINT", flushSync);

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
      });
    },
    { descriptors: FPP_TRUST_CLI_DESCRIPTORS },
  );

  // -- tool metadata (displaySummary for agent catalog) --
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
      name: "fpp_handshake_offer",
      label: "FPP Handshake Offer",
      description:
        "Generate this agent's signed constitutional claim for a trust handshake. " +
        "Share the returned JSON with the target agent so they can call fpp_handshake_verify. " +
        "Use this when you need to prove your FPP adoption to another agent.",
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
  ],
});

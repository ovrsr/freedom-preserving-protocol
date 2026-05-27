/**
 * index.ts
 *
 * Plugin entry for the FPP Trust & Handshake plugin. Registers on startup
 * and exposes:
 *   - Trust graph + handshake instances (library API)
 *   - Four LLM-facing tools (fpp_handshake_offer, fpp_handshake_verify,
 *     fpp_trust_status, fpp_attestation_export)
 *   - CLI surface (openclaw fpp-trust list/seed/export/verify/strict)
 *   - Ed25519 agent identity, Merkle audit bridging, signed claims
 *   - Group context trust clusters
 *   - Strict-mode signaling to the enforcement plugin
 *
 * Constitutional rationale:
 *   - Law 1 (consent): trust relationships require mutual handshake.
 *   - Law 2 (corrigibility): trust graph events are logged and inspectable.
 *   - Law 5 (scoped exploration): trust propagation has bounded depth.
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";

import { TrustGraphProtocol } from "./trust-graph.js";
import { ConstitutionalHandshake } from "./handshake.js";
import { loadTrustGraph, saveTrustGraph, saveTrustGraphSync } from "./persistence.js";
import { loadOrCreateIdentity } from "./identity.js";
import { MerkleBridge } from "./merkle-bridge.js";
import { StrictModeManager } from "./strict-mode.js";
import { GroupContextManager } from "./group-context.js";
import { createFppTools } from "./tools.js";
import { registerFppTrustCli, FPP_TRUST_CLI_DESCRIPTORS } from "./cli.js";

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

interface FppTrustConfig {
  constitutionHash: string;
  trustAttenuationFactor: number;
  handshakeTimeoutMs: number;
  maxPropagationDepth: number;
  trustGraphPath: string;
  identityKeyPath: string;
  auditLogPath: string;
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
  const merkleBridge = new MerkleBridge(config.auditLogPath);
  const strictMode = new StrictModeManager(config.strictModeStatePath, {
    defaultTtlMs: config.strictModeTtlMs,
    defaultAddApprovalOn: config.strictModeAddApprovalOn,
  });
  const groupContext = new GroupContextManager(trustGraph, identity.agentId);

  return { trustGraph, handshake, identity, merkleBridge, strictMode, groupContext, config };
}

export default definePluginEntry({
  id: "openclaw-fpp-trust",
  name: "Freedom Preserving Protocol — Trust & Handshake",
  description:
    "Agent-to-agent trust graph, constitutional handshake, signed claims, " +
    "Merkle audit bridging, and strict-mode signaling for multi-agent FPP verification.",
  register(api: OpenClawPluginApi) {
    const {
      trustGraph,
      handshake,
      identity,
      merkleBridge,
      strictMode,
      groupContext,
      config,
    } = createTrustStack(api.pluginConfig);

    // -- persistence (same debounce pattern as before) --

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

    // -- hook: cleanup expired sessions --

    api.on("before_tool_call", async (_event, _ctx) => {
      handshake.cleanupExpired();
      return undefined;
    }, { priority: 90 });

    // -- register tools --

    const tools = createFppTools({
      identity,
      trustGraph,
      handshake,
      merkleBridge,
      strictMode,
      constitutionHash: config.constitutionHash,
      strictModeOnHandshakeFailure: config.strictModeOnHandshakeFailure,
      strictModeTtlMs: config.strictModeTtlMs,
    });

    for (const tool of tools) {
      api.registerTool(tool as Parameters<typeof api.registerTool>[0]);
    }

    // -- register CLI --

    api.registerCli(
      (ctx) => {
        registerFppTrustCli(ctx.program as Parameters<typeof registerFppTrustCli>[0], {
          identity,
          trustGraph,
          merkleBridge,
          strictMode,
          constitutionHash: config.constitutionHash,
        });
      },
      {
        descriptors: FPP_TRUST_CLI_DESCRIPTORS,
      },
    );

    void groupContext;
  },
});

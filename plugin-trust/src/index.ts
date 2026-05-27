/**
 * index.ts
 *
 * Plugin entry for the FPP Trust & Handshake plugin. Registers on startup
 * and exposes the trust graph and handshake instances via the plugin API.
 *
 * This plugin is independent of the enforcement plugin — it handles
 * agent-to-agent trust verification, not tool-call gating.
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

interface FppTrustConfig {
  constitutionHash: string;
  trustAttenuationFactor: number;
  handshakeTimeoutMs: number;
  maxPropagationDepth: number;
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
  };
}

/**
 * Create a configured trust stack (graph + handshake) from plugin config.
 */
export function createTrustStack(rawConfig?: Record<string, unknown>): {
  trustGraph: TrustGraphProtocol;
  handshake: ConstitutionalHandshake;
  config: FppTrustConfig;
} {
  const config = mergeConfig(rawConfig);
  const trustGraph = new TrustGraphProtocol();
  const handshake = new ConstitutionalHandshake(trustGraph, config.constitutionHash);
  return { trustGraph, handshake, config };
}

export default definePluginEntry({
  id: "openclaw-fpp-trust",
  name: "Freedom Preserving Protocol — Trust & Handshake",
  description:
    "Agent-to-agent trust graph and constitutional handshake for multi-agent FPP verification.",
  register(api: OpenClawPluginApi) {
    const { trustGraph, handshake } = createTrustStack(api.pluginConfig);

    api.on("before_tool_call", async (_event, _ctx) => {
      handshake.cleanupExpired();
      return undefined;
    }, { priority: 90 });
  },
});

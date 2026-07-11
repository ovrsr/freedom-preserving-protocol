/**
 * Harness-agnostic trust stack factory — graph, handshake, identity, quorum.
 */

import { workspaceFile } from "@ovrsr/fpp-protocol-core";
import { TrustGraphProtocol, TrustLevel } from "./trust-graph.js";
import { ConstitutionalHandshake } from "./handshake.js";
import { loadTrustGraph } from "./persistence.js";
import { loadOrCreateIdentity } from "./identity.js";
import { MerkleBridge } from "./merkle-bridge.js";
import { StrictModeManager, CONSERVATIVE_STRICT_APPROVAL_ON } from "./strict-mode.js";
import { GroupContextManager } from "./group-context.js";
import { ReplayCache } from "./replay-cache.js";
import {
  resolveVerificationPolicy,
  type VerificationPolicy,
} from "./verification-policy.js";
import { KeyLifecycleLedger } from "./key-lifecycle.js";
import { parseQuorumPolicyConfig } from "./quorum-policy.js";
import { QuorumSessionManager } from "./quorum-session.js";

export type TrustConfigDiagnostic = {
  code: string;
  severity: "error" | "warn" | "info";
  detail: string;
};

export interface FppTrustConfig {
  constitutionHash: string;
  trustAttenuationFactor: number;
  handshakeTimeoutMs: number;
  maxPropagationDepth: number;
  propagationMinEdgeConfidence: number;
  propagationEvidenceCeiling: number;
  trustGraphPath: string;
  identityKeyPath: string;
  auditLogPath: string;
  fallbackAuditLogPath: string | null;
  receiptLogPath: string;
  strictModeStatePath: string;
  replayCachePath: string;
  verificationPolicy: VerificationPolicy;
  requireSignedClaims: boolean;
  requireMerkleProof: boolean;
  requireFreshness: boolean;
  allowLegacyDeclarations: boolean;
  strictModeOnHandshakeFailure: boolean;
  strictModeTtlMs: number;
  strictModeAddApprovalOn: string[];
  acknowledgeDangerousOverrides: boolean;
  quorumPeerThreshold: number;
  quorumStewardThreshold: number;
  quorumPeerEligibleIds: string[];
  quorumStewardEligibleIds: string[];
  quorumMinStandingLevel?: number | undefined;
  quorumProposalTtlMs: number;
  mandateStorePath: string;
  quorumStatePath: string;
  /** Migration diagnostics only — never used to rewrite operator config files. */
  migrationDiagnostics: TrustConfigDiagnostic[];
}

export type TrustStack = {
  trustGraph: TrustGraphProtocol;
  handshake: ConstitutionalHandshake;
  identity: ReturnType<typeof loadOrCreateIdentity>;
  merkleBridge: MerkleBridge;
  strictMode: StrictModeManager;
  groupContext: GroupContextManager;
  replayCache: ReplayCache;
  keyLifecycle: KeyLifecycleLedger;
  quorum: QuorumSessionManager;
  config: FppTrustConfig;
};

export function mergeTrustConfig(
  raw: Record<string, unknown> | undefined,
): FppTrustConfig {
  const cfg = (raw ?? {}) as Partial<FppTrustConfig> & Record<string, unknown>;
  const ack = cfg.acknowledgeDangerousOverrides === true;
  const policy = resolveVerificationPolicy({
    ...cfg,
    acknowledgeDangerousOverrides: ack,
  });
  const migrationDiagnostics: TrustConfigDiagnostic[] = [];

  if (
    cfg.verificationPolicy === "legacy-unsafe" &&
    policy.policy !== "legacy-unsafe"
  ) {
    migrationDiagnostics.push({
      code: "DANGEROUS_LEGACY_UNSAFE",
      severity: "error",
      detail: policy.diagnostic,
    });
  } else if (policy.policy === "legacy-unsafe") {
    migrationDiagnostics.push({
      code: "DANGEROUS_LEGACY_UNSAFE",
      severity: "warn",
      detail: policy.diagnostic,
    });
  }

  if (
    policy.policy !== "hardened-v2" ||
    policy.diagnostic.includes("unknown") ||
    migrationDiagnostics.length > 0
  ) {
    console.warn(`[fpp-trust] ${policy.diagnostic}`);
  }
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
    propagationMinEdgeConfidence:
      typeof cfg.propagationMinEdgeConfidence === "number"
        ? cfg.propagationMinEdgeConfidence
        : 0.2,
    propagationEvidenceCeiling:
      typeof cfg.propagationEvidenceCeiling === "number"
        ? cfg.propagationEvidenceCeiling
        : 0.45,
    trustGraphPath:
      typeof cfg.trustGraphPath === "string"
        ? cfg.trustGraphPath
        : workspaceFile("fpp-trust-graph.json"),
    identityKeyPath:
      typeof cfg.identityKeyPath === "string"
        ? cfg.identityKeyPath
        : workspaceFile("fpp-agent-identity.key"),
    fallbackAuditLogPath:
      cfg.fallbackAuditLogPath === null
        ? null
        : typeof cfg.fallbackAuditLogPath === "string"
          ? cfg.fallbackAuditLogPath
          : workspaceFile("fpp-plugin-audit.jsonl"),
    auditLogPath:
      typeof cfg.auditLogPath === "string"
        ? cfg.auditLogPath
        : workspaceFile("constitution-audit.jsonl"),
    receiptLogPath:
      typeof cfg.receiptLogPath === "string"
        ? cfg.receiptLogPath
        : workspaceFile("fpp-receipts.jsonl"),
    strictModeStatePath:
      typeof cfg.strictModeStatePath === "string"
        ? cfg.strictModeStatePath
        : workspaceFile("fpp-strict-sessions.json"),
    replayCachePath:
      typeof cfg.replayCachePath === "string"
        ? cfg.replayCachePath
        : workspaceFile("fpp-replay-cache.json"),
    verificationPolicy: policy.policy,
    requireSignedClaims: policy.requireSignedClaims,
    requireMerkleProof:
      typeof cfg.requireMerkleProof === "boolean"
        ? cfg.requireMerkleProof
        : false,
    requireFreshness: policy.requireFreshness,
    allowLegacyDeclarations: policy.allowLegacyDeclarations,
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
      : [...CONSERVATIVE_STRICT_APPROVAL_ON],
    acknowledgeDangerousOverrides: ack,
    quorumPeerThreshold:
      typeof cfg.quorumPeerThreshold === "number"
        ? cfg.quorumPeerThreshold
        : 2,
    quorumStewardThreshold:
      typeof cfg.quorumStewardThreshold === "number"
        ? cfg.quorumStewardThreshold
        : 2,
    quorumPeerEligibleIds: Array.isArray(cfg.quorumPeerEligibleIds)
      ? (cfg.quorumPeerEligibleIds as string[])
      : [],
    quorumStewardEligibleIds: Array.isArray(cfg.quorumStewardEligibleIds)
      ? (cfg.quorumStewardEligibleIds as string[])
      : [],
    ...(typeof cfg.quorumMinStandingLevel === "number"
      ? { quorumMinStandingLevel: cfg.quorumMinStandingLevel }
      : {}),
    quorumProposalTtlMs:
      typeof cfg.quorumProposalTtlMs === "number"
        ? cfg.quorumProposalTtlMs
        : 3_600_000,
    mandateStorePath:
      typeof cfg.mandateStorePath === "string"
        ? cfg.mandateStorePath
        : workspaceFile("fpp-mandates.json"),
    quorumStatePath:
      typeof cfg.quorumStatePath === "string"
        ? cfg.quorumStatePath
        : workspaceFile("fpp-quorum-sessions.json"),
    migrationDiagnostics,
  };
}

/**
 * Create a configured trust stack (graph + handshake + identity + etc.)
 * from config. Useful for programmatic access outside any harness adapter.
 */
export function createTrustStack(
  rawConfig?: Record<string, unknown>,
): TrustStack {
  const config = mergeTrustConfig(rawConfig);
  const identity = loadOrCreateIdentity(config.identityKeyPath);
  const trustGraph = loadTrustGraph(config.trustGraphPath, undefined, {
    attenuationFactor: config.trustAttenuationFactor,
    identity,
  });
  trustGraph.setPropagationPolicy({
    maxDepth: config.maxPropagationDepth,
    attenuationFactor: config.trustAttenuationFactor,
    minEdgeConfidence: config.propagationMinEdgeConfidence,
    evidenceClassCeiling: config.propagationEvidenceCeiling,
  });
  const replayCache = new ReplayCache({ path: config.replayCachePath });
  const handshake = new ConstitutionalHandshake(trustGraph, config.constitutionHash, {
    timeoutMs: config.handshakeTimeoutMs,
    maxPropagationDepth: config.maxPropagationDepth,
    requireSignedClaims: config.requireSignedClaims,
    requireMerkleProof: config.requireMerkleProof,
    requireFreshness: config.requireFreshness,
    replayCache,
    localAudience: identity.agentId,
  });
  const merkleBridge = new MerkleBridge(
    config.auditLogPath,
    process.cwd(),
    config.fallbackAuditLogPath,
  );
  const strictMode = new StrictModeManager(config.strictModeStatePath, {
    defaultTtlMs: config.strictModeTtlMs,
    defaultAddApprovalOn: config.strictModeAddApprovalOn,
  });
  const groupContext = new GroupContextManager(trustGraph, identity.agentId);
  const keyLifecycle = new KeyLifecycleLedger();
  const quorumPolicy = parseQuorumPolicyConfig({
    peerThreshold: config.quorumPeerThreshold,
    stewardThreshold: config.quorumStewardThreshold,
    peerEligibleIds: config.quorumPeerEligibleIds,
    stewardEligibleIds: config.quorumStewardEligibleIds,
    ...(config.quorumMinStandingLevel !== undefined
      ? {
          minStandingLevel: config.quorumMinStandingLevel as TrustLevel,
        }
      : {}),
    proposalTtlMs: config.quorumProposalTtlMs,
  });
  const quorum = new QuorumSessionManager({
    policy: quorumPolicy,
    ledger: keyLifecycle,
    mandateStorePath: config.mandateStorePath,
    statePath: config.quorumStatePath,
  });

  return {
    trustGraph,
    handshake,
    identity,
    merkleBridge,
    strictMode,
    groupContext,
    replayCache,
    keyLifecycle,
    quorum,
    config,
  };
}

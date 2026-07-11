/**
 * Deterministic runtime/policy metadata bound into conformance receipts.
 *
 * Hashes exclude secrets and machine-specific absolute paths so the same
 * logical policy produces the same identifier across hosts.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DIGEST_DOMAINS, digest } from "@ovrsr/fpp-protocol-core";
import type { FppPluginConfig } from "./config.js";
import { CLASSIFICATION_IDS } from "./risk-classifier.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export type RuntimeManifest = {
  schemaVersion: 1;
  policyId: string;
  policyVersion: string;
  classifierRulesetHash: string;
  effectiveConfigHash: string;
  packageBuildHash: string;
  constitutionHash: string;
  implementationVersion: string;
  pluginApiCompat: string;
  minGatewayVersion: string;
  runtimeState: "ok" | "degraded";
  degradedReason?: string | undefined;
};

export type PackageBuildInput = {
  name: string;
  version: string;
  pluginApi: string;
  minGatewayVersion?: string | undefined;
  openclawVersion?: string | undefined;
};

let cachedPkg: {
  name: string;
  version: string;
  openclaw?: {
    compat?: { pluginApi?: string; minGatewayVersion?: string };
    build?: { openclawVersion?: string };
  };
} | null = null;

function readPluginPackage(): NonNullable<typeof cachedPkg> {
  if (cachedPkg) return cachedPkg;
  const pkgPath = join(__dirname, "..", "package.json");
  cachedPkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  return cachedPkg!;
}

/** Deterministic hash of the classifier taxonomy / ruleset identity. */
export function computeClassifierRulesetHash(): string {
  return digest({
    version: 2,
    domain: DIGEST_DOMAINS.receipt,
    value: {
      kind: "classifier-ruleset",
      classificationIds: [...CLASSIFICATION_IDS].sort(),
      rulesetVersion: 1,
    },
  });
}

/**
 * Hash of effective enforcement policy. Excludes filesystem paths and key
 * material so host-local config locations do not change the policy id.
 */
export function computeEffectiveConfigHash(config: FppPluginConfig): string {
  return digest({
    version: 2,
    domain: DIGEST_DOMAINS.receipt,
    value: {
      kind: "effective-config",
      blockOn: [...config.blockOn].sort(),
      approvalOn: [...config.approvalOn].sort(),
      approvalTimeoutMs: config.approvalTimeoutMs,
      approvalTimeoutBehavior: config.approvalTimeoutBehavior,
      respectTrustStrictMode: config.respectTrustStrictMode,
      knownCustomTools: [...config.knownCustomTools].sort(),
      auditFailureBehavior: config.auditFailureBehavior,
      acknowledgeDangerousOverrides: config.acknowledgeDangerousOverrides,
      receiptMaxPending: config.receiptMaxPending,
      receiptPendingTtlMs: config.receiptPendingTtlMs,
      receiptSigningEnabled: config.receiptSigningEnabled,
      dispositionMode: config.dispositionMode,
      standingAllowOn: [...config.standingAllowOn].sort(),
      mandateDefaultMaxActions: config.mandateDefaultMaxActions,
      stagedUndoWindowMs: config.stagedUndoWindowMs,
      // intentionally omit: auditLogPath, receiptLogPath, identityKeyPath,
      // mandateStorePath, strictModeStatePath, constitutionHash (bound separately)
    },
  });
}

export function computePackageBuildHash(input: PackageBuildInput): string {
  return digest({
    version: 2,
    domain: DIGEST_DOMAINS.receipt,
    value: {
      kind: "package-build",
      name: input.name,
      version: input.version,
      pluginApi: input.pluginApi,
      minGatewayVersion: input.minGatewayVersion ?? null,
      openclawVersion: input.openclawVersion ?? null,
    },
  });
}

export function buildRuntimeManifest(input: {
  config: FppPluginConfig;
  constitutionHash: string;
  degraded: boolean;
  degradedReason?: string | undefined;
}): RuntimeManifest {
  const pkg = readPluginPackage();
  const classifierRulesetHash = computeClassifierRulesetHash();
  const effectiveConfigHash = computeEffectiveConfigHash(input.config);
  const pluginApi = pkg.openclaw?.compat?.pluginApi ?? "unknown";
  const minGatewayVersion = pkg.openclaw?.compat?.minGatewayVersion ?? "unknown";
  const packageBuildHash = computePackageBuildHash({
    name: pkg.name,
    version: pkg.version,
    pluginApi,
    minGatewayVersion,
    openclawVersion: pkg.openclaw?.build?.openclawVersion,
  });
  const policyVersion = digest({
    version: 2,
    domain: DIGEST_DOMAINS.receipt,
    value: {
      kind: "policy-version",
      classifierRulesetHash,
      effectiveConfigHash,
      constitutionHash: input.constitutionHash,
    },
  }).slice(0, 32);

  return {
    schemaVersion: 1,
    policyId: `fpp-enforcement:${classifierRulesetHash.slice(0, 8)}`,
    policyVersion,
    classifierRulesetHash,
    effectiveConfigHash,
    packageBuildHash,
    constitutionHash: input.constitutionHash,
    implementationVersion: pkg.version,
    pluginApiCompat: pluginApi,
    minGatewayVersion,
    runtimeState: input.degraded ? "degraded" : "ok",
    degradedReason: input.degraded ? input.degradedReason : undefined,
  };
}

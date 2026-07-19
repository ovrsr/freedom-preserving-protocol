/**
 * Deterministic runtime/policy metadata bound into conformance receipts.
 *
 * Hashes exclude secrets and machine-specific absolute paths so the same
 * logical policy produces the same identifier across hosts.
 *
 * Package/build identity is injected by the harness adapter — this module
 * never reads OpenClaw package.json itself.
 */

import { DIGEST_DOMAINS, digest } from "@ovrsr/fpp-protocol-core";
import type { FppPluginConfig } from "./config.js";
import { CLASSIFICATION_IDS } from "./risk-classifier.js";

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

/** Default package identity for unit tests and library consumers without a harness. */
export const DEFAULT_PACKAGE_BUILD: PackageBuildInput = {
  name: "@ovrsr/fpp-enforcement-core",
  version: "1.0.0",
  pluginApi: "library",
  minGatewayVersion: "n/a",
};

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
      outOfWorkspacePaths: Object.entries(config.outOfWorkspacePaths)
        .map(([absolutePath, resourcePathAlias]) => [
          absolutePath,
          resourcePathAlias,
        ])
        .sort((a, b) => {
          const keyCmp = a[0]!.localeCompare(b[0]!);
          return keyCmp !== 0 ? keyCmp : a[1]!.localeCompare(b[1]!);
        }),
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
      // mandateStorePath, strictModeStatePath, stewardAuthorizationLedgerPath,
      // constitutionHash (bound separately). outOfWorkspacePaths is included
      // above because it changes authorization matching behavior.
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
  packageBuild?: PackageBuildInput | undefined;
}): RuntimeManifest {
  const pkg = input.packageBuild ?? DEFAULT_PACKAGE_BUILD;
  const classifierRulesetHash = computeClassifierRulesetHash();
  const effectiveConfigHash = computeEffectiveConfigHash(input.config);
  const pluginApi = pkg.pluginApi;
  const minGatewayVersion = pkg.minGatewayVersion ?? "unknown";
  const packageBuildHash = computePackageBuildHash(pkg);
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

/**
 * OpenClaw adapter re-exports harness-agnostic enforcement config, plus
 * manifest default parity checks against openclaw.plugin.json.
 */

import { readFileSync } from "node:fs";
import {
  DEFAULT_CONFIG,
  type FppPluginConfig,
} from "@ovrsr/fpp-enforcement-core";

export {
  CONSERVATIVE_STRICT_APPROVAL_ON,
  DEFAULT_CONFIG,
  diagnoseConfigSafety,
  mergeConfig,
  mergeConfigWithDiagnostics,
  type ConfigDiagnostic,
  type ConfigDiagnosticSeverity,
  type DispositionMode,
  type FppPluginConfig,
  type MergeConfigResult,
} from "@ovrsr/fpp-enforcement-core";

/** Fields whose manifest `default` must match DEFAULT_CONFIG. */
const MANIFEST_DEFAULT_KEYS: (keyof FppPluginConfig)[] = [
  "auditLogPath",
  "blockOn",
  "approvalOn",
  "approvalTimeoutMs",
  "approvalTimeoutBehavior",
  "constitutionHash",
  "strictModeStatePath",
  "respectTrustStrictMode",
  "knownCustomTools",
  "auditFailureBehavior",
  "receiptMaxPending",
  "receiptPendingTtlMs",
  "receiptLogPath",
  "identityKeyPath",
  "receiptSigningEnabled",
  "dispositionMode",
  "standingAllowOn",
  "mandateStorePath",
  "mandateDefaultMaxActions",
  "stagedUndoWindowMs",
];

export type ManifestValidationResult = {
  ok: boolean;
  mismatches: string[];
};

/**
 * Validate that openclaw.plugin.json configSchema defaults match DEFAULT_CONFIG.
 * Does not rewrite the manifest — reports drift only.
 */
export function validateManifestDefaults(manifestPath: string): ManifestValidationResult {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    configSchema?: { properties?: Record<string, { default?: unknown }> };
  };
  const props = manifest.configSchema?.properties ?? {};
  const mismatches: string[] = [];

  for (const key of MANIFEST_DEFAULT_KEYS) {
    const prop = props[key];
    if (!prop || !("default" in prop)) {
      mismatches.push(`manifest missing default for ${key}`);
      continue;
    }
    const expected = DEFAULT_CONFIG[key];
    const actual = prop.default;
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      mismatches.push(
        `${key}: manifest=${JSON.stringify(actual)} runtime=${JSON.stringify(expected)}`,
      );
    }
  }

  return { ok: mismatches.length === 0, mismatches };
}

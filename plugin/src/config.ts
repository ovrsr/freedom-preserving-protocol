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

/** Path-like config keys — manifest may keep relative forms for readability. */
const PATH_DEFAULT_KEYS = new Set<keyof FppPluginConfig>([
  "auditLogPath",
  "strictModeStatePath",
  "receiptLogPath",
  "identityKeyPath",
  "mandateStorePath",
]);

/**
 * Relative OpenClaw defaults (manifest) match absolute runtime defaults
 * that end with the same `.openclaw/workspace/<file>` suffix.
 */
function defaultsEquivalent(
  key: keyof FppPluginConfig,
  manifestDefault: unknown,
  runtimeDefault: unknown,
): boolean {
  if (JSON.stringify(manifestDefault) === JSON.stringify(runtimeDefault)) {
    return true;
  }
  if (
    PATH_DEFAULT_KEYS.has(key) &&
    typeof manifestDefault === "string" &&
    typeof runtimeDefault === "string"
  ) {
    const rel = manifestDefault.replace(/\\/g, "/");
    const abs = runtimeDefault.replace(/\\/g, "/");
    if (rel.startsWith(".openclaw/workspace/")) {
      return abs.endsWith(`/${rel}`) || abs.endsWith(rel);
    }
  }
  return false;
}

/**
 * Validate that openclaw.plugin.json configSchema defaults match DEFAULT_CONFIG.
 * Does not rewrite the manifest — reports drift only.
 * Path defaults may remain relative in the manifest while runtime resolves absolute.
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
    if (!defaultsEquivalent(key, actual, expected)) {
      mismatches.push(
        `${key}: manifest=${JSON.stringify(actual)} runtime=${JSON.stringify(expected)}`,
      );
    }
  }

  return { ok: mismatches.length === 0, mismatches };
}

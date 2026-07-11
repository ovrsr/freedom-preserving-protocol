/**
 * config.ts
 *
 * Plugin config schema and defaults. Mirrors openclaw.plugin.json's
 * configSchema. Defaults are conservative — adopters who want to relax
 * enforcement should do so by config, not by editing source.
 *
 * Dangerous overrides (blockOn downgrade, approvalTimeoutBehavior=allow)
 * require explicit `acknowledgeDangerousOverrides: true`. Without it,
 * runtime keeps the safe default and emits migration diagnostics — the
 * operator's config file is never rewritten.
 */

import { readFileSync } from "node:fs";
import type { ClassificationId } from "./risk-classifier.js";

/**
 * Conservative strict-mode approval overrides used when the shared
 * strict-mode state file is missing schema validity (malformed JSON,
 * wrong version, etc.). Must stay aligned with the trust plugin defaults.
 */
export const CONSERVATIVE_STRICT_APPROVAL_ON: readonly ClassificationId[] = [
  "fs.write.workspace",
  "fs.delete.workspace",
  "http.public-read",
  "http.public-write",
  "exec.outbound-write",
  "message.external",
];

export type ConfigDiagnosticSeverity = "error" | "warn" | "info";

export type ConfigDiagnostic = {
  code: string;
  severity: ConfigDiagnosticSeverity;
  detail: string;
};

export type DispositionMode = "operator-present" | "unattended";

export type FppPluginConfig = {
  auditLogPath: string;
  blockOn: ClassificationId[];
  approvalOn: ClassificationId[];
  approvalTimeoutMs: number;
  approvalTimeoutBehavior: "allow" | "deny";
  constitutionHash: string;
  strictModeStatePath: string;
  respectTrustStrictMode: boolean;
  /**
   * Explicit operator allowlist of known custom tool names that may bypass
   * the unknown.unclassified → approval default. Scoped — not a global fail-open.
   */
  knownCustomTools: string[];
  /**
   * Behavior when the enforcement audit log cannot be written (corruption,
   * permissions, etc.). Default `fail-closed` blocks high-risk and unknown
   * calls rather than proceeding without an audit record.
   * `degraded-allow-low-risk` may allow only classifier-`allow` decisions
   * after emitting a visible AUDIT-GAP diagnostic.
   */
  auditFailureBehavior: "fail-closed" | "degraded-allow-low-risk";
  /**
   * Required to honor dangerous overrides (timeout allow, blockOn downgrade,
   * standingAllowOn covering hard-floor classes).
   * Without this flag those overrides are ignored at runtime and reported
   * via migration diagnostics — the on-disk user config is not rewritten.
   */
  acknowledgeDangerousOverrides: boolean;
  /** Max in-flight pending receipts awaiting after_tool_call / authorization. */
  receiptMaxPending: number;
  /** Pending receipt TTL before sweep marks them as audit-gap timeouts. */
  receiptPendingTtlMs: number;
  /** Path for the v2 signed receipt ledger (separate from legacy audit log). */
  receiptLogPath: string;
  /** Shared agent identity seed path (compatible with trust plugin). */
  identityKeyPath: string;
  /** When false, receipts are emitted unsigned and labeled degraded. */
  receiptSigningEnabled: boolean;
  /**
   * Disposition engine mode. New installs default to `unattended`.
   * Existing configs missing this field migrate to `operator-present`
   * (fail-safe) with a migration diagnostic recommending `unattended`.
   */
  dispositionMode: DispositionMode;
  /**
   * Human operator standing allowlist of classification ids covered without
   * a signed mandate. Hard-floor classes require acknowledgeDangerousOverrides.
   */
  standingAllowOn: ClassificationId[];
  /** File-backed mandate store path. */
  mandateStorePath: string;
  /** Default maxActions when materializing standing-allowlist coverage. */
  mandateDefaultMaxActions: number;
  /** Undo/review window for allow-staged decisions (ms). */
  stagedUndoWindowMs: number;
};

export type MergeConfigResult = {
  config: FppPluginConfig;
  diagnostics: ConfigDiagnostic[];
};

export const DEFAULT_CONFIG: FppPluginConfig = {
  auditLogPath: ".openclaw/workspace/fpp-plugin-audit.jsonl",
  blockOn: ["fs.delete.protected", "exec.cred-exfil", "gateway.restart"],
  approvalOn: [
    "fs.delete.workspace",
    "fs.write.protected",
    "pkg.install",
    "pkg.publish",
    "http.public-write",
    "exec.outbound-write",
    "exec.system-modify",
    "gateway.config-change",
    "message.external",
    "unknown.unclassified",
  ],
  approvalTimeoutMs: 60_000,
  approvalTimeoutBehavior: "deny",
  constitutionHash:
    "71bf60ad917c5413cc17b0f65e83c7a29218e24a2740725a819058ed9c6b1993",
  strictModeStatePath: ".openclaw/workspace/fpp-strict-sessions.json",
  respectTrustStrictMode: true,
  knownCustomTools: [],
  auditFailureBehavior: "fail-closed",
  acknowledgeDangerousOverrides: false,
  receiptMaxPending: 256,
  receiptPendingTtlMs: 15 * 60_000,
  receiptLogPath: ".openclaw/workspace/fpp-receipts.jsonl",
  identityKeyPath: ".openclaw/workspace/fpp-agent-identity.key",
  receiptSigningEnabled: true,
  dispositionMode: "unattended",
  standingAllowOn: [],
  mandateStorePath: ".openclaw/workspace/fpp-mandates.json",
  mandateDefaultMaxActions: 10,
  stagedUndoWindowMs: 60_000,
};

function isBlockDowngrade(blockOn: ClassificationId[]): boolean {
  return DEFAULT_CONFIG.blockOn.some((id) => !blockOn.includes(id));
}

function standingAllowCoversHardFloor(
  standingAllowOn: ClassificationId[],
): boolean {
  return DEFAULT_CONFIG.blockOn.some((id) => standingAllowOn.includes(id));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Diagnose unsafe configuration shapes without mutating anything.
 * Used by install verification and mergeConfigWithDiagnostics.
 */
export function diagnoseConfigSafety(
  partial: Partial<FppPluginConfig> & Record<string, unknown>,
): ConfigDiagnostic[] {
  const diagnostics: ConfigDiagnostic[] = [];
  const ack = partial.acknowledgeDangerousOverrides === true;

  if (partial.approvalTimeoutBehavior === "allow") {
    diagnostics.push({
      code: "DANGEROUS_TIMEOUT_ALLOW",
      severity: ack ? "warn" : "error",
      detail: ack
        ? "approvalTimeoutBehavior=allow is acknowledged (fail-open on timeout)."
        : "approvalTimeoutBehavior=allow requires acknowledgeDangerousOverrides: true. " +
          "Without acknowledgement, runtime keeps deny. Set the flag explicitly if intentional.",
    });
  }

  if (Array.isArray(partial.blockOn) && isBlockDowngrade(partial.blockOn as ClassificationId[])) {
    diagnostics.push({
      code: "DANGEROUS_BLOCK_DOWNGRADE",
      severity: ack ? "warn" : "error",
      detail: ack
        ? "blockOn removes one or more default hard-blocks (acknowledged)."
        : "blockOn removes default hard-blocks (fs.delete.protected / exec.cred-exfil / gateway.restart). " +
          "Requires acknowledgeDangerousOverrides: true. Without acknowledgement, missing hard-blocks are restored at runtime.",
    });
  }

  if (
    Array.isArray(partial.standingAllowOn) &&
    standingAllowCoversHardFloor(partial.standingAllowOn as ClassificationId[])
  ) {
    diagnostics.push({
      code: "DANGEROUS_STANDING_ALLOW_HARD_FLOOR",
      severity: ack ? "warn" : "error",
      detail: ack
        ? "standingAllowOn includes hard-floor classification(s) (acknowledged)."
        : "standingAllowOn includes hard-floor classification(s) from blockOn. " +
          "Requires acknowledgeDangerousOverrides: true. Without acknowledgement, those ids are stripped at runtime.",
    });
  }

  return diagnostics;
}

function resolveDispositionMode(
  input: unknown,
  partial: Partial<FppPluginConfig>,
): { mode: DispositionMode; diagnostic: ConfigDiagnostic | null } {
  if (
    partial.dispositionMode === "unattended" ||
    partial.dispositionMode === "operator-present"
  ) {
    return { mode: partial.dispositionMode, diagnostic: null };
  }

  const empty =
    input === undefined ||
    input === null ||
    (isRecord(input) && Object.keys(input).length === 0);

  if (empty) {
    return { mode: DEFAULT_CONFIG.dispositionMode, diagnostic: null };
  }

  return {
    mode: "operator-present",
    diagnostic: {
      code: "DISPOSITION_MODE_MIGRATION",
      severity: "info",
      detail:
        "dispositionMode was absent; using fail-safe operator-present. " +
        "Set dispositionMode: \"unattended\" explicitly for headless agents that should abstain instead of requireApproval.",
    },
  };
}

export function mergeConfigWithDiagnostics(input: unknown): MergeConfigResult {
  const partial = (isRecord(input) ? input : {}) as Partial<FppPluginConfig>;
  const diagnostics = diagnoseConfigSafety(
    partial as Partial<FppPluginConfig> & Record<string, unknown>,
  );
  const ack = partial.acknowledgeDangerousOverrides === true;

  let approvalTimeoutBehavior =
    partial.approvalTimeoutBehavior ?? DEFAULT_CONFIG.approvalTimeoutBehavior;
  if (approvalTimeoutBehavior === "allow" && !ack) {
    approvalTimeoutBehavior = "deny";
  }

  let blockOn = partial.blockOn ?? DEFAULT_CONFIG.blockOn;
  if (Array.isArray(partial.blockOn) && isBlockDowngrade(partial.blockOn) && !ack) {
    // Restore missing default hard-blocks without rewriting the operator's file.
    const restored = new Set<ClassificationId>([...partial.blockOn, ...DEFAULT_CONFIG.blockOn]);
    blockOn = [...restored];
  }

  let standingAllowOn = partial.standingAllowOn ?? DEFAULT_CONFIG.standingAllowOn;
  if (
    Array.isArray(partial.standingAllowOn) &&
    standingAllowCoversHardFloor(partial.standingAllowOn) &&
    !ack
  ) {
    standingAllowOn = partial.standingAllowOn.filter(
      (id) => !DEFAULT_CONFIG.blockOn.includes(id),
    );
  }

  const { mode: dispositionMode, diagnostic: dispositionDiag } =
    resolveDispositionMode(input, partial);
  if (dispositionDiag) {
    diagnostics.push(dispositionDiag);
  }

  const config: FppPluginConfig = {
    auditLogPath: partial.auditLogPath ?? DEFAULT_CONFIG.auditLogPath,
    blockOn,
    approvalOn: partial.approvalOn ?? DEFAULT_CONFIG.approvalOn,
    approvalTimeoutMs: partial.approvalTimeoutMs ?? DEFAULT_CONFIG.approvalTimeoutMs,
    approvalTimeoutBehavior,
    constitutionHash: partial.constitutionHash ?? DEFAULT_CONFIG.constitutionHash,
    strictModeStatePath:
      partial.strictModeStatePath ?? DEFAULT_CONFIG.strictModeStatePath,
    respectTrustStrictMode:
      partial.respectTrustStrictMode ?? DEFAULT_CONFIG.respectTrustStrictMode,
    knownCustomTools: partial.knownCustomTools ?? DEFAULT_CONFIG.knownCustomTools,
    auditFailureBehavior:
      partial.auditFailureBehavior ?? DEFAULT_CONFIG.auditFailureBehavior,
    acknowledgeDangerousOverrides: ack,
    receiptMaxPending: partial.receiptMaxPending ?? DEFAULT_CONFIG.receiptMaxPending,
    receiptPendingTtlMs:
      partial.receiptPendingTtlMs ?? DEFAULT_CONFIG.receiptPendingTtlMs,
    receiptLogPath: partial.receiptLogPath ?? DEFAULT_CONFIG.receiptLogPath,
    identityKeyPath: partial.identityKeyPath ?? DEFAULT_CONFIG.identityKeyPath,
    receiptSigningEnabled:
      partial.receiptSigningEnabled ?? DEFAULT_CONFIG.receiptSigningEnabled,
    dispositionMode,
    standingAllowOn,
    mandateStorePath: partial.mandateStorePath ?? DEFAULT_CONFIG.mandateStorePath,
    mandateDefaultMaxActions:
      partial.mandateDefaultMaxActions ?? DEFAULT_CONFIG.mandateDefaultMaxActions,
    stagedUndoWindowMs:
      partial.stagedUndoWindowMs ?? DEFAULT_CONFIG.stagedUndoWindowMs,
  };

  return { config, diagnostics };
}

export function mergeConfig(input: unknown): FppPluginConfig {
  const { config, diagnostics } = mergeConfigWithDiagnostics(input);
  for (const d of diagnostics) {
    if (d.severity === "error") {
      console.error(`FPP CONFIG ${d.code}: ${d.detail}`);
    } else if (d.severity === "warn") {
      console.warn(`FPP CONFIG ${d.code}: ${d.detail}`);
    } else {
      console.info(`FPP CONFIG ${d.code}: ${d.detail}`);
    }
  }
  return config;
}

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

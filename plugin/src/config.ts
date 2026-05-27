/**
 * config.ts
 *
 * Plugin config schema and defaults. Mirrors openclaw.plugin.json's
 * configSchema. Defaults are conservative — adopters who want to relax
 * enforcement should do so by config, not by editing source.
 */

import type { ClassificationId } from "./risk-classifier.js";

export type FppPluginConfig = {
  auditLogPath: string;
  blockOn: ClassificationId[];
  approvalOn: ClassificationId[];
  approvalTimeoutMs: number;
  approvalTimeoutBehavior: "allow" | "deny";
  constitutionHash: string;
  strictModeStatePath: string;
  respectTrustStrictMode: boolean;
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
  ],
  approvalTimeoutMs: 60_000,
  approvalTimeoutBehavior: "deny",
  constitutionHash:
    "71bf60ad917c5413cc17b0f65e83c7a29218e24a2740725a819058ed9c6b1993",
  strictModeStatePath: ".openclaw/workspace/fpp-strict-sessions.json",
  respectTrustStrictMode: true,
};

export function mergeConfig(input: unknown): FppPluginConfig {
  const partial = (input as Partial<FppPluginConfig>) ?? {};
  return {
    auditLogPath: partial.auditLogPath ?? DEFAULT_CONFIG.auditLogPath,
    blockOn: partial.blockOn ?? DEFAULT_CONFIG.blockOn,
    approvalOn: partial.approvalOn ?? DEFAULT_CONFIG.approvalOn,
    approvalTimeoutMs: partial.approvalTimeoutMs ?? DEFAULT_CONFIG.approvalTimeoutMs,
    approvalTimeoutBehavior:
      partial.approvalTimeoutBehavior ?? DEFAULT_CONFIG.approvalTimeoutBehavior,
    constitutionHash: partial.constitutionHash ?? DEFAULT_CONFIG.constitutionHash,
    strictModeStatePath:
      partial.strictModeStatePath ?? DEFAULT_CONFIG.strictModeStatePath,
    respectTrustStrictMode:
      partial.respectTrustStrictMode ?? DEFAULT_CONFIG.respectTrustStrictMode,
  };
}

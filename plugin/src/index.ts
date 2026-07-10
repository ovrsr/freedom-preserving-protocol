/**
 * index.ts
 *
 * Plugin entry. Registers a `before_tool_call` hook that:
 *   1. Classifies the tool call against a risk taxonomy (see risk-classifier.ts).
 *   2. Looks the classification up in this plugin's config to decide:
 *      block, requireApproval, or allow.
 *   3. Writes a hash-chained audit entry to the dispatcher-layer audit log.
 *
 * Types come from `openclaw/plugin-sdk/plugin-entry`. The hook signature is
 * `(event, ctx) => result`; the plugin's resolved config lives on `api.pluginConfig`
 * (not on event.context — the older docs were out of date).
 *
 * Constitutional rationale:
 *   - Law 1 (consent): requireApproval surfaces the action to the user before it runs.
 *   - Law 2 (corrigibility): every decision is logged with reason and tool metadata.
 *   - Law 3 (reversibility): the hook can block irreversible actions in advance.
 *   - Law 5 (scoped exploration): unknown tools require approval by default;
 *     operators may allowlist known custom tools explicitly.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type { OpenClawPluginApi, OpenClawPluginDefinition } from "openclaw/plugin-sdk/plugin-entry";

import { classifyToolCall, type ClassificationResult } from "./risk-classifier.js";
import {
  mergeConfig,
  CONSERVATIVE_STRICT_APPROVAL_ON,
  type FppPluginConfig,
} from "./config.js";
import {
  appendEnforcementEntry,
  type EnforcementEvent,
  type EnforcementOutcome,
} from "./audit-log.js";

interface StrictSessionEntry {
  strict: boolean;
  addedApprovalOn: string[];
  expiresAt: string;
}

interface StrictModeState {
  version: number;
  sessions: Record<string, StrictSessionEntry>;
}

type StrictReadResult =
  | { kind: "ok"; state: StrictModeState }
  | { kind: "missing" }
  | { kind: "degraded"; code: "STRICT_MODE_MALFORMED" | "STRICT_MODE_SCHEMA_INVALID" };

let strictModeCache: { result: StrictReadResult; readAt: number } | null = null;
const STRICT_CACHE_TTL_MS = 1000;

function emitStrictDiagnostic(
  code: "STRICT_MODE_MALFORMED" | "STRICT_MODE_SCHEMA_INVALID",
  detail: string,
): void {
  // Structured diagnostic — never include session keys or reason text.
  console.error(`FPP ${code}: ${detail}`);
}

function isValidStrictEntry(value: unknown): value is StrictSessionEntry {
  if (!value || typeof value !== "object") return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.strict === "boolean" &&
    Array.isArray(e.addedApprovalOn) &&
    e.addedApprovalOn.every((x) => typeof x === "string") &&
    typeof e.expiresAt === "string"
  );
}

function readStrictModeState(filePath: string): StrictReadResult {
  const now = Date.now();
  if (strictModeCache && now - strictModeCache.readAt < STRICT_CACHE_TTL_MS) {
    return strictModeCache.result;
  }
  const resolved = resolve(filePath);
  if (!existsSync(resolved)) {
    const result: StrictReadResult = { kind: "missing" };
    strictModeCache = { result, readAt: now };
    return result;
  }
  try {
    const raw: unknown = JSON.parse(readFileSync(resolved, "utf-8"));
    if (!raw || typeof raw !== "object") {
      const result: StrictReadResult = {
        kind: "degraded",
        code: "STRICT_MODE_SCHEMA_INVALID",
      };
      emitStrictDiagnostic(result.code, "strict-mode state root is not an object");
      strictModeCache = { result, readAt: now };
      return result;
    }
    const obj = raw as Record<string, unknown>;
    if (obj.version !== 1 || typeof obj.sessions !== "object" || obj.sessions === null) {
      const result: StrictReadResult = {
        kind: "degraded",
        code: "STRICT_MODE_SCHEMA_INVALID",
      };
      emitStrictDiagnostic(
        result.code,
        "strict-mode state failed versioned schema validation",
      );
      strictModeCache = { result, readAt: now };
      return result;
    }
    const sessions: Record<string, StrictSessionEntry> = {};
    for (const [key, entry] of Object.entries(
      obj.sessions as Record<string, unknown>,
    )) {
      if (!isValidStrictEntry(entry)) {
        const result: StrictReadResult = {
          kind: "degraded",
          code: "STRICT_MODE_SCHEMA_INVALID",
        };
        emitStrictDiagnostic(
          result.code,
          "strict-mode session entry failed schema validation",
        );
        strictModeCache = { result, readAt: now };
        return result;
      }
      sessions[key] = entry;
    }
    const state: StrictModeState = { version: 1, sessions };
    const result: StrictReadResult = { kind: "ok", state };
    strictModeCache = { result, readAt: now };
    return result;
  } catch {
    const result: StrictReadResult = {
      kind: "degraded",
      code: "STRICT_MODE_MALFORMED",
    };
    emitStrictDiagnostic(
      result.code,
      "strict-mode state file is not valid JSON; applying conservative fallback",
    );
    strictModeCache = { result, readAt: now };
    return result;
  }
}

function getStrictApprovalOverrides(
  filePath: string,
  sessionKey: string | undefined,
): string[] {
  if (!sessionKey) return [];
  const result = readStrictModeState(filePath);
  if (result.kind === "missing") return [];
  if (result.kind === "degraded") {
    // Malformed state must not silently disable configured protection.
    return [...CONSERVATIVE_STRICT_APPROVAL_ON];
  }
  const entry = result.state.sessions[sessionKey];
  if (!entry || !entry.strict) return [];
  if (new Date(entry.expiresAt).getTime() < Date.now()) return [];
  return entry.addedApprovalOn ?? [];
}

/** Test seam: reset the strict-mode read cache between tests. */
export function resetStrictModeCache(): void {
  strictModeCache = null;
}

function severityFor(classification: ClassificationResult): "info" | "warning" | "critical" {
  if (classification.decision === "block") return "critical";
  if (
    classification.classification.startsWith("fs.delete") ||
    classification.classification.startsWith("fs.write.protected") ||
    classification.classification.startsWith("exec.system-modify") ||
    classification.classification.startsWith("gateway.")
  ) {
    return "warning";
  }
  return "info";
}

function decide(
  config: FppPluginConfig,
  classification: ClassificationResult,
  strictOverrides: string[] = [],
): "block" | "approval" | "allow" {
  if (config.blockOn.includes(classification.classification)) return "block";
  if (config.approvalOn.includes(classification.classification)) return "approval";
  if (strictOverrides.includes(classification.classification)) return "approval";
  // If the classifier itself says block but config doesn't list it, honor the
  // classifier's recommendation but downgrade to approval rather than allow.
  // Preserves Law 1 even when an operator's config is loose.
  if (classification.decision === "block") return "approval";
  return classification.decision;
}

/** Test seam: decision helper used by the before_tool_call hook. */
export { decide };

function emitAuditGap(message: string): void {
  console.error(`FPP AUDIT-GAP: ${message}`);
}

function tryAppend(
  logPath: string,
  event: EnforcementEvent,
  outcome: EnforcementOutcome,
): { ok: true } | { ok: false; error: Error } {
  try {
    appendEnforcementEntry(logPath, event, outcome);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err as Error };
  }
}

/**
 * When audit persistence fails: fail-closed for high-risk / approval paths.
 * degraded-allow-low-risk may proceed only for classifier-allow decisions.
 */
function handleAuditFailure(
  config: FppPluginConfig,
  decision: "block" | "approval" | "allow",
  error: Error,
): { block: true; blockReason: string } | undefined {
  const highRisk = decision === "block" || decision === "approval";
  if (config.auditFailureBehavior === "fail-closed" || highRisk) {
    return {
      block: true,
      blockReason: `audit failure (fail-closed): ${error.message}`,
    };
  }
  emitAuditGap(
    `proceeding under degraded-allow-low-risk despite audit write failure: ${error.message}`,
  );
  return undefined;
}

/**
 * Test seam: register the enforcement hook against any api-like object.
 * Production entry calls this from definePluginEntry.register.
 */
export function registerEnforcement(api: {
  pluginConfig?: unknown;
  on: (
    event: string,
    handler: (...args: unknown[]) => unknown,
    opts?: { priority?: number },
  ) => void;
}): FppPluginConfig {
  const config = mergeConfig(api.pluginConfig);
  api.on(
    "before_tool_call",
    async (event: unknown, ctx: unknown) => {
      const e = event as {
        toolName: string;
        params?: Record<string, unknown>;
        runId?: string;
      };
      const c = ctx as {
        agentId?: string;
        runId?: string;
        sessionKey?: string;
        toolCallId?: string;
      };
      const classification = classifyToolCall(e.toolName, e.params ?? {}, {
        knownCustomTools: config.knownCustomTools,
      });
      const strictOverrides = config.respectTrustStrictMode
        ? getStrictApprovalOverrides(config.strictModeStatePath, c.sessionKey)
        : [];
      const decision = decide(config, classification, strictOverrides);

      const eventForAudit: EnforcementEvent = {
        toolName: e.toolName,
        agentId: c.agentId,
        runId: c.runId ?? e.runId,
        sessionKey: c.sessionKey,
        toolCallId: c.toolCallId,
        classification: classification.classification,
        decision,
        reason: classification.reason,
        constitutionHash: config.constitutionHash,
      };

      if (decision === "block") {
        const appended = tryAppend(config.auditLogPath, eventForAudit, "blocked");
        if (!appended.ok) {
          const failure = handleAuditFailure(config, decision, appended.error);
          if (failure) return failure;
        }
        return {
          block: true,
          blockReason: `${classification.classification}: ${classification.reason}`,
        };
      }

      if (decision === "approval") {
        const appended = tryAppend(
          config.auditLogPath,
          eventForAudit,
          "approval_requested",
        );
        if (!appended.ok) {
          const failure = handleAuditFailure(config, decision, appended.error);
          if (failure) return failure;
        }
        return {
          requireApproval: {
            title: buildTitle(classification),
            description: buildDescription(classification, e.toolName),
            severity: severityFor(classification),
            timeoutMs: config.approvalTimeoutMs,
            timeoutBehavior: config.approvalTimeoutBehavior,
            allowedDecisions: ["allow-once", "deny"],
            pluginId: "openclaw-fpp-plugin",
            onResolution: async (decisionResult: string) => {
              const outcome: EnforcementOutcome =
                decisionResult === "allow-once" || decisionResult === "allow-always"
                  ? "approved"
                  : decisionResult === "deny"
                    ? "denied"
                    : decisionResult === "timeout"
                      ? "timeout"
                      : "cancelled";
              const logged = tryAppend(
                config.auditLogPath,
                eventForAudit,
                outcome,
              );
              if (!logged.ok) {
                emitAuditGap(
                  `post-approval outcome logging failed (${outcome}): ${logged.error.message}. ` +
                    `Preserve the existing audit file; do not overwrite or restart the chain. ` +
                    `See docs/TROUBLESHOOTING.md.`,
                );
              }
            },
          },
        };
      }

      const allowedAppend = tryAppend(
        config.auditLogPath,
        eventForAudit,
        "allowed",
      );
      if (!allowedAppend.ok) {
        const failure = handleAuditFailure(
          config,
          decision,
          allowedAppend.error,
        );
        if (failure) return failure;
      }
      return;
    },
    { priority: 50 },
  );
  return config;
}

export const PLUGIN_APPROVAL_DESCRIPTION_MAX_LENGTH = 256;
export const PLUGIN_APPROVAL_TITLE_MAX_LENGTH = 80;

export function buildDescription(
  classification: ClassificationResult,
  toolName: string,
): string {
  const body = `${classification.classification}: ${classification.reason} [${toolName}]`;
  if (body.length <= PLUGIN_APPROVAL_DESCRIPTION_MAX_LENGTH) return body;
  return body.slice(0, PLUGIN_APPROVAL_DESCRIPTION_MAX_LENGTH - 3) + "...";
}

export function buildTitle(classification: ClassificationResult): string {
  const title = `FPP gate: ${classification.classification}`;
  if (title.length <= PLUGIN_APPROVAL_TITLE_MAX_LENGTH) return title;
  return title.slice(0, PLUGIN_APPROVAL_TITLE_MAX_LENGTH - 3) + "...";
}

const plugin: OpenClawPluginDefinition = definePluginEntry({
  id: "openclaw-fpp-plugin",
  name: "Freedom Preserving Protocol — Enforcement",
  description:
    "Gates tool calls through the five Freedom Preserving Laws via a before_tool_call hook.",
  register(api: OpenClawPluginApi) {
    registerEnforcement(api as Parameters<typeof registerEnforcement>[0]);
  },
});

export default plugin;

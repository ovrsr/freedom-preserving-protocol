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
 *   - Law 5 (scoped exploration): unknown tools are logged but allowed, with a note.
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";

import { classifyToolCall, type ClassificationResult } from "./risk-classifier.js";
import { mergeConfig, type FppPluginConfig } from "./config.js";
import { appendEnforcementEntry } from "./audit-log.js";

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
): "block" | "approval" | "allow" {
  if (config.blockOn.includes(classification.classification)) return "block";
  if (config.approvalOn.includes(classification.classification)) return "approval";
  // If the classifier itself says block but config doesn't list it, honor the
  // classifier's recommendation but downgrade to approval rather than allow.
  // Preserves Law 1 even when an operator's config is loose.
  if (classification.decision === "block") return "approval";
  return classification.decision;
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

export default definePluginEntry({
  id: "openclaw-fpp-plugin",
  name: "Freedom Preserving Protocol — Enforcement",
  description:
    "Gates tool calls through the five Freedom Preserving Laws via a before_tool_call hook.",
  register(api: OpenClawPluginApi) {
    const config = mergeConfig(api.pluginConfig);

    api.on(
      "before_tool_call",
      async (event, ctx) => {
        const classification = classifyToolCall(event.toolName, event.params);
        const decision = decide(config, classification);

        const eventForAudit = {
          toolName: event.toolName,
          agentId: ctx.agentId,
          runId: ctx.runId ?? event.runId,
          sessionKey: ctx.sessionKey,
          classification: classification.classification,
          decision,
          reason: classification.reason,
          constitutionHash: config.constitutionHash,
        };

        if (decision === "block") {
          appendEnforcementEntry(config.auditLogPath, eventForAudit, "blocked");
          return {
            block: true,
            blockReason: `${classification.classification}: ${classification.reason}`,
          };
        }

        if (decision === "approval") {
          appendEnforcementEntry(
            config.auditLogPath,
            eventForAudit,
            "approval_requested",
          );
          return {
            requireApproval: {
              title: buildTitle(classification),
              description: buildDescription(classification, event.toolName),
              severity: severityFor(classification),
              timeoutMs: config.approvalTimeoutMs,
              timeoutBehavior: config.approvalTimeoutBehavior,
              allowedDecisions: ["allow-once", "deny"],
              pluginId: "openclaw-fpp-plugin",
              onResolution: async (decisionResult) => {
                const outcome =
                  decisionResult === "allow-once" || decisionResult === "allow-always"
                    ? "approved"
                    : decisionResult === "deny"
                      ? "denied"
                      : decisionResult === "timeout"
                        ? "timeout"
                        : "cancelled";
                appendEnforcementEntry(config.auditLogPath, eventForAudit, outcome);
              },
            },
          };
        }

        appendEnforcementEntry(config.auditLogPath, eventForAudit, "allowed");
        return;
      },
      { priority: 50 },
    );
  },
});

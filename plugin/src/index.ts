/**
 * index.ts — OpenClaw adapter over @ovrsr/fpp-enforcement-core.
 *
 * Translates OpenClaw before_tool_call / after_tool_call hooks into the
 * harness-neutral FppRuntimeAdapter surface. Policy logic lives in core.
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type { OpenClawPluginApi, OpenClawPluginDefinition } from "openclaw/plugin-sdk/plugin-entry";

import {
  createEnforcementRuntime,
  legacyDecisionFromDisposition,
  resolveDisposition,
  isReversibleClassification,
  type ClassificationResult,
  type EnforcementRuntime,
  type FppPluginConfig,
  type FppRuntimeAdapter,
  type PendingReceiptRecord,
  type ReceiptSigner,
  type ReceiptStore,
  type SignedReceipt,
  buildRuntimeManifest,
  signReceiptPayload,
  loadReceiptSigner,
} from "@ovrsr/fpp-enforcement-core";
import { DIGEST_DOMAINS, digest, resolveWorkspaceRoot } from "@ovrsr/fpp-protocol-core";
import { readOpenClawPackageBuild } from "./runtime-manifest.js";

/** Process-local runtime (resettable in tests). */
let activeRuntime: EnforcementRuntime | null = null;

function openClawAdapter(): FppRuntimeAdapter {
  return {
    harnessId: "openclaw",
    getWorkspacePaths() {
      return { workspaceRoot: resolveWorkspaceRoot({ profile: "openclaw" }) };
    },
    // requestApproval is intentionally unused by core; OpenClaw surfaces
    // require_approval via the hook return value in operator-present mode.
  };
}

/** Always build a fresh runtime for the supplied config (test + reload safe). */
function createRuntime(pluginConfig: unknown): EnforcementRuntime {
  activeRuntime?.reset();
  activeRuntime = createEnforcementRuntime(pluginConfig, openClawAdapter(), {
    packageBuild: readOpenClawPackageBuild(),
    approvalTitle: buildTitle,
    approvalDescription: buildDescription,
  });
  return activeRuntime;
}

/** Test seam: reset receipt store / runtime between tests. */
export function resetReceiptStore(): void {
  activeRuntime?.reset();
  activeRuntime = null;
}

/** Test seam: inspect the active receipt store. */
export function getActiveReceiptStore(): ReceiptStore | null {
  return activeRuntime?.getReceiptStore() ?? null;
}

/** Test seam: inspect the active receipt signer. */
export function getActiveReceiptSigner(): ReceiptSigner | null {
  const runtime = activeRuntime;
  if (!runtime) return null;
  const config = runtime.getConfig();
  return loadReceiptSigner({
    keyPath: config.identityKeyPath,
    enabled: config.receiptSigningEnabled,
  });
}

export function buildSignedReceiptFromRecord(
  record: PendingReceiptRecord,
  config: FppPluginConfig,
  signer: ReceiptSigner,
): SignedReceipt {
  const runtime = buildRuntimeManifest({
    config,
    constitutionHash: config.constitutionHash,
    degraded: false,
    packageBuild: readOpenClawPackageBuild(),
  });
  const payload = {
    schemaVersion: 1 as const,
    receiptClass: "conformance" as const,
    actionDigest: record.actionDigest,
    policyId: runtime.policyId,
    policyVersion: runtime.policyVersion,
    implementationVersion: runtime.implementationVersion,
    disposition: record.disposition,
    authorization: record.authorization ?? "unresolved",
    outcome: record.outcome ?? "unknown",
    issuedAt: record.finalizedAt ?? record.proposedAt,
    classification: record.classification,
    receiptId: record.receiptId,
    toolCallId: record.toolCallId,
    correlationConfidence: record.correlationConfidence,
    constitutionHash: runtime.constitutionHash,
    classifierRulesetHash: runtime.classifierRulesetHash,
    effectiveConfigHash: runtime.effectiveConfigHash,
    packageBuildHash: runtime.packageBuildHash,
    pluginApiCompat: runtime.pluginApiCompat,
    runtimeState: runtime.runtimeState,
  };
  return signReceiptPayload(payload, signer);
}

export function digestExecutionOutcome(input: {
  error?: string | undefined;
  durationMs?: number | undefined;
  hasResult: boolean;
}): string {
  return digest({
    version: 2,
    domain: DIGEST_DOMAINS.receipt,
    value: {
      kind: "execution-outcome",
      hasResult: input.hasResult,
      errorPresent: Boolean(input.error),
      errorDigest: input.error
        ? digest({
            version: 2,
            domain: DIGEST_DOMAINS.receipt,
            value: { kind: "error-text", text: input.error.slice(0, 280) },
          })
        : null,
      durationMs:
        typeof input.durationMs === "number" ? input.durationMs : null,
    },
  });
}

export function reconcileOrphanedReceipts(
  config: FppPluginConfig,
  nowIso = new Date().toISOString(),
): PendingReceiptRecord[] {
  const runtime = activeRuntime ?? createRuntime(config);
  return runtime.reconcileOrphanedReceipts(nowIso);
}

/** Test seam: reset the strict-mode read cache between tests. */
export function resetStrictModeCache(): void {
  activeRuntime?.reset();
}

export { legacyDecisionFromDisposition };

/**
 * @deprecated Prefer resolveDisposition. Kept as a thin wrapper for callers
 * that still expect block | approval | allow.
 */
function decide(
  config: FppPluginConfig,
  classification: ClassificationResult,
  strictOverrides: string[] = [],
): "block" | "approval" | "allow" {
  const result = resolveDisposition({
    classification,
    config,
    strictOverrides,
    reversible: isReversibleClassification(classification.classification),
  });
  return legacyDecisionFromDisposition(result.disposition);
}

export { decide };

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
  const runtime = createRuntime(api.pluginConfig);
  const config = runtime.getConfig();

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
      const result = await runtime.onBeforeToolCall(
        {
          toolName: e.toolName,
          params: e.params,
          runId: e.runId,
          toolCallId: c.toolCallId,
        },
        {
          agentId: c.agentId,
          runId: c.runId ?? e.runId,
          sessionKey: c.sessionKey,
          toolCallId: c.toolCallId,
        },
      );

      if (result.action === "block") {
        return { block: true, blockReason: result.blockReason };
      }
      if (result.action === "require_approval") {
        return {
          requireApproval: {
            title: result.title,
            description: result.description,
            severity: result.severity,
            timeoutMs: result.timeoutMs,
            timeoutBehavior: result.timeoutBehavior,
            allowedDecisions: ["allow-once", "deny"] as ("allow-once" | "deny")[],
            pluginId: "openclaw-fpp-plugin",
            onResolution: result.onResolution,
          },
        };
      }
      return;
    },
    { priority: 50 },
  );

  api.on(
    "after_tool_call",
    async (event: unknown, ctx: unknown) => {
      const e = event as {
        toolName: string;
        params?: Record<string, unknown>;
        runId?: string;
        toolCallId?: string;
        result?: unknown;
        error?: string;
        durationMs?: number;
      };
      const c = ctx as {
        agentId?: string;
        runId?: string;
        sessionKey?: string;
        toolCallId?: string;
      };
      await runtime.onAfterToolCall(
        {
          toolName: e.toolName,
          params: e.params,
          runId: e.runId,
          toolCallId: c.toolCallId ?? e.toolCallId,
          result: e.result,
          error: e.error,
          durationMs: e.durationMs,
        },
        {
          agentId: c.agentId,
          runId: c.runId ?? e.runId,
          sessionKey: c.sessionKey,
          toolCallId: c.toolCallId ?? e.toolCallId,
        },
      );
    },
    { priority: 50 },
  );

  return config;
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

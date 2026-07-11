/**
 * Cursor adapter — FppRuntimeAdapter over Cursor preToolUse / beforeMCPExecution hooks.
 *
 * Strategy (verified against Cursor docs 2026-07): Cursor ships native agent hooks
 * (`preToolUse`, `postToolUse`, `beforeMCPExecution`, `afterMCPExecution`). This
 * adapter drives enforcement-core from those hooks via a command hook that reads
 * JSON on stdin and writes a permission decision on stdout. It does **not** invent
 * a Cursor extension API. Operator can disable hooks; cloud agents may defer some
 * MCP hooks — see adapters/harness-capabilities.json gradedGuarantee.
 */

import {
  createEnforcementRuntime,
  type EnforcementRuntime,
  type FppBeforeToolCallResult,
  type FppRuntimeAdapter,
} from "@ovrsr/fpp-enforcement-core";
import { resolveWorkspaceRoot } from "@ovrsr/fpp-protocol-core";

export const CURSOR_HARNESS_ID = "cursor" as const;
export const CURSOR_INTERCEPTION_STRATEGY = "cursor-hooks-preToolUse" as const;

export type CursorAdapterOptions = {
  workspaceRoot?: string | undefined;
};

export type CursorRuntimeAdapter = FppRuntimeAdapter & {
  interceptionStrategy: typeof CURSOR_INTERCEPTION_STRATEGY;
};

export type CursorHookEvent = {
  tool_name: string;
  tool_input?: Record<string, unknown> | undefined;
  tool_call_id?: string | undefined;
  session_id?: string | undefined;
};

export type CursorHookDecision = {
  permissionDecision: "allow" | "deny" | "ask";
  permissionDecisionReason?: string | undefined;
};

export function createCursorAdapter(
  options: CursorAdapterOptions = {},
): CursorRuntimeAdapter {
  const workspaceRoot =
    options.workspaceRoot ??
    resolveWorkspaceRoot({ profile: "cursor" });
  return {
    harnessId: CURSOR_HARNESS_ID,
    interceptionStrategy: CURSOR_INTERCEPTION_STRATEGY,
    getWorkspacePaths: () => ({ workspaceRoot }),
    // Cursor can surface "ask" via hook permissionDecision; core never calls
    // requestApproval. Unattended installs leave this undefined.
  };
}

export function createCursorRuntime(
  configInput: unknown,
  options: CursorAdapterOptions = {},
): EnforcementRuntime {
  return createEnforcementRuntime(configInput, createCursorAdapter(options));
}

/**
 * Map a Cursor/Claude-compatible PreToolUse stdin payload through enforcement-core.
 */
export async function handleCursorPreToolUse(
  runtime: EnforcementRuntime,
  event: CursorHookEvent,
): Promise<CursorHookDecision> {
  const toolCallId = event.tool_call_id ?? `cursor-${Date.now()}`;
  const result: FppBeforeToolCallResult = await runtime.onBeforeToolCall(
    {
      toolName: event.tool_name,
      params: event.tool_input ?? {},
      toolCallId,
    },
    {
      toolCallId,
      sessionKey: event.session_id,
      agentId: "cursor",
    },
  );

  if (result.action === "block") {
    return {
      permissionDecision: "deny",
      permissionDecisionReason: result.blockReason,
    };
  }
  if (result.action === "require_approval") {
    // Cursor hooks support "ask"; prefer that over inventing requestApproval UI.
    return {
      permissionDecision: "ask",
      permissionDecisionReason: result.description,
    };
  }
  return { permissionDecision: "allow" };
}

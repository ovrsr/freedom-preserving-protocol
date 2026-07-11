/**
 * Shared MCP / sidecar tool proxy for harnesses without (or in addition to)
 * native PreToolUse hooks. Wraps a downstream invoke with enforcement-core
 * before/after hooks so deny/abstain never reaches the tool.
 */

import type {
  EnforcementRuntime,
  FppToolCallContext,
} from "@ovrsr/fpp-enforcement-core";

export type ToolInvoke = (
  toolName: string,
  params: Record<string, unknown>,
) => Promise<unknown>;

export type ToolProxyCallContext = {
  toolCallId: string;
  agentId?: string | undefined;
  runId?: string | undefined;
  sessionKey?: string | undefined;
};

export class ToolProxyDeniedError extends Error {
  readonly blockReason: string;
  constructor(blockReason: string) {
    super(blockReason);
    this.name = "ToolProxyDeniedError";
    this.blockReason = blockReason;
  }
}

export type ToolProxy = {
  call: (
    toolName: string,
    params: Record<string, unknown>,
    ctx: ToolProxyCallContext,
  ) => Promise<unknown>;
};

/**
 * Create a proxy that runs `runtime.onBeforeToolCall` before `invoke` and
 * `onAfterToolCall` after. Block / require_approval never invoke downstream.
 */
export function createToolProxy(
  runtime: EnforcementRuntime,
  invoke: ToolInvoke,
): ToolProxy {
  return {
    async call(toolName, params, ctx) {
      const toolCtx: FppToolCallContext = {
        toolCallId: ctx.toolCallId,
        agentId: ctx.agentId,
        runId: ctx.runId,
        sessionKey: ctx.sessionKey,
      };
      const before = await runtime.onBeforeToolCall(
        { toolName, params, toolCallId: ctx.toolCallId },
        toolCtx,
      );

      if (before.action === "block") {
        throw new ToolProxyDeniedError(before.blockReason);
      }
      if (before.action === "require_approval") {
        throw new ToolProxyDeniedError(
          `require_approval not supported in tool-proxy: ${before.description}`,
        );
      }

      try {
        const result = await invoke(toolName, params);
        await runtime.onAfterToolCall(
          { toolName, params, toolCallId: ctx.toolCallId, result },
          toolCtx,
        );
        return result;
      } catch (err) {
        await runtime.onAfterToolCall(
          {
            toolName,
            params,
            toolCallId: ctx.toolCallId,
            error: err instanceof Error ? err.message : String(err),
          },
          toolCtx,
        );
        throw err;
      }
    },
  };
}

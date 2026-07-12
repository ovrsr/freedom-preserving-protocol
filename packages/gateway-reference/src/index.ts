/**
 * Non-default gateway-shaped reference stub for CI demos.
 *
 * NOT a production gateway. NOT an OpenClaw plugin. Opt-in via `enabled: true`.
 * Demonstrates tool-router → enforcement-core disposition before invoke.
 */

import type {
  EnforcementRuntime,
  FppToolCallContext,
} from "@ovrsr/fpp-enforcement-core";

export type GatewayInvoke = (
  toolName: string,
  params: Record<string, unknown>,
) => Promise<unknown>;

export type GatewayRouteContext = {
  toolCallId: string;
  agentId?: string | undefined;
  runId?: string | undefined;
  sessionKey?: string | undefined;
};

export class GatewayReferenceDisabledError extends Error {
  constructor(message = "gateway-reference is disabled (set enabled: true for CI demos only)") {
    super(message);
    this.name = "GatewayReferenceDisabledError";
  }
}

export class GatewayReferenceDeniedError extends Error {
  readonly blockReason: string;
  constructor(blockReason: string) {
    super(blockReason);
    this.name = "GatewayReferenceDeniedError";
    this.blockReason = blockReason;
  }
}

export type GatewayReferenceOptions = {
  /** Feature flag — default false. Must be explicitly true for demos. */
  enabled?: boolean | undefined;
  runtime: EnforcementRuntime;
  invoke: GatewayInvoke;
};

export type GatewayReferenceRouter = {
  readonly enabled: boolean;
  route: (
    toolName: string,
    params: Record<string, unknown>,
    ctx: GatewayRouteContext,
  ) => Promise<unknown>;
};

/**
 * Fake in-process tool-router that consults enforcement-core before invoke.
 * Default `enabled: false` so this package cannot be mistaken for a live gateway.
 */
export function createGatewayReferenceRouter(
  options: GatewayReferenceOptions,
): GatewayReferenceRouter {
  const enabled = options.enabled === true;
  const { runtime, invoke } = options;

  return {
    enabled,
    async route(toolName, params, ctx) {
      if (!enabled) {
        throw new GatewayReferenceDisabledError();
      }

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
        throw new GatewayReferenceDeniedError(before.blockReason);
      }
      if (before.action === "require_approval") {
        throw new GatewayReferenceDeniedError(
          `require_approval not supported in gateway-reference: ${before.description}`,
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

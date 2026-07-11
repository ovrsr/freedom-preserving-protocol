export {
  CURSOR_HARNESS_ID,
  CURSOR_INTERCEPTION_STRATEGY,
  createCursorAdapter,
  createCursorRuntime,
  handleCursorPreToolUse,
  type CursorAdapterOptions,
  type CursorHookDecision,
  type CursorHookEvent,
  type CursorRuntimeAdapter,
} from "./adapter.js";

/** Shared MCP/sidecar proxy for Cursor installs that prefer a tool gateway. */
export {
  createToolProxy,
  ToolProxyDeniedError,
  type ToolProxy,
  type ToolInvoke,
  type ToolProxyCallContext,
} from "@ovrsr/fpp-tool-proxy";

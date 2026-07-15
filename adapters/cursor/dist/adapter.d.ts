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
import { type EnforcementRuntime, type FppRuntimeAdapter } from "@ovrsr/fpp-enforcement-core";
export declare const CURSOR_HARNESS_ID: "cursor";
export declare const CURSOR_INTERCEPTION_STRATEGY: "cursor-hooks-preToolUse";
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
export declare function createCursorAdapter(options?: CursorAdapterOptions): CursorRuntimeAdapter;
export declare function createCursorRuntime(configInput: unknown, options?: CursorAdapterOptions): EnforcementRuntime;
/**
 * Map a Cursor/Claude-compatible PreToolUse stdin payload through enforcement-core.
 */
export declare function handleCursorPreToolUse(runtime: EnforcementRuntime, event: CursorHookEvent): Promise<CursorHookDecision>;
//# sourceMappingURL=adapter.d.ts.map
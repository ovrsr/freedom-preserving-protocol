/**
 * Codex adapter — FppRuntimeAdapter over Codex PreToolUse hooks.
 *
 * Strategy (OpenAI Codex hooks docs): `~/.codex/hooks.json` PreToolUse can deny
 * via permissionDecision or exit code 2. Coverage is graded — shell/Bash is the
 * reliable path; apply_patch and some MCP tools have historically had gaps.
 * Trigger frontmatter for skills remains partial. No operator approval UI →
 * force unattended defaults (no requestApproval).
 */
import { type EnforcementRuntime, type FppRuntimeAdapter } from "@ovrsr/fpp-enforcement-core";
export declare const CODEX_HARNESS_ID: "codex";
export declare const CODEX_INTERCEPTION_STRATEGY: "codex-hooks-PreToolUse";
export declare const CODEX_GRADED_GUARANTEE: string;
export type CodexAdapterOptions = {
    workspaceRoot?: string | undefined;
};
export type CodexRuntimeAdapter = FppRuntimeAdapter & {
    interceptionStrategy: typeof CODEX_INTERCEPTION_STRATEGY;
    gradedGuarantee: string;
};
export type CodexHookEvent = {
    tool_name: string;
    tool_input?: Record<string, unknown> | undefined;
    tool_call_id?: string | undefined;
    session_id?: string | undefined;
};
export type CodexHookDecision = {
    permissionDecision: "allow" | "deny";
    permissionDecisionReason?: string | undefined;
};
export declare function createCodexAdapter(options?: CodexAdapterOptions): CodexRuntimeAdapter;
export declare function createCodexRuntime(configInput: unknown, options?: CodexAdapterOptions): EnforcementRuntime;
export declare function handleCodexPreToolUse(runtime: EnforcementRuntime, event: CodexHookEvent): Promise<CodexHookDecision>;
//# sourceMappingURL=adapter.d.ts.map
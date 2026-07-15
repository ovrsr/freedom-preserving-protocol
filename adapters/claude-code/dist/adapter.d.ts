/**
 * Claude Code adapter — FppRuntimeAdapter over PreToolUse / PostToolUse hooks.
 *
 * Strategy (Anthropic Claude Code hooks docs): configure PreToolUse command hooks
 * in `.claude/settings.json`. Hook reads stdin JSON, returns hookSpecificOutput
 * with permissionDecision. Prompt-layer skills already work under `.claude/skills/`.
 * Operator can disable hooks or use `--dangerously-skip-permissions`.
 */
import { type EnforcementRuntime, type FppRuntimeAdapter } from "@ovrsr/fpp-enforcement-core";
export declare const CLAUDE_CODE_HARNESS_ID: "claude-code";
export declare const CLAUDE_CODE_INTERCEPTION_STRATEGY: "claude-code-hooks-PreToolUse";
export type ClaudeCodeAdapterOptions = {
    workspaceRoot?: string | undefined;
};
export type ClaudeCodeRuntimeAdapter = FppRuntimeAdapter & {
    interceptionStrategy: typeof CLAUDE_CODE_INTERCEPTION_STRATEGY;
};
export type ClaudeCodeHookEvent = {
    tool_name: string;
    tool_input?: Record<string, unknown> | undefined;
    tool_call_id?: string | undefined;
    session_id?: string | undefined;
};
export type ClaudeCodeHookDecision = {
    hookSpecificOutput: {
        hookEventName: "PreToolUse";
        permissionDecision: "allow" | "deny" | "ask";
        permissionDecisionReason?: string | undefined;
    };
};
export declare function createClaudeCodeAdapter(options?: ClaudeCodeAdapterOptions): ClaudeCodeRuntimeAdapter;
export declare function createClaudeCodeRuntime(configInput: unknown, options?: ClaudeCodeAdapterOptions): EnforcementRuntime;
export declare function handleClaudeCodePreToolUse(runtime: EnforcementRuntime, event: ClaudeCodeHookEvent): Promise<ClaudeCodeHookDecision>;
//# sourceMappingURL=adapter.d.ts.map
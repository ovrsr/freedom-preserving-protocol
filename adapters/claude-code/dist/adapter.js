/**
 * Claude Code adapter — FppRuntimeAdapter over PreToolUse / PostToolUse hooks.
 *
 * Strategy (Anthropic Claude Code hooks docs): configure PreToolUse command hooks
 * in `.claude/settings.json`. Hook reads stdin JSON, returns hookSpecificOutput
 * with permissionDecision. Prompt-layer skills already work under `.claude/skills/`.
 * Operator can disable hooks or use `--dangerously-skip-permissions`.
 */
import { createEnforcementRuntime, } from "@ovrsr/fpp-enforcement-core";
import { resolveWorkspaceRoot } from "@ovrsr/fpp-protocol-core";
export const CLAUDE_CODE_HARNESS_ID = "claude-code";
export const CLAUDE_CODE_INTERCEPTION_STRATEGY = "claude-code-hooks-PreToolUse";
export function createClaudeCodeAdapter(options = {}) {
    const workspaceRoot = options.workspaceRoot ??
        resolveWorkspaceRoot({ profile: "claude-code" });
    return {
        harnessId: CLAUDE_CODE_HARNESS_ID,
        interceptionStrategy: CLAUDE_CODE_INTERCEPTION_STRATEGY,
        getWorkspacePaths: () => ({ workspaceRoot }),
    };
}
export function createClaudeCodeRuntime(configInput, options = {}) {
    return createEnforcementRuntime(configInput, createClaudeCodeAdapter(options));
}
export async function handleClaudeCodePreToolUse(runtime, event) {
    const toolCallId = event.tool_call_id ?? `claude-${Date.now()}`;
    const result = await runtime.onBeforeToolCall({
        toolName: event.tool_name,
        params: event.tool_input ?? {},
        toolCallId,
    }, {
        toolCallId,
        sessionKey: event.session_id,
        agentId: "claude-code",
    });
    if (result.action === "block") {
        return {
            hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: "deny",
                permissionDecisionReason: result.blockReason,
            },
        };
    }
    if (result.action === "require_approval") {
        return {
            hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: "ask",
                permissionDecisionReason: result.description,
            },
        };
    }
    return {
        hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "allow",
        },
    };
}
//# sourceMappingURL=adapter.js.map
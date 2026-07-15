/**
 * Codex adapter — FppRuntimeAdapter over Codex PreToolUse hooks.
 *
 * Strategy (OpenAI Codex hooks docs): `~/.codex/hooks.json` PreToolUse can deny
 * via permissionDecision or exit code 2. Coverage is graded — shell/Bash is the
 * reliable path; apply_patch and some MCP tools have historically had gaps.
 * Trigger frontmatter for skills remains partial. No operator approval UI →
 * force unattended defaults (no requestApproval).
 */
import { createEnforcementRuntime, } from "@ovrsr/fpp-enforcement-core";
import { resolveWorkspaceRoot } from "@ovrsr/fpp-protocol-core";
export const CODEX_HARNESS_ID = "codex";
export const CODEX_INTERCEPTION_STRATEGY = "codex-hooks-PreToolUse";
export const CODEX_GRADED_GUARANTEE = "Codex PreToolUse hooks enforce dispositions for shell/Bash reliably; " +
    "apply_patch and some MCP paths may have incomplete coverage. " +
    "Skill trigger frontmatter remains partial. Unattended defaults (no approval UI).";
export function createCodexAdapter(options = {}) {
    const workspaceRoot = options.workspaceRoot ?? resolveWorkspaceRoot({ profile: "codex" });
    return {
        harnessId: CODEX_HARNESS_ID,
        interceptionStrategy: CODEX_INTERCEPTION_STRATEGY,
        gradedGuarantee: CODEX_GRADED_GUARANTEE,
        getWorkspacePaths: () => ({ workspaceRoot }),
        // No Codex operator approval UI for FPP — unattended only.
    };
}
export function createCodexRuntime(configInput, options = {}) {
    // Force unattended when config omits dispositionMode.
    const input = configInput && typeof configInput === "object"
        ? {
            dispositionMode: "unattended",
            ...configInput,
        }
        : { dispositionMode: "unattended" };
    return createEnforcementRuntime(input, createCodexAdapter(options));
}
export async function handleCodexPreToolUse(runtime, event) {
    const toolCallId = event.tool_call_id ?? `codex-${Date.now()}`;
    const result = await runtime.onBeforeToolCall({
        toolName: event.tool_name,
        params: event.tool_input ?? {},
        toolCallId,
    }, {
        toolCallId,
        sessionKey: event.session_id,
        agentId: "codex",
    });
    if (result.action === "block" || result.action === "require_approval") {
        // Codex has no FPP approval UI — treat require_approval as deny (fail-closed).
        const reason = result.action === "block"
            ? result.blockReason
            : `require_approval not supported on Codex adapter: ${result.description}`;
        return {
            permissionDecision: "deny",
            permissionDecisionReason: reason,
        };
    }
    return { permissionDecision: "allow" };
}
//# sourceMappingURL=adapter.js.map
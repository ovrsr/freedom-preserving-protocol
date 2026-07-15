#!/usr/bin/env npx tsx
/**
 * Claude Code PreToolUse hook CLI — stdin JSON → hookSpecificOutput JSON.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClaudeCodeRuntime, handleClaudeCodePreToolUse, } from "./adapter.js";
import { workspaceFile } from "@ovrsr/fpp-protocol-core";
async function readStdin() {
    const chunks = [];
    for await (const chunk of process.stdin) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf8");
}
function loadConfig() {
    const configPath = process.env.FPP_ENFORCEMENT_CONFIG?.trim() ||
        workspaceFile("fpp-enforcement.json", { profile: "claude-code" });
    const resolved = resolve(configPath);
    if (existsSync(resolved)) {
        return JSON.parse(readFileSync(resolved, "utf8"));
    }
    return {
        dispositionMode: "unattended",
        auditLogPath: workspaceFile("fpp-plugin-audit.jsonl", {
            profile: "claude-code",
        }),
        receiptLogPath: workspaceFile("fpp-receipts.jsonl", {
            profile: "claude-code",
        }),
        identityKeyPath: workspaceFile("agent.key", { profile: "claude-code" }),
        mandateStorePath: workspaceFile("fpp-mandates.json", {
            profile: "claude-code",
        }),
        strictModeStatePath: workspaceFile("fpp-strict-mode.json", {
            profile: "claude-code",
        }),
    };
}
async function main() {
    const raw = await readStdin();
    if (!raw.trim()) {
        process.stdout.write(JSON.stringify({
            hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: "allow",
            },
        }));
        return;
    }
    const event = JSON.parse(raw);
    const decision = await handleClaudeCodePreToolUse(createClaudeCodeRuntime(loadConfig()), event);
    process.stdout.write(JSON.stringify(decision));
}
main().catch((err) => {
    console.error(String(err));
    process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: `FPP hook error: ${err.message}`,
        },
    }));
});
//# sourceMappingURL=hook-cli.js.map
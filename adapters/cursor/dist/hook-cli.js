#!/usr/bin/env npx tsx
/**
 * Cursor / Claude-compatible PreToolUse hook CLI.
 * Reads JSON event from stdin; writes permission decision JSON to stdout.
 *
 * Usage (from repo root):
 *   npx tsx adapters/cursor/src/hook-cli.ts
 *   npx tsx adapters/cursor/src/hook-cli.ts --after
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createCursorRuntime, handleCursorPreToolUse } from "./adapter.js";
import { workspaceFile, resolveWorkspaceRoot, } from "@ovrsr/fpp-protocol-core";
import { assertConfigPathAllowed } from "@ovrsr/fpp-enforcement-core";
async function readStdin() {
    const chunks = [];
    for await (const chunk of process.stdin) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf8");
}
function loadConfig() {
    const profile = "cursor";
    const wsRoot = resolve(resolveWorkspaceRoot({ profile }));
    const envPath = process.env.FPP_ENFORCEMENT_CONFIG?.trim();
    const configPath = envPath
        ? assertConfigPathAllowed({
            configPath: envPath,
            workspaceRoot: wsRoot,
        })
        : resolve(workspaceFile("fpp-enforcement.json", { profile }));
    if (existsSync(configPath)) {
        return JSON.parse(readFileSync(configPath, "utf8"));
    }
    return {
        dispositionMode: "unattended",
        auditLogPath: workspaceFile("fpp-plugin-audit.jsonl", { profile }),
        receiptLogPath: workspaceFile("fpp-receipts.jsonl", { profile }),
        identityKeyPath: workspaceFile("agent.key", { profile }),
        mandateStorePath: workspaceFile("fpp-mandates.json", { profile }),
        strictModeStatePath: workspaceFile("fpp-strict-mode.json", {
            profile,
        }),
    };
}
async function main() {
    const after = process.argv.includes("--after");
    const raw = await readStdin();
    if (!raw.trim()) {
        process.stdout.write(JSON.stringify({ permissionDecision: "allow" }));
        return;
    }
    const event = JSON.parse(raw);
    const runtime = createCursorRuntime(loadConfig());
    if (after) {
        const toolCallId = event.tool_call_id ?? `cursor-after-${Date.now()}`;
        await runtime.onAfterToolCall({
            toolName: event.tool_name,
            params: event.tool_input ?? {},
            toolCallId,
            error: event.error,
        }, { toolCallId, agentId: "cursor" });
        process.stdout.write(JSON.stringify({ continue: true }));
        return;
    }
    const decision = await handleCursorPreToolUse(runtime, event);
    process.stdout.write(JSON.stringify(decision));
}
main().catch((err) => {
    console.error(String(err));
    // Fail-closed on hook errors for security-critical governance.
    process.stdout.write(JSON.stringify({
        permissionDecision: "deny",
        permissionDecisionReason: `FPP hook error: ${err.message}`,
    }));
    process.exit(0);
});
//# sourceMappingURL=hook-cli.js.map
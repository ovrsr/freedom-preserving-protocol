#!/usr/bin/env npx tsx
/**
 * Codex PreToolUse hook CLI — stdin JSON → permissionDecision JSON.
 * Exit code 2 is an alternate deny signal; we prefer JSON for clarity.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createCodexRuntime, handleCodexPreToolUse } from "./adapter.js";
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
    const profile = "codex";
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
    const raw = await readStdin();
    if (!raw.trim()) {
        process.stdout.write(JSON.stringify({ permissionDecision: "allow" }));
        return;
    }
    const event = JSON.parse(raw);
    const decision = await handleCodexPreToolUse(createCodexRuntime(loadConfig()), event);
    process.stdout.write(JSON.stringify(decision));
    if (decision.permissionDecision === "deny") {
        process.exitCode = 2;
    }
}
main().catch((err) => {
    console.error(String(err));
    process.stdout.write(JSON.stringify({
        permissionDecision: "deny",
        permissionDecisionReason: `FPP hook error: ${err.message}`,
    }));
    process.exit(2);
});
//# sourceMappingURL=hook-cli.js.map
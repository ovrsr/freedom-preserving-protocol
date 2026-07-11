#!/usr/bin/env npx tsx
/**
 * Codex PreToolUse hook CLI — stdin JSON → permissionDecision JSON.
 * Exit code 2 is an alternate deny signal; we prefer JSON for clarity.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createCodexRuntime, handleCodexPreToolUse } from "./adapter.js";
import { workspaceFile } from "@ovrsr/fpp-protocol-core";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function loadConfig(): unknown {
  const configPath =
    process.env.FPP_ENFORCEMENT_CONFIG?.trim() ||
    workspaceFile("fpp-enforcement.json", { profile: "codex" });
  const resolved = resolve(configPath);
  if (existsSync(resolved)) {
    return JSON.parse(readFileSync(resolved, "utf8"));
  }
  return {
    dispositionMode: "unattended",
    auditLogPath: workspaceFile("fpp-plugin-audit.jsonl", { profile: "codex" }),
    receiptLogPath: workspaceFile("fpp-receipts.jsonl", { profile: "codex" }),
    identityKeyPath: workspaceFile("agent.key", { profile: "codex" }),
    mandateStorePath: workspaceFile("fpp-mandates.json", { profile: "codex" }),
    strictModeStatePath: workspaceFile("fpp-strict-mode.json", {
      profile: "codex",
    }),
  };
}

async function main(): Promise<void> {
  const raw = await readStdin();
  if (!raw.trim()) {
    process.stdout.write(JSON.stringify({ permissionDecision: "allow" }));
    return;
  }
  const event = JSON.parse(raw) as {
    tool_name: string;
    tool_input?: Record<string, unknown>;
    tool_call_id?: string;
    session_id?: string;
  };
  const decision = await handleCodexPreToolUse(
    createCodexRuntime(loadConfig()),
    event,
  );
  process.stdout.write(JSON.stringify(decision));
  if (decision.permissionDecision === "deny") {
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(String(err));
  process.stdout.write(
    JSON.stringify({
      permissionDecision: "deny",
      permissionDecisionReason: `FPP hook error: ${(err as Error).message}`,
    }),
  );
  process.exit(2);
});

#!/usr/bin/env npx tsx
/**
 * Claude Code PreToolUse hook CLI — stdin JSON → hookSpecificOutput JSON.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  createClaudeCodeRuntime,
  handleClaudeCodePreToolUse,
} from "./adapter.js";
import {
  workspaceFile,
  resolveWorkspaceRoot,
} from "@ovrsr/fpp-protocol-core";
import { assertConfigPathAllowed } from "@ovrsr/fpp-enforcement-core";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function loadConfig(): unknown {
  const profile = "claude-code";
  const wsRoot = resolve(resolveWorkspaceRoot({ profile }));
  const envPath = process.env.FPP_ENFORCEMENT_CONFIG?.trim();
  const configPath = envPath
    ? assertConfigPathAllowed({
        configPath: envPath,
        workspaceRoot: wsRoot,
      })
    : resolve(
        workspaceFile("fpp-enforcement.json", { profile }),
      );
  if (existsSync(configPath)) {
    return JSON.parse(readFileSync(configPath, "utf8"));
  }
  return {
    dispositionMode: "unattended",
    auditLogPath: workspaceFile("fpp-plugin-audit.jsonl", {
      profile,
    }),
    receiptLogPath: workspaceFile("fpp-receipts.jsonl", {
      profile,
    }),
    identityKeyPath: workspaceFile("agent.key", { profile }),
    mandateStorePath: workspaceFile("fpp-mandates.json", {
      profile,
    }),
    strictModeStatePath: workspaceFile("fpp-strict-mode.json", {
      profile,
    }),
  };
}

async function main(): Promise<void> {
  const raw = await readStdin();
  if (!raw.trim()) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
        },
      }),
    );
    return;
  }
  const event = JSON.parse(raw) as {
    tool_name: string;
    tool_input?: Record<string, unknown>;
    tool_call_id?: string;
    session_id?: string;
  };
  const decision = await handleClaudeCodePreToolUse(
    createClaudeCodeRuntime(loadConfig()),
    event,
  );
  process.stdout.write(JSON.stringify(decision));
}

main().catch((err) => {
  console.error(String(err));
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `FPP hook error: ${(err as Error).message}`,
      },
    }),
  );
});

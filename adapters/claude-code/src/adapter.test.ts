/**
 * Claude Code adapter tests — unattended disposition path.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createClaudeCodeAdapter,
  createClaudeCodeRuntime,
  handleClaudeCodePreToolUse,
} from "./adapter.js";

describe("Claude Code FppRuntimeAdapter", () => {
  const wsPath = mkdtempSync(join(tmpdir(), "fpp-claude-"));
  after(() => rmSync(wsPath, { recursive: true, force: true }));

  function config() {
    return {
      auditLogPath: join(wsPath, "audit.jsonl"),
      receiptLogPath: join(wsPath, "receipts.jsonl"),
      identityKeyPath: join(wsPath, "agent.key"),
      mandateStorePath: join(wsPath, "mandates.json"),
      strictModeStatePath: join(wsPath, "strict.json"),
      dispositionMode: "unattended" as const,
    };
  }

  it("exposes harnessId claude-code", () => {
    const adapter = createClaudeCodeAdapter({ workspaceRoot: wsPath });
    assert.equal(adapter.harnessId, "claude-code");
    assert.equal(
      adapter.interceptionStrategy,
      "claude-code-hooks-PreToolUse",
    );
  });

  it("abstains (blocks) hard-floor calls in unattended mode", async () => {
    const cfg = config();
    const runtime = createClaudeCodeRuntime(cfg, { workspaceRoot: wsPath });
    const result = await runtime.onBeforeToolCall(
      {
        toolName: "Bash",
        params: { command: "rm -rf ~/.ssh/id_ed25519" },
        toolCallId: "cc-1",
      },
      { toolCallId: "cc-1" },
    );
    assert.equal(result.action, "block");
    assert.equal(existsSync(cfg.auditLogPath), true);
  });

  it("handleClaudeCodePreToolUse returns Claude hookSpecificOutput shape", async () => {
    const runtime = createClaudeCodeRuntime(config(), {
      workspaceRoot: wsPath,
    });
    const denied = await handleClaudeCodePreToolUse(runtime, {
      tool_name: "Bash",
      tool_input: { command: "rm -rf ~/.ssh/id_ed25519" },
      tool_call_id: "cc-hook-1",
    });
    assert.equal(denied.hookSpecificOutput.hookEventName, "PreToolUse");
    assert.equal(denied.hookSpecificOutput.permissionDecision, "deny");

    const allowed = await handleClaudeCodePreToolUse(runtime, {
      tool_name: "Bash",
      tool_input: { command: "echo hello" },
      tool_call_id: "cc-hook-2",
    });
    assert.equal(allowed.hookSpecificOutput.permissionDecision, "allow");
  });
});

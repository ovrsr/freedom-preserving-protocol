/**
 * Cursor adapter tests — fake tool call → disposition → receipt under profile cursor.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createCursorAdapter,
  createCursorRuntime,
  handleCursorPreToolUse,
} from "./adapter.js";

describe("Cursor FppRuntimeAdapter", () => {
  const wsPath = mkdtempSync(join(tmpdir(), "fpp-cursor-"));
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

  it("exposes harnessId cursor and workspace profile cursor", () => {
    const adapter = createCursorAdapter({ workspaceRoot: wsPath });
    assert.equal(adapter.harnessId, "cursor");
    assert.equal(adapter.getWorkspacePaths().workspaceRoot, wsPath);
    assert.equal(adapter.interceptionStrategy, "cursor-hooks-preToolUse");
  });

  it("blocks hard-floor tool calls and records a receipt", async () => {
    const cfg = config();
    const runtime = createCursorRuntime(cfg, { workspaceRoot: wsPath });
    const result = await runtime.onBeforeToolCall(
      {
        toolName: "Shell",
        params: { command: "rm -rf ~/.ssh/id_ed25519" },
        toolCallId: "cursor-tc-1",
      },
      { toolCallId: "cursor-tc-1", agentId: "cursor-agent" },
    );
    assert.equal(result.action, "block");
    assert.equal(existsSync(cfg.auditLogPath), true);
  });

  it("handleCursorPreToolUse maps Cursor hook stdin to deny/allow JSON", async () => {
    const runtime = createCursorRuntime(config(), { workspaceRoot: wsPath });
    const denied = await handleCursorPreToolUse(runtime, {
      tool_name: "Shell",
      tool_input: { command: "rm -rf ~/.ssh/id_ed25519" },
      tool_call_id: "hook-1",
    });
    assert.equal(denied.permissionDecision, "deny");
    assert.ok(denied.permissionDecisionReason);

    const allowed = await handleCursorPreToolUse(runtime, {
      tool_name: "Shell",
      tool_input: { command: "echo hello" },
      tool_call_id: "hook-2",
    });
    assert.equal(allowed.permissionDecision, "allow");
  });

  it("does not expose requestApproval (unattended default; ask via hook ask)", () => {
    const adapter = createCursorAdapter({ workspaceRoot: wsPath });
    assert.equal(adapter.requestApproval, undefined);
  });
});

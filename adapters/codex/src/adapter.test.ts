/**
 * Codex adapter tests — graded guarantees; unattended defaults.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createCodexAdapter,
  createCodexRuntime,
  handleCodexPreToolUse,
} from "./adapter.js";

describe("Codex FppRuntimeAdapter", () => {
  const wsPath = mkdtempSync(join(tmpdir(), "fpp-codex-"));
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

  it("exposes harnessId codex with graded coverage note", () => {
    const adapter = createCodexAdapter({ workspaceRoot: wsPath });
    assert.equal(adapter.harnessId, "codex");
    assert.equal(adapter.interceptionStrategy, "codex-hooks-PreToolUse");
    assert.ok(adapter.gradedGuarantee.includes("shell"));
    assert.equal(adapter.requestApproval, undefined);
  });

  it("blocks hard-floor Bash calls and writes audit", async () => {
    const cfg = config();
    const runtime = createCodexRuntime(cfg, { workspaceRoot: wsPath });
    const result = await runtime.onBeforeToolCall(
      {
        toolName: "Bash",
        params: { command: "rm -rf ~/.ssh/id_ed25519" },
        toolCallId: "codex-1",
      },
      { toolCallId: "codex-1" },
    );
    assert.equal(result.action, "block");
    assert.equal(existsSync(cfg.auditLogPath), true);
  });

  it("handleCodexPreToolUse maps to permissionDecision deny/allow", async () => {
    const runtime = createCodexRuntime(config(), { workspaceRoot: wsPath });
    const denied = await handleCodexPreToolUse(runtime, {
      tool_name: "Bash",
      tool_input: { command: "rm -rf ~/.ssh/id_ed25519" },
      tool_call_id: "cx-1",
    });
    assert.equal(denied.permissionDecision, "deny");

    const allowed = await handleCodexPreToolUse(runtime, {
      tool_name: "Bash",
      tool_input: { command: "echo hello" },
      tool_call_id: "cx-2",
    });
    assert.equal(allowed.permissionDecision, "allow");
  });
});

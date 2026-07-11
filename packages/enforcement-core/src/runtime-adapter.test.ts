import assert from "node:assert/strict";
import { describe, it, after } from "node:test";
import { join } from "node:path";
import {
  createEnforcementRuntime,
  type FppRuntimeAdapter,
  type FppBeforeToolCallResult,
} from "./runtime-adapter.js";
import { createTempWorkspace } from "./test-helpers.js";

function fakeAdapter(harnessId = "test"): FppRuntimeAdapter {
  return {
    harnessId,
    getWorkspacePaths() {
      return { workspaceRoot: "/tmp/fpp-test" };
    },
  };
}

describe("FppRuntimeAdapter / createEnforcementRuntime", () => {
  const ws = createTempWorkspace("fpp-runtime-");
  after(() => ws.cleanup());

  it("exposes harnessId from the adapter without OpenClaw types", () => {
    const adapter = fakeAdapter("generic");
    const runtime = createEnforcementRuntime(
      {
        auditLogPath: join(ws.path, "audit.jsonl"),
        receiptLogPath: join(ws.path, "receipts.jsonl"),
        identityKeyPath: join(ws.path, "agent.key"),
        mandateStorePath: join(ws.path, "mandates.json"),
        strictModeStatePath: join(ws.path, "strict.json"),
        dispositionMode: "unattended",
      },
      adapter,
    );
    assert.equal(runtime.adapter.harnessId, "generic");
    assert.equal(runtime.getConfig().dispositionMode, "unattended");
  });

  it("blocks hard-floor classifications via onBeforeToolCall", async () => {
    const runtime = createEnforcementRuntime(
      {
        auditLogPath: join(ws.path, "audit2.jsonl"),
        receiptLogPath: join(ws.path, "receipts2.jsonl"),
        identityKeyPath: join(ws.path, "agent2.key"),
        mandateStorePath: join(ws.path, "mandates2.json"),
        strictModeStatePath: join(ws.path, "strict2.json"),
        dispositionMode: "unattended",
      },
      fakeAdapter(),
    );
    const result: FppBeforeToolCallResult = await runtime.onBeforeToolCall(
      {
        toolName: "filesystem_delete",
        params: { path: "~/.ssh/id_ed25519" },
        toolCallId: "tc-1",
      },
      { agentId: "agent-a", toolCallId: "tc-1" },
    );
    assert.equal(result.action, "block");
    if (result.action === "block") {
      assert.match(result.blockReason, /fs\.delete\.protected|block/i);
    }
  });

  it("returns require_approval only in operator-present mode", async () => {
    const runtime = createEnforcementRuntime(
      {
        auditLogPath: join(ws.path, "audit3.jsonl"),
        receiptLogPath: join(ws.path, "receipts3.jsonl"),
        identityKeyPath: join(ws.path, "agent3.key"),
        mandateStorePath: join(ws.path, "mandates3.json"),
        strictModeStatePath: join(ws.path, "strict3.json"),
        dispositionMode: "operator-present",
        approvalOn: ["fs.write.workspace"],
      },
      fakeAdapter(),
    );
    const result = await runtime.onBeforeToolCall(
      {
        toolName: "filesystem_write",
        params: { path: ".openclaw/workspace/notes.md", content: "x" },
        toolCallId: "tc-2",
      },
      { toolCallId: "tc-2" },
    );
    assert.equal(result.action, "require_approval");
  });

  it("does not call requestApproval in unattended mode for staged allows", async () => {
    let approvalCalls = 0;
    const adapter: FppRuntimeAdapter = {
      harnessId: "test",
      getWorkspacePaths: () => ({ workspaceRoot: ws.path }),
      async requestApproval() {
        approvalCalls += 1;
        return "allow-once";
      },
    };
    const runtime = createEnforcementRuntime(
      {
        auditLogPath: join(ws.path, "audit4.jsonl"),
        receiptLogPath: join(ws.path, "receipts4.jsonl"),
        identityKeyPath: join(ws.path, "agent4.key"),
        mandateStorePath: join(ws.path, "mandates4.json"),
        strictModeStatePath: join(ws.path, "strict4.json"),
        dispositionMode: "unattended",
      },
      adapter,
    );
    const result = await runtime.onBeforeToolCall(
      {
        toolName: "filesystem_write",
        params: { path: ".openclaw/workspace/tmp/scratch.txt", content: "x" },
        toolCallId: "tc-3",
      },
      { toolCallId: "tc-3" },
    );
    assert.notEqual(result.action, "require_approval");
    assert.equal(approvalCalls, 0);
  });
});

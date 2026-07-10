import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { registerEnforcement } from "./index.js";
import { createHookCapture, createTempWorkspace } from "./test-helpers.js";

describe("enforcement hook integration", () => {
  const ws = createTempWorkspace("fpp-hook-");
  const auditLogPath = join(ws.path, "audit.jsonl");

  after(() => ws.cleanup());

  function setup() {
    const capture = createHookCapture({
      auditLogPath,
      respectTrustStrictMode: false,
    });
    registerEnforcement(capture.api);
    assert.equal(capture.hooks.length, 1);
    assert.equal(capture.hooks[0]!.event, "before_tool_call");
    return capture.hooks[0]!.handler;
  }

  const ctx = {
    agentId: "agent-xyz",
    runId: "run-xyz",
    sessionKey: "session-xyz",
    toolCallId: "call-xyz",
  };

  it("blocks protected deletes and retains correlation ids", async () => {
    const handler = setup();
    const result = (await handler(
      {
        toolName: "filesystem_delete",
        params: { path: "/home/user/.ssh/id_ed25519" },
        runId: "event-run",
      },
      ctx,
    )) as { block?: boolean };
    assert.equal(result.block, true);
    const line = JSON.parse(readFileSync(auditLogPath, "utf8").trim().split("\n").at(-1)!);
    assert.equal(line.outcome, "blocked");
    assert.equal(line.agentId, "agent-xyz");
    assert.equal(line.runId, "run-xyz");
    assert.equal(line.sessionKey, "session-xyz");
    assert.equal(line.toolCallId, "call-xyz");
  });

  it("requests approval and logs onResolution approved", async () => {
    const handler = setup();
    const result = (await handler(
      {
        toolName: "filesystem_delete",
        params: { path: ".openclaw/workspace/tmp/scratch.txt" },
      },
      ctx,
    )) as {
      requireApproval?: { onResolution: (d: string) => Promise<void> };
    };
    assert.ok(result.requireApproval);
    await result.requireApproval!.onResolution("allow-once");
    const lines = readFileSync(auditLogPath, "utf8").trim().split("\n");
    const outcomes = lines.map((l) => JSON.parse(l).outcome);
    assert.ok(outcomes.includes("approval_requested"));
    assert.ok(outcomes.includes("approved"));
    const requested = lines
      .map((l) => JSON.parse(l))
      .find((e) => e.outcome === "approval_requested");
    assert.equal(requested.toolCallId, "call-xyz");
  });

  it("fakes deny resolution and logs denied outcome", async () => {
    const handler = setup();
    const result = (await handler(
      {
        toolName: "filesystem_delete",
        params: { path: ".openclaw/workspace/tmp/scratch.txt" },
      },
      ctx,
    )) as {
      requireApproval?: { onResolution: (d: string) => Promise<void> };
    };
    assert.ok(result.requireApproval);
    await result.requireApproval!.onResolution("deny");
    const outcomes = readFileSync(auditLogPath, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l).outcome);
    assert.ok(outcomes.includes("denied"));
  });

  it("allows benign reads and logs allowed", async () => {
    const handler = setup();
    const result = await handler(
      {
        toolName: "filesystem_read",
        params: { path: ".openclaw/workspace/notes.md" },
      },
      ctx,
    );
    assert.equal(result, undefined);
    const line = JSON.parse(readFileSync(auditLogPath, "utf8").trim().split("\n").at(-1)!);
    assert.equal(line.outcome, "allowed");
    assert.equal(line.decision, "allow");
    assert.equal(line.toolCallId, "call-xyz");
  });
});

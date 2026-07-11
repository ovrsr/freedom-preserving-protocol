/**
 * End-to-end security regression suite for the enforcement plugin.
 * Each case maps to a demonstrated Plan 4 finding. Do not weaken these
 * assertions without updating docs/CAPABILITY_STATUS.md.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { registerEnforcement, resetStrictModeCache, decide } from "./index.js";
import { classifyToolCall } from "./risk-classifier.js";
import { mergeConfig, DEFAULT_CONFIG } from "./config.js";
import {
  appendEnforcementEntry,
  AuditCorruptionError,
} from "./audit-log.js";
import { createHookCapture, createTempWorkspace } from "./test-helpers.js";

describe("security regressions (enforcement)", () => {
  const ws = createTempWorkspace("fpp-sec-enf-");
  after(() => ws.cleanup());

  const ctx = {
    agentId: "agent-sec",
    runId: "run-sec",
    sessionKey: "session-sec",
    toolCallId: "call-sec",
  };

  it("REGRESSION: unknown tools require approval (not allow)", async () => {
    resetStrictModeCache();
    const capture = createHookCapture({
      auditLogPath: join(ws.path, "unknown-audit.jsonl"),
      respectTrustStrictMode: false,
    });
    registerEnforcement(capture.api);
    const handler = capture.hooks[0]!.handler;
    const result = (await handler(
      { toolName: "some_custom_tool_xyz", params: { foo: "bar" } },
      ctx,
    )) as { requireApproval?: unknown } | undefined;
    assert.ok(result && result.requireApproval);
    const classification = classifyToolCall("some_custom_tool_xyz", {});
    assert.equal(classification.decision, "approval");
  });

  it("REGRESSION: corrupted audit tail does not silently reset the chain", () => {
    const corruptPath = join(ws.path, "corrupt-chain.jsonl");
    writeFileSync(corruptPath, "{broken\n", "utf8");
    assert.throws(
      () =>
        appendEnforcementEntry(
          corruptPath,
          {
            toolName: "filesystem_delete",
            classification: "fs.delete.protected",
            decision: "block",
            reason: "test",
            constitutionHash: "abc",
          },
          "blocked",
        ),
      (err: unknown) => err instanceof AuditCorruptionError,
    );
    assert.equal(readFileSync(corruptPath, "utf8").trim(), "{broken");
  });

  it("REGRESSION: high-risk call blocked when audit is corrupted (fail-closed)", async () => {
    resetStrictModeCache();
    const corruptPath = join(ws.path, "corrupt-hook.jsonl");
    writeFileSync(corruptPath, "CORRUPT\n", "utf8");
    const capture = createHookCapture({
      auditLogPath: corruptPath,
      respectTrustStrictMode: false,
      auditFailureBehavior: "fail-closed",
    });
    registerEnforcement(capture.api);
    const handler = capture.hooks[0]!.handler;
    const result = (await handler(
      {
        toolName: "filesystem_delete",
        params: { path: "/home/user/.ssh/id_ed25519" },
      },
      ctx,
    )) as { block?: boolean; blockReason?: string };
    assert.equal(result.block, true);
    assert.match(result.blockReason ?? "", /audit/i);
    assert.equal(readFileSync(corruptPath, "utf8").trim(), "CORRUPT");
  });

  it("REGRESSION: classifier hard-block is not silently allowed by empty blockOn", () => {
    const config = mergeConfig({
      blockOn: [],
      acknowledgeDangerousOverrides: true,
    });
    const classification = classifyToolCall("filesystem_delete", {
      path: "/home/user/.ssh/id_ed25519",
    });
    assert.equal(classification.decision, "block");
    // Even with empty blockOn, decide must not return allow for classifier-block.
    const decision = decide(config, classification, []);
    assert.notEqual(decision, "allow");
  });

  it("CONTROL: benign workspace read remains allow", async () => {
    resetStrictModeCache();
    const capture = createHookCapture({
      auditLogPath: join(ws.path, "benign-audit.jsonl"),
      respectTrustStrictMode: false,
    });
    registerEnforcement(capture.api);
    const handler = capture.hooks[0]!.handler;
    const result = await handler(
      {
        toolName: "filesystem_read",
        params: { path: ".openclaw/workspace/notes.md" },
      },
      ctx,
    );
    assert.equal(result, undefined);
    const line = JSON.parse(
      readFileSync(join(ws.path, "benign-audit.jsonl"), "utf8").trim(),
    );
    assert.equal(line.outcome, "allowed");
  });

  it("CONTROL: default config keeps unknown.unclassified in approvalOn", () => {
    assert.ok(DEFAULT_CONFIG.approvalOn.includes("unknown.unclassified"));
    assert.equal(DEFAULT_CONFIG.approvalTimeoutBehavior, "deny");
    assert.equal(DEFAULT_CONFIG.auditFailureBehavior, "fail-closed");
  });

  it("REGRESSION: unattended unknown tools abstain (never requireApproval)", async () => {
    resetStrictModeCache();
    const capture = createHookCapture({
      auditLogPath: join(ws.path, "unattended-unknown-audit.jsonl"),
      respectTrustStrictMode: false,
      dispositionMode: "unattended",
    });
    registerEnforcement(capture.api);
    const handler = capture.hooks[0]!.handler;
    const result = (await handler(
      { toolName: "some_custom_tool_xyz", params: { foo: "bar" } },
      ctx,
    )) as { block?: boolean; blockReason?: string; requireApproval?: unknown };
    assert.equal(result.requireApproval, undefined);
    assert.equal(result.block, true);
    assert.match(result.blockReason ?? "", /^abstain:/);
  });

  it("CONTROL: malformed tool params do not throw in classifier", () => {
    const r = classifyToolCall("shell_exec", null as unknown as Record<string, unknown>);
    assert.ok(r.classification);
    assert.ok(["block", "approval", "allow"].includes(r.decision));
  });
});

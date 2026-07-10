import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { registerEnforcement, resetStrictModeCache } from "./index.js";
import { createHookCapture, createTempWorkspace } from "./test-helpers.js";

describe("enforcement hook integration", () => {
  const ws = createTempWorkspace("fpp-hook-");
  const auditLogPath = join(ws.path, "audit.jsonl");

  after(() => ws.cleanup());

  function setup() {
    resetStrictModeCache();
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

  it("blocks high-risk calls when audit log is corrupted (fail-closed)", async () => {
    const corruptPath = join(ws.path, "corrupt-high-risk.jsonl");
    writeFileSync(corruptPath, "{broken\n", "utf8");
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
        runId: "event-run",
      },
      ctx,
    )) as { block?: boolean; blockReason?: string };
    assert.equal(result.block, true);
    assert.match(result.blockReason ?? "", /audit/i);
    // Corrupted file must not be overwritten with a fresh zero-hash chain.
    assert.equal(readFileSync(corruptPath, "utf8").trim(), "{broken");
  });

  it("emits audit-gap diagnostic when post-approval outcome logging fails", async () => {
    const gapPath = join(ws.path, "gap-audit.jsonl");
    const diagnostics: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      diagnostics.push(args.map(String).join(" "));
    };
    try {
      const capture = createHookCapture({
        auditLogPath: gapPath,
        respectTrustStrictMode: false,
      });
      registerEnforcement(capture.api);
      const handler = capture.hooks[0]!.handler;
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
      writeFileSync(gapPath, "CORRUPT_TAIL\n", "utf8");
      await result.requireApproval!.onResolution("allow-once");
      assert.ok(
        diagnostics.some((d) => /audit-gap/i.test(d)),
        `expected audit-gap diagnostic, got: ${JSON.stringify(diagnostics)}`,
      );
    } finally {
      console.error = originalError;
    }
  });

  it("malformed strict-mode JSON applies conservative approval overrides", async () => {
    resetStrictModeCache();
    const strictPath = join(ws.path, "strict-corrupt.json");
    writeFileSync(strictPath, "{broken", "utf8");
    const diagnostics: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      diagnostics.push(args.map(String).join(" "));
    };
    try {
      const capture = createHookCapture({
        auditLogPath: join(ws.path, "strict-audit.jsonl"),
        respectTrustStrictMode: true,
        strictModeStatePath: strictPath,
      });
      registerEnforcement(capture.api);
      const handler = capture.hooks[0]!.handler;
      // fs.write.workspace is normally allow; strict conservative fallback escalates it
      const result = (await handler(
        {
          toolName: "filesystem_write",
          params: { path: ".openclaw/workspace/notes.md", content: "x" },
        },
        ctx,
      )) as { requireApproval?: unknown } | undefined;
      assert.ok(
        result && result.requireApproval,
        "malformed strict state must not silently disable protection",
      );
      assert.ok(
        diagnostics.some((d) => /STRICT_MODE_MALFORMED|strict-mode/i.test(d)),
      );
      assert.ok(
        !diagnostics.some((d) => d.includes("session-xyz")),
        "diagnostics must not include session keys",
      );
    } finally {
      console.error = originalError;
    }
  });

  it("expired strict-mode entry does not escalate", async () => {
    resetStrictModeCache();
    const strictPath = join(ws.path, "strict-expired.json");
    writeFileSync(
      strictPath,
      JSON.stringify({
        version: 1,
        updatedAt: "2020-01-01T00:00:00.000Z",
        sessions: {
          "session-xyz": {
            strict: true,
            reason: "old",
            addedApprovalOn: ["fs.write.workspace"],
            addedAt: "2020-01-01T00:00:00.000Z",
            expiresAt: "2020-01-01T01:00:00.000Z",
          },
        },
      }),
      "utf8",
    );
    const capture = createHookCapture({
      auditLogPath: join(ws.path, "expired-audit.jsonl"),
      respectTrustStrictMode: true,
      strictModeStatePath: strictPath,
    });
    registerEnforcement(capture.api);
    const handler = capture.hooks[0]!.handler;
    const result = await handler(
      {
        toolName: "filesystem_write",
        params: { path: ".openclaw/workspace/notes.md", content: "x" },
      },
      ctx,
    );
    assert.equal(result, undefined, "expired strict entry must not escalate");
  });

  it("valid strict-mode escalates http.public-read", async () => {
    resetStrictModeCache();
    const strictPath = join(ws.path, "strict-http-read.json");
    writeFileSync(
      strictPath,
      JSON.stringify({
        version: 1,
        updatedAt: new Date().toISOString(),
        sessions: {
          "session-xyz": {
            strict: true,
            reason: "handshake failed",
            addedApprovalOn: ["http.public-read"],
            addedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          },
        },
      }),
      "utf8",
    );
    const capture = createHookCapture({
      auditLogPath: join(ws.path, "http-read-audit.jsonl"),
      respectTrustStrictMode: true,
      strictModeStatePath: strictPath,
    });
    registerEnforcement(capture.api);
    const handler = capture.hooks[0]!.handler;
    const result = (await handler(
      {
        toolName: "http_request",
        params: { method: "GET", url: "https://api.example.com/v1/info" },
      },
      ctx,
    )) as { requireApproval?: unknown } | undefined;
    assert.ok(
      result && result.requireApproval,
      "http.public-read override must be reachable for public GET",
    );
  });
});

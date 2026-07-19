import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { registerEnforcement, resetStrictModeCache, resetReceiptStore, getActiveReceiptStore, getActiveReceiptSigner, buildSignedReceiptFromRecord, digestExecutionOutcome } from "./index.js";
import { createHookCapture, createTempWorkspace } from "./test-helpers.js";
import { mergeConfig } from "./config.js";
import plugin from "./index.js";

describe("enforcement hook integration", () => {
  const ws = createTempWorkspace("fpp-hook-");
  const auditLogPath = join(ws.path, "audit.jsonl");

  after(() => ws.cleanup());

  function setup(extraConfig: Record<string, unknown> = {}) {
    resetStrictModeCache();
    resetReceiptStore();
    const capture = createHookCapture({
      auditLogPath,
      respectTrustStrictMode: false,
      receiptMaxPending: 4,
      identityKeyPath: join(ws.path, "agent.key"),
      receiptLogPath: join(ws.path, "receipts.jsonl"),
      ...extraConfig,
    });
    registerEnforcement(capture.api);
    assert.ok(capture.hooks.length >= 1);
    assert.equal(capture.hooks[0]!.event, "before_tool_call");
    const before = capture.hooks.find((h) => h.event === "before_tool_call");
    assert.ok(before);
    return before!.handler;
  }

  function setupBoth(extraConfig: Record<string, unknown> = {}) {
    resetStrictModeCache();
    resetReceiptStore();
    const capture = createHookCapture({
      auditLogPath,
      respectTrustStrictMode: false,
      receiptMaxPending: 4,
      identityKeyPath: join(ws.path, "agent.key"),
      receiptLogPath: join(ws.path, "receipts.jsonl"),
      ...extraConfig,
    });
    registerEnforcement(capture.api);
    const before = capture.hooks.find((h) => h.event === "before_tool_call");
    const after = capture.hooks.find((h) => h.event === "after_tool_call");
    assert.ok(before);
    assert.ok(after);
    return { before: before!.handler, after: after!.handler, config: capture.api.pluginConfig };
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
    const handler = setup({ dispositionMode: "operator-present" });
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

  it("unattended unknown tool abstains instead of requireApproval", async () => {
    const handler = setup({ dispositionMode: "unattended" });
    const result = (await handler(
      { toolName: "some_custom_tool_xyz", params: { foo: 1 } },
      ctx,
    )) as { block?: boolean; blockReason?: string; requireApproval?: unknown };
    assert.equal(result.requireApproval, undefined);
    assert.equal(result.block, true);
    assert.match(result.blockReason ?? "", /^abstain:/);
  });

  it("operator-present still requireApproval for approvalOn", async () => {
    const handler = setup({ dispositionMode: "operator-present" });
    const result = (await handler(
      { toolName: "some_custom_tool_xyz", params: { foo: 1 } },
      ctx,
    )) as { requireApproval?: unknown; block?: boolean };
    assert.ok(result.requireApproval);
    assert.notEqual(result.block, true);
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
    resetStrictModeCache();
    resetReceiptStore();
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

  it("correlates receipts by toolCallId and finalizes blocks immediately", async () => {
    const handler = setup();
    const store = getActiveReceiptStore();
    assert.ok(store);

    await handler(
      {
        toolName: "filesystem_delete",
        params: { path: "/home/user/.ssh/id_ed25519" },
      },
      { ...ctx, toolCallId: "call-block-rcpt" },
    );
    assert.equal(store.getPending("call-block-rcpt"), undefined);
    assert.equal(store.getFinalized("call-block-rcpt")?.outcome, "blocked");

    await handler(
      {
        toolName: "filesystem_read",
        params: { path: ".openclaw/workspace/notes.md" },
      },
      { ...ctx, toolCallId: "call-allow-rcpt" },
    );
    assert.equal(store.getPending("call-allow-rcpt")?.status, "pending_execution");
    assert.notEqual(
      store.getFinalized("call-block-rcpt")?.receiptId,
      store.getPending("call-allow-rcpt")?.receiptId,
    );
  });

  it("emits reduced-confidence receipt when toolCallId is missing", async () => {
    const diagnostics: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      diagnostics.push(args.map(String).join(" "));
    };
    try {
      const handler = setup();
      await handler(
        {
          toolName: "filesystem_read",
          params: { path: ".openclaw/workspace/notes.md" },
        },
        { agentId: "agent-xyz", runId: "run-xyz", sessionKey: "session-xyz" },
      );
      const store = getActiveReceiptStore();
      assert.ok(store);
      assert.equal(store.pendingCount(), 1);
      assert.ok(diagnostics.some((d) => /reduced correlation confidence/i.test(d)));
    } finally {
      console.error = originalError;
    }
  });

  it("correlates approval success with after_tool_call execution outcome", async () => {
    const { before, after } = setupBoth({
      receiptLogPath: join(ws.path, "rcpt-approval-ok.jsonl"),
    });
    const result = (await before(
      {
        toolName: "filesystem_delete",
        params: { path: ".openclaw/workspace/tmp/scratch.txt" },
      },
      { ...ctx, toolCallId: "call-appr-ok" },
    )) as { requireApproval?: { onResolution: (d: string) => Promise<void> } };
    assert.ok(result.requireApproval);
    await result.requireApproval!.onResolution("allow-once");
    const store = getActiveReceiptStore()!;
    assert.equal(store.getPending("call-appr-ok")?.status, "pending_execution");
    assert.equal(store.getPending("call-appr-ok")?.authorization, "approved");

    await after(
      {
        toolName: "filesystem_delete",
        params: { path: ".openclaw/workspace/tmp/scratch.txt" },
        toolCallId: "call-appr-ok",
        result: { ok: true },
        durationMs: 12,
      },
      { ...ctx, toolCallId: "call-appr-ok" },
    );
    const finalized = store.getFinalized("call-appr-ok");
    assert.equal(finalized?.authorization, "approved");
    assert.match(finalized?.outcome ?? "", /^executed:/);
    assert.equal(finalized?.status, "finalized");
  });

  it("keeps authorization separate from execution error", async () => {
    const { before, after } = setupBoth();
    await before(
      {
        toolName: "filesystem_read",
        params: { path: ".openclaw/workspace/notes.md" },
      },
      { ...ctx, toolCallId: "call-allow-err" },
    );
    await after(
      {
        toolName: "filesystem_read",
        toolCallId: "call-allow-err",
        error: "ENOENT: secret-path-should-not-leak",
        durationMs: 3,
      },
      { ...ctx, toolCallId: "call-allow-err" },
    );
    const finalized = getActiveReceiptStore()!.getFinalized("call-allow-err");
    assert.equal(finalized?.authorization, "policy-match");
    assert.match(finalized?.outcome ?? "", /^error:/);
    const receiptLines = readFileSync(join(ws.path, "receipts.jsonl"), "utf8");
    assert.equal(receiptLines.includes("secret-path-should-not-leak"), false);
  });

  it("finalizes deny/timeout/cancelled without waiting for after_tool_call", async () => {
    for (const [decision, toolCallId] of [
      ["deny", "call-deny"],
      ["timeout", "call-timeout"],
      ["cancelled", "call-cancel"],
    ] as const) {
      const { before } = setupBoth({
        receiptLogPath: join(ws.path, `rcpt-${toolCallId}.jsonl`),
        identityKeyPath: join(ws.path, `key-${toolCallId}.key`),
      });
      const result = (await before(
        {
          toolName: "filesystem_delete",
          params: { path: ".openclaw/workspace/tmp/scratch.txt" },
        },
        { ...ctx, toolCallId },
      )) as { requireApproval?: { onResolution: (d: string) => Promise<void> } };
      await result.requireApproval!.onResolution(decision);
      const finalized = getActiveReceiptStore()!.getFinalized(toolCallId);
      assert.equal(finalized?.status, "finalized");
      assert.equal(finalized?.outcome, decision === "deny" ? "denied" : decision);
      assert.equal(getActiveReceiptStore()!.getPending(toolCallId), undefined);
    }
  });

  it("ignores duplicate after_tool_call and reports missing pending as audit gap", async () => {
    const diagnostics: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      diagnostics.push(args.map(String).join(" "));
    };
    try {
      const { before, after } = setupBoth();
      await before(
        {
          toolName: "filesystem_read",
          params: { path: ".openclaw/workspace/notes.md" },
        },
        { ...ctx, toolCallId: "call-dup-after" },
      );
      await after(
        { toolName: "filesystem_read", toolCallId: "call-dup-after", result: {} },
        { ...ctx, toolCallId: "call-dup-after" },
      );
      await after(
        { toolName: "filesystem_read", toolCallId: "call-dup-after", error: "late" },
        { ...ctx, toolCallId: "call-dup-after" },
      );
      assert.match(
        getActiveReceiptStore()!.getFinalized("call-dup-after")!.outcome!,
        /^executed:/,
      );

      await after(
        { toolName: "filesystem_read", toolCallId: "call-missing-before", result: {} },
        { ...ctx, toolCallId: "call-missing-before" },
      );
      assert.ok(diagnostics.some((d) => /no pending receipt/i.test(d)));
    } finally {
      console.error = originalError;
    }
  });

  it("reconcileOrphanedReceipts marks pending calls as visible gaps", async () => {
    const { before } = setupBoth({
      receiptLogPath: join(ws.path, "orphan-receipts.jsonl"),
    });
    await before(
      {
        toolName: "filesystem_read",
        params: { path: ".openclaw/workspace/notes.md" },
      },
      { ...ctx, toolCallId: "call-orphan" },
    );
    assert.equal(getActiveReceiptStore()!.pendingCount(), 1);
    const { reconcileOrphanedReceipts } = await import("./index.js");
    const { mergeConfig } = await import("./config.js");
    const orphans = reconcileOrphanedReceipts(
      mergeConfig({
        auditLogPath,
        identityKeyPath: join(ws.path, "agent.key"),
        receiptLogPath: join(ws.path, "orphan-receipts.jsonl"),
        respectTrustStrictMode: false,
      }),
    );
    assert.equal(orphans.length, 1);
    assert.equal(orphans[0]!.outcome, "audit_gap_orphan");
    assert.equal(getActiveReceiptStore()!.pendingCount(), 0);
  });

  it("exposes receipt signer and can build a signed receipt from a record", () => {
    setup({
      receiptSigningEnabled: true,
      receiptLogPath: join(ws.path, "signed-receipts.jsonl"),
    });
    const signer = getActiveReceiptSigner();
    assert.ok(signer);
    const config = mergeConfig({
      auditLogPath,
      respectTrustStrictMode: false,
      receiptSigningEnabled: true,
      identityKeyPath: join(ws.path, "agent.key"),
      receiptLogPath: join(ws.path, "signed-receipts.jsonl"),
    });
    const signed = buildSignedReceiptFromRecord(
      {
        receiptId: "rcpt-test",
        toolCallId: "call-sign",
        correlationConfidence: "exact",
        actionDigest: "a".repeat(64),
        classification: "fs.read.workspace",
        disposition: "allow",
        decision: "allow",
        proposedAt: new Date().toISOString(),
        status: "finalized",
        outcome: "executed",
        finalizedAt: new Date().toISOString(),
        authorization: "standing-allowlist",
      },
      config,
      signer!,
    );
    assert.equal(signed.receiptId, "rcpt-test");
    assert.ok(signed.signature);
  });

  it("digestExecutionOutcome domain-separates success vs error outcomes", () => {
    const ok = digestExecutionOutcome({ hasResult: true, durationMs: 12 });
    const err = digestExecutionOutcome({
      hasResult: false,
      error: "boom",
      durationMs: 3,
    });
    const bare = digestExecutionOutcome({ hasResult: false });
    assert.match(ok, /^[0-9a-f]{64}$/);
    assert.match(err, /^[0-9a-f]{64}$/);
    assert.notEqual(ok, err);
    assert.notEqual(err, bare);
  });

  it("plugin entry register wires enforcement hooks", () => {
    resetStrictModeCache();
    resetReceiptStore();
    const capture = createHookCapture({
      auditLogPath: join(ws.path, "entry-audit.jsonl"),
      respectTrustStrictMode: false,
    });
    assert.equal(typeof plugin.register, "function");
    plugin.register!(capture.api as never);
    assert.ok(capture.hooks.some((h) => h.event === "before_tool_call"));
  });
});

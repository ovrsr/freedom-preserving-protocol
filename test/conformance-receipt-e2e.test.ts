/**
 * Cross-plugin end-to-end: classification → receipt → proof → capsule.
 *
 * Completeness limitation: receipts prove what the instrumented boundary
 * observed and signed — not that every action passed through it.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  registerEnforcement,
  resetReceiptStore,
  resetStrictModeCache,
  reconcileOrphanedReceipts,
} from "../plugin/src/index.ts";
import { createHookCapture } from "../plugin/src/test-helpers.ts";
import { mergeConfig } from "../plugin/src/config.ts";
import { verifyReceiptLog, createReceiptProof } from "../plugin/src/receipt-log.ts";
import { verifyReceiptEvidence } from "../plugin-trust/src/receipt-verifier.ts";
import { loadOrCreateIdentity } from "../plugin-trust/src/identity.ts";
import {
  buildTrustStateCapsule,
  validateTrustStateCapsule,
  isLegacyClaimMasquerading,
} from "../plugin-trust/src/capsule.ts";

describe("conformance receipt e2e", () => {
  const dir = mkdtempSync(join(tmpdir(), "fpp-e2e-"));
  after(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it("runs block, approval-success, execution-error, proof, verify, capsule", async () => {
    resetStrictModeCache();
    resetReceiptStore();
    const auditLogPath = join(dir, "audit.jsonl");
    const receiptLogPath = join(dir, "receipts.jsonl");
    const identityKeyPath = join(dir, "agent.key");

    const capture = createHookCapture({
      auditLogPath,
      receiptLogPath,
      identityKeyPath,
      respectTrustStrictMode: false,
    });
    registerEnforcement(capture.api);
    const before = capture.hooks.find((h) => h.event === "before_tool_call")!.handler;
    const after = capture.hooks.find((h) => h.event === "after_tool_call")!.handler;
    const ctx = {
      agentId: "agent-e2e",
      runId: "run-e2e",
      sessionKey: "session-e2e",
    };

    // Block path
    await before(
      {
        toolName: "filesystem_delete",
        params: { path: "/home/user/.ssh/id_ed25519" },
      },
      { ...ctx, toolCallId: "call-block" },
    );

    // Approval → success
    const appr = (await before(
      {
        toolName: "filesystem_delete",
        params: { path: ".openclaw/workspace/tmp/x.txt" },
      },
      { ...ctx, toolCallId: "call-appr" },
    )) as { requireApproval: { onResolution: (d: string) => Promise<void> } };
    await appr.requireApproval.onResolution("allow-once");
    await after(
      {
        toolName: "filesystem_delete",
        toolCallId: "call-appr",
        result: { ok: true },
        durationMs: 5,
      },
      { ...ctx, toolCallId: "call-appr" },
    );

    // Allow → execution error (no raw error text in ledger)
    await before(
      {
        toolName: "filesystem_read",
        params: { path: ".openclaw/workspace/notes.md" },
      },
      { ...ctx, toolCallId: "call-err" },
    );
    await after(
      {
        toolName: "filesystem_read",
        toolCallId: "call-err",
        error: "ENOENT secret-should-not-appear",
        durationMs: 2,
      },
      { ...ctx, toolCallId: "call-err" },
    );

    const report = verifyReceiptLog(receiptLogPath);
    assert.equal(report.ok, true);
    assert.ok(report.entries >= 3);
    const raw = readFileSync(receiptLogPath, "utf8");
    assert.equal(raw.includes("secret-should-not-appear"), false);

    const proof = createReceiptProof(receiptLogPath, 0);
    assert.ok(proof);
    assert.equal(proof.logKind, "conformance-receipt");

    const firstReceipt = JSON.parse(raw.trim().split("\n")[0]!).receipt;
    const evidence = verifyReceiptEvidence({
      receipt: firstReceipt,
      inclusionProof: proof,
      expectedRoot: proof.root,
    });
    assert.equal(evidence.valid, true);
    assert.ok(evidence.whatWasNotProven.some((x) => /completeness|behavioral/i.test(x)));

    // Capsule exchange
    const identity = loadOrCreateIdentity(identityKeyPath, "/");
    const now = Date.parse("2026-07-10T12:00:00.000Z");
    const capsule = buildTrustStateCapsule({
      identity,
      runtimeId: "e2e-runtime",
      implementationVersion: "1.2.2",
      evidenceRoot: proof.root,
      receiptRoot: proof.root,
      coverageMetrics: {
        metricVersion: 1,
        finalizedReceipts: report.entries,
        completeness: "unknown",
      },
      freshness: {
        audience: "fpp:peer:verifier",
        challenge: "e2e-nonce",
        issuedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 60_000).toISOString(),
      },
      view: "peer-summary",
    });
    const validated = validateTrustStateCapsule(capsule, {
      maxLifetimeMs: 120_000,
      allowedClockSkewMs: 5_000,
      nowMs: now + 1_000,
    });
    assert.equal(validated.valid, true);

    // Negatives
    assert.equal(
      isLegacyClaimMasquerading({
        agentId: identity.agentId,
        constitutionHash: "a".repeat(64),
      }),
      true,
    );
    const badSig = { ...firstReceipt, signature: "00".repeat(64) };
    assert.equal(verifyReceiptEvidence({ receipt: badSig }).valid, false);

    // Missing outcome / audit gap
    await before(
      {
        toolName: "filesystem_read",
        params: { path: ".openclaw/workspace/notes.md" },
      },
      { ...ctx, toolCallId: "call-orphan" },
    );
    const orphans = reconcileOrphanedReceipts(
      mergeConfig({
        auditLogPath,
        receiptLogPath,
        identityKeyPath,
        respectTrustStrictMode: false,
      }),
    );
    assert.ok(orphans.some((o) => o.toolCallId === "call-orphan"));
  });
});

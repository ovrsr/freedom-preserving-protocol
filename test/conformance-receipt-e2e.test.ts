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
import {
  verifyReceiptLog,
  createReceiptProof,
} from "../plugin/src/receipt-log.ts";
import { createReceiptInclusionEvidence } from "../packages/enforcement-core/src/receipt-log.ts";
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
    const inclusionEvidence = createReceiptInclusionEvidence(receiptLogPath, 0);
    assert.ok(inclusionEvidence);
    assert.equal(inclusionEvidence.proof.leaf, inclusionEvidence.entry.hash);

    const firstReceipt = JSON.parse(raw.trim().split("\n")[0]!).receipt;
    const claimedRootOnly = verifyReceiptEvidence({
      receipt: firstReceipt,
      inclusionEvidence,
      expectedConstitutionHash: firstReceipt.constitutionHash,
      expectedPolicyId: firstReceipt.policyId,
      expectedPolicyVersion: firstReceipt.policyVersion,
    });
    assert.equal(
      claimedRootOnly.inclusionVerification.proofValidUnderClaimedRoot,
      true,
    );
    assert.equal(claimedRootOnly.inclusionVerification.rootAnchored, false);
    assert.equal(claimedRootOnly.inclusionVerification.inclusionVerified, false);
    assert.equal(claimedRootOnly.valid, false);
    assert.equal(claimedRootOnly.confidenceCeiling, 0);

    const unanchoredEvidence = verifyReceiptEvidence({
      receipt: firstReceipt,
      inclusionEvidence,
      expectedRoot: inclusionEvidence.proof.root,
    });
    assert.equal(unanchoredEvidence.valid, true);
    assert.equal(unanchoredEvidence.attestationEligibility.eligible, false);
    assert.equal(unanchoredEvidence.attestation, undefined);

    const evidence = verifyReceiptEvidence({
      receipt: firstReceipt,
      inclusionEvidence,
      expectedRoot: inclusionEvidence.proof.root,
      expectedConstitutionHash: firstReceipt.constitutionHash,
      expectedPolicyId: firstReceipt.policyId,
      expectedPolicyVersion: firstReceipt.policyVersion,
    });
    assert.equal(evidence.valid, true);
    assert.ok(evidence.whatWasNotProven.some((x) => /completeness|behavioral/i.test(x)));
    assert.ok(evidence.attestation, "expected instrumented-boundary-disposition attestation");
    assert.equal(evidence.attestation.kind, "instrumented-boundary-disposition");
    assert.equal(evidence.attestation.claimClass, "event");
    assert.equal(evidence.attestation.inclusionVerified, true);
    assert.ok(
      evidence.whatWasNotProven.some((x) => /downstream parameter equality/i.test(x)),
    );

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

describe("gateway governance transition receipts e2e", () => {
  const dir = mkdtempSync(join(tmpdir(), "fpp-gw-e2e-"));
  after(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it("binds governance epoch on governed receipts and marks transition aborts", async () => {
    const { createEnforcementRuntime } = await import(
      "../packages/enforcement-core/src/index.ts"
    );
    const {
      createGatewayReferenceRouter,
      GovernanceLedger,
      GatewayReferenceStaleEpochError,
    } = await import("../packages/gateway-reference/src/index.ts");
    const { signMessage, verifySignature } = await import(
      "../packages/protocol-core/src/index.ts"
    );
    const ed = await import("@noble/ed25519");
    const { sha512 } = await import("@noble/hashes/sha512");
    const { bytesToHex } = await import("@noble/hashes/utils");
    ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m));

    const seed = new Uint8Array(32).fill(3);
    const publicKeyHex = bytesToHex(ed.getPublicKey(seed));
    const ledger = new GovernanceLedger({
      path: join(dir, "governance.jsonl"),
      signer: {
        alg: "Ed25519",
        keyId: "e2e-key",
        sign: (message) => signMessage(message, seed),
      },
      verifier: {
        verify: (message, signatureHex, keyId) => {
          if (keyId !== "e2e-key") return false;
          return verifySignature(
            message,
            Buffer.from(signatureHex, "hex"),
            Buffer.from(publicKeyHex, "hex"),
          );
        },
      },
      constitutionHash: "71bf60ad" + "0".repeat(56),
      policyEngineVersion: "@ovrsr/fpp-enforcement-core@1.0.0",
    });

    const runtime = createEnforcementRuntime(
      {
        auditLogPath: join(dir, "audit.jsonl"),
        receiptLogPath: join(dir, "receipts.jsonl"),
        identityKeyPath: join(dir, "agent.key"),
        mandateStorePath: join(dir, "mandates.json"),
        strictModeStatePath: join(dir, "strict.json"),
        dispositionMode: "unattended",
        receiptSigningEnabled: true,
      },
      {
        harnessId: "gateway-reference-e2e",
        getWorkspacePaths: () => ({ workspaceRoot: dir }),
      },
    );

    let now = 5_000;
    const waiters: Array<{ deadline: number; resolve: () => void }> = [];
    let release!: () => void;
    const barrier = new Promise<void>((r) => {
      release = r;
    });
    let seq = 0;
    const router = createGatewayReferenceRouter({
      enabled: true,
      runtime,
      invoke: async () => ({ ok: true }),
      governanceLedger: ledger,
      drainTimeoutMs: 10,
      nowMs: () => now,
      waitUntil: (deadline) =>
        new Promise((resolve) => {
          if (now >= deadline) {
            resolve("deadline");
            return;
          }
          waiters.push({
            deadline,
            resolve: () => resolve("deadline"),
          });
        }),
      eventIdFactory: () => `evt_e2e_${++seq}`,
      beforeInvoke: async () => {
        await barrier;
      },
    });

    await runtime.onBeforeToolCall(
      {
        toolName: "Shell",
        params: { command: "echo unrelated plugin call" },
        toolCallId: "plugin-pending",
      },
      { toolCallId: "plugin-pending" },
    );
    const held = router.route(
      "Shell",
      { command: "echo e2e" },
      { toolCallId: "e2e-held" },
    );
    await new Promise((r) => setImmediate(r));
    assert.equal(
      runtime.getReceiptStore().getPending("e2e-held")?.governanceEpoch,
      0,
    );

    const disablePromise = router.disableGovernance({ reason: "e2e" });
    await new Promise((r) => setImmediate(r));
    now += 10;
    for (const w of waiters.splice(0, waiters.length)) {
      if (now >= w.deadline) w.resolve();
    }
    await disablePromise;

    const aborted = runtime.getReceiptStore().getFinalized("e2e-held");
    assert.equal(aborted?.outcome, "governance_transition_aborted");
    assert.equal(aborted?.governanceEpoch, 0);
    assert.equal(aborted?.governanceMode, "enabled");
    assert.ok(
      runtime.getReceiptStore().getPending("plugin-pending"),
      "transition reconciliation must leave unrelated runtime receipts pending",
    );

    release();
    await assert.rejects(() => held, GatewayReferenceStaleEpochError);
  });
});

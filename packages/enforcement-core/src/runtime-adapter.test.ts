import assert from "node:assert/strict";
import { describe, it, after } from "node:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import {
  canonicalizeV2,
  emergencyOverrideSigningFields,
  signMessage,
  type SignedEmergencyOverrideV1,
} from "@ovrsr/fpp-protocol-core";
import {
  createEnforcementRuntime,
  type FppRuntimeAdapter,
  type FppBeforeToolCallResult,
} from "./runtime-adapter.js";
import { createTempWorkspace } from "./test-helpers.js";

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

function fakeAdapter(harnessId = "test"): FppRuntimeAdapter {
  return {
    harnessId,
    getWorkspacePaths() {
      return { workspaceRoot: "/tmp/fpp-test" };
    },
  };
}

function signOverride(
  override: Omit<SignedEmergencyOverrideV1, "signature" | "publicKey">,
  seed: Uint8Array,
): SignedEmergencyOverrideV1 {
  const publicKey = Buffer.from(ed.getPublicKey(seed)).toString("hex");
  const withKey = { ...override, publicKey } as SignedEmergencyOverrideV1;
  const message = Buffer.from(
    canonicalizeV2(emergencyOverrideSigningFields(withKey)),
    "utf8",
  );
  const signature = Buffer.from(signMessage(message, seed)).toString("hex");
  return { ...withKey, signature };
}

function writeIdentityKey(path: string, seed: Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from(seed), { mode: 0o600 });
}

function plantEmergencyOverride(
  storePath: string,
  override: SignedEmergencyOverrideV1,
): void {
  mkdirSync(dirname(storePath), { recursive: true });
  writeFileSync(
    storePath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        overrides: [override],
        ledgers: {
          [override.overrideId]: {
            remainingActions: override.budgets.remainingActions,
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
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

  it("reports transition receipt persistence failure without committing failed records", async () => {
    const receiptLogPath = join(ws.path, "receipts-transition-failure.jsonl");
    const runtime = createEnforcementRuntime(
      {
        auditLogPath: join(ws.path, "audit-transition-failure.jsonl"),
        receiptLogPath,
        identityKeyPath: join(ws.path, "agent-transition-failure.key"),
        mandateStorePath: join(ws.path, "mandates-transition-failure.json"),
        strictModeStatePath: join(ws.path, "strict-transition-failure.json"),
        dispositionMode: "unattended",
      },
      fakeAdapter("gateway-reference"),
    );
    await runtime.onBeforeToolCall(
      {
        toolName: "Shell",
        params: { command: "echo pending" },
        toolCallId: "transition-write-failure",
      },
      {
        toolCallId: "transition-write-failure",
        governanceEpoch: 3,
        governanceMode: "enabled",
      },
    );
    writeFileSync(receiptLogPath, "{corrupt-tail\n", "utf8");

    let caught: unknown;
    try {
      runtime.reconcileTransitionAbortedReceipts({
        governanceEpoch: 3,
        eligibleToolCallIds: new Set(["transition-write-failure"]),
        nowIso: "2026-07-20T12:00:05.000Z",
      });
    } catch (error) {
      caught = error;
    }
    assert.ok(caught instanceof Error);
    assert.match(caught.message, /receipt|persist|corrupt/i);
    const report = (
      caught as {
        result?: {
          records: Array<{
            toolCallId: string;
            persisted: boolean;
            error?: string;
          }>;
        };
      }
    ).result;
    assert.equal(report?.records.length, 1);
    assert.equal(report?.records[0]?.toolCallId, "transition-write-failure");
    assert.equal(report?.records[0]?.persisted, false);
    assert.match(report?.records[0]?.error ?? "", /receipt|corrupt|persist/i);
    assert.ok(runtime.getReceiptStore().getPending("transition-write-failure"));
    assert.equal(
      runtime.getReceiptStore().getFinalized("transition-write-failure"),
      undefined,
    );

    writeFileSync(receiptLogPath, "", "utf8");
    const retry = runtime.reconcileTransitionAbortedReceipts({
      governanceEpoch: 3,
      eligibleToolCallIds: new Set(["transition-write-failure"]),
      nowIso: "2026-07-20T12:00:06.000Z",
    });
    assert.equal(retry.records.length, 1);
    assert.equal(retry.records[0]?.persisted, true);
    assert.equal(retry.aborted.length, 1);
    const idempotentRetry = runtime.reconcileTransitionAbortedReceipts({
      governanceEpoch: 3,
      eligibleToolCallIds: new Set(["transition-write-failure"]),
      nowIso: "2026-07-20T12:00:07.000Z",
    });
    assert.deepEqual(idempotentRetry, { aborted: [], records: [] });
    assert.equal(
      readFileSync(receiptLogPath, "utf8").trim().split("\n").length,
      1,
    );
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

  it("onResolution cancelled produces one durable terminal receipt and blocks double finalize", async () => {
    const runtime = createEnforcementRuntime(
      {
        auditLogPath: join(ws.path, "audit-approval-cancel.jsonl"),
        receiptLogPath: join(ws.path, "receipts-approval-cancel.jsonl"),
        identityKeyPath: join(ws.path, "agent-approval-cancel.key"),
        mandateStorePath: join(ws.path, "mandates-approval-cancel.json"),
        strictModeStatePath: join(ws.path, "strict-approval-cancel.json"),
        dispositionMode: "operator-present",
        approvalOn: ["fs.write.workspace"],
      },
      fakeAdapter("gateway-reference"),
    );
    const result = await runtime.onBeforeToolCall(
      {
        toolName: "filesystem_write",
        params: { path: ".openclaw/workspace/notes.md", content: "x" },
        toolCallId: "approval-cancel",
      },
      {
        toolCallId: "approval-cancel",
        governanceEpoch: 0,
        governanceMode: "enabled",
      },
    );
    assert.equal(result.action, "require_approval");
    if (result.action !== "require_approval") return;

    assert.equal(
      runtime.getReceiptStore().getPending("approval-cancel")?.status,
      "pending_authorization",
    );

    await result.onResolution("cancelled");

    const finalized = runtime.getReceiptStore().getFinalized("approval-cancel");
    assert.ok(finalized);
    assert.equal(finalized.status, "finalized");
    assert.equal(finalized.outcome, "cancelled");
    assert.equal(
      runtime.getReceiptStore().getPending("approval-cancel"),
      undefined,
    );
    const receiptLinesAfterFirst = readFileSync(
      join(ws.path, "receipts-approval-cancel.jsonl"),
      "utf8",
    )
      .trim()
      .split("\n")
      .filter(Boolean);
    assert.equal(receiptLinesAfterFirst.length, 1);

    // Calling resolution again must not create a second terminal outcome.
    await result.onResolution("deny");
    assert.equal(
      runtime.getReceiptStore().getFinalized("approval-cancel")?.outcome,
      "cancelled",
    );
    const receiptLinesAfterRetry = readFileSync(
      join(ws.path, "receipts-approval-cancel.jsonl"),
      "utf8",
    )
      .trim()
      .split("\n")
      .filter(Boolean);
    assert.equal(receiptLinesAfterRetry.length, 1);

    // Transition reconciliation must not invent a second terminal receipt.
    const reconciled = runtime.reconcileTransitionAbortedReceipts({
      governanceEpoch: 0,
      eligibleToolCallIds: new Set(["approval-cancel"]),
      nowIso: "2026-07-20T12:00:10.000Z",
    });
    assert.deepEqual(reconciled, { aborted: [], records: [] });
    assert.equal(
      runtime.getReceiptStore().getFinalized("approval-cancel")?.outcome,
      "cancelled",
    );
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

  it("wires mandate diagnostics to AUDIT-GAP and audit-log integrity entry", async () => {
    // Plant a broken signed mandate that fails verify.
    const mandateStorePath = join(ws.path, "mandates-diag-rt.json");
    const auditLogPath = join(ws.path, "audit-diag-rt.jsonl");
    mkdirSync(dirname(mandateStorePath), { recursive: true });
    writeFileSync(
      mandateStorePath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          mandates: [
            {
              schemaVersion: 1,
              mandateId: "m-rt-diag",
              issuerClass: "operator",
              issuerId: "operator:alice",
              scope: { classifications: ["pkg.install"] },
              budgets: { maxActions: 5, remainingActions: 5 },
              validFrom: "2026-01-01T00:00:00.000Z",
              validTo: "2099-01-01T00:00:00.000Z",
              revocable: true,
              evidenceRef: "evidence:rt",
              publicKey: "aa".repeat(32),
              signature: "00".repeat(64),
            },
          ],
          ledgers: { "m-rt-diag": { remainingActions: 5 } },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const gaps: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      const msg = args.map(String).join(" ");
      if (msg.includes("FPP AUDIT-GAP")) gaps.push(msg);
      originalError.apply(console, args as []);
    };

    try {
      const runtime = createEnforcementRuntime(
        {
          auditLogPath,
          receiptLogPath: join(ws.path, "receipts-diag-rt.jsonl"),
          identityKeyPath: join(ws.path, "agent-diag-rt.key"),
          mandateStorePath,
          strictModeStatePath: join(ws.path, "strict-diag-rt.json"),
          dispositionMode: "unattended",
          constitutionHash: "test-hash",
        },
        fakeAdapter(),
      );
      await runtime.onBeforeToolCall(
        {
          toolName: "exec",
          params: { command: "npm install left-pad" },
          toolCallId: "tc-diag",
        },
        { toolCallId: "tc-diag" },
      );

      assert.ok(
        gaps.some((g) => /mandate|signature|integrity/i.test(g)),
        `expected AUDIT-GAP for mandate integrity, got: ${gaps.join(" | ")}`,
      );
      assert.ok(existsSync(auditLogPath));
      const lines = readFileSync(auditLogPath, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean);
      const integrity = lines
        .map((l) => JSON.parse(l) as { classification?: string; reason?: string })
        .find((e) => e.classification === "fpp.mandate.integrity");
      assert.ok(integrity);
      assert.match(String(integrity!.reason), /m-rt-diag/);
    } finally {
      console.error = originalError;
    }
  });
});

describe("emergency override wiring in onBeforeToolCall", () => {
  const ws = createTempWorkspace("fpp-runtime-emg-");
  after(() => ws.cleanup());

  const stewardSeed = ed.utils.randomPrivateKey();
  const agentSeed = ed.utils.randomPrivateKey();

  const baseOverride = {
    schemaVersion: 1 as const,
    overrideId: "e-rt-valid",
    issuerId: "steward:alice",
    scope: { classifications: ["exec.system-modify"] },
    budgets: { maxActions: 2, remainingActions: 2 },
    validFrom: "2026-01-01T00:00:00.000Z",
    validTo: "2099-01-01T00:00:00.000Z",
    evidenceRef: "evidence:rt-emergency",
  };

  it("valid override yields allow_minimal + emergency ledger + debit", async () => {
    const mandateStorePath = join(ws.path, "mandates-emg.json");
    const identityKeyPath = join(ws.path, "agent-emg.key");
    const emergencyPath = join(ws.path, "fpp-emergency-overrides.json");
    writeIdentityKey(identityKeyPath, agentSeed);
    const override = signOverride(baseOverride, stewardSeed);
    plantEmergencyOverride(emergencyPath, override);

    const runtime = createEnforcementRuntime(
      {
        auditLogPath: join(ws.path, "audit-emg.jsonl"),
        receiptLogPath: join(ws.path, "receipts-emg.jsonl"),
        identityKeyPath,
        mandateStorePath,
        strictModeStatePath: join(ws.path, "strict-emg.json"),
        dispositionMode: "unattended",
      },
      fakeAdapter(),
    );

    const result = await runtime.onBeforeToolCall(
      {
        toolName: "exec",
        params: { command: "sudo systemctl restart nginx" },
        toolCallId: "tc-emg-ok",
      },
      { toolCallId: "tc-emg-ok" },
    );

    assert.equal(result.action, "allow");
    if (result.action === "allow") {
      assert.equal(result.disposition.disposition, "allow_minimal");
      assert.equal(result.disposition.authorization, "emergency");
    }

    const reviewPath = join(ws.path, "fpp-emergency-review.jsonl");
    assert.ok(existsSync(reviewPath));
    const reviewLines = readFileSync(reviewPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean);
    assert.ok(
      reviewLines.some((l) => /mandatory_review_pending/.test(l)),
      `expected mandatory_review_pending in ${reviewLines.join(" | ")}`,
    );

    const onDisk = JSON.parse(readFileSync(emergencyPath, "utf8"));
    assert.equal(onDisk.ledgers["e-rt-valid"].remainingActions, 1);
  });

  it("expired override abstains with distinguishable reason", async () => {
    const mandateStorePath = join(ws.path, "mandates-emg-exp.json");
    const identityKeyPath = join(ws.path, "agent-emg-exp.key");
    const emergencyPath = join(ws.path, "fpp-emergency-overrides.json");
    // Separate subdir so sibling path does not collide with prior test file name.
    const sub = join(ws.path, "expired");
    mkdirSync(sub, { recursive: true });
    const mandateInSub = join(sub, "mandates.json");
    const emergencyInSub = join(sub, "fpp-emergency-overrides.json");
    writeIdentityKey(identityKeyPath, agentSeed);
    const override = signOverride(
      {
        ...baseOverride,
        overrideId: "e-rt-expired",
        validFrom: "2026-01-01T00:00:00.000Z",
        validTo: "2026-02-01T00:00:00.000Z",
      },
      stewardSeed,
    );
    plantEmergencyOverride(emergencyInSub, override);

    const runtime = createEnforcementRuntime(
      {
        auditLogPath: join(ws.path, "audit-emg-exp.jsonl"),
        receiptLogPath: join(ws.path, "receipts-emg-exp.jsonl"),
        identityKeyPath,
        mandateStorePath: mandateInSub,
        strictModeStatePath: join(ws.path, "strict-emg-exp.json"),
        dispositionMode: "unattended",
      },
      fakeAdapter(),
    );

    const result = await runtime.onBeforeToolCall(
      {
        toolName: "exec",
        params: { command: "sudo systemctl restart nginx" },
        toolCallId: "tc-emg-exp",
      },
      { toolCallId: "tc-emg-exp" },
    );

    assert.equal(result.action, "block");
    if (result.action === "block") {
      assert.match(result.blockReason, /emergency override rejected \(expired\)/);
    }
  });

  it("hard-floor blockOn wins even with valid emergency override", async () => {
    const sub = join(ws.path, "hardfloor");
    mkdirSync(sub, { recursive: true });
    const identityKeyPath = join(sub, "agent.key");
    const mandateStorePath = join(sub, "mandates.json");
    const emergencyPath = join(sub, "fpp-emergency-overrides.json");
    writeIdentityKey(identityKeyPath, agentSeed);
    const override = signOverride(
      {
        ...baseOverride,
        overrideId: "e-rt-hard",
        scope: { classifications: ["fs.delete.protected"] },
      },
      stewardSeed,
    );
    plantEmergencyOverride(emergencyPath, override);

    const runtime = createEnforcementRuntime(
      {
        auditLogPath: join(sub, "audit.jsonl"),
        receiptLogPath: join(sub, "receipts.jsonl"),
        identityKeyPath,
        mandateStorePath,
        strictModeStatePath: join(sub, "strict.json"),
        dispositionMode: "unattended",
      },
      fakeAdapter(),
    );

    const result = await runtime.onBeforeToolCall(
      {
        toolName: "filesystem_delete",
        params: { path: "~/.ssh/id_ed25519" },
        toolCallId: "tc-emg-hard",
      },
      { toolCallId: "tc-emg-hard" },
    );

    assert.equal(result.action, "block");
    if (result.action === "block") {
      assert.doesNotMatch(result.blockReason, /emergency override rejected/);
      assert.match(result.blockReason, /fs\.delete\.protected|block/i);
    }
  });

  it("agent-self-signed override never yields allow_minimal", async () => {
    const sub = join(ws.path, "selfkey");
    mkdirSync(sub, { recursive: true });
    const identityKeyPath = join(sub, "agent.key");
    const mandateStorePath = join(sub, "mandates.json");
    const emergencyPath = join(sub, "fpp-emergency-overrides.json");
    writeIdentityKey(identityKeyPath, agentSeed);
    const override = signOverride(
      { ...baseOverride, overrideId: "e-rt-self" },
      agentSeed,
    );
    plantEmergencyOverride(emergencyPath, override);

    const runtime = createEnforcementRuntime(
      {
        auditLogPath: join(sub, "audit.jsonl"),
        receiptLogPath: join(sub, "receipts.jsonl"),
        identityKeyPath,
        mandateStorePath,
        strictModeStatePath: join(sub, "strict.json"),
        dispositionMode: "unattended",
      },
      fakeAdapter(),
    );

    const result = await runtime.onBeforeToolCall(
      {
        toolName: "exec",
        params: { command: "sudo systemctl restart nginx" },
        toolCallId: "tc-emg-self",
      },
      { toolCallId: "tc-emg-self" },
    );

    assert.equal(result.action, "block");
    if (result.action === "block") {
      assert.match(
        result.blockReason,
        /emergency override rejected \(agent-self-key\)/,
      );
    }
    if (result.action === "allow") {
      assert.notEqual(result.disposition.disposition, "allow_minimal");
    }
  });
});

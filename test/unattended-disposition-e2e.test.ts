/**
 * End-to-end: unattended vs operator-present disposition modes.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import {
  canonicalizeV2,
  mandateSigningFields,
  signMessage,
  type StandingMandateV1,
} from "@ovrsr/fpp-protocol-core";

import {
  registerEnforcement,
  resetReceiptStore,
  resetStrictModeCache,
  getActiveReceiptStore,
} from "../plugin/src/index.ts";
import { createHookCapture } from "../plugin/src/test-helpers.ts";
import { MandateStore } from "../plugin/src/mandate-store.ts";

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

function signMandate(
  mandate: Omit<StandingMandateV1, "signature" | "publicKey">,
  seed: Uint8Array,
): StandingMandateV1 {
  const publicKey = Buffer.from(ed.getPublicKey(seed)).toString("hex");
  const withKey = { ...mandate, publicKey } as StandingMandateV1;
  const message = Buffer.from(
    canonicalizeV2(mandateSigningFields(withKey)),
    "utf8",
  );
  const signature = Buffer.from(signMessage(message, seed)).toString("hex");
  return { ...withKey, signature };
}

describe("unattended disposition e2e", () => {
  const dir = mkdtempSync(join(tmpdir(), "fpp-unattended-e2e-"));
  after(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  const ctx = {
    agentId: "agent-u",
    runId: "run-u",
    sessionKey: "session-u",
  };

  function setup(extra: Record<string, unknown>) {
    resetStrictModeCache();
    resetReceiptStore();
    const capture = createHookCapture({
      auditLogPath: join(dir, "audit.jsonl"),
      receiptLogPath: join(dir, "receipts.jsonl"),
      identityKeyPath: join(dir, "agent.key"),
      mandateStorePath: join(dir, "mandates.json"),
      respectTrustStrictMode: false,
      ...extra,
    });
    registerEnforcement(capture.api);
    const before = capture.hooks.find((h) => h.event === "before_tool_call")!.handler;
    return before;
  }

  it("hard-floor blocks in both modes", async () => {
    for (const mode of ["unattended", "operator-present"] as const) {
      const before = setup({ dispositionMode: mode });
      const result = (await before(
        {
          toolName: "filesystem_delete",
          params: { path: "/home/user/.ssh/id_ed25519" },
        },
        { ...ctx, toolCallId: `call-block-${mode}` },
      )) as { block?: boolean };
      assert.equal(result.block, true, mode);
    }
  });

  it("unattended abstains on unknown tools; operator-present requires approval", async () => {
    const unattended = setup({ dispositionMode: "unattended" });
    const u = (await unattended(
      { toolName: "custom_mystery_tool", params: {} },
      { ...ctx, toolCallId: "call-abstain" },
    )) as { block?: boolean; blockReason?: string; requireApproval?: unknown };
    assert.equal(u.requireApproval, undefined);
    assert.equal(u.block, true);
    assert.match(u.blockReason ?? "", /^abstain:/);
    const store = getActiveReceiptStore()!;
    assert.equal(store.getFinalized("call-abstain")?.disposition, "abstain");

    const present = setup({ dispositionMode: "operator-present" });
    const p = (await present(
      { toolName: "custom_mystery_tool", params: {} },
      { ...ctx, toolCallId: "call-appr" },
    )) as { requireApproval?: unknown; block?: boolean };
    assert.ok(p.requireApproval);
    assert.notEqual(p.block, true);
  });

  it("unattended allows when a signed mandate covers the classification", async () => {
    const mandatePath = join(dir, "mandates-allow.json");
    const seed = ed.utils.randomPrivateKey();
    const mandate = signMandate(
      {
        schemaVersion: 1,
        mandateId: "e2e-mandate",
        issuerClass: "operator",
        issuerId: "operator:e2e",
        scope: { classifications: ["pkg.install"] },
        budgets: { maxActions: 3, remainingActions: 3 },
        validFrom: "2020-01-01T00:00:00.000Z",
        validTo: "2099-01-01T00:00:00.000Z",
        revocable: true,
        evidenceRef: "evidence:e2e",
      },
      seed,
    );
    const store = new MandateStore(mandatePath);
    store.put(mandate);

    const before = setup({
      dispositionMode: "unattended",
      mandateStorePath: mandatePath,
    });
    const result = await before(
      {
        toolName: "shell_exec",
        params: { command: "npm install lodash" },
      },
      { ...ctx, toolCallId: "call-mandate" },
    );
    assert.equal(result, undefined);
    const reloaded = new MandateStore(mandatePath);
    assert.equal(reloaded.getRemaining("e2e-mandate"), 2);
  });

  it("Issue #5: budgeted mandate allows multiple unattended tool calls without post-debit abstain", async () => {
    const mandatePath = join(dir, "mandates-multidebit.json");
    const seed = ed.utils.randomPrivateKey();
    const mandate = signMandate(
      {
        schemaVersion: 1,
        mandateId: "e2e-multidebit",
        issuerClass: "operator",
        issuerId: "operator:e2e",
        scope: { classifications: ["pkg.install"] },
        budgets: { maxActions: 3, remainingActions: 3 },
        validFrom: "2020-01-01T00:00:00.000Z",
        validTo: "2099-01-01T00:00:00.000Z",
        revocable: true,
        evidenceRef: "evidence:multidebit",
      },
      seed,
    );
    new MandateStore(mandatePath).put(mandate);

    const before = setup({
      dispositionMode: "unattended",
      mandateStorePath: mandatePath,
    });

    for (const callId of ["call-md-1", "call-md-2"]) {
      const result = await before(
        {
          toolName: "shell_exec",
          params: { command: "npm install lodash" },
        },
        { ...ctx, toolCallId: callId },
      );
      assert.equal(
        result,
        undefined,
        `expected allow (undefined) for ${callId}, got ${JSON.stringify(result)}`,
      );
    }

    const reloaded = new MandateStore(mandatePath);
    assert.equal(reloaded.getRemaining("e2e-multidebit"), 1);
    assert.ok(
      reloaded.findCoverage("pkg.install", { nowMs: Date.now() }),
      "mandate must still cover after two debits",
    );
  });
});

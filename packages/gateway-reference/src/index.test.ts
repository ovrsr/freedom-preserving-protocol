/**
 * Gateway-shaped reference stub — CI demos only.
 * Not a production gateway; not an OpenClaw plugin.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import { bytesToHex } from "@noble/hashes/utils";
import { createEnforcementRuntime } from "@ovrsr/fpp-enforcement-core";
import { signMessage, verifySignature } from "@ovrsr/fpp-protocol-core";
import {
  createGatewayReferenceRouter,
  GatewayReferenceDisabledError,
  GatewayReferenceDeniedError,
  GatewayReferenceDrainingError,
  GatewayReferenceDuplicateActiveCallError,
  GatewayReferenceStaleEpochError,
  GovernanceLedger,
  type GovernanceEventSigner,
  type GovernanceEventVerifier,
} from "./index.js";

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

function makeCrypto(): {
  signer: GovernanceEventSigner;
  verifier: GovernanceEventVerifier;
} {
  const seed = new Uint8Array(32).fill(9);
  const publicKeyHex = bytesToHex(ed.getPublicKey(seed));
  return {
    signer: {
      alg: "Ed25519",
      keyId: "host-operator-key-1",
      sign(message) {
        return signMessage(message, seed);
      },
    },
    verifier: {
      verify(message, signatureHex, keyId) {
        if (keyId !== "host-operator-key-1") return false;
        try {
          return verifySignature(
            message,
            Buffer.from(signatureHex, "hex"),
            Buffer.from(publicKeyHex, "hex"),
          );
        } catch {
          return false;
        }
      },
    },
  };
}

describe("createGatewayReferenceRouter", () => {
  const wsPath = mkdtempSync(join(tmpdir(), "fpp-gw-ref-"));
  after(() => rmSync(wsPath, { recursive: true, force: true }));

  function runtime() {
    return createEnforcementRuntime(
      {
        auditLogPath: join(wsPath, "audit.jsonl"),
        receiptLogPath: join(wsPath, "receipts.jsonl"),
        identityKeyPath: join(wsPath, "agent.key"),
        mandateStorePath: join(wsPath, "mandates.json"),
        strictModeStatePath: join(wsPath, "strict.json"),
        dispositionMode: "unattended",
      },
      {
        harnessId: "gateway-reference",
        getWorkspacePaths: () => ({ workspaceRoot: wsPath }),
      },
    );
  }

  it("is disabled by default and refuses to route", async () => {
    let invoked = 0;
    const router = createGatewayReferenceRouter({
      runtime: runtime(),
      invoke: async () => {
        invoked += 1;
        return { ok: true };
      },
    });
    await assert.rejects(
      () =>
        router.route("Shell", { command: "echo hi" }, { toolCallId: "g0" }),
      GatewayReferenceDisabledError,
    );
    assert.equal(invoked, 0);
  });

  it("when enabled, deny/abstain prevents downstream invoke", async () => {
    let invoked = 0;
    const router = createGatewayReferenceRouter({
      enabled: true,
      runtime: runtime(),
      invoke: async () => {
        invoked += 1;
        return { ok: true };
      },
    });
    await assert.rejects(
      () =>
        router.route(
          "Shell",
          { command: "rm -rf ~/.ssh/id_ed25519" },
          { toolCallId: "g1" },
        ),
      GatewayReferenceDeniedError,
    );
    assert.equal(invoked, 0);
  });

  it("when enabled, allow forwards through the fake tool-router", async () => {
    let invoked = 0;
    const router = createGatewayReferenceRouter({
      enabled: true,
      runtime: runtime(),
      invoke: async (toolName, params) => {
        invoked += 1;
        return { toolName, params };
      },
    });
    const result = await router.route(
      "Shell",
      { command: "echo hello" },
      { toolCallId: "g2" },
    );
    assert.equal(invoked, 1);
    assert.deepEqual(result, {
      toolName: "Shell",
      params: { command: "echo hello" },
    });
  });
});

describe("gateway governance transitions", () => {
  const wsPath = mkdtempSync(join(tmpdir(), "fpp-gw-gov-"));
  after(() => rmSync(wsPath, { recursive: true, force: true }));

  function makeRuntime(suffix: string) {
    return createEnforcementRuntime(
      {
        auditLogPath: join(wsPath, `${suffix}-audit.jsonl`),
        receiptLogPath: join(wsPath, `${suffix}-receipts.jsonl`),
        identityKeyPath: join(wsPath, `${suffix}-agent.key`),
        mandateStorePath: join(wsPath, `${suffix}-mandates.json`),
        strictModeStatePath: join(wsPath, `${suffix}-strict.json`),
        dispositionMode: "unattended",
      },
      {
        harnessId: "gateway-reference",
        getWorkspacePaths: () => ({ workspaceRoot: wsPath }),
      },
    );
  }

  function makeLedger(name: string) {
    const { signer, verifier } = makeCrypto();
    return new GovernanceLedger({
      path: join(wsPath, `${name}.jsonl`),
      signer,
      verifier,
      constitutionHash: "71bf60ad" + "0".repeat(56),
      policyEngineVersion: "@ovrsr/fpp-enforcement-core@1.0.0",
    });
  }

  function makeClock() {
    let now = 1_000;
    const waiters: Array<{
      deadline: number;
      resolve: (reason: "deadline" | "cancelled") => void;
    }> = [];
    return {
      nowMs: () => now,
      waitUntil: (deadlineMs: number) =>
        new Promise<"deadline" | "cancelled">((resolve) => {
          if (now >= deadlineMs) {
            resolve("deadline");
            return;
          }
          waiters.push({ deadline: deadlineMs, resolve });
        }),
      advance(ms: number) {
        now += ms;
        const due = waiters.splice(0, waiters.length);
        for (const w of due) {
          if (now >= w.deadline) w.resolve("deadline");
          else waiters.push(w);
        }
      },
    };
  }

  it("aborts only pre-invoke calls and fails disable while an invoke is executing", async () => {
    const clock = makeClock();
    const ledger = makeLedger("phase-boundary");
    const rt = makeRuntime("phase-boundary");
    let releaseInvoke!: () => void;
    const invokeBarrier = new Promise<void>((resolve) => {
      releaseInvoke = resolve;
    });
    let markInvokeStarted!: () => void;
    const invokeStarted = new Promise<void>((resolve) => {
      markInvokeStarted = resolve;
    });
    let releaseReady!: () => void;
    const readyBarrier = new Promise<void>((resolve) => {
      releaseReady = resolve;
    });
    let markReadyReached!: () => void;
    const readyReached = new Promise<void>((resolve) => {
      markReadyReached = resolve;
    });

    const router = createGatewayReferenceRouter({
      enabled: true,
      runtime: rt,
      invoke: async (_toolName, params) => {
        if (params["kind"] === "invoking") {
          markInvokeStarted();
          await invokeBarrier;
        }
        return { ok: true };
      },
      governanceLedger: ledger,
      drainTimeoutMs: 10,
      nowMs: clock.nowMs,
      waitUntil: clock.waitUntil,
      eventIdFactory: () => "evt_phase_boundary",
      beforeInvoke: async ({ toolCallId }) => {
        if (toolCallId === "call-ready") {
          markReadyReached();
          await readyBarrier;
        }
      },
    });

    const invoking = router.route(
      "Shell",
      { command: "echo invoking", kind: "invoking" },
      { toolCallId: "call-invoking" },
    );
    await invokeStarted;
    const ready = router.route(
      "Shell",
      { command: "echo ready", kind: "ready" },
      { toolCallId: "call-ready" },
    );
    await readyReached;

    const disable = router.disableGovernance({ reason: "phase boundary" });
    await new Promise((resolve) => setImmediate(resolve));
    clock.advance(10);
    await assert.rejects(() => disable, /invoking|executing|drain/i);

    assert.deepEqual(router.getGovernanceState(), {
      schemaVersion: 1,
      mode: "enabled",
      epoch: 0,
    });
    assert.equal(
      rt.getReceiptStore().getFinalized("call-ready")?.outcome,
      "governance_transition_aborted",
    );
    assert.ok(rt.getReceiptStore().getPending("call-invoking"));
    const ledgerState = ledger.getLastState();
    assert.equal(ledgerState.ok, true);
    if (ledgerState.ok) assert.equal(ledgerState.events.length, 0);

    releaseReady();
    await assert.rejects(() => ready, GatewayReferenceStaleEpochError);
    releaseInvoke();
    assert.deepEqual(await invoking, { ok: true });
    assert.match(
      rt.getReceiptStore().getFinalized("call-invoking")?.outcome ?? "",
      /^executed:/,
    );
  });

  it("starts enabled at epoch 0 and distinguishes package flag from governance mode", () => {
    const router = createGatewayReferenceRouter({
      enabled: true,
      runtime: makeRuntime("start"),
      invoke: async () => ({ ok: true }),
      governanceLedger: makeLedger("start"),
    });
    assert.equal(router.enabled, true);
    const state = router.getGovernanceState();
    assert.equal(state.mode, "enabled");
    assert.equal(state.epoch, 0);
  });

  it("refuses router startup when governance ledger state is unverifiable", () => {
    const { signer, verifier } = makeCrypto();
    const malformedPath = join(wsPath, "startup-malformed.jsonl");
    writeFileSync(malformedPath, "{not-json\n", "utf8");
    const malformed = new GovernanceLedger({
      path: malformedPath,
      signer,
      verifier,
      constitutionHash: "71bf60ad" + "0".repeat(56),
      policyEngineVersion: "@ovrsr/fpp-enforcement-core@1.0.0",
    });
    assert.throws(
      () =>
        createGatewayReferenceRouter({
          enabled: true,
          runtime: makeRuntime("startup-malformed"),
          invoke: async () => ({ ok: true }),
          governanceLedger: malformed,
        }),
      /ledger|unavailable|malformed/i,
    );

    const valid = makeLedger("startup-bad-signature");
    assert.equal(
      valid.append({
        kind: "governance-disabled",
        eventId: "evt_startup_bad_signature",
        actor: { role: "operator", id: "op_local" },
      }).ok,
      true,
    );
    const signatureInvalid = new GovernanceLedger({
      path: valid.path,
      signer,
      verifier: { verify: () => false },
      constitutionHash: "71bf60ad" + "0".repeat(56),
      policyEngineVersion: "@ovrsr/fpp-enforcement-core@1.0.0",
    });
    assert.throws(
      () =>
        createGatewayReferenceRouter({
          enabled: true,
          runtime: makeRuntime("startup-bad-signature"),
          invoke: async () => ({ ok: true }),
          governanceLedger: signatureInvalid,
        }),
      /ledger|unavailable|signature/i,
    );

    const unreadable = new GovernanceLedger({
      path: valid.path,
      signer,
      verifier,
      constitutionHash: "71bf60ad" + "0".repeat(56),
      policyEngineVersion: "@ovrsr/fpp-enforcement-core@1.0.0",
      ioHooks: {
        beforeRead: () => {
          throw new Error("injected read failure");
        },
      },
    });
    assert.throws(
      () =>
        createGatewayReferenceRouter({
          enabled: true,
          runtime: makeRuntime("startup-unreadable"),
          invoke: async () => ({ ok: true }),
          governanceLedger: unreadable,
        }),
      /ledger|unavailable|read/i,
    );
  });

  it("refuses router startup when an existing governance ledger is empty", () => {
    const { signer, verifier } = makeCrypto();
    const emptyPath = join(wsPath, "startup-empty.jsonl");
    writeFileSync(emptyPath, "", "utf8");
    const emptyLedger = new GovernanceLedger({
      path: emptyPath,
      signer,
      verifier,
      constitutionHash: "71bf60ad" + "0".repeat(56),
      policyEngineVersion: "@ovrsr/fpp-enforcement-core@1.0.0",
    });
    assert.throws(
      () =>
        createGatewayReferenceRouter({
          enabled: true,
          runtime: makeRuntime("startup-empty"),
          invoke: async () => ({ ok: true }),
          governanceLedger: emptyLedger,
        }),
      /ledger|unavailable|empty|corrupt|ambiguous/i,
    );
  });

  it("refuses router startup when ledger constitution or policy context mismatches", () => {
    const { signer, verifier } = makeCrypto();
    const path = join(wsPath, "startup-context-mismatch.jsonl");
    const original = new GovernanceLedger({
      path,
      signer,
      verifier,
      constitutionHash: "71bf60ad" + "0".repeat(56),
      policyEngineVersion: "@ovrsr/fpp-enforcement-core@1.0.0",
    });
    assert.equal(
      original.append({
        kind: "governance-disabled",
        eventId: "evt_startup_context",
        actor: { role: "operator", id: "op_local" },
      }).ok,
      true,
    );
    const mismatched = new GovernanceLedger({
      path,
      signer,
      verifier,
      constitutionHash: "bb".repeat(32),
      policyEngineVersion: "@ovrsr/fpp-enforcement-core@1.0.0",
    });
    assert.throws(
      () =>
        createGatewayReferenceRouter({
          enabled: true,
          runtime: makeRuntime("startup-context-mismatch"),
          invoke: async () => ({ ok: true }),
          governanceLedger: mismatched,
        }),
      /ledger|unavailable|constitution|policy|context/i,
    );
  });

  it("disable publishes durable event then allows ungated calls without receipts", async () => {
    const clock = makeClock();
    const ledger = makeLedger("disable-flow");
    const rt = makeRuntime("disable-flow");
    let invoked = 0;
    const router = createGatewayReferenceRouter({
      enabled: true,
      runtime: rt,
      invoke: async () => {
        invoked += 1;
        return { ok: true };
      },
      governanceLedger: ledger,
      drainTimeoutMs: 50,
      nowMs: clock.nowMs,
      waitUntil: clock.waitUntil,
      eventIdFactory: (() => {
        let n = 0;
        return () => `evt_${++n}`;
      })(),
    });

    const disabled = await router.disableGovernance({ reason: "operator off" });
    assert.equal(disabled.mode, "disabled");
    assert.equal(disabled.epoch, 1);
    assert.equal(router.getGovernanceState().mode, "disabled");

    const beforeFinalized = rt.getReceiptStore().finalizedCount();
    const result = await router.route(
      "Shell",
      { command: "echo ungated" },
      { toolCallId: "ungated-1" },
    );
    assert.deepEqual(result, { ok: true });
    assert.equal(invoked, 1);
    assert.equal(rt.getReceiptStore().finalizedCount(), beforeFinalized);
    assert.equal(rt.getReceiptStore().pendingCount(), 0);

    const ledgerState = ledger.getLastState();
    assert.equal(ledgerState.ok, true);
    if (ledgerState.ok) {
      assert.equal(ledgerState.state.epoch, 1);
      assert.equal(ledgerState.state.mode, "disabled");
    }
  });

  it("rejects new governed admissions while draining", async () => {
    const clock = makeClock();
    const ledger = makeLedger("drain-reject");
    let release!: () => void;
    const barrier = new Promise<void>((r) => {
      release = r;
    });
    const router = createGatewayReferenceRouter({
      enabled: true,
      runtime: makeRuntime("drain-reject"),
      invoke: async () => ({ ok: true }),
      governanceLedger: ledger,
      drainTimeoutMs: 100,
      nowMs: clock.nowMs,
      waitUntil: clock.waitUntil,
      eventIdFactory: () => "evt_drain_reject",
      beforeInvoke: async () => {
        await barrier;
      },
    });

    const inFlight = router.route(
      "Shell",
      { command: "echo hold" },
      { toolCallId: "hold-admit" },
    );
    await new Promise((r) => setImmediate(r));

    const disablePromise = router.disableGovernance({ reason: "drain" });
    await new Promise((r) => setImmediate(r));
    assert.equal(router.getGovernanceState().mode, "draining");

    await assert.rejects(
      () =>
        router.route(
          "Shell",
          { command: "echo new" },
          { toolCallId: "drain-new" },
        ),
      GatewayReferenceDrainingError,
    );

    clock.advance(100);
    await disablePromise;
    release();
    await assert.rejects(() => inFlight, GatewayReferenceStaleEpochError);
  });

  it("bounded drain finalizes leftovers as governance_transition_aborted", async () => {
    const clock = makeClock();
    const ledger = makeLedger("abort");
    const rt = makeRuntime("abort");
    let releaseBarrier!: () => void;
    const barrier = new Promise<void>((r) => {
      releaseBarrier = r;
    });
    const router = createGatewayReferenceRouter({
      enabled: true,
      runtime: rt,
      invoke: async () => ({ ok: true }),
      governanceLedger: ledger,
      drainTimeoutMs: 10,
      nowMs: clock.nowMs,
      waitUntil: clock.waitUntil,
      eventIdFactory: () => "evt_abort",
      beforeInvoke: async () => {
        await barrier;
      },
    });

    const inFlight = router.route(
      "Shell",
      { command: "echo hold" },
      { toolCallId: "held-1" },
    );
    await new Promise((r) => setImmediate(r));
    assert.equal(rt.getReceiptStore().pendingCount(), 1);

    const disablePromise = router.disableGovernance({
      reason: "timeout leftovers",
    });
    await new Promise((r) => setImmediate(r));
    clock.advance(10);
    await disablePromise;

    const finalized = rt.getReceiptStore().getFinalized("held-1");
    assert.ok(finalized);
    assert.equal(finalized.status, "orphan");
    assert.equal(finalized.outcome, "governance_transition_aborted");

    releaseBarrier();
    await assert.rejects(() => inFlight, GatewayReferenceStaleEpochError);
  });

  it("terminalizes a receipt created after its route was transition-aborted", async () => {
    const clock = makeClock();
    const ledger = makeLedger("delayed-receipt");
    const rt = makeRuntime("delayed-receipt");
    const originalBefore = rt.onBeforeToolCall;
    let releaseBefore!: () => void;
    const beforeBarrier = new Promise<void>((resolve) => {
      releaseBefore = resolve;
    });
    rt.onBeforeToolCall = async (event, ctx) => {
      await beforeBarrier;
      return originalBefore(event, ctx);
    };
    let invoked = 0;
    const router = createGatewayReferenceRouter({
      enabled: true,
      runtime: rt,
      invoke: async () => {
        invoked += 1;
        return { ok: true };
      },
      governanceLedger: ledger,
      drainTimeoutMs: 10,
      nowMs: clock.nowMs,
      waitUntil: clock.waitUntil,
      eventIdFactory: () => "evt_delayed_receipt",
    });

    const routed = router.route(
      "Shell",
      { command: "echo delayed" },
      { toolCallId: "delayed-receipt" },
    );
    await new Promise((resolve) => setImmediate(resolve));
    const disabling = router.disableGovernance({ reason: "deadline" });
    await new Promise((resolve) => setImmediate(resolve));
    clock.advance(10);
    await disabling;

    releaseBefore();
    await assert.rejects(() => routed, GatewayReferenceStaleEpochError);
    assert.equal(invoked, 0);
    assert.equal(rt.getReceiptStore().pendingCount(), 0);
    assert.equal(
      rt.getReceiptStore().getFinalized("delayed-receipt")?.outcome,
      "governance_transition_aborted",
    );
  });

  it("ledger append failure leaves router out of ungated disabled mode", async () => {
    const { signer } = makeCrypto();
    const badLedger = new GovernanceLedger({
      path: join(wsPath, "fail-append.jsonl"),
      signer,
      verifier: { verify: () => false },
      constitutionHash: "71bf60ad" + "0".repeat(56),
      policyEngineVersion: "@ovrsr/fpp-enforcement-core@1.0.0",
    });
    const router = createGatewayReferenceRouter({
      enabled: true,
      runtime: makeRuntime("fail-append"),
      invoke: async () => ({ ok: true }),
      governanceLedger: badLedger,
      drainTimeoutMs: 5,
      eventIdFactory: () => "evt_fail",
    });
    await assert.rejects(
      () => router.disableGovernance({ reason: "should fail" }),
      /ledger|signature|unavailable/i,
    );
    assert.notEqual(router.getGovernanceState().mode, "disabled");
  });

  it("receipt persistence failure prevents disable publication", async () => {
    const clock = makeClock();
    const ledger = makeLedger("receipt-persist-fail");
    const rt = makeRuntime("receipt-persist-fail");
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const router = createGatewayReferenceRouter({
      enabled: true,
      runtime: rt,
      invoke: async () => ({ ok: true }),
      governanceLedger: ledger,
      drainTimeoutMs: 10,
      nowMs: clock.nowMs,
      waitUntil: clock.waitUntil,
      eventIdFactory: () => "evt_receipt_persist_fail",
      beforeInvoke: async () => {
        await barrier;
      },
    });
    const held = router.route(
      "Shell",
      { command: "echo held" },
      { toolCallId: "receipt-persist-fail-call" },
    );
    await new Promise((resolve) => setImmediate(resolve));
    writeFileSync(
      join(wsPath, "receipt-persist-fail-receipts.jsonl"),
      "{corrupt-tail\n",
      "utf8",
    );

    const disable = router.disableGovernance({ reason: "must persist receipt" });
    await new Promise((resolve) => setImmediate(resolve));
    clock.advance(10);
    let disableError: unknown;
    try {
      await disable;
    } catch (error) {
      disableError = error;
    }
    release();
    await assert.rejects(() => held, GatewayReferenceStaleEpochError);

    assert.ok(disableError instanceof Error);
    assert.match(disableError.message, /receipt|persist|corrupt/i);
    assert.deepEqual(router.getGovernanceState(), {
      schemaVersion: 1,
      mode: "enabled",
      epoch: 0,
    });
    assert.ok(rt.getReceiptStore().getPending("receipt-persist-fail-call"));
    const state = ledger.getLastState();
    assert.equal(state.ok, true);
    if (state.ok) assert.equal(state.events.length, 0);
  });

  it("enable restores governed routing after durable governance-enabled event", async () => {
    const ledger = makeLedger("enable");
    let seq = 0;
    const router = createGatewayReferenceRouter({
      enabled: true,
      runtime: makeRuntime("enable"),
      invoke: async () => ({ ok: true }),
      governanceLedger: ledger,
      drainTimeoutMs: 5,
      eventIdFactory: () => `evt_en_${++seq}`,
    });
    await router.disableGovernance({ reason: "off" });
    assert.equal(router.getGovernanceState().mode, "disabled");

    const enabled = await router.enableGovernance({ reason: "on" });
    assert.equal(enabled.mode, "enabled");
    assert.equal(enabled.epoch, 2);
    assert.equal(router.getGovernanceState().mode, "enabled");
  });

  it("enable failure leaves governance disabled", async () => {
    const good = makeLedger("enable-fail-good");
    let seq = 0;
    const router = createGatewayReferenceRouter({
      enabled: true,
      runtime: makeRuntime("enable-fail"),
      invoke: async () => ({ ok: true }),
      governanceLedger: good,
      drainTimeoutMs: 5,
      eventIdFactory: () => `evt_ef_${++seq}`,
    });
    await router.disableGovernance({ reason: "off" });

    mkdirSync(`${good.path}.lock`);
    await assert.rejects(
      () => router.enableGovernance({ reason: "on" }),
      /lock|unavailable/i,
    );
    assert.equal(router.getGovernanceState().mode, "disabled");
    rmSync(`${good.path}.lock`, { recursive: true, force: true });
  });

  it("rejects stale-epoch invoke when state changes at the pre-invoke barrier", async () => {
    const clock = makeClock();
    const ledger = makeLedger("stale-epoch");
    const rt = makeRuntime("stale-epoch");
    let release!: () => void;
    const barrier = new Promise<void>((r) => {
      release = r;
    });
    let seq = 0;
    const router = createGatewayReferenceRouter({
      enabled: true,
      runtime: rt,
      invoke: async () => ({ should: "not-run" }),
      governanceLedger: ledger,
      drainTimeoutMs: 5,
      nowMs: clock.nowMs,
      waitUntil: clock.waitUntil,
      eventIdFactory: () => `evt_stale_${++seq}`,
      beforeInvoke: async () => {
        await barrier;
      },
    });

    const inFlight = router.route(
      "Shell",
      { command: "echo stale" },
      { toolCallId: "stale-1" },
    );
    await new Promise((r) => setImmediate(r));

    const disablePromise = router.disableGovernance({ reason: "flip" });
    await new Promise((r) => setImmediate(r));
    clock.advance(5);
    await disablePromise;

    release();
    await assert.rejects(() => inFlight, GatewayReferenceStaleEpochError);
    const finalized = rt.getReceiptStore().getFinalized("stale-1");
    assert.equal(finalized?.outcome, "governance_transition_aborted");
  });

  it("allows in-drain completion when invoke finishes before the deadline", async () => {
    const clock = makeClock();
    const ledger = makeLedger("drain-ok");
    const rt = makeRuntime("drain-ok");
    let release!: () => void;
    const barrier = new Promise<void>((r) => {
      release = r;
    });
    let seq = 0;
    const router = createGatewayReferenceRouter({
      enabled: true,
      runtime: rt,
      invoke: async () => ({ ok: true }),
      governanceLedger: ledger,
      drainTimeoutMs: 1_000,
      nowMs: clock.nowMs,
      waitUntil: clock.waitUntil,
      eventIdFactory: () => `evt_dok_${++seq}`,
      beforeInvoke: async () => {
        await barrier;
      },
    });

    const inFlight = router.route(
      "Shell",
      { command: "echo finish" },
      { toolCallId: "drain-ok-1" },
    );
    await new Promise((r) => setImmediate(r));

    const disablePromise = router.disableGovernance({ reason: "drain-ok" });
    await new Promise((r) => setImmediate(r));
    assert.equal(router.getGovernanceState().mode, "draining");

    // Finish under draining before deadline — same epoch receipts retained.
    release();
    const result = await inFlight;
    assert.deepEqual(result, { ok: true });
    const finalized = rt.getReceiptStore().getFinalized("drain-ok-1");
    assert.equal(finalized?.governanceEpoch, 0);
    assert.match(finalized?.outcome ?? "", /^executed/);

    clock.advance(1_000);
    await disablePromise;
    assert.equal(router.getGovernanceState().mode, "disabled");
  });

  it("duplicate disable/enable requests are idempotent and do not duplicate events", async () => {
    const ledger = makeLedger("idempotent");
    let seq = 0;
    const router = createGatewayReferenceRouter({
      enabled: true,
      runtime: makeRuntime("idempotent"),
      invoke: async () => ({ ok: true }),
      governanceLedger: ledger,
      drainTimeoutMs: 5,
      eventIdFactory: () => `evt_id_${++seq}`,
    });

    await router.disableGovernance({ reason: "off" });
    await router.disableGovernance({ reason: "off-again" });
    let state = ledger.getLastState();
    assert.equal(state.ok, true);
    if (state.ok) {
      assert.equal(state.events.length, 1);
      assert.equal(state.state.epoch, 1);
    }

    await router.enableGovernance({ reason: "on" });
    await router.enableGovernance({ reason: "on-again" });
    state = ledger.getLastState();
    assert.equal(state.ok, true);
    if (state.ok) {
      assert.equal(state.events.length, 2);
      assert.equal(state.state.epoch, 2);
      assert.equal(state.state.mode, "enabled");
    }
  });

  it("rapid off/on/off with concurrent routes keeps linear epochs and one terminal receipt each", async () => {
    const clock = makeClock();
    const ledger = makeLedger("rapid");
    const rt = makeRuntime("rapid");
    let seq = 0;
    const barriers = new Map<string, () => void>();
    const router = createGatewayReferenceRouter({
      enabled: true,
      runtime: rt,
      invoke: async () => ({ ok: true }),
      governanceLedger: ledger,
      drainTimeoutMs: 20,
      nowMs: clock.nowMs,
      waitUntil: clock.waitUntil,
      eventIdFactory: () => `evt_rapid_${++seq}`,
      beforeInvoke: async ({ toolCallId }) => {
        await new Promise<void>((resolve) => {
          barriers.set(toolCallId, resolve);
        });
      },
    });

    const callIds = ["c1", "c2", "c3"];
    const inflight = callIds.map((id) =>
      router.route("Shell", { command: `echo ${id}` }, { toolCallId: id }),
    );
    await new Promise((r) => setImmediate(r));

    // Release first call under enabled; leave others held across toggles.
    barriers.get("c1")?.();
    await inflight[0];

    const d1 = router.disableGovernance({ reason: "off1" });
    await new Promise((r) => setImmediate(r));
    clock.advance(20);
    await d1;

    await router.enableGovernance({ reason: "on1" });
    const d2 = router.disableGovernance({ reason: "off2" });
    await new Promise((r) => setImmediate(r));
    clock.advance(20);
    await d2;

    for (const id of ["c2", "c3"]) {
      barriers.get(id)?.();
      await assert.rejects(() => inflight[callIds.indexOf(id)]!, () => true);
    }

    const ledgerState = ledger.getLastState();
    assert.equal(ledgerState.ok, true);
    if (ledgerState.ok) {
      const epochs = ledgerState.events.map((e) => e.epoch);
      assert.deepEqual(epochs, [1, 2, 3]);
      assert.equal(ledgerState.state.epoch, 3);
      assert.equal(ledgerState.state.mode, "disabled");
      for (let i = 1; i < epochs.length; i++) {
        assert.ok(epochs[i]! > epochs[i - 1]!);
      }
    }

    // Exactly one terminal outcome per admitted call.
    assert.match(
      rt.getReceiptStore().getFinalized("c1")?.outcome ?? "",
      /^executed/,
    );
    assert.equal(
      rt.getReceiptStore().getFinalized("c2")?.outcome,
      "governance_transition_aborted",
    );
    assert.equal(
      rt.getReceiptStore().getFinalized("c3")?.outcome,
      "governance_transition_aborted",
    );
  });

  it("rejects duplicate live toolCallId without overwriting active ownership", async () => {
    const clock = makeClock();
    const ledger = makeLedger("dup-id");
    const rt = makeRuntime("dup-id");
    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let markFirstReady!: () => void;
    const firstReady = new Promise<void>((resolve) => {
      markFirstReady = resolve;
    });
    let invoked = 0;

    const router = createGatewayReferenceRouter({
      enabled: true,
      runtime: rt,
      invoke: async () => {
        invoked += 1;
        return { ok: true };
      },
      governanceLedger: ledger,
      drainTimeoutMs: 50,
      nowMs: clock.nowMs,
      waitUntil: clock.waitUntil,
      eventIdFactory: () => "evt_dup_id",
      beforeInvoke: async ({ toolCallId }) => {
        if (toolCallId === "shared-id") {
          markFirstReady();
          await firstHeld;
        }
      },
    });

    const first = router.route(
      "Shell",
      { command: "echo first" },
      { toolCallId: "shared-id" },
    );
    await firstReady;

    await assert.rejects(
      () =>
        router.route(
          "Shell",
          { command: "echo second" },
          { toolCallId: "shared-id" },
        ),
      GatewayReferenceDuplicateActiveCallError,
    );
    assert.equal(invoked, 0);

    releaseFirst();
    assert.deepEqual(await first, { ok: true });
    assert.equal(invoked, 1);
    assert.match(
      rt.getReceiptStore().getFinalized("shared-id")?.outcome ?? "",
      /^executed:/,
    );
  });

  it("terminalizes require_approval receipts exactly once before returning", async () => {
    const ledger = makeLedger("approval-term");
    const rt = createEnforcementRuntime(
      {
        auditLogPath: join(wsPath, "approval-term-audit.jsonl"),
        receiptLogPath: join(wsPath, "approval-term-receipts.jsonl"),
        identityKeyPath: join(wsPath, "approval-term-agent.key"),
        mandateStorePath: join(wsPath, "approval-term-mandates.json"),
        strictModeStatePath: join(wsPath, "approval-term-strict.json"),
        dispositionMode: "operator-present",
        approvalOn: ["fs.write.workspace"],
      },
      {
        harnessId: "gateway-reference",
        getWorkspacePaths: () => ({ workspaceRoot: wsPath }),
      },
    );
    let invoked = 0;
    const router = createGatewayReferenceRouter({
      enabled: true,
      runtime: rt,
      invoke: async () => {
        invoked += 1;
        return { ok: true };
      },
      governanceLedger: ledger,
      eventIdFactory: () => "evt_approval_term",
    });

    await assert.rejects(
      () =>
        router.route(
          "filesystem_write",
          { path: ".openclaw/workspace/notes.md", content: "x" },
          { toolCallId: "approval-call" },
        ),
      GatewayReferenceDeniedError,
    );
    assert.equal(invoked, 0);

    const finalized = rt.getReceiptStore().getFinalized("approval-call");
    assert.ok(finalized);
    assert.equal(finalized.status, "finalized");
    assert.ok(
      finalized.outcome === "cancelled" || finalized.outcome === "denied",
    );
    assert.equal(rt.getReceiptStore().getPending("approval-call"), undefined);

    // Disable must not create a second terminal receipt for the same call.
    await router.disableGovernance({ reason: "after approval terminal" });
    assert.equal(
      rt.getReceiptStore().getFinalized("approval-call")?.outcome,
      finalized.outcome,
    );
  });

  it("wakes draining immediately when the final active call exits", async () => {
    const clock = makeClock();
    const ledger = makeLedger("drain-wakeup");
    const rt = makeRuntime("drain-wakeup");
    let releaseCall!: () => void;
    const callHeld = new Promise<void>((resolve) => {
      releaseCall = resolve;
    });
    let markReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      markReady = resolve;
    });

    const router = createGatewayReferenceRouter({
      enabled: true,
      runtime: rt,
      invoke: async () => ({ ok: true }),
      governanceLedger: ledger,
      drainTimeoutMs: 60_000,
      nowMs: clock.nowMs,
      waitUntil: clock.waitUntil,
      eventIdFactory: () => "evt_drain_wakeup",
      beforeInvoke: async () => {
        markReady();
        await callHeld;
      },
    });

    const inflight = router.route(
      "Shell",
      { command: "echo wake" },
      { toolCallId: "wake-call" },
    );
    await ready;

    let disableResolved = false;
    const disable = router.disableGovernance({ reason: "wake on idle" }).then(
      (state) => {
        disableResolved = true;
        return state;
      },
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(disableResolved, false);

    // Release the only active call without advancing the long deadline.
    // In-drain completion is allowed; disable must wake on activity, not timeout.
    releaseCall();
    assert.deepEqual(await inflight, { ok: true });

    const state = await disable;
    assert.equal(disableResolved, true);
    assert.deepEqual(state, {
      schemaVersion: 1,
      mode: "disabled",
      epoch: 1,
    });
    assert.match(
      rt.getReceiptStore().getFinalized("wake-call")?.outcome ?? "",
      /^executed:/,
    );
    // Deadline was never advanced — wakeup must not depend on the 60s timeout.
    assert.equal(clock.nowMs(), 1_000);
  });
});

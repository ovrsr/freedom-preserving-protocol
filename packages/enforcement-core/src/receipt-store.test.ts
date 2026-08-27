import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ReceiptStore,
  digestActionParams,
  type ProposeInput,
} from "./receipt-store.js";

function basePropose(
  overrides: Partial<ProposeInput> & Pick<ProposeInput, "toolCallId" | "decision">,
): ProposeInput {
  return {
    toolName: "filesystem_read",
    paramsDigest: digestActionParams({ path: "notes.md" }),
    classification: "fs.read.workspace",
    agentId: "agent-a",
    runId: "run-a",
    sessionKey: "session-a",
    nowIso: "2026-07-10T12:00:00.000Z",
    ...overrides,
  };
}

describe("ReceiptStore lifecycle", () => {
  it("finalizes blocked calls exactly once and leaves them non-pending", () => {
    const store = new ReceiptStore({ maxPending: 8 });
    const first = store.propose(
      basePropose({
        toolCallId: "call-block-1",
        decision: "block",
        classification: "fs.delete.protected",
        toolName: "filesystem_delete",
        paramsDigest: digestActionParams({ path: "/home/user/.ssh/id_ed25519" }),
      }),
    );
    assert.equal(first.finalized, true);
    assert.equal(first.record.status, "finalized");
    assert.equal(first.record.disposition, "deny");
    assert.equal(first.record.outcome, "blocked");
    assert.equal(store.pendingCount(), 0);

    const duplicate = store.propose(
      basePropose({
        toolCallId: "call-block-1",
        decision: "block",
        classification: "fs.delete.protected",
        toolName: "filesystem_delete",
        paramsDigest: digestActionParams({ path: "/home/user/.ssh/id_ed25519" }),
      }),
    );
    assert.equal(duplicate.idempotent, true);
    assert.equal(duplicate.record.receiptId, first.record.receiptId);
    assert.equal(store.finalizedCount(), 1);
  });

  it("keeps allow and approval proposals pending until finalized", () => {
    const store = new ReceiptStore({ maxPending: 8 });
    const allow = store.propose(
      basePropose({ toolCallId: "call-allow-1", decision: "allow" }),
    );
    assert.equal(allow.finalized, false);
    assert.equal(allow.record.status, "pending_execution");
    assert.equal(allow.record.disposition, "allow");

    const approval = store.propose(
      basePropose({
        toolCallId: "call-approval-1",
        decision: "approval",
        classification: "fs.delete.workspace",
      }),
    );
    assert.equal(approval.finalized, false);
    assert.equal(approval.record.status, "pending_authorization");
    assert.equal(approval.record.disposition, "require_approval");
    assert.equal(store.pendingCount(), 2);
  });

  it("does not cross-link concurrent tool calls with different toolCallIds", () => {
    const store = new ReceiptStore({ maxPending: 8 });
    const a = store.propose(
      basePropose({
        toolCallId: "call-a",
        decision: "allow",
        paramsDigest: digestActionParams({ path: "a.md" }),
      }),
    );
    const b = store.propose(
      basePropose({
        toolCallId: "call-b",
        decision: "allow",
        paramsDigest: digestActionParams({ path: "b.md" }),
      }),
    );
    assert.notEqual(a.record.receiptId, b.record.receiptId);
    assert.notEqual(a.record.actionDigest, b.record.actionDigest);

    const finalizedA = store.finalizeExecution("call-a", "executed", "2026-07-10T12:00:01.000Z");
    assert.equal(finalizedA?.receiptId, a.record.receiptId);
    assert.equal(store.getPending("call-b")?.receiptId, b.record.receiptId);
    assert.equal(store.getPending("call-a"), undefined);
  });

  it("marks missing toolCallId as reduced-confidence and uses fallback correlation", () => {
    const store = new ReceiptStore({ maxPending: 8 });
    const result = store.propose(
      basePropose({
        toolCallId: undefined,
        decision: "allow",
      }),
    );
    assert.equal(result.record.correlationConfidence, "reduced");
    assert.equal(result.record.toolCallId, null);
    assert.ok(result.record.fallbackCorrelationKey);
    assert.match(result.record.fallbackCorrelationKey!, /^fallback:/);
    assert.equal(store.pendingCount(), 1);
  });

  it("ignores duplicate after-hook finalize for the same toolCallId", () => {
    const store = new ReceiptStore({ maxPending: 8 });
    store.propose(basePropose({ toolCallId: "call-dup", decision: "allow" }));
    const first = store.finalizeExecution(
      "call-dup",
      "executed",
      "2026-07-10T12:00:01.000Z",
    );
    const second = store.finalizeExecution(
      "call-dup",
      "error",
      "2026-07-10T12:00:02.000Z",
    );
    assert.ok(first);
    assert.equal(first.outcome, "executed");
    assert.equal(second?.idempotent, true);
    assert.equal(second?.outcome, "executed");
    assert.equal(store.finalizedCount(), 1);
  });

  it("bounds pending storage and marks overflow as orphan audit gaps", () => {
    const store = new ReceiptStore({ maxPending: 2 });
    store.propose(basePropose({ toolCallId: "p1", decision: "allow", nowIso: "2026-07-10T12:00:00.000Z" }));
    store.propose(basePropose({ toolCallId: "p2", decision: "allow", nowIso: "2026-07-10T12:00:01.000Z" }));
    assert.equal(store.pendingCount(), 2);

    const overflow = store.propose(
      basePropose({ toolCallId: "p3", decision: "allow", nowIso: "2026-07-10T12:00:02.000Z" }),
    );
    assert.equal(overflow.record.toolCallId, "p3");
    assert.equal(store.pendingCount(), 2);
    assert.equal(store.getPending("p1"), undefined);
    const orphans = store.drainOrphans();
    assert.equal(orphans.length, 1);
    assert.equal(orphans[0]!.toolCallId, "p1");
    assert.equal(orphans[0]!.status, "orphan");
    assert.equal(orphans[0]!.outcome, "audit_gap_overflow");
  });

  it("records allow_staged and allow_minimal dispositions", () => {
    const store = new ReceiptStore({ maxPending: 8 });
    const staged = store.propose(
      basePropose({
        toolCallId: "call-staged",
        decision: "allow",
        disposition: "allow_staged",
        authorization: "mandate",
      }),
    );
    assert.equal(staged.record.disposition, "allow_staged");
    assert.equal(staged.record.authorization, "mandate");
    assert.equal(staged.finalized, false);

    const minimal = store.propose(
      basePropose({
        toolCallId: "call-minimal",
        decision: "allow",
        disposition: "allow_minimal",
        authorization: "emergency",
      }),
    );
    assert.equal(minimal.record.disposition, "allow_minimal");
    assert.equal(minimal.record.authorization, "emergency");
  });

  it("finalizes abstain without pending_authorization hang", () => {
    const store = new ReceiptStore({ maxPending: 8 });
    const result = store.propose(
      basePropose({
        toolCallId: "call-abstain",
        decision: "block",
        disposition: "abstain",
        authorization: "abstain",
        classification: "unknown.unclassified",
      }),
    );
    assert.equal(result.finalized, true);
    assert.equal(result.record.status, "finalized");
    assert.equal(result.record.disposition, "abstain");
    assert.equal(result.record.authorization, "abstain");
    assert.equal(store.pendingCount(), 0);
  });

  it("does not store raw tool parameters on the receipt record", () => {
    const secret = "super-secret-token-value";
    const store = new ReceiptStore({ maxPending: 4 });
    const result = store.propose(
      basePropose({
        toolCallId: "call-secret",
        decision: "allow",
        paramsDigest: digestActionParams({ token: secret }),
      }),
    );
    const serialized = JSON.stringify(result.record);
    assert.equal(serialized.includes(secret), false);
    assert.match(result.record.actionDigest, /^[0-9a-f]{64}$/);
  });

  it("sweeps expired pending receipts into timed_out orphans", () => {
    const store = new ReceiptStore({ maxPending: 4, pendingTtlMs: 1_000 });
    store.propose(
      basePropose({
        toolCallId: "call-expire",
        decision: "allow",
        nowIso: "2026-07-10T12:00:00.000Z",
      }),
    );
    const expired = store.sweepExpired("2026-07-10T12:00:02.000Z");
    assert.equal(expired.length, 1);
    assert.equal(expired[0]!.status, "timed_out");
    assert.equal(expired[0]!.outcome, "audit_gap_timeout");
    assert.equal(store.pendingCount(), 0);
  });

  it("retains captured governanceEpoch and governanceMode on propose", () => {
    const store = new ReceiptStore({ maxPending: 8 });
    const result = store.propose(
      basePropose({
        toolCallId: "call-gov",
        decision: "allow",
        governanceEpoch: 4,
        governanceMode: "enabled",
      }),
    );
    assert.equal(result.record.governanceEpoch, 4);
    assert.equal(result.record.governanceMode, "enabled");
    assert.equal(store.getPending("call-gov")?.governanceEpoch, 4);
  });

  it("transition reconciliation aborts only selected calls from the draining epoch", () => {
    const store = new ReceiptStore({ maxPending: 8 });
    store.propose(
      basePropose({
        toolCallId: "call-drain-ready",
        decision: "allow",
        governanceEpoch: 2,
        governanceMode: "enabled",
      }),
    );
    store.propose(
      basePropose({
        toolCallId: "call-drain-evaluating",
        decision: "approval",
        governanceEpoch: 2,
        governanceMode: "enabled",
      }),
    );
    store.propose(
      basePropose({
        toolCallId: "call-invoking",
        decision: "allow",
        governanceEpoch: 2,
        governanceMode: "enabled",
      }),
    );
    store.propose(
      basePropose({
        toolCallId: "call-other-epoch",
        decision: "allow",
        governanceEpoch: 1,
        governanceMode: "enabled",
      }),
    );
    store.propose(
      basePropose({
        toolCallId: "call-plugin",
        decision: "allow",
      }),
    );
    const aborted = store.abortPendingForGovernanceTransition(
      "2026-07-20T12:00:05.000Z",
      2,
      new Set(["call-drain-ready", "call-drain-evaluating"]),
    );
    assert.equal(aborted.length, 2);
    for (const record of aborted) {
      assert.equal(record.status, "orphan");
      assert.equal(record.outcome, "governance_transition_aborted");
      assert.notEqual(record.outcome, "audit_gap_orphan");
      assert.equal(record.governanceEpoch, 2);
    }
    assert.equal(store.getPending("call-drain-ready"), undefined);
    assert.equal(store.getPending("call-drain-evaluating"), undefined);
    assert.ok(store.getPending("call-invoking"));
    assert.ok(store.getPending("call-other-epoch"));
    assert.ok(store.getPending("call-plugin"));
    assert.equal(store.pendingCount(), 3);
  });

  it("transition reconciliation is idempotent and rejects epoch mismatches", () => {
    const store = new ReceiptStore({ maxPending: 8 });
    store.propose(
      basePropose({
        toolCallId: "call-selected",
        decision: "allow",
        governanceEpoch: 7,
        governanceMode: "enabled",
      }),
    );

    const first = store.abortPendingForGovernanceTransition(
      "2026-07-20T12:00:05.000Z",
      7,
      new Set(["call-selected"]),
    );
    const retry = store.abortPendingForGovernanceTransition(
      "2026-07-20T12:00:06.000Z",
      7,
      new Set(["call-selected"]),
    );
    assert.equal(first.length, 1);
    assert.equal(retry.length, 0);

    store.propose(
      basePropose({
        toolCallId: "call-wrong-epoch",
        decision: "allow",
        governanceEpoch: 8,
        governanceMode: "enabled",
      }),
    );
    assert.throws(
      () =>
        store.abortPendingForGovernanceTransition(
          "2026-07-20T12:00:07.000Z",
          7,
          new Set(["call-wrong-epoch"]),
        ),
      /epoch/i,
    );
    assert.ok(store.getPending("call-wrong-epoch"));
  });

  it("does not commit a transition abort until that record is persisted", () => {
    const store = new ReceiptStore({ maxPending: 8 });
    for (const toolCallId of ["call-persisted", "call-write-fails"]) {
      store.propose(
        basePropose({
          toolCallId,
          decision: "allow",
          governanceEpoch: 9,
          governanceMode: "enabled",
        }),
      );
    }

    assert.throws(
      () =>
        store.abortPendingForGovernanceTransition(
          "2026-07-20T12:00:05.000Z",
          9,
          new Set(["call-persisted", "call-write-fails"]),
          (candidate) => {
            if (candidate.toolCallId === "call-write-fails") {
              throw new Error("injected receipt persistence failure");
            }
          },
        ),
      /persistence failure/i,
    );
    assert.equal(
      store.getFinalized("call-persisted")?.outcome,
      "governance_transition_aborted",
    );
    assert.ok(store.getPending("call-write-fails"));
    assert.equal(store.getFinalized("call-write-fails"), undefined);

    const retry = store.abortPendingForGovernanceTransition(
      "2026-07-20T12:00:06.000Z",
      9,
      new Set(["call-persisted", "call-write-fails"]),
      () => undefined,
    );
    assert.deepEqual(
      retry.map((record) => record.toolCallId),
      ["call-write-fails"],
    );
    assert.equal(store.finalizedCount(), 2);
  });

  it("cancelled authorization is terminal and ignored by later transition abort", () => {
    const store = new ReceiptStore({ maxPending: 4 });
    store.propose(
      basePropose({
        toolCallId: "approval-held",
        decision: "approval",
        governanceEpoch: 2,
        governanceMode: "enabled",
      }),
    );
    assert.equal(
      store.getPending("approval-held")?.status,
      "pending_authorization",
    );

    const cancelled = store.recordAuthorization(
      "approval-held",
      "cancelled",
      "2026-07-20T12:00:01.000Z",
    );
    assert.equal(cancelled?.status, "finalized");
    assert.equal(cancelled?.outcome, "cancelled");
    assert.equal(store.getPending("approval-held"), undefined);

    const aborted = store.abortPendingForGovernanceTransition(
      "2026-07-20T12:00:02.000Z",
      2,
      new Set(["approval-held"]),
    );
    assert.deepEqual(aborted, []);
    assert.equal(store.getFinalized("approval-held")?.outcome, "cancelled");
  });

  it("rejects arbitrary orphan outcomes outside the allowlist", () => {
    const store = new ReceiptStore({ maxPending: 4 });
    store.propose(basePropose({ toolCallId: "call-x", decision: "allow" }));
    assert.throws(
      () =>
        store.orphanAllPending(
          "2026-07-20T12:00:00.000Z",
          "caller_controlled_outcome" as "audit_gap_orphan",
        ),
      /allowlist|invalid.*outcome|governance_transition_aborted|audit_gap_orphan/i,
    );
  });
});

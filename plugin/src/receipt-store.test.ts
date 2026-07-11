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
});

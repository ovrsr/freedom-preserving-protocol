import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { EmergencyReviewLedger } from "./emergency-review.js";
import { createTempWorkspace } from "./test-helpers.js";

describe("EmergencyReviewLedger", () => {
  const ws = createTempWorkspace("fpp-emerg-");
  after(() => ws.cleanup());

  it("appends a mandatory-review record for allow-minimal", () => {
    const path = join(ws.path, "emergency-review.jsonl");
    const ledger = new EmergencyReviewLedger(path);
    const record = ledger.requireReview({
      toolCallId: "call-e1",
      classification: "exec.system-modify",
      actionDigest: "c".repeat(64),
      reason: "emergency allow-minimal",
      nowIso: "2026-07-10T12:00:00.000Z",
    });
    assert.equal(record.status, "mandatory_review_pending");
    assert.equal(record.reviewed, false);
    const lines = readFileSync(path, "utf8").trim().split("\n");
    assert.equal(lines.length, 1);
    assert.match(lines[0]!, /mandatory_review_pending/);
  });

  it("is append-only across multiple emergencies", () => {
    const path = join(ws.path, "emergency-multi.jsonl");
    const ledger = new EmergencyReviewLedger(path);
    ledger.requireReview({
      toolCallId: "a",
      classification: "exec.system-modify",
      actionDigest: "d".repeat(64),
      reason: "e1",
      nowIso: "2026-07-10T12:00:00.000Z",
    });
    ledger.requireReview({
      toolCallId: "b",
      classification: "gateway.config-change",
      actionDigest: "e".repeat(64),
      reason: "e2",
      nowIso: "2026-07-10T12:00:01.000Z",
    });
    const lines = readFileSync(path, "utf8").trim().split("\n");
    assert.equal(lines.length, 2);
  });
});

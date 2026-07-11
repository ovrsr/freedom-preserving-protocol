import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { StagedActionLedger } from "./staged-actions.js";
import { createTempWorkspace } from "./test-helpers.js";

describe("StagedActionLedger", () => {
  const ws = createTempWorkspace("fpp-staged-");
  after(() => ws.cleanup());

  it("writes undo window metadata for a staged allow", () => {
    const path = join(ws.path, "staged.jsonl");
    const ledger = new StagedActionLedger(path);
    const record = ledger.register({
      toolCallId: "call-1",
      classification: "fs.write.workspace",
      actionDigest: "a".repeat(64),
      undoWindowMs: 60_000,
      nowMs: Date.parse("2026-07-10T12:00:00.000Z"),
    });
    assert.equal(record.status, "open");
    assert.equal(record.undoExpiresAt, "2026-07-10T12:01:00.000Z");
    const lines = readFileSync(path, "utf8").trim().split("\n");
    assert.equal(lines.length, 1);
    assert.match(lines[0]!, /"undoExpiresAt"/);
  });

  it("marks expiry without undo as still auditable", () => {
    const path = join(ws.path, "staged-expire.jsonl");
    const ledger = new StagedActionLedger(path);
    ledger.register({
      toolCallId: "call-2",
      classification: "fs.delete.workspace",
      actionDigest: "b".repeat(64),
      undoWindowMs: 1_000,
      nowMs: Date.parse("2026-07-10T12:00:00.000Z"),
    });
    const expired = ledger.sweepExpired(Date.parse("2026-07-10T12:00:02.000Z"));
    assert.equal(expired.length, 1);
    assert.equal(expired[0]!.status, "expired_without_undo");
    const lines = readFileSync(path, "utf8").trim().split("\n");
    assert.ok(lines.length >= 2);
    assert.match(lines.at(-1)!, /expired_without_undo/);
  });
});

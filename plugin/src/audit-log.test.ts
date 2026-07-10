import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appendEnforcementEntry, type EnforcementEvent } from "./audit-log.js";
import { createTempWorkspace } from "./test-helpers.js";

describe("appendEnforcementEntry", () => {
  const ws = createTempWorkspace("fpp-audit-");
  const logPath = join(ws.path, "enforcement.jsonl");

  after(() => ws.cleanup());

  const baseEvent: EnforcementEvent = {
    toolName: "filesystem_delete",
    agentId: "agent-1",
    runId: "run-1",
    sessionKey: "sess-1",
    toolCallId: "call-1",
    classification: "fs.delete.protected",
    decision: "block",
    reason: "protected path",
    constitutionHash: "abc",
  };

  it("chains hashes across outcomes", () => {
    const a = appendEnforcementEntry(logPath, baseEvent, "blocked");
    assert.equal(a.previousHash, "0".repeat(64));
    assert.match(a.hash, /^[0-9a-f]{64}$/);

    const b = appendEnforcementEntry(
      logPath,
      { ...baseEvent, decision: "allow", classification: "fs.read" },
      "allowed",
    );
    assert.equal(b.previousHash, a.hash);

    const lines = readFileSync(logPath, "utf8").trim().split("\n");
    assert.equal(lines.length, 2);
    const first = JSON.parse(lines[0]!);
    assert.equal(first.toolCallId, "call-1");
    const second = JSON.parse(lines[1]!);
    assert.equal(second.outcome, "allowed");
    assert.equal(second.agentId, "agent-1");
    assert.equal(second.runId, "run-1");
    assert.equal(second.sessionKey, "sess-1");
    assert.equal(second.toolCallId, "call-1");
  });

  it("stores null for missing correlation ids", () => {
    const path3 = join(ws.path, "missing.jsonl");
    appendEnforcementEntry(
      path3,
      {
        toolName: "shell_exec",
        classification: "exec.benign",
        decision: "allow",
        reason: "benign shell",
        constitutionHash: "abc",
      },
      "allowed",
    );
    const entry = JSON.parse(readFileSync(path3, "utf8").trim());
    assert.equal(entry.agentId, null);
    assert.equal(entry.runId, null);
    assert.equal(entry.sessionKey, null);
    assert.equal(entry.toolCallId, null);
  });

  it("records approval_requested and approved outcomes", () => {
    const path2 = join(ws.path, "approval.jsonl");
    appendEnforcementEntry(path2, { ...baseEvent, decision: "approval" }, "approval_requested");
    appendEnforcementEntry(path2, { ...baseEvent, decision: "approval" }, "approved");
    const lines = readFileSync(path2, "utf8").trim().split("\n");
    assert.equal(JSON.parse(lines[0]!).outcome, "approval_requested");
    assert.equal(JSON.parse(lines[1]!).outcome, "approved");
  });

  it("throws explicit corruption error on malformed tail instead of zero hash", () => {
    const corruptPath = join(ws.path, "corrupt.jsonl");
    writeFileSync(corruptPath, "not-valid-json\n", "utf8");
    assert.throws(
      () => appendEnforcementEntry(corruptPath, baseEvent, "blocked"),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /corrupt/i);
        assert.doesNotMatch(err.message, /^$/);
        return true;
      },
    );
    // Must not silently restart the chain with a zero previousHash entry.
    const content = readFileSync(corruptPath, "utf8");
    assert.equal(content.trim(), "not-valid-json");
  });

  it("throws on hash-field corruption in otherwise parseable tail", () => {
    const badHashPath = join(ws.path, "bad-hash.jsonl");
    writeFileSync(
      badHashPath,
      JSON.stringify({
        previousHash: "0".repeat(64),
        timestamp: new Date().toISOString(),
        kind: "enforcement",
        hash: "not-a-valid-hash",
      }) + "\n",
      "utf8",
    );
    assert.throws(
      () => appendEnforcementEntry(badHashPath, baseEvent, "blocked"),
      /corrupt/i,
    );
  });
});

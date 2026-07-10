import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTempWorkspace } from "./test-helpers.js";
import {
  loadReceiptSigner,
  signReceiptPayload,
  type ReceiptSignPayload,
} from "./receipt-signer.js";
import {
  appendSignedReceipt,
  verifyReceiptLog,
  ReceiptLogCorruptionError,
  collectReceiptLeaves,
  createReceiptProof,
  RECEIPT_LOG_KIND,
} from "./receipt-log.js";

function makeSigned(wsPath: string, outcome = "executed") {
  const signer = loadReceiptSigner({
    keyPath: join(wsPath, "agent.key"),
    enabled: true,
    basePath: "/",
  });
  const payload: ReceiptSignPayload = {
    schemaVersion: 1,
    receiptClass: "conformance",
    actionDigest: "a".repeat(64),
    policyId: "fpp-enforcement",
    policyVersion: "1.1.4",
    implementationVersion: "1.1.4",
    disposition: "allow",
    authorization: "policy-match",
    outcome,
    issuedAt: "2026-07-10T12:00:00.000Z",
  };
  return signReceiptPayload(payload, signer);
}

describe("receipt ledger", () => {
  const ws = createTempWorkspace("fpp-rlog-");
  after(() => ws.cleanup());

  it("appends signed receipts with hash chaining", () => {
    const logPath = join(ws.path, "receipts.jsonl");
    const a = appendSignedReceipt(logPath, makeSigned(ws.path, "executed"));
    const b = appendSignedReceipt(logPath, makeSigned(ws.path, "blocked"));
    assert.match(a.hash, /^[0-9a-f]{64}$/);
    assert.equal(b.previousHash, a.hash);
    const report = verifyReceiptLog(logPath);
    assert.equal(report.ok, true);
    assert.equal(report.entries, 2);
    assert.equal(report.logKind, RECEIPT_LOG_KIND);
  });

  it("verifies signatures on each receipt entry", () => {
    const logPath = join(ws.path, "sig-receipts.jsonl");
    appendSignedReceipt(logPath, makeSigned(ws.path));
    const report = verifyReceiptLog(logPath);
    assert.equal(report.ok, true);
    assert.equal(report.signatureFailures, 0);
  });

  it("detects chain tampering", () => {
    const logPath = join(ws.path, "tamper.jsonl");
    appendSignedReceipt(logPath, makeSigned(ws.path, "a"));
    appendSignedReceipt(logPath, makeSigned(ws.path, "b"));
    const lines = readFileSync(logPath, "utf8").trim().split("\n");
    const second = JSON.parse(lines[1]!);
    second.previousHash = "0".repeat(64);
    writeFileSync(logPath, lines[0] + "\n" + JSON.stringify(second) + "\n");
    const report = verifyReceiptLog(logPath);
    assert.equal(report.ok, false);
    assert.ok(report.errors.some((e) => /previousHash/i.test(e)));
  });

  it("fails closed on malformed tail and refuses further append", () => {
    const logPath = join(ws.path, "corrupt.jsonl");
    writeFileSync(logPath, "{broken\n", "utf8");
    assert.throws(
      () => appendSignedReceipt(logPath, makeSigned(ws.path)),
      (err: unknown) => err instanceof ReceiptLogCorruptionError,
    );
    assert.equal(readFileSync(logPath, "utf8").trim(), "{broken");
  });

  it("creates a Merkle inclusion proof without raw action parameters", () => {
    const logPath = join(ws.path, "proof.jsonl");
    appendSignedReceipt(logPath, makeSigned(ws.path, "p0"));
    appendSignedReceipt(logPath, makeSigned(ws.path, "p1"));
    const leaves = collectReceiptLeaves(logPath);
    const proof = createReceiptProof(logPath, 1);
    assert.ok(proof);
    assert.equal(proof.leaf, leaves[1]);
    assert.equal(proof.logKind, RECEIPT_LOG_KIND);
    const serialized = JSON.stringify(proof);
    assert.equal(serialized.includes("super-secret"), false);
  });

  it("rejects typed-log confusion with heartbeat/enforcement kinds", () => {
    const logPath = join(ws.path, "wrong-kind.jsonl");
    const entry = {
      previousHash: "0".repeat(64),
      timestamp: "2026-07-10T12:00:00.000Z",
      kind: "enforcement",
      hash: "c".repeat(64),
    };
    writeFileSync(logPath, JSON.stringify(entry) + "\n");
    const report = verifyReceiptLog(logPath);
    assert.equal(report.ok, false);
    assert.ok(report.errors.some((e) => /log kind|receipt/i.test(e)));
  });
});

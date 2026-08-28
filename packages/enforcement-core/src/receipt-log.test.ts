import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DIGEST_DOMAINS, digest } from "@ovrsr/fpp-protocol-core";
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
  createReceiptInclusionEvidence,
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

function rehashEntry(entry: Record<string, unknown>): Record<string, unknown> {
  const { hash: _hash, ...preimage } = entry;
  void _hash;
  return {
    ...preimage,
    hash: digest({
      version: 2,
      domain: DIGEST_DOMAINS.entry,
      value: preimage,
    }),
  };
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

  it("refuses append when a non-tail entry is corrupt even if the tail hash looks intact", () => {
    const logPath = join(ws.path, "mid-corrupt.jsonl");
    appendSignedReceipt(logPath, makeSigned(ws.path, "first"));
    appendSignedReceipt(logPath, makeSigned(ws.path, "second"));
    const before = readFileSync(logPath);
    const lines = before.toString("utf8").trim().split("\n");
    assert.equal(lines.length, 2);

    const first = JSON.parse(lines[0]!);
    first.receipt.outcome = "tampered-mid-chain";
    // Keep the stored hash and the second entry untouched so a tail-only
    // previousHash reader would still accept the chain head.
    writeFileSync(logPath, JSON.stringify(first) + "\n" + lines[1] + "\n");

    const afterTamper = readFileSync(logPath);
    assert.throws(
      () => appendSignedReceipt(logPath, makeSigned(ws.path, "third")),
      (err: unknown) =>
        err instanceof ReceiptLogCorruptionError &&
        /hash|chain|corrupt|previousHash|signature/i.test(err.message),
    );
    assert.deepEqual(readFileSync(logPath), afterTamper);
    assert.notDeepEqual(afterTamper, before);
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

  it("exports inclusion evidence with the exact entry preimage and proof", () => {
    const logPath = join(ws.path, "evidence.jsonl");
    const receipt = makeSigned(ws.path, "included");
    appendSignedReceipt(logPath, receipt);
    const evidence = createReceiptInclusionEvidence(logPath, 0);
    assert.ok(evidence);
    assert.equal(evidence.evidenceVersion, 1);
    assert.equal(evidence.logKind, RECEIPT_LOG_KIND);
    assert.deepEqual(evidence.entry.receipt, receipt);
    assert.equal(evidence.entry.kind, RECEIPT_LOG_KIND);
    assert.equal(evidence.proof.leaf, evidence.entry.hash);
    assert.equal(evidence.proof.root, evidence.entry.hash);
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

  it("fails root and proof generation closed with indexed diagnostics for every malformed entry", () => {
    const cases: Array<{
      name: string;
      mutate: (lines: string[]) => string[];
      expected: RegExp;
    }> = [
      {
        name: "invalid-json",
        mutate: (lines) => [lines[0]!, "{broken"],
        expected: /line 2: invalid JSON/i,
      },
      {
        name: "wrong-kind",
        mutate: (lines) => {
          const entry = JSON.parse(lines[0]!) as Record<string, unknown>;
          return [JSON.stringify(rehashEntry({ ...entry, kind: "enforcement" }))];
        },
        expected: /line 1: unexpected log kind/i,
      },
      {
        name: "broken-hash",
        mutate: (lines) => {
          const entry = JSON.parse(lines[0]!) as Record<string, unknown>;
          return [JSON.stringify({ ...entry, hash: "f".repeat(64) })];
        },
        expected: /line 1: hash mismatch/i,
      },
      {
        name: "chain-gap",
        mutate: (lines) => {
          const second = JSON.parse(lines[1]!) as Record<string, unknown>;
          return [
            lines[0]!,
            JSON.stringify(
              rehashEntry({ ...second, previousHash: "f".repeat(64) }),
            ),
          ];
        },
        expected: /line 2: previousHash mismatch/i,
      },
      {
        name: "invalid-signature",
        mutate: (lines) => {
          const entry = JSON.parse(lines[0]!) as Record<string, unknown> & {
            receipt: Record<string, unknown>;
          };
          return [
            JSON.stringify(
              rehashEntry({
                ...entry,
                receipt: { ...entry.receipt, signature: "00".repeat(64) },
              }),
            ),
          ];
        },
        expected: /line 1: signature failure/i,
      },
      {
        name: "duplicate-entry",
        mutate: (lines) => [lines[0]!, lines[0]!],
        expected: /line 2: duplicate (?:entry|hash)/i,
      },
    ];

    for (const testCase of cases) {
      const logPath = join(ws.path, `strict-${testCase.name}.jsonl`);
      appendSignedReceipt(logPath, makeSigned(ws.path, `${testCase.name}-a`));
      appendSignedReceipt(logPath, makeSigned(ws.path, `${testCase.name}-b`));
      const original = readFileSync(logPath, "utf8").trim().split("\n");
      writeFileSync(
        logPath,
        testCase.mutate(original).join("\n") + "\n",
        "utf8",
      );

      const report = verifyReceiptLog(logPath);
      assert.equal(report.ok, false, testCase.name);
      assert.match(report.errors.join("; "), testCase.expected, testCase.name);
      assert.throws(
        () => collectReceiptLeaves(logPath),
        testCase.expected,
        `${testCase.name}: root collection`,
      );
      assert.throws(
        () => createReceiptProof(logPath, 0),
        testCase.expected,
        `${testCase.name}: proof generation`,
      );
      assert.throws(
        () => createReceiptInclusionEvidence(logPath, 0),
        testCase.expected,
        `${testCase.name}: evidence generation`,
      );
    }
  });
});

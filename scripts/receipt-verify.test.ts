/**
 * Tests for receipt ledger CLI verify/proof helpers.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { verifyReceiptLog, RECEIPT_LOG_KIND } from "./receipt-verify.ts";
import {
  generateReceiptProof,
  verifyReceiptProofFile,
} from "./receipt-proof.ts";
import {
  loadReceiptSigner,
  signReceiptPayload,
} from "../plugin/src/receipt-signer.ts";
import { appendSignedReceipt } from "../plugin/src/receipt-log.ts";

describe("receipt-verify CLI helpers", () => {
  const workdir = mkdtempSync(join(tmpdir(), "fpp-rv-"));
  after(() => {
    if (existsSync(workdir)) rmSync(workdir, { recursive: true, force: true });
  });

  it("verifies a valid receipt log and rejects enforcement-kind confusion", () => {
    const log = join(workdir, "ok.jsonl");
    const signer = loadReceiptSigner({
      keyPath: join(workdir, "k.key"),
      enabled: true,
      basePath: "/",
    });
    const receipt = signReceiptPayload(
      {
        schemaVersion: 1,
        receiptClass: "conformance",
        actionDigest: "a".repeat(64),
        policyId: "fpp-enforcement",
        policyVersion: "1",
        implementationVersion: "1",
        disposition: "allow",
        authorization: "policy-match",
        outcome: "executed",
        issuedAt: "2026-07-10T12:00:00.000Z",
      },
      signer,
    );
    appendSignedReceipt(log, receipt);
    const report = verifyReceiptLog(log);
    assert.equal(report.ok, true);
    assert.equal(report.logKind, RECEIPT_LOG_KIND);

    const wrong = join(workdir, "wrong.jsonl");
    writeFileSync(
      wrong,
      JSON.stringify({
        previousHash: "0".repeat(64),
        kind: "heartbeat",
        hash: "d".repeat(64),
      }) + "\n",
    );
    const bad = verifyReceiptLog(wrong);
    assert.equal(bad.ok, false);
  });
});

describe("receipt-proof CLI helpers", () => {
  const workdir = mkdtempSync(join(tmpdir(), "fpp-rp-"));
  after(() => {
    if (existsSync(workdir)) rmSync(workdir, { recursive: true, force: true });
  });

  it("round-trips a receipt inclusion proof with logKind binding", () => {
    const log = join(workdir, "proof.jsonl");
    const signer = loadReceiptSigner({
      keyPath: join(workdir, "k.key"),
      enabled: true,
      basePath: "/",
    });
    for (const outcome of ["a", "b"]) {
      appendSignedReceipt(
        log,
        signReceiptPayload(
          {
            schemaVersion: 1,
            receiptClass: "conformance",
            actionDigest: "a".repeat(64),
            policyId: "fpp-enforcement",
            policyVersion: "1",
            implementationVersion: "1",
            disposition: "allow",
            authorization: "policy-match",
            outcome,
            issuedAt: "2026-07-10T12:00:00.000Z",
          },
          signer,
        ),
      );
    }
    const proof = generateReceiptProof(log, 1);
    assert.equal(proof.logKind, RECEIPT_LOG_KIND);
    const proofPath = join(workdir, "proof.json");
    writeFileSync(proofPath, JSON.stringify(proof));
    const report = verifyReceiptProofFile(proofPath, log);
    assert.equal(report.valid, true);
    assert.equal(report.rootMatch, true);
    assert.equal(report.logKindMatch, true);
  });
});

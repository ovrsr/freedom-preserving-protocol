/**
 * Companion tests live alongside receipt-verify; this file covers proof-only
 * negative cases for typed-root confusion.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { verifyReceiptProofFile, generateReceiptProof } from "./receipt-proof.ts";
import {
  loadReceiptSigner,
  signReceiptPayload,
} from "../plugin/src/receipt-signer.ts";
import { appendSignedReceipt } from "../plugin/src/receipt-log.ts";

describe("receipt-proof negative cases", () => {
  const workdir = mkdtempSync(join(tmpdir(), "fpp-rpn-"));
  after(() => {
    if (existsSync(workdir)) rmSync(workdir, { recursive: true, force: true });
  });

  it("rejects proofs that claim a non-receipt logKind", () => {
    const log = join(workdir, "r.jsonl");
    const signer = loadReceiptSigner({
      keyPath: join(workdir, "k.key"),
      enabled: true,
      basePath: "/",
    });
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
          outcome: "executed",
          issuedAt: "2026-07-10T12:00:00.000Z",
        },
        signer,
      ),
    );
    const proof = generateReceiptProof(log, 0);
    const tampered = { ...proof, logKind: "heartbeat" };
    const proofPath = join(workdir, "bad-proof.json");
    writeFileSync(proofPath, JSON.stringify(tampered));
    const report = verifyReceiptProofFile(proofPath, log);
    assert.equal(report.logKindMatch, false);
  });
});

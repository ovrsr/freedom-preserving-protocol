import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  KEY_ALGORITHM,
  canonicalizeV2,
  deriveAgentIdV2,
  signMessage,
  publicKeyFromSeed,
} from "@ovrsr/fpp-protocol-core";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import {
  verifyReceiptEvidence,
  verifyReceiptSignatureLocal,
  getReceiptRoot,
  createTypedReceiptProof,
  RECEIPT_LOG_KIND,
} from "./receipt-verifier.js";

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

function makeSignedReceipt(seed: Uint8Array, overrides: Record<string, unknown> = {}) {
  const pub = publicKeyFromSeed(seed);
  const publicKeyHex = Buffer.from(pub).toString("hex");
  const agentId = deriveAgentIdV2(publicKeyHex);
  const base: Record<string, unknown> = {
    schemaVersion: 1,
    receiptClass: "conformance",
    actionDigest: "a".repeat(64),
    policyId: "fpp-enforcement:deadbeef",
    policyVersion: "pol-1",
    implementationVersion: "1.1.4",
    disposition: "allow",
    authorization: "policy-match",
    outcome: "executed",
    issuedAt: "2026-07-10T12:00:00.000Z",
    signingStatus: "signed",
    trustElevating: true,
    canonicalizationVersion: 2,
    keyAlgorithm: KEY_ALGORITHM,
    agentId,
    keyFingerprint: agentId.slice(-64),
    classifierRulesetHash: "c".repeat(64),
    ...overrides,
  };
  const { signature: _s, publicKey: _p, payloadDigest: _d, ...rest } = base;
  void _s;
  void _p;
  void _d;
  const message = new TextEncoder().encode(canonicalizeV2(rest));
  const sig = signMessage(message, seed);
  return {
    ...rest,
    publicKey: publicKeyHex,
    signature: Buffer.from(sig).toString("hex"),
  };
}

describe("receipt verifier", () => {
  const dir = mkdtempSync(join(tmpdir(), "fpp-rv-"));
  after(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it("accepts a valid signed receipt", () => {
    const seed = ed.utils.randomPrivateKey();
    const receipt = makeSignedReceipt(seed);
    const report = verifyReceiptEvidence({ receipt });
    assert.equal(report.valid, true);
    assert.equal(report.claimClass, "event");
    assert.ok(report.whatWasNotProven.some((x) => /behavioral/i.test(x)));
  });

  it("rejects wrong signer / agentId mismatch", () => {
    const seed = ed.utils.randomPrivateKey();
    const receipt = makeSignedReceipt(seed, {
      agentId: "fpp:ed25519:" + "b".repeat(64),
    });
    const sig = verifyReceiptSignatureLocal(receipt);
    assert.equal(sig.valid, false);
  });

  it("rejects wrong policy hash", () => {
    const seed = ed.utils.randomPrivateKey();
    const receipt = makeSignedReceipt(seed);
    const report = verifyReceiptEvidence({
      receipt,
      expectedPolicyVersion: "other-policy",
    });
    assert.equal(report.valid, false);
    assert.ok(report.reasons.some((r) => /policyVersion/i.test(r)));
  });

  it("rejects unknown schema", () => {
    const report = verifyReceiptEvidence({
      receipt: { schemaVersion: 99, receiptClass: "conformance" },
    });
    assert.equal(report.valid, false);
  });

  it("rejects cross-log root confusion on inclusion proofs", () => {
    const seed = ed.utils.randomPrivateKey();
    const receipt = makeSignedReceipt(seed);
    const report = verifyReceiptEvidence({
      receipt,
      inclusionProof: {
        leaf: "a".repeat(64),
        index: 0,
        path: [],
        root: "a".repeat(64),
        logKind: "heartbeat",
      },
    });
    assert.equal(report.valid, false);
    assert.ok(report.reasons.some((r) => /logKind confusion/i.test(r)));
  });

  it("reads typed receipt roots without mixing enforcement kinds", () => {
    const log = join(dir, "mixed.jsonl");
    writeFileSync(
      log,
      JSON.stringify({
        previousHash: "0".repeat(64),
        kind: "enforcement",
        hash: "e".repeat(64),
      }) +
        "\n" +
        JSON.stringify({
          previousHash: "0".repeat(64),
          kind: RECEIPT_LOG_KIND,
          hash: "r".repeat(64),
          receipt: {},
        }) +
        "\n",
    );
    const root = getReceiptRoot(log);
    assert.equal(root.entryCount, 1);
    assert.equal(root.logKind, RECEIPT_LOG_KIND);
    assert.equal(root.root, "r".repeat(64));
    const proof = createTypedReceiptProof(log, 0);
    assert.ok(proof);
    assert.equal(proof.logKind, RECEIPT_LOG_KIND);
  });
});

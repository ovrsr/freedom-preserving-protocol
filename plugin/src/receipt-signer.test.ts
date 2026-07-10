import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTempWorkspace } from "./test-helpers.js";
import {
  loadReceiptSigner,
  signReceiptPayload,
  verifyReceiptSignature,
  type ReceiptSignPayload,
} from "./receipt-signer.js";

const basePayload = (): ReceiptSignPayload => ({
  schemaVersion: 1,
  receiptClass: "conformance",
  actionDigest: "a".repeat(64),
  policyId: "fpp-enforcement",
  policyVersion: "1.1.4",
  implementationVersion: "1.1.4",
  disposition: "allow",
  authorization: "policy-match",
  outcome: "executed",
  issuedAt: "2026-07-10T12:00:00.000Z",
});

describe("receipt signer", () => {
  const ws = createTempWorkspace("fpp-signer-");
  after(() => ws.cleanup());

  it("round-trips a signed receipt with the shared identity format", () => {
    const keyPath = join(ws.path, "agent.key");
    const signer = loadReceiptSigner({ keyPath, enabled: true });
    assert.equal(signer.mode, "signed");
    assert.ok(signer.agentId.startsWith("fpp:ed25519:"));
    const signed = signReceiptPayload(basePayload(), signer);
    assert.equal(signed.signingStatus, "signed");
    assert.equal(signed.keyAlgorithm, "ed25519");
    assert.equal(signed.canonicalizationVersion, 2);
    assert.ok(signed.signature);
    assert.ok(signed.keyFingerprint);
    const verified = verifyReceiptSignature(signed);
    assert.equal(verified.valid, true);
  });

  it("rejects verification when agentId does not match the public key", () => {
    const keyPath = join(ws.path, "mismatch.key");
    const signer = loadReceiptSigner({ keyPath, enabled: true });
    const signed = signReceiptPayload(basePayload(), signer);
    signed.agentId = "fpp:ed25519:" + "b".repeat(64);
    const verified = verifyReceiptSignature(signed);
    assert.equal(verified.valid, false);
    assert.match(verified.reason, /agentId/i);
  });

  it("fails closed on malformed identity key material", () => {
    const keyPath = join(ws.path, "bad.key");
    writeFileSync(keyPath, Buffer.from("not-32-bytes"));
    assert.throws(
      () => loadReceiptSigner({ keyPath, enabled: true }),
      /malformed/i,
    );
  });

  it("loads the same key material as the trust plugin identity format", async () => {
    const keyPath = join(ws.path, "shared.key");
    const enforcement = loadReceiptSigner({ keyPath, enabled: true });
    // Dynamic import keeps this test from requiring a build of plugin-trust.
    const { loadOrCreateIdentity } = await import(
      "../../plugin-trust/src/identity.js"
    );
    const trust = loadOrCreateIdentity(keyPath, "/");
    assert.equal(enforcement.agentId, trust.agentId);
    assert.equal(enforcement.publicKeyHex, trust.publicKeyHex);
  });

  it("emits explicit unsigned degraded receipts when signing is disabled", () => {
    const signer = loadReceiptSigner({
      keyPath: join(ws.path, "unused.key"),
      enabled: false,
    });
    assert.equal(signer.mode, "unsigned-degraded");
    const signed = signReceiptPayload(basePayload(), signer);
    assert.equal(signed.signingStatus, "unsigned-degraded");
    assert.equal(signed.trustElevating, false);
    assert.equal(signed.signature, undefined);
    const verified = verifyReceiptSignature(signed);
    assert.equal(verified.valid, false);
    assert.match(verified.reason, /unsigned|degraded/i);
  });
});

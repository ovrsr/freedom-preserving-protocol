import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as openpgp from "openpgp";
import { canonicalizeV2 } from "@ovrsr/fpp-protocol-core";
import {
  SignatureBackendRegistry,
  createDefaultBackendRegistry,
} from "./signature-backend.js";
import { createOpenPgpBackend } from "./openpgp-backend.js";

async function generateTestKey(name: string) {
  const { privateKey, publicKey } = await openpgp.generateKey({
    type: "ecc",
    curve: "curve25519Legacy",
    userIDs: [{ name, email: `${name}@example.test` }],
    format: "object",
  });
  const fingerprint = publicKey.getFingerprint().toLowerCase();
  return {
    privateKey,
    publicKey,
    publicKeyArmored: publicKey.armor(),
    privateKeyArmored: privateKey.armor(),
    fingerprint,
    keyRef: `openpgp:${fingerprint}`,
  };
}

describe("OpenPGP signature backend", () => {
  it("parses a public key to openpgp:<lowercase fingerprint>", async () => {
    const key = await generateTestKey("alice");
    const backend = createOpenPgpBackend();
    const parsed = await backend.parsePublicKey(key.publicKeyArmored);
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.keyRef, key.keyRef);
      assert.equal(parsed.fingerprint, key.fingerprint);
    }
  });

  it("rejects private-key armor", async () => {
    const key = await generateTestKey("bob");
    const backend = createOpenPgpBackend();
    const parsed = await backend.parsePublicKey(key.privateKeyArmored);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.match(parsed.reason, /private/i);
    }
  });

  it("verifies a detached signature over exact canonical payload", async () => {
    const key = await generateTestKey("carol");
    const backend = createOpenPgpBackend();
    const payload = { hello: "world", n: 1 };
    const canonical = canonicalizeV2(payload);
    const message = await openpgp.createMessage({ text: canonical });
    const detached = await openpgp.sign({
      message,
      signingKeys: key.privateKey,
      detached: true,
    });
    const issuedAt = new Date().toISOString();
    const result = await backend.verifyDetached({
      canonicalPayload: canonical,
      signaturesArmored: [detached],
      publicKeysArmored: [key.publicKeyArmored],
      expectedKeyRefs: [key.keyRef],
      issuedAt,
      nowMs: Date.now(),
      allowedClockSkewMs: 60_000,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.signingKeyRefs, [key.keyRef]);
    }
  });

  it("verifies a clear-signed message whose text equals canonical payload", async () => {
    const key = await generateTestKey("dave");
    const backend = createOpenPgpBackend();
    const canonical = canonicalizeV2({ a: 1, b: "x" });
    const clear = await openpgp.sign({
      message: await openpgp.createCleartextMessage({ text: canonical }),
      signingKeys: key.privateKey,
    });
    const issuedAt = new Date().toISOString();
    const result = await backend.verifyCleartext({
      cleartextArmored: clear,
      expectedCanonicalPayload: canonical,
      publicKeysArmored: [key.publicKeyArmored],
      expectedKeyRefs: [key.keyRef],
      issuedAt,
      nowMs: Date.now(),
      allowedClockSkewMs: 60_000,
    });
    assert.equal(result.ok, true);
  });

  it("verifies multiple detached signatures when all expected keys signed", async () => {
    const a = await generateTestKey("multi-a");
    const b = await generateTestKey("multi-b");
    const backend = createOpenPgpBackend();
    const canonical = canonicalizeV2({ multi: true });
    const message = await openpgp.createMessage({ text: canonical });
    const sigA = await openpgp.sign({
      message,
      signingKeys: a.privateKey,
      detached: true,
    });
    const sigB = await openpgp.sign({
      message,
      signingKeys: b.privateKey,
      detached: true,
    });
    const issuedAt = new Date().toISOString();
    const result = await backend.verifyDetached({
      canonicalPayload: canonical,
      signaturesArmored: [sigA, sigB],
      publicKeysArmored: [a.publicKeyArmored, b.publicKeyArmored],
      expectedKeyRefs: [a.keyRef, b.keyRef],
      issuedAt,
      nowMs: Date.now(),
      allowedClockSkewMs: 60_000,
    });
    assert.equal(result.ok, true);
  });

  it("rejects wrong key, modified payload, and non-canonical JSON cleartext", async () => {
    const a = await generateTestKey("wrong-a");
    const b = await generateTestKey("wrong-b");
    const backend = createOpenPgpBackend();
    const canonical = canonicalizeV2({ v: 1 });
    const message = await openpgp.createMessage({ text: canonical });
    const sig = await openpgp.sign({
      message,
      signingKeys: a.privateKey,
      detached: true,
    });
    const issuedAt = new Date().toISOString();
    const wrongKey = await backend.verifyDetached({
      canonicalPayload: canonical,
      signaturesArmored: [sig],
      publicKeysArmored: [b.publicKeyArmored],
      expectedKeyRefs: [b.keyRef],
      issuedAt,
      nowMs: Date.now(),
      allowedClockSkewMs: 60_000,
    });
    assert.equal(wrongKey.ok, false);

    const modified = await backend.verifyDetached({
      canonicalPayload: canonicalizeV2({ v: 2 }),
      signaturesArmored: [sig],
      publicKeysArmored: [a.publicKeyArmored],
      expectedKeyRefs: [a.keyRef],
      issuedAt,
      nowMs: Date.now(),
      allowedClockSkewMs: 60_000,
    });
    assert.equal(modified.ok, false);

    const nonCanonical = `{ "b":1, "a":2 }`; // not JCS key order
    const clear = await openpgp.sign({
      message: await openpgp.createCleartextMessage({ text: nonCanonical }),
      signingKeys: a.privateKey,
    });
    const clearResult = await backend.verifyCleartext({
      cleartextArmored: clear,
      expectedCanonicalPayload: canonicalizeV2({ a: 2, b: 1 }),
      publicKeysArmored: [a.publicKeyArmored],
      expectedKeyRefs: [a.keyRef],
      issuedAt,
      nowMs: Date.now(),
      allowedClockSkewMs: 60_000,
    });
    assert.equal(clearResult.ok, false);
  });

  it("rejects signature creation time outside issuedAt clock skew", async () => {
    const key = await generateTestKey("skew");
    const backend = createOpenPgpBackend();
    const canonical = canonicalizeV2({ skew: true });
    const message = await openpgp.createMessage({ text: canonical });
    const sig = await openpgp.sign({
      message,
      signingKeys: key.privateKey,
      detached: true,
    });
    const result = await backend.verifyDetached({
      canonicalPayload: canonical,
      signaturesArmored: [sig],
      publicKeysArmored: [key.publicKeyArmored],
      expectedKeyRefs: [key.keyRef],
      issuedAt: "2020-01-01T00:00:00.000Z",
      nowMs: Date.now(),
      allowedClockSkewMs: 5_000,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.reason, /skew|issuedAt|time/i);
    }
  });

  it("registry rejects unsupported backends", () => {
    const registry = createDefaultBackendRegistry([createOpenPgpBackend()]);
    assert.equal(registry.get("openpgp")?.algorithm, "openpgp");
    assert.throws(
      () => registry.require(" Dilithium"),
      /unsupported signature backend/i,
    );
    assert.throws(
      () => new SignatureBackendRegistry().require("openpgp"),
      /unsupported signature backend/i,
    );
  });
});

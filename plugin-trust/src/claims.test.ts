import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { loadOrCreateIdentity } from "./identity.js";
import { signClaim, verifyClaim, canonicalize } from "./claims.js";
import type { ConstitutionalClaim } from "./handshake.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("canonicalize", () => {
  it("sorts keys deterministically", () => {
    const a = canonicalize({ z: 1, a: 2, m: 3 });
    const b = canonicalize({ a: 2, m: 3, z: 1 });
    assert.equal(a, b);
    assert.equal(a, '{"a":2,"m":3,"z":1}');
  });

  it("handles nested objects and arrays", () => {
    const result = canonicalize({ b: [1, 2], a: { y: true, x: false } });
    assert.equal(result, '{"a":{"x":false,"y":true},"b":[1,2]}');
  });

  it("handles null and primitives", () => {
    assert.equal(canonicalize(null), "null");
    assert.equal(canonicalize(42), "42");
    assert.equal(canonicalize("hello"), '"hello"');
  });
});

describe("signClaim / verifyClaim", () => {
  const tmp = mkdtempSync(join(tmpdir(), "fpp-claims-test-"));
  const keyPath = join(tmp, "test.key");

  it("sign then verify round-trips successfully", () => {
    const identity = loadOrCreateIdentity(keyPath, "/");
    const claim: ConstitutionalClaim = {
      agentId: identity.agentId,
      constitutionHash: "a".repeat(64),
      adoptedAt: "2026-01-01T00:00:00Z",
      auditMerkleRoot: "b".repeat(64),
      auditEntryCount: 5,
      chainIntact: true,
      recentLaws: ["law1", "law3"],
    };

    const signed = signClaim(claim, identity);
    assert.equal(signed.publicKey, identity.publicKeyHex);
    assert.equal(typeof signed.signature, "string");
    assert.equal(signed.signature.length, 128);

    const result = verifyClaim(signed);
    assert.equal(result.valid, true);
  });

  it("rejects tampered claims", () => {
    const identity = loadOrCreateIdentity(keyPath, "/");
    const claim: ConstitutionalClaim = {
      agentId: identity.agentId,
      constitutionHash: "c".repeat(64),
      adoptedAt: "2026-01-01T00:00:00Z",
      auditMerkleRoot: "d".repeat(64),
      auditEntryCount: 3,
      chainIntact: true,
      recentLaws: [],
    };

    const signed = signClaim(claim, identity);
    signed.auditEntryCount = 999;

    const result = verifyClaim(signed);
    assert.equal(result.valid, false);
  });

  it("rejects claims without signature", () => {
    const result = verifyClaim({
      agentId: "test",
      constitutionHash: "x".repeat(64),
      adoptedAt: "",
      auditMerkleRoot: "",
      auditEntryCount: 0,
      chainIntact: false,
      recentLaws: [],
      publicKey: "",
      signature: "",
    });
    assert.equal(result.valid, false);
  });

  it("rejects mismatched agentId and publicKey", () => {
    const identity = loadOrCreateIdentity(keyPath, "/");
    const claim: ConstitutionalClaim = {
      agentId: identity.agentId,
      constitutionHash: "e".repeat(64),
      adoptedAt: "2026-01-01T00:00:00Z",
      auditMerkleRoot: "f".repeat(64),
      auditEntryCount: 1,
      chainIntact: true,
      recentLaws: [],
    };
    const signed = signClaim(claim, identity);
    signed.agentId = "fpp:ed25519:" + "0".repeat(64);
    const result = verifyClaim(signed);
    assert.equal(result.valid, false);
    assert.match(result.reason, /agentId does not match/i);
  });

  it("binds v2 agentId and keyAlgorithm into the signed claim", () => {
    const identity = loadOrCreateIdentity(keyPath, "/");
    assert.match(identity.agentId, /^fpp:ed25519:[0-9a-f]{64}$/);
    assert.match(identity.legacyAlias, /^fpp-[0-9a-f]{16}$/);
    const signed = signClaim(
      {
        agentId: "ignored-will-be-replaced",
        constitutionHash: "1".repeat(64),
        adoptedAt: "2026-01-01T00:00:00Z",
        auditMerkleRoot: "2".repeat(64),
        auditEntryCount: 0,
        chainIntact: true,
        recentLaws: [],
      },
      identity,
    );
    assert.equal(signed.agentId, identity.agentId);
    assert.equal(signed.keyAlgorithm, "ed25519");
    assert.equal(verifyClaim(signed).valid, true);
  });

  // cleanup
  after(() => {
    rmSync(tmp, { recursive: true, force: true });
  });
});

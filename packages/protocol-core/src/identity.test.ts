import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deriveAgentIdV2,
  deriveLegacyAlias,
  fingerprintPublicKey,
  isLegacyAgentAlias,
  parseAgentId,
  publicKeyMatchesAgentId,
  verifySignature,
} from "./identity.js";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

describe("identity fingerprints", () => {
  const seed = new Uint8Array(32).fill(7);
  const publicKey = ed.getPublicKey(seed);
  const publicKeyHex = Buffer.from(publicKey).toString("hex");

  it("derives a deterministic full fingerprint agent id", () => {
    const a = deriveAgentIdV2(publicKeyHex);
    const b = deriveAgentIdV2(publicKeyHex);
    assert.equal(a, b);
    assert.match(a, /^fpp:ed25519:[0-9a-f]{64}$/);
  });

  it("derives the historical truncated legacy alias", () => {
    const alias = deriveLegacyAlias(publicKeyHex);
    assert.match(alias, /^fpp-[0-9a-f]{16}$/);
    assert.equal(alias, "fpp-" + fingerprintPublicKey(publicKeyHex).slice(0, 16));
  });

  it("rejects mismatched agent id / public key pairs", () => {
    const id = deriveAgentIdV2(publicKeyHex);
    const otherHex = Buffer.from(ed.getPublicKey(new Uint8Array(32).fill(9))).toString(
      "hex",
    );
    assert.equal(publicKeyMatchesAgentId(id, otherHex), false);
    assert.equal(publicKeyMatchesAgentId(id, publicKeyHex), true);
  });

  it("does not treat a legacy alias as proof of identity alone", () => {
    const alias = deriveLegacyAlias(publicKeyHex);
    assert.equal(isLegacyAgentAlias(alias), true);
    assert.equal(publicKeyMatchesAgentId(alias, publicKeyHex), false);
    // Alias may be checked only as a labeled companion of the full id
    assert.equal(
      publicKeyMatchesAgentId(alias, publicKeyHex, { allowLegacyAlias: true }),
      true,
    );
  });

  it("rejects malformed public key lengths", () => {
    assert.throws(() => deriveAgentIdV2("abcd"), /32 bytes|64 hex/i);
    assert.throws(() => deriveAgentIdV2("zz".repeat(32)), /hex/i);
  });

  it("avoids truncated-id collisions by preferring full fingerprints", () => {
    const full = deriveAgentIdV2(publicKeyHex);
    const alias = deriveLegacyAlias(publicKeyHex);
    const parsed = parseAgentId(full);
    assert.equal(parsed.kind, "v2");
    assert.equal(parsed.algorithm, "ed25519");
    assert.equal(parseAgentId(alias).kind, "legacy-alias");
    assert.notEqual(full, alias);
  });

  it("verifies ed25519 signatures", () => {
    const message = new TextEncoder().encode("hello");
    const sig = ed.sign(message, seed);
    assert.equal(verifySignature(message, sig, publicKey), true);
    assert.equal(verifySignature(message, sig, ed.getPublicKey(new Uint8Array(32).fill(1))), false);
  });
});

/**
 * Cross-package interoperability vectors for @ovrsr/fpp-protocol-core.
 *
 * Produces digests/proofs/claims via core APIs and verifies them the same way
 * plugins and root scripts consume them.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canonicalizeV1,
  computeMerkleRoot,
  createMerkleProof,
  digest,
  hashEntryV1,
  parseClaim,
  verifyMerkleProof,
  DIGEST_DOMAINS,
} from "@ovrsr/fpp-protocol-core";

describe("protocol-core interoperability", () => {
  it("v1 audit entry digests match across hashEntryV1 and digest({version:1})", () => {
    const entry = {
      previousHash: "0".repeat(64),
      timestamp: "2026-07-10T00:00:00.000Z",
      kind: "heartbeat",
      constitutionHash: "71bf60ad917c5413cc17b0f65e83c7a29218e24a2740725a819058ed9c6b1993",
      notes: "interop",
      hash: "ignored",
    };
    const a = hashEntryV1(entry);
    const b = digest({ version: 1, value: entry });
    assert.equal(a, b);
    assert.equal(a.length, 64);
  });

  it("merkle proofs created by core verify with the same root scripts use", () => {
    const leaves = [
      hashEntryV1({ seq: 1, kind: "a", previousHash: "0".repeat(64) }),
      hashEntryV1({ seq: 2, kind: "b", previousHash: "1".repeat(64) }),
      hashEntryV1({ seq: 3, kind: "c", previousHash: "2".repeat(64) }),
    ];
    const root = computeMerkleRoot(leaves);
    const proof = createMerkleProof(leaves, 1);
    assert.ok(proof);
    assert.equal(proof.root, root);
    assert.equal(verifyMerkleProof(proof), true);
  });

  it("legacy v1 claims remain parseable as declaration-only", () => {
    const raw = {
      agentId: "fpp-abcdef0123456789",
      constitutionHash: "a".repeat(64),
      adoptedAt: "2026-01-01T00:00:00.000Z",
      auditMerkleRoot: "b".repeat(64),
      auditEntryCount: 1,
      chainIntact: true,
      recentLaws: [],
    };
    const result = parseClaim(raw);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.kind, "legacy-v1");
    assert.equal(result.assurance, "declaration-only");
  });

  it("v2 digests are domain-separated from v1 canonical strings", () => {
    const value = { hello: "world" };
    const v1 = digest({ version: 1, value });
    const v2 = digest({ version: 2, domain: DIGEST_DOMAINS.claim, value });
    assert.notEqual(v1, v2);
    assert.equal(canonicalizeV1(value), '{"hello":"world"}');
  });
});

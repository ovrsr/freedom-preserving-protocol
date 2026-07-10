import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeMerkleRootV1,
  computeMerkleRootV2,
  createMerkleProofV1,
  createMerkleProofV2,
  hashPairV1,
  hashPairV2,
  verifyMerkleProofV1,
  verifyMerkleProofV2,
} from "./merkle.js";
import { DIGEST_DOMAINS } from "./digest.js";

const LEAVES = ["aa".repeat(32), "bb".repeat(32), "cc".repeat(32)];

describe("Merkle v1 (legacy)", () => {
  it("empty tree root is 64 zeros", () => {
    assert.equal(computeMerkleRootV1([]), "0".repeat(64));
  });

  it("single leaf returns the leaf", () => {
    assert.equal(computeMerkleRootV1([LEAVES[0]!]), LEAVES[0]);
  });

  it("matches historical three-leaf root", () => {
    assert.equal(
      computeMerkleRootV1(LEAVES),
      "f372961e0178fea099eb05057b8b6a363a21f7ee2456e6e17a8f92990d01d1f9",
    );
    assert.equal(
      hashPairV1(LEAVES[0]!, LEAVES[1]!),
      "fa0dafbf43f1f551e536353e9d1a942a8e86e41a0b58dfeaf264ef217f6b862a",
    );
  });

  it("proof verifies against computed root", () => {
    for (let i = 0; i < LEAVES.length; i++) {
      const proof = createMerkleProofV1(LEAVES, i);
      assert.ok(proof);
      assert.equal(proof.root, computeMerkleRootV1(LEAVES));
      assert.equal(verifyMerkleProofV1(proof), true);
    }
  });

  it("tampered proof fails", () => {
    const proof = createMerkleProofV1(LEAVES, 1)!;
    proof.leaf = "ff".repeat(32);
    assert.equal(verifyMerkleProofV1(proof), false);
  });
});

describe("Merkle v2 (domain-separated)", () => {
  it("uses distinct domains for leaves vs internal nodes", () => {
    const a = LEAVES[0]!;
    const b = LEAVES[1]!;
    assert.notEqual(hashPairV2(a, b), hashPairV1(a, b));
    assert.notEqual(
      hashPairV2(a, b),
      // leaf-domain misuse must not equal node-domain pair hash
      hashPairV1(DIGEST_DOMAINS.leaf + a, DIGEST_DOMAINS.leaf + b),
    );
  });

  it("v2 root differs from v1 for the same leaves", () => {
    assert.notEqual(computeMerkleRootV2(LEAVES), computeMerkleRootV1(LEAVES));
  });

  it("v2 proofs verify independently of v1", () => {
    const proof = createMerkleProofV2(LEAVES, 0)!;
    assert.equal(verifyMerkleProofV2(proof), true);
    assert.equal(verifyMerkleProofV1(proof as never), false);
  });

  it("empty and single-leaf behave like v1", () => {
    assert.equal(computeMerkleRootV2([]), "0".repeat(64));
    assert.equal(computeMerkleRootV2([LEAVES[0]!]), LEAVES[0]);
  });
});

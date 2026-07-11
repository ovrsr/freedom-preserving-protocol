import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import {
  computeMerkleRoot,
  createMerkleProof,
  verifyMerkleProof,
  MerkleBridge,
} from "./merkle-bridge.js";

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

describe("computeMerkleRoot", () => {
  it("returns zero hash for empty leaves", () => {
    assert.equal(computeMerkleRoot([]), "0".repeat(64));
  });

  it("returns leaf for single element", () => {
    const leaf = sha256("hello");
    assert.equal(computeMerkleRoot([leaf]), leaf);
  });

  it("computes a consistent root for multiple leaves", () => {
    const leaves = ["a", "b", "c"].map((s) => sha256(s));
    const root1 = computeMerkleRoot(leaves);
    const root2 = computeMerkleRoot(leaves);
    assert.equal(root1, root2);
    assert.equal(root1.length, 64);
  });
});

describe("createMerkleProof / verifyMerkleProof", () => {
  it("creates and verifies a valid proof", () => {
    const leaves = ["x", "y", "z", "w"].map((s) => sha256(s));
    const proof = createMerkleProof(leaves, 2);
    assert.ok(proof);
    assert.equal(proof.leaf, leaves[2]);
    assert.equal(proof.root, computeMerkleRoot(leaves));
    assert.equal(verifyMerkleProof(proof), true);
  });

  it("rejects tampered proof", () => {
    const leaves = ["a", "b", "c"].map((s) => sha256(s));
    const proof = createMerkleProof(leaves, 1);
    assert.ok(proof);
    proof.leaf = sha256("tampered");
    assert.equal(verifyMerkleProof(proof), false);
  });

  it("returns null for out-of-range index", () => {
    assert.equal(createMerkleProof(["a"], 5), null);
    assert.equal(createMerkleProof([], 0), null);
  });
});

describe("MerkleBridge", () => {
  const tmp = mkdtempSync(join(tmpdir(), "fpp-merkle-test-"));

  it("returns zero root for missing file", () => {
    const bridge = new MerkleBridge("nonexistent.jsonl", tmp);
    const { root, entryCount } = bridge.getCurrentRoot();
    assert.equal(root, "0".repeat(64));
    assert.equal(entryCount, 0);
  });

  it("reads audit JSONL and computes root", () => {
    const logPath = join(tmp, "audit.jsonl");
    const h1 = sha256("entry1");
    const h2 = sha256("entry2");
    writeFileSync(
      logPath,
      `{"hash":"${h1}","other":"data"}\n{"hash":"${h2}"}\n`,
    );

    const bridge = new MerkleBridge("audit.jsonl", tmp);
    const { root, entryCount } = bridge.getCurrentRoot();
    assert.equal(entryCount, 2);
    assert.equal(root, computeMerkleRoot([h1, h2]));
  });

  it("creates proof for leaf by hash", () => {
    const logPath = join(tmp, "audit2.jsonl");
    const h1 = sha256("a1");
    const h2 = sha256("a2");
    const h3 = sha256("a3");
    writeFileSync(
      logPath,
      [h1, h2, h3].map((h) => `{"hash":"${h}"}`).join("\n") + "\n",
    );

    const bridge = new MerkleBridge("audit2.jsonl", tmp);
    const proof = bridge.createProofForLeaf(h2);
    assert.ok(proof);
    assert.equal(proof.index, 1);
    assert.equal(verifyMerkleProof(proof), true);
  });

  it("uses fallback when primary audit log has no entries", () => {
    writeFileSync(join(tmp, "constitution-audit.jsonl"), "");
    const h1 = sha256("enforcement-1");
    const h2 = sha256("enforcement-2");
    writeFileSync(
      join(tmp, "fpp-plugin-audit.jsonl"),
      `{"hash":"${h1}"}\n{"hash":"${h2}"}\n`,
    );

    const bridge = new MerkleBridge(
      "constitution-audit.jsonl",
      tmp,
      "fpp-plugin-audit.jsonl",
    );
    const { root, entryCount } = bridge.getCurrentRoot();
    assert.equal(entryCount, 2);
    assert.equal(root, computeMerkleRoot([h1, h2]));
  });

  it("prefers primary log when it has entries even if fallback is populated", () => {
    const primaryH = sha256("constitution-only");
    const fallbackH = sha256("enforcement-only");
    writeFileSync(
      join(tmp, "primary-pref.jsonl"),
      `{"hash":"${primaryH}"}\n`,
    );
    writeFileSync(
      join(tmp, "fallback-pref.jsonl"),
      `{"hash":"${fallbackH}"}\n`,
    );

    const bridge = new MerkleBridge(
      "primary-pref.jsonl",
      tmp,
      "fallback-pref.jsonl",
    );
    const { root, entryCount } = bridge.getCurrentRoot();
    assert.equal(entryCount, 1);
    assert.equal(root, computeMerkleRoot([primaryH]));
  });

  it("returns zero root when fallback is disabled and primary is empty", () => {
    writeFileSync(join(tmp, "empty-primary.jsonl"), "");
    const bridge = new MerkleBridge("empty-primary.jsonl", tmp, null);
    const { root, entryCount } = bridge.getCurrentRoot();
    assert.equal(entryCount, 0);
    assert.equal(root, "0".repeat(64));
  });

  it("labels Merkle results as inclusion-under-claimed-root", () => {
    const leaves = ["a", "b", "c"].map((s) => sha256(s));
    const proof = createMerkleProof(leaves, 1);
    assert.ok(proof);
    const bridge = new MerkleBridge("unused.jsonl", tmp, null);
    const result = bridge.evaluateInclusion(proof, proof.root);
    assert.equal(result.valid, true);
    assert.equal(result.semantics, "inclusion-under-claimed-root");
    assert.equal(result.rootAnchored, false);
    assert.equal(result.rootMatch, true);
  });

  after(() => {
    rmSync(tmp, { recursive: true, force: true });
  });
});

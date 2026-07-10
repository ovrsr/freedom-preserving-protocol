/**
 * Tests for the constitution audit chain — append, verify, tamper rejection,
 * and Merkle inclusion proof round-trip.
 *
 * Uses temporary files only; never touches ~/.openclaw or real workspaces.
 */
import { describe, it, after, before } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { appendAuditEntry } from "./audit-append.ts";
import { verify } from "./audit-verify.ts";
import { generateProof, verifyProofFile } from "./audit-proof.ts";
import {
  computeMerkleRoot,
  createMerkleProof,
  verifyMerkleProof,
} from "./merkle.ts";

describe("audit chain — append + verify", () => {
  let workdir: string;

  before(() => {
    workdir = mkdtempSync(join(tmpdir(), "fpp-audit-"));
  });

  after(() => {
    if (workdir && existsSync(workdir)) rmSync(workdir, { recursive: true, force: true });
  });

  it("appendAuditEntry writes an entry with a zero previousHash for the first append", () => {
    const log = join(workdir, "first.jsonl");
    const r = appendAuditEntry({ log, kind: "heartbeat", notes: "first" });
    assert.equal(r.previousHash, "0".repeat(64));
    assert.match(r.hash, /^[0-9a-f]{64}$/);
    assert.match(r.merkleRoot, /^[0-9a-f]{64}$/);
    assert.ok(existsSync(log));
    assert.ok(existsSync(log.replace(/\.jsonl$/, ".merkle")));
  });

  it("subsequent entries chain: previousHash of N equals hash of N-1", () => {
    const log = join(workdir, "chained.jsonl");
    const a = appendAuditEntry({ log, kind: "heartbeat", notes: "one" });
    const b = appendAuditEntry({ log, kind: "heartbeat", notes: "two" });
    const c = appendAuditEntry({ log, kind: "heartbeat", notes: "three" });
    assert.equal(b.previousHash, a.hash);
    assert.equal(c.previousHash, b.hash);

    const lines = readFileSync(log, "utf-8").trim().split("\n");
    assert.equal(lines.length, 3);
  });

  it("verify returns ok=true for an intact chain and reports the Merkle root", () => {
    const log = join(workdir, "verify-ok.jsonl");
    appendAuditEntry({ log, kind: "adoption", notes: "adopt" });
    appendAuditEntry({ log, kind: "heartbeat", notes: "hb1" });
    appendAuditEntry({ log, kind: "heartbeat", notes: "hb2" });

    const report = verify(log);
    assert.equal(report.ok, true, report.errors.join("; "));
    assert.equal(report.entries, 3);
    assert.match(report.merkleRoot ?? "", /^[0-9a-f]{64}$/);
    assert.equal(report.errors.length, 0);
  });

  it("verify detects tampering when a byte inside an entry is changed", () => {
    const log = join(workdir, "verify-tampered.jsonl");
    appendAuditEntry({ log, kind: "heartbeat", notes: "one" });
    appendAuditEntry({ log, kind: "heartbeat", notes: "two" });

    const raw = readFileSync(log, "utf-8");
    const [line1, line2] = raw.trim().split("\n");
    const parsed = JSON.parse(line1!) as Record<string, unknown>;
    parsed.notes = "one-tampered";
    writeFileSync(log, JSON.stringify(parsed) + "\n" + line2 + "\n");

    const report = verify(log);
    assert.equal(report.ok, false);
    assert.ok(
      report.errors.some((e) => /hash mismatch/.test(e)),
      "expected a hash-mismatch error",
    );
  });

  it("verify detects a broken chain when previousHash is edited", () => {
    const log = join(workdir, "verify-broken-chain.jsonl");
    appendAuditEntry({ log, kind: "heartbeat", notes: "a" });
    appendAuditEntry({ log, kind: "heartbeat", notes: "b" });

    const raw = readFileSync(log, "utf-8");
    const [line1, line2] = raw.trim().split("\n");
    const parsed = JSON.parse(line2!) as Record<string, unknown>;
    parsed.previousHash = "f".repeat(64);
    writeFileSync(log, line1 + "\n" + JSON.stringify(parsed) + "\n");

    const report = verify(log);
    assert.equal(report.ok, false);
    assert.ok(
      report.errors.some((e) => /previousHash mismatch|hash mismatch/.test(e)),
    );
  });
});

describe("audit chain — Merkle proofs", () => {
  let workdir: string;

  before(() => {
    workdir = mkdtempSync(join(tmpdir(), "fpp-audit-proof-"));
  });

  after(() => {
    if (workdir && existsSync(workdir)) rmSync(workdir, { recursive: true, force: true });
  });

  it("merkle helpers round-trip for a hand-built tree", () => {
    const leaves = ["a".repeat(64), "b".repeat(64), "c".repeat(64), "d".repeat(64)];
    const root = computeMerkleRoot(leaves);
    for (let i = 0; i < leaves.length; i++) {
      const proof = createMerkleProof(leaves, i);
      assert.ok(proof, `expected proof for index ${i}`);
      assert.equal(proof!.root, root);
      assert.equal(verifyMerkleProof(proof!), true);
    }
  });

  it("generateProof + verifyProofFile round-trip against a real log", () => {
    const log = join(workdir, "proof-log.jsonl");
    for (let i = 0; i < 4; i++) {
      appendAuditEntry({ log, kind: "heartbeat", notes: `hb-${i}` });
    }

    const proof = generateProof(log, 2);
    assert.match(proof.leaf, /^[0-9a-f]{64}$/);
    assert.match(proof.root, /^[0-9a-f]{64}$/);
    assert.equal(verifyMerkleProof(proof), true);

    const proofPath = join(workdir, "proof-2.json");
    writeFileSync(proofPath, JSON.stringify(proof) + "\n");
    const report = verifyProofFile(proofPath, log);
    assert.equal(report.valid, true);
    assert.equal(report.rootMatch, true);
    assert.equal(report.proofRoot, report.currentRoot);
  });

  it("generateProof rejects out-of-range indices", () => {
    const log = join(workdir, "range-log.jsonl");
    appendAuditEntry({ log, kind: "heartbeat", notes: "only" });
    assert.throws(() => generateProof(log, 5), /out of range/);
    assert.throws(() => generateProof(log, -1), /out of range/);
  });

  it("verifyProofFile reports rootMatch=false after the log grows", () => {
    const log = join(workdir, "growing-log.jsonl");
    appendAuditEntry({ log, kind: "heartbeat", notes: "a" });
    appendAuditEntry({ log, kind: "heartbeat", notes: "b" });

    const proof = generateProof(log, 0);
    const proofPath = join(workdir, "proof-old.json");
    writeFileSync(proofPath, JSON.stringify(proof) + "\n");

    appendAuditEntry({ log, kind: "heartbeat", notes: "c" });

    const report = verifyProofFile(proofPath, log);
    assert.equal(report.valid, true, "the proof itself remains internally valid");
    assert.equal(report.rootMatch, false, "the current log root has moved on");
    assert.notEqual(report.proofRoot, report.currentRoot);
  });
});

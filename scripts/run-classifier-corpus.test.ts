import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCorpus, runCorpus, summarize } from "./run-classifier-corpus.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const ADVERSARIAL_PATH = resolve(root, "test/fixtures/classifier-adversarial.json");
const BENIGN_PATH = resolve(root, "test/fixtures/classifier-benign.json");

describe("loadCorpus", () => {
  test("loads adversarial corpus without schema errors", () => {
    const corpus = loadCorpus(ADVERSARIAL_PATH);
    assert.equal(corpus.version, 1);
    assert.ok(corpus.cases.length > 0);
    for (const c of corpus.cases) {
      assert.ok(c.id, "each case must have an id");
      assert.ok(c.category, "each case must have a category");
      assert.ok(c.toolName, "each case must have a toolName");
      assert.ok(c.params, "each case must have params");
      assert.ok(
        ["block", "approval", "allow"].includes(c.expected),
        `invalid expected: ${c.expected}`,
      );
    }
  });

  test("loads benign corpus without schema errors", () => {
    const corpus = loadCorpus(BENIGN_PATH);
    assert.equal(corpus.version, 1);
    assert.ok(corpus.cases.length > 0);
    for (const c of corpus.cases) {
      assert.ok(c.id);
      assert.ok(["block", "approval", "allow"].includes(c.expected));
    }
  });

  test("all case ids are unique across both corpora", () => {
    const adv = loadCorpus(ADVERSARIAL_PATH);
    const ben = loadCorpus(BENIGN_PATH);
    const ids = [...adv.cases, ...ben.cases].map((c) => c.id);
    const unique = new Set(ids);
    assert.equal(ids.length, unique.size, "duplicate case ids found");
  });
});

describe("runCorpus", () => {
  test("all adversarial cases match expected decisions", () => {
    const corpus = loadCorpus(ADVERSARIAL_PATH);
    const results = runCorpus(corpus.cases);
    const failures = results.filter((r) => !r.pass);
    if (failures.length > 0) {
      const msg = failures
        .map((f) => `  ${f.id}: expected=${f.expected} actual=${f.actual}`)
        .join("\n");
      assert.fail(`Adversarial corpus mismatches:\n${msg}`);
    }
  });

  test("all benign cases match expected decisions", () => {
    const corpus = loadCorpus(BENIGN_PATH);
    const results = runCorpus(corpus.cases);
    const failures = results.filter((r) => !r.pass);
    if (failures.length > 0) {
      const msg = failures
        .map((f) => `  ${f.id}: expected=${f.expected} actual=${f.actual}`)
        .join("\n");
      assert.fail(`Benign corpus mismatches:\n${msg}`);
    }
  });
});

describe("summarize", () => {
  test("correct counts for mixed results", () => {
    const results = [
      { id: "a", category: "cat1", expected: "block" as const, actual: "block" as const, pass: true, classification: "x", reason: "r" },
      { id: "b", category: "cat1", expected: "block" as const, actual: "allow" as const, pass: false, classification: "x", reason: "r" },
      { id: "c", category: "cat2", expected: "allow" as const, actual: "approval" as const, pass: false, classification: "x", reason: "r" },
    ];
    const summary = summarize(results);
    assert.equal(summary.total, 3);
    assert.equal(summary.passed, 1);
    assert.equal(summary.failed, 2);
    assert.equal(summary.byCategory["cat1"].fn, 1);
    assert.equal(summary.byCategory["cat2"].fp, 1);
  });
});

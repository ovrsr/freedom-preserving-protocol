#!/usr/bin/env tsx
/**
 * run-classifier-corpus.ts
 *
 * Runs the adversarial + benign classifier corpus against classifyToolCall
 * and reports FN/FP by category. Exit non-zero on mismatch.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyToolCall, type Decision } from "../plugin/src/risk-classifier.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

type CorpusCase = {
  id: string;
  category: string;
  toolName: string;
  params: Record<string, unknown>;
  expected: Decision;
  notes?: string;
};

type CorpusFile = {
  version: number;
  cases: CorpusCase[];
};

type Result = {
  id: string;
  category: string;
  expected: Decision;
  actual: Decision;
  pass: boolean;
  classification: string;
  reason: string;
};

const VALID_DECISIONS = new Set(["block", "approval", "allow"]);

export function loadCorpus(path: string): CorpusFile {
  const raw = JSON.parse(readFileSync(path, "utf-8")) as CorpusFile;
  if (raw.version !== 1) throw new Error(`Unsupported corpus version: ${raw.version}`);
  if (!Array.isArray(raw.cases)) throw new Error("corpus.cases must be an array");
  for (const c of raw.cases) {
    if (!c.id || !c.category || !c.toolName || !c.params || !c.expected) {
      throw new Error(`Invalid case: ${JSON.stringify(c)}`);
    }
    if (!VALID_DECISIONS.has(c.expected)) {
      throw new Error(`Invalid expected decision "${c.expected}" in case ${c.id}`);
    }
  }
  return raw;
}

export function runCorpus(cases: CorpusCase[]): Result[] {
  return cases.map((c) => {
    const result = classifyToolCall(c.toolName, c.params);
    return {
      id: c.id,
      category: c.category,
      expected: c.expected,
      actual: result.decision,
      pass: result.decision === c.expected,
      classification: result.classification,
      reason: result.reason,
    };
  });
}

export function summarize(results: Result[]): {
  total: number;
  passed: number;
  failed: number;
  byCategory: Record<string, { total: number; fn: number; fp: number }>;
} {
  const byCategory: Record<string, { total: number; fn: number; fp: number }> = {};

  for (const r of results) {
    if (!byCategory[r.category]) {
      byCategory[r.category] = { total: 0, fn: 0, fp: 0 };
    }
    byCategory[r.category].total++;
    if (!r.pass) {
      const isBlockOrApproval = r.expected === "block" || r.expected === "approval";
      if (isBlockOrApproval && r.actual === "allow") {
        byCategory[r.category].fn++;
      } else {
        byCategory[r.category].fp++;
      }
    }
  }

  return {
    total: results.length,
    passed: results.filter((r) => r.pass).length,
    failed: results.filter((r) => !r.pass).length,
    byCategory,
  };
}

function main() {
  const fixtures = [
    resolve(root, "test/fixtures/classifier-adversarial.json"),
    resolve(root, "test/fixtures/classifier-benign.json"),
  ];

  let allResults: Result[] = [];
  let hasErrors = false;

  for (const fixture of fixtures) {
    let corpus: CorpusFile;
    try {
      corpus = loadCorpus(fixture);
    } catch (e) {
      console.error(`Schema validation failed for ${fixture}: ${(e as Error).message}`);
      hasErrors = true;
      continue;
    }
    const results = runCorpus(corpus.cases);
    allResults = allResults.concat(results);
  }

  const summary = summarize(allResults);

  console.log(`\nClassifier Corpus Report`);
  console.log(`========================`);
  console.log(`Total cases: ${summary.total}`);
  console.log(`Passed:      ${summary.passed}`);
  console.log(`Failed:      ${summary.failed}`);
  console.log(`\nBy category:`);

  for (const [cat, stats] of Object.entries(summary.byCategory).sort()) {
    const status = stats.fn + stats.fp === 0 ? "OK" : "MISMATCH";
    console.log(`  ${cat.padEnd(20)} ${stats.total} cases | FN: ${stats.fn} | FP: ${stats.fp} | ${status}`);
  }

  const failures = allResults.filter((r) => !r.pass);
  if (failures.length > 0) {
    console.log(`\nFailures:`);
    for (const f of failures) {
      console.log(`  ${f.id}: expected=${f.expected} actual=${f.actual} (${f.classification})`);
      console.log(`    reason: ${f.reason}`);
    }
  }

  if (hasErrors || summary.failed > 0) {
    process.exit(1);
  }
  console.log(`\nAll cases match expected classifier behavior.`);
}

const isDirectInvocation =
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` ||
  import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}`;

if (isDirectInvocation) {
  main();
}

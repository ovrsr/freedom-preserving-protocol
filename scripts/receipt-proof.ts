#!/usr/bin/env tsx
/**
 * receipt-proof.ts
 *
 * Generate or verify a Merkle inclusion proof for a conformance receipt entry.
 * Proofs carry logKind=conformance-receipt so they cannot be confused with
 * heartbeat audit proofs. Raw action parameters are never included.
 *
 * Usage:
 *   npm run receipt:proof -- --index 0
 *   npm run receipt:proof -- --verify proof.json
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { verifyMerkleProofV2, computeMerkleRootV2 } from "@ovrsr/fpp-protocol-core";
import {
  collectReceiptLeaves,
  createReceiptProof,
  RECEIPT_LOG_KIND,
  type ReceiptMerkleProof,
} from "../plugin/src/receipt-log.ts";

export { createReceiptProof, collectReceiptLeaves, RECEIPT_LOG_KIND };

export function generateReceiptProof(
  logPath: string,
  index: number,
): ReceiptMerkleProof {
  if (!existsSync(logPath)) {
    throw new Error(`Receipt log not found: ${logPath}`);
  }
  const proof = createReceiptProof(logPath, index);
  if (!proof) {
    const leaves = collectReceiptLeaves(logPath);
    throw new Error(
      `Index ${index} out of range (log has ${leaves.length} entries)`,
    );
  }
  return proof;
}

export type ReceiptProofVerifyReport = {
  valid: boolean;
  rootMatch: boolean;
  logKindMatch: boolean;
  proofRoot: string;
  currentRoot: string;
  logKind: string;
};

export function verifyReceiptProofFile(
  proofPath: string,
  logPath: string,
): ReceiptProofVerifyReport {
  const proof = JSON.parse(readFileSync(proofPath, "utf-8")) as ReceiptMerkleProof;
  const valid = verifyMerkleProofV2(proof);
  const leaves = collectReceiptLeaves(logPath);
  const currentRoot = computeMerkleRootV2(leaves);
  return {
    valid,
    rootMatch: proof.root === currentRoot,
    logKindMatch: proof.logKind === RECEIPT_LOG_KIND,
    proofRoot: proof.root,
    currentRoot,
    logKind: String(proof.logKind ?? "missing"),
  };
}

function usage() {
  console.log(`Usage: npm run receipt:proof -- [options]

Generate:
  --index <n>        Entry index (0-based) to prove
  --log <path>       Receipt log path (default: .openclaw/workspace/fpp-receipts.jsonl)
  --out <path>       Write proof JSON to file (default: stdout)

Verify:
  --verify <path>    Verify a proof JSON file against the current receipt log

  --json             Machine-readable output
  -h, --help         This help`);
}

type Args = {
  mode: "generate" | "verify";
  log: string;
  index: number;
  out?: string;
  verifyPath?: string;
  json: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    mode: "generate",
    log: ".openclaw/workspace/fpp-receipts.jsonl",
    index: -1,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--index") args.index = parseInt(argv[++i]!, 10);
    else if (a === "--log") args.log = argv[++i]!;
    else if (a === "--out") args.out = argv[++i]!;
    else if (a === "--verify") {
      args.mode = "verify";
      args.verifyPath = argv[++i]!;
    } else if (a === "--json") args.json = true;
    else if (a === "--help" || a === "-h") {
      usage();
      process.exit(0);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.mode === "verify") {
    if (!args.verifyPath) {
      console.error("--verify requires a proof file path");
      process.exit(2);
    }
    const report = verifyReceiptProofFile(
      resolve(args.verifyPath),
      resolve(args.log),
    );
    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`Proof valid:        ${report.valid ? "YES" : "NO"}`);
      console.log(`Root matches log:   ${report.rootMatch ? "YES" : "NO"}`);
      console.log(`Log kind match:     ${report.logKindMatch ? "YES" : "NO"} (${report.logKind})`);
      console.log(`Proof root:         ${report.proofRoot}`);
      console.log(`Current log root:   ${report.currentRoot}`);
    }
    process.exit(
      report.valid && report.rootMatch && report.logKindMatch ? 0 : 1,
    );
  }

  if (args.index < 0) {
    console.error("--index is required (0-based entry index)");
    process.exit(2);
  }

  const proof = generateReceiptProof(resolve(args.log), args.index);
  const proofJson = JSON.stringify(proof, null, 2);
  if (args.out) {
    writeFileSync(resolve(args.out), proofJson + "\n");
    console.log(`Receipt proof written to ${args.out}`);
    console.log(`  logKind: ${proof.logKind}`);
    console.log(`  entry:   ${args.index}`);
    console.log(`  leaf:    ${proof.leaf.slice(0, 16)}...`);
    console.log(`  root:    ${proof.root.slice(0, 16)}...`);
  } else if (args.json) {
    console.log(proofJson);
  } else {
    console.log(`Merkle inclusion proof for receipt entry ${args.index}:`);
    console.log(`  logKind: ${proof.logKind}`);
    console.log(`  leaf:    ${proof.leaf}`);
    console.log(`  root:    ${proof.root}`);
    console.log(`\nFull proof JSON:`);
    console.log(proofJson);
  }
}

const isDirectInvocation =
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` ||
  import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}`;

if (isDirectInvocation) {
  main();
}

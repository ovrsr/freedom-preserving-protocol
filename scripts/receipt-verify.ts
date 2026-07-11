#!/usr/bin/env tsx
/**
 * receipt-verify.ts
 *
 * Verify the integrity of a typed conformance receipt ledger.
 * Distinguishes receipt logs from heartbeat/enforcement audit logs.
 *
 * Usage:
 *   npx tsx scripts/receipt-verify.ts [--log <path>] [--json]
 */

import { resolve } from "node:path";
import {
  verifyReceiptLog,
  RECEIPT_LOG_KIND,
  type ReceiptLogVerifyReport,
} from "../packages/enforcement-core/src/receipt-log.ts";

export { verifyReceiptLog, RECEIPT_LOG_KIND, type ReceiptLogVerifyReport };

function parseArgs(argv: string[]): { log: string; json: boolean } {
  let log = ".openclaw/workspace/fpp-receipts.jsonl";
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--log") log = argv[++i]!;
    else if (a === "--json") json = true;
    else if (a === "--help" || a === "-h") {
      console.log(
        `Usage: npm run receipt:verify -- [--log <path>] [--json]\n\n` +
          `Verifies a ${RECEIPT_LOG_KIND} ledger (not heartbeat/enforcement logs).`,
      );
      process.exit(0);
    }
  }
  return { log, json };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = verifyReceiptLog(resolve(args.log));

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Receipt log: ${args.log}`);
    console.log(`Log kind:    ${report.logKind}`);
    console.log(`Entries:     ${report.entries}`);
    if (report.lastHash) console.log(`Last hash:   ${report.lastHash}`);
    if (report.merkleRoot) console.log(`Merkle root: ${report.merkleRoot}`);
    if (report.ok) {
      console.log("\nReceipt chain integrity: OK");
    } else {
      console.error("\nReceipt chain integrity: FAILED");
      for (const e of report.errors) console.error(`  - ${e}`);
    }
  }

  process.exit(report.ok ? 0 : 1);
}

const isDirectInvocation =
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` ||
  import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}`;

if (isDirectInvocation) {
  main();
}

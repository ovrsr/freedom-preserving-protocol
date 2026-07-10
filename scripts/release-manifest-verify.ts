#!/usr/bin/env tsx
/**
 * Verify a signed release manifest before publish.
 */
import { resolve } from "node:path";
import {
  readReleaseManifest,
  verifyReleaseManifest,
  type ReleaseVerifyResult,
} from "./release-manifest.ts";

export { verifyReleaseManifest, readReleaseManifest, type ReleaseVerifyResult };

function main() {
  const args = process.argv.slice(2);
  let path = "assurance-artifacts/release-manifest.json";
  let json = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--manifest") path = args[++i]!;
    else if (args[i] === "--json") json = true;
    else if (args[i] === "--help" || args[i] === "-h") {
      console.log("Usage: npm run release:verify -- [--manifest <path>] [--json]");
      process.exit(0);
    }
  }
  const manifest = readReleaseManifest(resolve(path));
  const report = verifyReleaseManifest(manifest);
  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`Release manifest: ${path}`);
    console.log(`Signing domain:   ${manifest.signingDomain}`);
    console.log(report.ok ? "OK" : "FAILED");
    for (const e of report.errors) console.error(`  - ${e}`);
  }
  process.exit(report.ok ? 0 : 1);
}

const isDirect =
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` ||
  import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}`;
if (isDirect) main();

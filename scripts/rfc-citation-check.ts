/**
 * Static citation list for RFC 0001. Optional network check via --fetch.
 *
 * Usage:
 *   npx tsx scripts/rfc-citation-check.ts
 *   npx tsx scripts/rfc-citation-check.ts --fetch
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type Citation = {
  id: string;
  url: string;
  /** Substrings that MUST appear in the RFC markdown */
  rfcMarkers: string[];
};

export const CITATIONS: readonly Citation[] = [
  {
    id: "arXiv:2603.11853",
    url: "https://arxiv.org/abs/2603.11853",
    rfcMarkers: ["2603.11853", "arXiv:2603.11853"],
  },
  {
    id: "arXiv:2603.16586",
    url: "https://arxiv.org/abs/2603.16586",
    rfcMarkers: ["2603.16586", "arXiv:2603.16586"],
  },
  {
    id: "AOS-COORDINATION",
    url: "docs/rfc/AOS-COORDINATION.md",
    rfcMarkers: ["AOS Phase 2", "AOS"],
  },
] as const;

export function rfcPath(): string {
  return join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "docs",
    "rfc",
    "0001-voluntary-constitutional-layer.md",
  );
}

export function loadRfcBody(): string {
  return readFileSync(rfcPath(), "utf8");
}

/** Returns citation ids whose markers are all absent from the RFC body. */
export function collectMissingInRfc(body: string): string[] {
  const missing: string[] = [];
  for (const c of CITATIONS) {
    const found = c.rfcMarkers.some((m) => body.includes(m));
    if (!found) missing.push(c.id);
  }
  return missing;
}

async function fetchOk(url: string): Promise<boolean> {
  if (!url.startsWith("http")) return true;
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return true;
    // Some hosts disallow HEAD; try GET
    const get = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    return get.ok;
  } catch {
    return false;
  }
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const doFetch = argv.includes("--fetch");
  const body = loadRfcBody();
  const missing = collectMissingInRfc(body);
  if (missing.length > 0) {
    console.error("RFC missing citation markers:", missing.join(", "));
    return 1;
  }
  console.log(`OK: ${CITATIONS.length} citations present in RFC body`);

  if (doFetch) {
    let failed = 0;
    for (const c of CITATIONS) {
      if (!c.url.startsWith("http")) continue;
      const ok = await fetchOk(c.url);
      console.log(`${ok ? "OK" : "FAIL"} ${c.id} ${c.url}`);
      if (!ok) failed += 1;
    }
    if (failed > 0) return 1;
  }
  return 0;
}

const entry = process.argv[1]?.replace(/\\/g, "/");
const self = fileURLToPath(import.meta.url).replace(/\\/g, "/");
const isDirect = Boolean(entry && (entry === self || entry.endsWith("/rfc-citation-check.ts")));

if (isDirect) {
  process.exit(await main());
}

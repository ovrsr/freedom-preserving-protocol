#!/usr/bin/env tsx
/**
 * audit-bootstrap.ts
 *
 * Non-model constitution-audit bootstrap (Q4-B). Creates or extends
 * constitution-audit.jsonl without requiring the heartbeat skill / model.
 *
 * Gates (match hooks/constitution-audit/SKILL.md):
 *   - Refuse if never adopted (SOUL missing Freedom Preserving Protocol marker)
 *   - Refuse if .fpp-revoked marker exists beside the audit log
 *
 * Usage:
 *   npx tsx scripts/audit-bootstrap.ts --soul ~/.openclaw/agents/<id>/SOUL.md
 *   npm run audit:bootstrap -- --soul /path/to/SOUL.md
 *
 * Cron (example, every 6 hours):
 *   0 star-slash-6 * * * cd /path/to/skill && npm run audit:bootstrap -- --soul "$SOUL"
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { appendAuditEntry } from "./audit-append.ts";
import { absolutizeWorkspacePath, workspaceFile } from "./skill-lib/index.ts";
import { verify as verifyAuditChain } from "./audit-verify.ts";

const ADOPTION_MARKER = "Freedom Preserving Protocol";

export type BootstrapOptions = {
  soul: string;
  log?: string;
  /** When true, if log already exists do not append (create-only). Default false. */
  ifMissing?: boolean;
};

export type BootstrapResult = {
  logPath: string;
  created: boolean;
  appended: boolean;
  hash: string;
  skipped?: boolean;
  reason?: string;
};

function assertAdopted(soulPath: string): void {
  if (!existsSync(soulPath)) {
    throw new Error(
      `SOUL not found at ${soulPath} — cannot bootstrap constitution-audit (never adopted).`,
    );
  }
  const content = readFileSync(soulPath, "utf-8");
  if (!content.includes(ADOPTION_MARKER)) {
    throw new Error(
      `SOUL at ${soulPath} does not contain "${ADOPTION_MARKER}" — never adopted; refusing to create constitution-audit.`,
    );
  }
}

function assertNotRevoked(logPath: string): void {
  const marker = join(dirname(logPath), ".fpp-revoked");
  if (existsSync(marker)) {
    throw new Error(
      `Revocation marker present at ${marker} — refusing to bootstrap constitution-audit (matches heartbeat skill policy).`,
    );
  }
}

/**
 * Ensure primary constitution-audit.jsonl exists (and optionally append a heartbeat).
 */
export function bootstrapConstitutionAudit(
  opts: BootstrapOptions,
): BootstrapResult {
  const soulPath = resolve(opts.soul);
  assertAdopted(soulPath);

  const logPath = resolve(
    absolutizeWorkspacePath(opts.log ?? workspaceFile("constitution-audit.jsonl")),
  );
  assertNotRevoked(logPath);

  const existed = existsSync(logPath);
  if (existed && opts.ifMissing) {
    const report = verifyAuditChain(logPath);
    if (!report.ok) {
      throw new Error(
        `Existing constitution-audit failed verification: ${report.errors.join("; ")}`,
      );
    }
    return {
      logPath,
      created: false,
      appended: false,
      hash: report.lastHash ?? "",
      skipped: true,
      reason: "log already exists (--if-missing)",
    };
  }

  if (existed) {
    const report = verifyAuditChain(logPath);
    if (!report.ok) {
      throw new Error(
        `Existing constitution-audit failed verification: ${report.errors.join("; ")}`,
      );
    }
  }

  const kind = existed ? "heartbeat" : "heartbeat";
  const notes = existed
    ? "non-model bootstrap heartbeat"
    : "non-model bootstrap (initial constitution-audit)";

  const appended = appendAuditEntry({
    log: logPath,
    kind,
    notes,
    adoptionIntact: true,
    actions: 0,
    abstentions: 0,
    escalations: 0,
  });

  return {
    logPath: appended.logPath,
    created: !existed,
    appended: true,
    hash: appended.hash,
  };
}

function parseArgs(argv: string[]): BootstrapOptions & { help?: boolean } {
  const opts: BootstrapOptions & { help?: boolean } = {
    soul: "",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--soul" && argv[i + 1]) opts.soul = argv[++i]!;
    else if (a === "--log" && argv[i + 1]) opts.log = argv[++i]!;
    else if (a === "--if-missing") opts.ifMissing = true;
    else if (a === "--help" || a === "-h") opts.help = true;
  }
  return opts;
}

function printHelp(): void {
  console.log(`Usage: npm run audit:bootstrap -- --soul <path> [options]

Non-model bootstrap for constitution-audit.jsonl (does not require heartbeat skill).

Options:
  --soul <path>     Path to SOUL.md (required; must contain adoption marker)
  --log <path>      Audit log path (default: workspace constitution-audit.jsonl)
  --if-missing      Only create when log is absent; skip if chain already exists
  -h, --help        This help

Gates:
  - Refuses if SOUL is missing the Freedom Preserving Protocol adoption marker
  - Refuses if .fpp-revoked exists beside the audit log

Cron example (every 6 hours):
  0 */6 * * * cd /path/to/skill && npm run audit:bootstrap -- --soul "$HOME/.openclaw/agents/main/SOUL.md"
`);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  if (!args.soul) {
    console.error("Error: --soul <path> is required.");
    printHelp();
    process.exit(2);
  }

  try {
    const result = bootstrapConstitutionAudit(args);
    if (result.skipped) {
      console.log(`Skipped: ${result.reason}`);
      console.log(`  log: ${result.logPath}`);
    } else if (result.created) {
      console.log(`Created constitution-audit at ${result.logPath}`);
      console.log(`  hash: ${result.hash.slice(0, 16)}...`);
    } else {
      console.log(`Appended heartbeat to ${result.logPath}`);
      console.log(`  hash: ${result.hash.slice(0, 16)}...`);
    }
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}

const isDirect =
  process.argv[1] &&
  normalize(fileURLToPath(import.meta.url)) ===
    normalize(resolve(process.argv[1]));

if (isDirect) {
  main();
}

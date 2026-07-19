#!/usr/bin/env tsx
/**
 * Interactive questionnaire for OperatorAuthorizationV1.
 *
 * Walks through every wire field, validates with parseOperatorAuthorization,
 * and prints canonicalizeV2 JSON suitable for offline OpenPGP signing.
 *
 * Usage:
 *   npx tsx scripts/operator-authorization-questionnaire.ts
 *   npm run authz:questionnaire
 *
 * Options:
 *   --out <path>   Also write canonical JSON to a file
 *   --help         Show help
 */

import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import {
  canonicalizeV2,
  parseOperatorAuthorization,
  type OperatorAuthorizationV1,
} from "@ovrsr/fpp-protocol-core";
import { CLASSIFICATION_IDS } from "@ovrsr/fpp-enforcement-core";

/** Allowed grant lifetimes (minutes). */
export const TIMEFRAME_MINUTES = [10, 30, 60, 90] as const;
export type TimeframeMinutes = (typeof TIMEFRAME_MINUTES)[number];
export const DEFAULT_TIMEFRAME_MINUTES: TimeframeMinutes = 60;

/** Raw string answers collected from the questionnaire (all fields). */
export type AuthorizationAnswers = {
  schemaVersion: string;
  kind: string;
  authorizationId: string;
  stewardId: string;
  signingKeyRef: string;
  audience: string;
  mode: string;
  /** Questionnaire-only: enables "all" for classifications/toolNames/resourcePaths. */
  emergencyAuthorization: string;
  classifications: string;
  toolNames: string;
  resourcePaths: string;
  issuedAt: string;
  /** One of TIMEFRAME_MINUTES; used to derive expiresAt. */
  durationMinutes: string;
  nonce: string;
  maxUses: string;
  reason: string;
};

export type BuildResult =
  | { ok: true; authorization: OperatorAuthorizationV1 }
  | { ok: false; error: string };

/** All exact classification ids (comma-separated) for scope.classifications. */
export const SCOPE_CLASSIFICATIONS_CSV = CLASSIFICATION_IDS.join(", ");

const HINTS: Record<keyof AuthorizationAnswers, string> = {
  schemaVersion: "Must be 1",
  kind: 'Must be "operator-authorization"',
  authorizationId: "Unique id for this grant (any non-empty string)",
  stewardId: "fpp:steward:v1:<26 lowercase base32 chars> (bare body also accepted)",
  signingKeyRef:
    "openpgp:<40- or 64-char lowercase fingerprint> (bare fingerprint also accepted)",
  audience: "Local instance id (must match steward ledger policy)",
  mode: "one-shot | standing",
  emergencyAuthorization:
    "yes|no — questionnaire-only. When yes, classifications/toolNames/resourcePaths may be \"all\". Does not bypass hard floors or become emergency override.",
  classifications: `Comma-separated exact ids (or \"all\" if emergency). Available: ${SCOPE_CLASSIFICATIONS_CSV}`,
  toolNames:
    'Optional comma-separated exact tool names (e.g. apply_patch). Empty = omit. \"all\" (emergency only) = no tool filter',
  resourcePaths:
    'Optional comma-separated workspace-relative paths. Empty = omit. \"all\" (emergency only) = no path filter',
  issuedAt: "ISO-8601 UTC (e.g. 2026-07-18T12:00:00.000Z)",
  durationMinutes: `Grant lifetime in minutes: ${TIMEFRAME_MINUTES.join(" | ")} (default ${DEFAULT_TIMEFRAME_MINUTES})`,
  nonce: "32–128 URL-safe alphanumeric chars (A-Za-z0-9_-)",
  maxUses: "Positive integer; one-shot must be 1",
  reason: "Human-readable justification (non-empty)",
};

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function mintNonce(): string {
  return randomBytes(24).toString("base64url");
}

function mintAuthorizationId(): string {
  return `authz-${randomBytes(8).toString("hex")}`;
}

function isAllToken(value: string): boolean {
  return value.trim().toLowerCase() === "all";
}

export function parseEmergencyAuthorization(raw: string): boolean {
  const v = raw.trim().toLowerCase();
  return v === "y" || v === "yes" || v === "true" || v === "1";
}

export function parseDurationMinutes(raw: string): TimeframeMinutes | undefined {
  const n = Number(raw.trim());
  if (!Number.isInteger(n)) return undefined;
  return (TIMEFRAME_MINUTES as readonly number[]).includes(n)
    ? (n as TimeframeMinutes)
    : undefined;
}

export function expiresAtFromDuration(
  issuedAt: string,
  minutes: TimeframeMinutes,
): string {
  const issued = Date.parse(issuedAt);
  if (Number.isNaN(issued)) {
    throw new Error("issuedAt must be ISO-8601 UTC");
  }
  return new Date(issued + minutes * 60 * 1000).toISOString();
}

/** Accept bare 26-char body or full fpp:steward:v1:… form. */
export function normalizeStewardId(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (/^[a-z2-7]{26}$/.test(value)) {
    return `fpp:steward:v1:${value}`;
  }
  return value;
}

/** Accept bare 40/64 hex fingerprint or openpgp:… form. */
export function normalizeSigningKeyRef(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (/^[0-9a-f]{40}$/.test(value) || /^[0-9a-f]{64}$/.test(value)) {
    return `openpgp:${value}`;
  }
  return value;
}

/**
 * Resolve a CSV field. When emergency and value is "all":
 * - classifications → every CLASSIFICATION_ID
 * - toolNames / resourcePaths → omit (undefined) = unrestricted within classifications
 */
function resolveScopeList(
  field: "classifications" | "toolNames" | "resourcePaths",
  raw: string,
  emergency: boolean,
): { ok: true; values: string[] | undefined } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (isAllToken(trimmed)) {
    if (!emergency) {
      return {
        ok: false,
        error: `"all" for ${field} requires emergencyAuthorization=yes`,
      };
    }
    if (field === "classifications") {
      return { ok: true, values: [...CLASSIFICATION_IDS] };
    }
    // toolNames / resourcePaths: omit filter (= any tool or path in scope)
    return { ok: true, values: undefined };
  }
  const values = splitCsv(trimmed);
  if (field === "classifications") {
    return { ok: true, values };
  }
  return { ok: true, values: values.length > 0 ? values : undefined };
}

/** Build and validate OperatorAuthorizationV1 from questionnaire string answers. */
export function buildOperatorAuthorizationFromAnswers(
  answers: AuthorizationAnswers,
): BuildResult {
  const schemaVersion = Number(answers.schemaVersion.trim());
  if (schemaVersion !== 1) {
    return { ok: false, error: "schemaVersion must be 1" };
  }
  if (answers.kind.trim() !== "operator-authorization") {
    return { ok: false, error: 'kind must be "operator-authorization"' };
  }
  const mode = answers.mode.trim();
  if (mode !== "one-shot" && mode !== "standing") {
    return { ok: false, error: 'mode must be "one-shot" or "standing"' };
  }
  const maxUses = Number(answers.maxUses.trim());
  if (!Number.isInteger(maxUses) || maxUses < 1) {
    return { ok: false, error: "maxUses must be a positive integer" };
  }

  const emergency = parseEmergencyAuthorization(answers.emergencyAuthorization);
  const duration = parseDurationMinutes(answers.durationMinutes);
  if (duration === undefined) {
    return {
      ok: false,
      error: `durationMinutes must be one of ${TIMEFRAME_MINUTES.join("|")}`,
    };
  }

  const classifications = resolveScopeList(
    "classifications",
    answers.classifications,
    emergency,
  );
  if (!classifications.ok) return classifications;
  const toolNames = resolveScopeList("toolNames", answers.toolNames, emergency);
  if (!toolNames.ok) return toolNames;
  const resourcePaths = resolveScopeList(
    "resourcePaths",
    answers.resourcePaths,
    emergency,
  );
  if (!resourcePaths.ok) return resourcePaths;

  let expiresAt: string;
  try {
    expiresAt = expiresAtFromDuration(answers.issuedAt.trim(), duration);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "invalid issuedAt",
    };
  }

  const authorization: OperatorAuthorizationV1 = {
    schemaVersion: 1,
    kind: "operator-authorization",
    authorizationId: answers.authorizationId.trim(),
    stewardId: normalizeStewardId(answers.stewardId),
    signingKeyRef: normalizeSigningKeyRef(answers.signingKeyRef),
    audience: answers.audience.trim(),
    mode,
    scope: {
      classifications: classifications.values ?? [],
      ...(toolNames.values !== undefined ? { toolNames: toolNames.values } : {}),
      ...(resourcePaths.values !== undefined
        ? { resourcePaths: resourcePaths.values }
        : {}),
    },
    issuedAt: answers.issuedAt.trim(),
    expiresAt,
    nonce: answers.nonce.trim(),
    maxUses,
    reason: answers.reason.trim(),
  };

  const parsed = parseOperatorAuthorization(authorization);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }
  return { ok: true, authorization: parsed.authorization };
}

type Question = {
  key: keyof AuthorizationAnswers;
  label: string;
  defaultValue?: () => string;
};

const QUESTIONS: Question[] = [
  {
    key: "schemaVersion",
    label: "schemaVersion",
    defaultValue: () => "1",
  },
  {
    key: "kind",
    label: "kind",
    defaultValue: () => "operator-authorization",
  },
  {
    key: "authorizationId",
    label: "authorizationId",
    defaultValue: mintAuthorizationId,
  },
  { key: "stewardId", label: "stewardId" },
  { key: "signingKeyRef", label: "signingKeyRef" },
  { key: "audience", label: "audience" },
  {
    key: "mode",
    label: "mode",
    defaultValue: () => "one-shot",
  },
  {
    key: "emergencyAuthorization",
    label: "emergencyAuthorization",
    defaultValue: () => "no",
  },
  { key: "classifications", label: "scope.classifications" },
  {
    key: "toolNames",
    label: "scope.toolNames (optional)",
    defaultValue: () => "",
  },
  {
    key: "resourcePaths",
    label: "scope.resourcePaths (optional)",
    defaultValue: () => "",
  },
  {
    key: "issuedAt",
    label: "issuedAt",
    defaultValue: () => new Date().toISOString(),
  },
  {
    key: "durationMinutes",
    label: "durationMinutes",
    defaultValue: () => String(DEFAULT_TIMEFRAME_MINUTES),
  },
  {
    key: "nonce",
    label: "nonce",
    defaultValue: mintNonce,
  },
  {
    key: "maxUses",
    label: "maxUses",
    defaultValue: () => "1",
  },
  { key: "reason", label: "reason" },
];

const OPTIONAL_EMPTY_KEYS = new Set<keyof AuthorizationAnswers>([
  "toolNames",
  "resourcePaths",
]);

async function promptAll(): Promise<AuthorizationAnswers> {
  const rl = createInterface({ input, output });
  const answers = {} as AuthorizationAnswers;

  console.log("");
  console.log("OperatorAuthorizationV1 questionnaire");
  console.log("─────────────────────────────────────");
  console.log("Press Enter to accept a default. Empty optional lists omit the field.");
  console.log("Forbidden classifications: affected-party-consent, data-subject-consent,");
  console.log("constitutional-ratification. Wildcards and path traversal are rejected.");
  console.log(
    `Timeframe options: ${TIMEFRAME_MINUTES.join(", ")} minutes (default ${DEFAULT_TIMEFRAME_MINUTES}).`,
  );
  console.log("");

  try {
    for (const q of QUESTIONS) {
      console.log(`  ${HINTS[q.key]}`);

      let def = q.defaultValue?.() ?? "";
      if (q.key === "maxUses" && answers.mode === "one-shot") {
        def = "1";
      } else if (q.key === "maxUses" && answers.mode === "standing" && def === "1") {
        def = "5";
      }
      if (
        q.key === "classifications" &&
        parseEmergencyAuthorization(answers.emergencyAuthorization ?? "")
      ) {
        def = "all";
      }
      if (
        (q.key === "toolNames" || q.key === "resourcePaths") &&
        parseEmergencyAuthorization(answers.emergencyAuthorization ?? "")
      ) {
        def = "all";
      }

      const suffix = def.length > 0 ? ` [${def}]` : "";
      const raw = (await rl.question(`${q.label}${suffix}: `)).trim();
      const value = raw.length > 0 ? raw : def;

      if (value.length === 0 && !OPTIONAL_EMPTY_KEYS.has(q.key)) {
        console.error(`  error: ${q.label} is required`);
        let filled = "";
        while (filled.length === 0) {
          filled = (await rl.question(`${q.label}: `)).trim();
          if (filled.length === 0) {
            console.error(`  error: ${q.label} is required`);
          }
        }
        answers[q.key] = filled;
      } else {
        answers[q.key] = value;
      }
      console.log("");
    }
  } finally {
    rl.close();
  }

  return answers;
}

function printHelp(): void {
  console.log(`Usage: npx tsx scripts/operator-authorization-questionnaire.ts [--out <path>]

Interactive questionnaire that collects every OperatorAuthorizationV1 field,
validates the result, and prints canonicalizeV2 JSON for offline signing.

When emergencyAuthorization=yes, classifications/toolNames/resourcePaths accept
"all" (expand classifications; omit tool/path filters).

Timeframe: choose durationMinutes from ${TIMEFRAME_MINUTES.join("|")} (default ${DEFAULT_TIMEFRAME_MINUTES}).

Options:
  --out <path>   Write canonical JSON to this file as well as stdout
  --help         Show this help
`);
}

function parseArgs(argv: string[]): { outPath?: string; help: boolean } {
  let outPath: string | undefined;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--out") {
      const next = argv[++i];
      if (!next) {
        console.error("error: --out requires a path");
        process.exit(1);
      }
      outPath = next;
    } else {
      console.error(`error: unknown argument: ${arg}`);
      process.exit(1);
    }
  }
  return outPath !== undefined ? { outPath, help } : { help };
}

async function main(): Promise<void> {
  const { outPath, help } = parseArgs(process.argv.slice(2));
  if (help) {
    printHelp();
    return;
  }

  const answers = await promptAll();
  const result = buildOperatorAuthorizationFromAnswers(answers);
  if (!result.ok) {
    console.error(`error: invalid authorization — ${result.error}`);
    console.error("Re-run the questionnaire and correct the field(s) above.");
    process.exit(1);
  }

  const canonical = canonicalizeV2(result.authorization);
  if (outPath !== undefined) {
    const abs = resolve(outPath);
    writeFileSync(abs, canonical, "utf8");
    console.error(`Wrote ${abs}`);
  }

  console.log("");
  console.log("Valid OperatorAuthorizationV1 (canonicalizeV2 — sign these exact bytes):");
  console.log("─────────────────────────────────────────────────────────────────────────");
  process.stdout.write(canonical);
  if (!canonical.endsWith("\n")) {
    process.stdout.write("\n");
  }
  console.log("");
  console.log("Next: sign with external OpenPGP tooling, then:");
  console.log("  steward authorization-verify --payload <file> --signature <sig>");
  console.log("  steward authorization-admit  --payload <file> --signature <sig>");
}

const isDirectRun =
  process.argv[1] !== undefined &&
  /operator-authorization-questionnaire\.(ts|js|mjs|cjs)$/.test(
    process.argv[1].replace(/\\/g, "/"),
  );

if (isDirectRun) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}

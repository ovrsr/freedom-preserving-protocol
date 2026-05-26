/**
 * audit-log.ts
 *
 * Hash-chained JSONL audit log writer used by the FPP plugin. Same canonical
 * JSON format as scripts/audit-append.ts in the parent skill package, so an
 * external verifier can validate both logs with the same tooling.
 *
 * Entries written here have kind "enforcement" (with a sub-kind in the
 * decision field). The skill's heartbeat audit (kind "heartbeat") writes to
 * a separate file; the two logs are complementary, not duplicative.
 */

import {
  appendFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";

const ZERO = "0".repeat(64);

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k])).join(",") + "}"
  );
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function hashEntry(entry: Record<string, unknown>): string {
  const { hash: _ignored, ...rest } = entry;
  void _ignored;
  return sha256Hex(canonicalize(rest));
}

function readPreviousHash(logPath: string): string {
  if (!existsSync(logPath)) return ZERO;
  const content = readFileSync(logPath, "utf-8").trim();
  if (!content) return ZERO;
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return ZERO;
  const last = lines[lines.length - 1];
  if (!last) return ZERO;
  try {
    const parsed = JSON.parse(last) as Record<string, unknown>;
    const h = parsed.hash;
    if (typeof h === "string" && /^[0-9a-f]{64}$/.test(h)) return h;
  } catch {
    /* fallthrough */
  }
  return ZERO;
}

export type EnforcementEvent = {
  toolName: string;
  agentId?: string | undefined;
  runId?: string | undefined;
  sessionKey?: string | undefined;
  classification: string;
  decision: "block" | "approval" | "allow";
  reason: string;
  constitutionHash: string;
};

export type EnforcementOutcome =
  | "blocked"
  | "approval_requested"
  | "approved"
  | "denied"
  | "timeout"
  | "cancelled"
  | "allowed";

export function appendEnforcementEntry(
  logPath: string,
  event: EnforcementEvent,
  outcome: EnforcementOutcome,
): { hash: string; previousHash: string } {
  const resolved = resolve(logPath);
  mkdirSync(dirname(resolved), { recursive: true });
  const previousHash = readPreviousHash(resolved);

  const entry: Record<string, unknown> = {
    previousHash,
    timestamp: new Date().toISOString(),
    kind: "enforcement",
    classification: event.classification,
    decision: event.decision,
    outcome,
    toolName: event.toolName,
    agentId: event.agentId ?? null,
    runId: event.runId ?? null,
    sessionKey: event.sessionKey ?? null,
    reason: event.reason.slice(0, 280),
    constitutionHash: event.constitutionHash,
  };
  entry.hash = hashEntry(entry);

  appendFileSync(resolved, JSON.stringify(entry) + "\n");
  return { hash: entry.hash as string, previousHash };
}

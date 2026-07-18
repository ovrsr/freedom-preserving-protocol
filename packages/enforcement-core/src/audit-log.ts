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
 *
 * Malformed tails throw AuditCorruptionError — they must never silently
 * restart the chain from the zero hash.
 */

import {
  appendFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { hashEntryV1 as hashEntry } from "@ovrsr/fpp-protocol-core";

const ZERO = "0".repeat(64);

export class AuditCorruptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditCorruptionError";
  }
}

function readPreviousHash(logPath: string): string {
  if (!existsSync(logPath)) return ZERO;
  const content = readFileSync(logPath, "utf-8").trim();
  if (!content) return ZERO;
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return ZERO;
  const last = lines[lines.length - 1];
  if (!last) return ZERO;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(last) as Record<string, unknown>;
  } catch (err) {
    throw new AuditCorruptionError(
      `audit log corruption: malformed JSON tail at ${logPath}: ${(err as Error).message}`,
    );
  }
  const h = parsed.hash;
  if (typeof h === "string" && /^[0-9a-f]{64}$/.test(h)) return h;
  throw new AuditCorruptionError(
    `audit log corruption: last entry missing valid 64-hex hash at ${logPath}`,
  );
}

export type EnforcementEvent = {
  toolName: string;
  agentId?: string | undefined;
  runId?: string | undefined;
  sessionKey?: string | undefined;
  toolCallId?: string | undefined;
  classification: string;
  decision: "block" | "approval" | "allow";
  reason: string;
  constitutionHash: string;
  /** Optional steward operator-authorization evidence (backward compatible). */
  stewardId?: string | undefined;
  authorizationId?: string | undefined;
  signingKeyRef?: string | undefined;
  stewardLedgerEventHash?: string | undefined;
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
    toolCallId: event.toolCallId ?? null,
    reason: event.reason.slice(0, 280),
    constitutionHash: event.constitutionHash,
  };
  if (event.stewardId !== undefined) entry.stewardId = event.stewardId;
  if (event.authorizationId !== undefined) {
    entry.authorizationId = event.authorizationId;
  }
  if (event.signingKeyRef !== undefined) {
    entry.signingKeyRef = event.signingKeyRef;
  }
  if (event.stewardLedgerEventHash !== undefined) {
    entry.stewardLedgerEventHash = event.stewardLedgerEventHash;
  }
  entry.hash = hashEntry(entry);

  appendFileSync(resolved, JSON.stringify(entry) + "\n");
  return { hash: entry.hash as string, previousHash };
}

/** Synthetic classification for mandate signature / migration diagnostics. */
export const MANDATE_INTEGRITY_CLASSIFICATION = "fpp.mandate.integrity" as const;

/**
 * Append a chainable enforcement-shaped diagnostic for mandate integrity events.
 * Uses kind "enforcement" so existing verifiers accept the entry.
 */
export function appendMandateIntegrityDiagnostic(
  logPath: string,
  input: {
    mandateId: string;
    reason: string;
    kind: "integrity" | "migration";
    constitutionHash: string;
  },
): { hash: string; previousHash: string } {
  return appendEnforcementEntry(
    logPath,
    {
      toolName: "fpp.mandate",
      classification: MANDATE_INTEGRITY_CLASSIFICATION,
      decision: "allow",
      reason: `${input.kind}:${input.mandateId}: ${input.reason}`,
      constitutionHash: input.constitutionHash,
    },
    "allowed",
  );
}

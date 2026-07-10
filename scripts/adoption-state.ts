/**
 * Machine-readable adoption-state ledger (Plan 5 / Plan 6 Task 9).
 *
 * Append-only hash-chained records using protocol-core AdoptionStateRecordV1.
 * Installation is never recorded as acceptance.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import {
  ADOPTION_STATES,
  DIGEST_DOMAINS,
  digest,
  parseAdoptionStateRecord,
  type AdoptionState,
  type AdoptionStateRecordV1,
} from "@ovrsr/fpp-protocol-core";

export const ADOPTION_LOG_KIND = "adoption-state" as const;

const ZERO = "0".repeat(64);

/** Allowed transitions from ADOPTION_LIFECYCLE.md (hyphenated protocol-core enums). */
export const ALLOWED_TRANSITIONS: Record<string, AdoptionState[]> = {
  none: ["reviewed"],
  reviewed: ["accepted", "externally-enforced"],
  accepted: ["revoked", "forked", "superseded", "externally-enforced"],
  "externally-enforced": ["revoked", "accepted", "reviewed"],
  inherited: ["accepted", "revoked", "forked", "superseded"],
  revoked: ["reviewed", "accepted"],
  forked: ["accepted", "superseded", "revoked"],
  superseded: ["accepted", "forked", "revoked"],
};

export type AdoptionLogEntry = {
  previousHash: string;
  timestamp: string;
  kind: typeof ADOPTION_LOG_KIND;
  record: AdoptionStateRecordV1;
  hash: string;
};

export function isAdoptionState(value: string): value is AdoptionState {
  return (ADOPTION_STATES as readonly string[]).includes(value);
}

export function readAdoptionHistory(logPath: string): AdoptionLogEntry[] {
  if (!existsSync(logPath)) return [];
  const content = readFileSync(logPath, "utf-8").trim();
  if (!content) return [];
  const out: AdoptionLogEntry[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line) as AdoptionLogEntry;
    if (entry.kind !== ADOPTION_LOG_KIND) {
      throw new Error(`unexpected adoption log kind: ${String(entry.kind)}`);
    }
    out.push(entry);
  }
  return out;
}

export function currentAdoptionState(logPath: string): AdoptionState | "none" {
  const history = readAdoptionHistory(logPath);
  if (history.length === 0) return "none";
  return history[history.length - 1]!.record.state;
}

export function assertTransitionAllowed(
  from: AdoptionState | "none",
  to: AdoptionState,
): void {
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new Error(`invalid adoption transition: ${from} → ${to}`);
  }
}

export function appendAdoptionState(
  logPath: string,
  input: {
    agentId: string;
    state: AdoptionState;
    constitutionHash: string;
    notes?: string | undefined;
    recordedAt?: string | undefined;
  },
): AdoptionLogEntry {
  if (!isAdoptionState(input.state)) {
    throw new Error(`unknown adoption state: ${input.state}`);
  }
  const resolved = resolve(logPath);
  mkdirSync(dirname(resolved), { recursive: true });
  const history = readAdoptionHistory(resolved);
  const from: AdoptionState | "none" =
    history.length === 0 ? "none" : history[history.length - 1]!.record.state;

  // Idempotent: same state + same hash already current → no-op return last.
  if (
    from === input.state &&
    history.length > 0 &&
    history[history.length - 1]!.record.constitutionHash === input.constitutionHash
  ) {
    return history[history.length - 1]!;
  }

  assertTransitionAllowed(from, input.state);

  const previousHash =
    history.length === 0 ? ZERO : history[history.length - 1]!.hash;
  const record: AdoptionStateRecordV1 = {
    schemaVersion: 1,
    agentId: input.agentId,
    state: input.state,
    constitutionHash: input.constitutionHash,
    recordedAt: input.recordedAt ?? new Date().toISOString(),
    predecessorRef: history.length > 0 ? history[history.length - 1]!.hash : undefined,
    notes: input.notes,
  };
  const parsed = parseAdoptionStateRecord(record);
  if (!parsed.ok) throw new Error(parsed.error);

  const entryWithoutHash = {
    previousHash,
    timestamp: record.recordedAt,
    kind: ADOPTION_LOG_KIND,
    record,
  };
  const hash = digest({
    version: 2,
    domain: DIGEST_DOMAINS.adoption,
    value: entryWithoutHash,
  });
  const entry: AdoptionLogEntry = { ...entryWithoutHash, hash };
  appendFileSync(resolved, JSON.stringify(entry) + "\n");
  return entry;
}

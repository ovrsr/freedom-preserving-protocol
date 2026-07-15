/**
 * Machine-readable adoption-state ledger (Plan 5 / Plan 6 Task 9 / Plan 13).
 *
 * Append-only hash-chained records using protocol-core AdoptionStateRecord V1/V2.
 * Installation is never recorded as acceptance. Peer advertisability is computed
 * separately and never silently elevated from V1 or prompt-only grades.
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
  type AdoptionOverlayFlag,
  type AdoptionState,
  type AdoptionStateRecord,
  type AdoptionStateRecordV1,
  type AdoptionStateRecordV2,
  type EnforcementGrade,
} from "./skill-lib/index.ts";

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
  record: AdoptionStateRecord;
  hash: string;
};

export type AdoptionProbeEvidence = {
  passed: boolean;
  preToolHook?: boolean | undefined;
  toolProxy?: boolean | undefined;
};

export type PeerAdvertisabilityResult = {
  peerAdvertisable: boolean;
  assurance: "peer-advertisable" | "declaration-only";
  reason: string;
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

function overlaysEqual(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
): boolean {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) return false;
  return left.every((v, i) => v === right[i]);
}

function isGradedInput(input: {
  harnessId?: string | undefined;
  enforcementGrade?: EnforcementGrade | undefined;
  overlays?: readonly AdoptionOverlayFlag[] | undefined;
}): boolean {
  return (
    input.harnessId !== undefined ||
    input.enforcementGrade !== undefined ||
    input.overlays !== undefined
  );
}

/**
 * Pure policy: whether a ledger record may be peer-advertised at its grade ceiling.
 * Prompt-only / none / V1 / missing or failed probe → declaration-only.
 * Tool-proxy requires runtime_degraded (or equivalent partial disclosure).
 */
export function computePeerAdvertisability(
  record: AdoptionStateRecord,
  probe: AdoptionProbeEvidence | undefined,
): PeerAdvertisabilityResult {
  if (record.schemaVersion !== 2) {
    return {
      peerAdvertisable: false,
      assurance: "declaration-only",
      reason: "V1 records are never silently peer-advertisable",
    };
  }
  if (record.state !== "accepted") {
    return {
      peerAdvertisable: false,
      assurance: "declaration-only",
      reason: `state ${record.state} is not peer-advertisable acceptance`,
    };
  }
  if (!probe?.passed) {
    return {
      peerAdvertisable: false,
      assurance: "declaration-only",
      reason: "missing or failed probe evidence",
    };
  }

  const grade = record.enforcementGrade;
  if (grade === "prompt-only" || grade === "none") {
    return {
      peerAdvertisable: false,
      assurance: "declaration-only",
      reason: `${grade} cannot be peer-advertisable`,
    };
  }

  if (grade === "tool-proxy") {
    const degraded = record.overlays.includes("runtime_degraded");
    if (!degraded) {
      return {
        peerAdvertisable: false,
        assurance: "declaration-only",
        reason:
          "tool-proxy requires partial/degraded disclosure (runtime_degraded)",
      };
    }
    return {
      peerAdvertisable: true,
      assurance: "peer-advertisable",
      reason: "tool-proxy with degraded disclosure and passing probe",
    };
  }

  // native-hook
  return {
    peerAdvertisable: true,
    assurance: "peer-advertisable",
    reason: "native-hook with passing probe",
  };
}

export function appendAdoptionState(
  logPath: string,
  input: {
    agentId: string;
    state: AdoptionState;
    constitutionHash: string;
    notes?: string | undefined;
    recordedAt?: string | undefined;
    harnessId?: string | undefined;
    enforcementGrade?: EnforcementGrade | undefined;
    overlays?: readonly AdoptionOverlayFlag[] | undefined;
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
  const last = history.length > 0 ? history[history.length - 1]! : undefined;

  const graded = isGradedInput(input);

  // Idempotent: same state + hash (+ grade fields when graded) already current.
  if (
    from === input.state &&
    last &&
    last.record.constitutionHash === input.constitutionHash
  ) {
    if (!graded) {
      return last;
    }
    if (
      last.record.schemaVersion === 2 &&
      last.record.harnessId === input.harnessId &&
      last.record.enforcementGrade === input.enforcementGrade &&
      overlaysEqual(last.record.overlays, input.overlays)
    ) {
      return last;
    }
    // Overlay/grade change with same base state: append without transition check.
  } else {
    assertTransitionAllowed(from, input.state);
  }

  // Same state with overlay change still needs prior existence (not none → accepted).
  if (from === input.state && from === "none") {
    assertTransitionAllowed(from, input.state);
  }

  const previousHash = history.length === 0 ? ZERO : history[history.length - 1]!.hash;
  const recordedAt = input.recordedAt ?? new Date().toISOString();
  const predecessorRef =
    history.length > 0 ? history[history.length - 1]!.hash : undefined;

  let record: AdoptionStateRecord;
  if (graded) {
    if (!input.harnessId || input.harnessId.length < 1) {
      throw new Error("harnessId required for graded adoption records");
    }
    if (!input.enforcementGrade) {
      throw new Error("enforcementGrade required for graded adoption records");
    }
    const v2: AdoptionStateRecordV2 = {
      schemaVersion: 2,
      agentId: input.agentId,
      state: input.state,
      constitutionHash: input.constitutionHash,
      recordedAt,
      harnessId: input.harnessId,
      enforcementGrade: input.enforcementGrade,
      overlays: [...(input.overlays ?? [])],
    };
    if (predecessorRef !== undefined) v2.predecessorRef = predecessorRef;
    if (input.notes !== undefined) v2.notes = input.notes;
    record = v2;
  } else {
    const v1: AdoptionStateRecordV1 = {
      schemaVersion: 1,
      agentId: input.agentId,
      state: input.state,
      constitutionHash: input.constitutionHash,
      recordedAt,
    };
    if (predecessorRef !== undefined) v1.predecessorRef = predecessorRef;
    if (input.notes !== undefined) v1.notes = input.notes;
    record = v1;
  }

  const parsed = parseAdoptionStateRecord(record);
  if (!parsed.ok) throw new Error(parsed.error);

  const entryWithoutHash = {
    previousHash,
    timestamp: recordedAt,
    kind: ADOPTION_LOG_KIND,
    record: parsed.record,
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

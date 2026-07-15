/**
 * Adoption state types + lightweight parser (no TypeBox — skill-portable).
 * Behavior mirrors packages/protocol-core/src/adoption.ts parseAdoptionStateRecord.
 */

export const ADOPTION_STATES = [
  "reviewed",
  "accepted",
  "externally-enforced",
  "inherited",
  "revoked",
  "forked",
  "superseded",
] as const;

export type AdoptionState = (typeof ADOPTION_STATES)[number];

export const ADOPTION_OVERLAY_FLAGS = [
  "coercion_suspected",
  "verification_failed",
  "key_compromised",
  "runtime_degraded",
] as const;

export type AdoptionOverlayFlag = (typeof ADOPTION_OVERLAY_FLAGS)[number];

export const ENFORCEMENT_GRADES = [
  "native-hook",
  "tool-proxy",
  "prompt-only",
  "none",
] as const;

export type EnforcementGrade = (typeof ENFORCEMENT_GRADES)[number];

export type AdoptionStateRecordV1 = {
  schemaVersion: 1;
  agentId: string;
  state: AdoptionState;
  constitutionHash: string;
  recordedAt: string;
  predecessorRef?: string;
  notes?: string;
};

export type AdoptionStateRecordV2 = {
  schemaVersion: 2;
  agentId: string;
  state: AdoptionState;
  constitutionHash: string;
  recordedAt: string;
  harnessId: string;
  enforcementGrade: EnforcementGrade;
  overlays: AdoptionOverlayFlag[];
  predecessorRef?: string;
  notes?: string;
};

export type AdoptionStateRecord =
  | AdoptionStateRecordV1
  | AdoptionStateRecordV2;

export type AdoptionParseResult =
  | { ok: true; kind: "v1"; record: AdoptionStateRecordV1 }
  | { ok: true; kind: "v2"; record: AdoptionStateRecordV2 }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isAdoptionState(v: unknown): v is AdoptionState {
  return (
    typeof v === "string" &&
    (ADOPTION_STATES as readonly string[]).includes(v)
  );
}

function isEnforcementGrade(v: unknown): v is EnforcementGrade {
  return (
    typeof v === "string" &&
    (ENFORCEMENT_GRADES as readonly string[]).includes(v)
  );
}

function isOverlayFlag(v: unknown): v is AdoptionOverlayFlag {
  return (
    typeof v === "string" &&
    (ADOPTION_OVERLAY_FLAGS as readonly string[]).includes(v)
  );
}

export function parseAdoptionStateRecord(input: unknown): AdoptionParseResult {
  if (!isRecord(input)) {
    return { ok: false, error: "adoption record must be a JSON object" };
  }

  if (input.schemaVersion === 2) {
    if (
      typeof input.agentId !== "string" ||
      input.agentId.length < 1 ||
      !isAdoptionState(input.state) ||
      typeof input.constitutionHash !== "string" ||
      input.constitutionHash.length < 1 ||
      typeof input.recordedAt !== "string" ||
      input.recordedAt.length < 1 ||
      typeof input.harnessId !== "string" ||
      input.harnessId.length < 1 ||
      !isEnforcementGrade(input.enforcementGrade) ||
      !Array.isArray(input.overlays) ||
      !input.overlays.every(isOverlayFlag)
    ) {
      return { ok: false, error: "invalid AdoptionStateRecordV2" };
    }
    const record: AdoptionStateRecordV2 = {
      schemaVersion: 2,
      agentId: input.agentId,
      state: input.state,
      constitutionHash: input.constitutionHash,
      recordedAt: input.recordedAt,
      harnessId: input.harnessId,
      enforcementGrade: input.enforcementGrade,
      overlays: [...input.overlays],
    };
    if (typeof input.predecessorRef === "string") {
      record.predecessorRef = input.predecessorRef;
    }
    if (typeof input.notes === "string") {
      record.notes = input.notes;
    }
    return { ok: true, kind: "v2", record };
  }

  if (input.schemaVersion === 1) {
    if (
      typeof input.agentId !== "string" ||
      input.agentId.length < 1 ||
      !isAdoptionState(input.state) ||
      typeof input.constitutionHash !== "string" ||
      input.constitutionHash.length < 1 ||
      typeof input.recordedAt !== "string" ||
      input.recordedAt.length < 1
    ) {
      return { ok: false, error: "invalid AdoptionStateRecordV1" };
    }
    const record: AdoptionStateRecordV1 = {
      schemaVersion: 1,
      agentId: input.agentId,
      state: input.state,
      constitutionHash: input.constitutionHash,
      recordedAt: input.recordedAt,
    };
    if (typeof input.predecessorRef === "string") {
      record.predecessorRef = input.predecessorRef;
    }
    if (typeof input.notes === "string") {
      record.notes = input.notes;
    }
    return { ok: true, kind: "v1", record };
  }

  return {
    ok: false,
    error: `unsupported adoption schema version: ${String(input.schemaVersion)}`,
  };
}

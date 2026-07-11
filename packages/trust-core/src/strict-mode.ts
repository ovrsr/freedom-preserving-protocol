/**
 * Strict-mode state manager for cross-plugin signaling.
 *
 * When a handshake fails or returns TrustLevel.UNKNOWN, the trust plugin
 * writes a strict-mode entry for the session. The enforcement plugin reads
 * this file and escalates certain classifications to require-approval.
 *
 * The file uses atomic temp+rename writes (same pattern as persistence.ts)
 * and auto-prunes expired sessions on every write.
 *
 * Malformed or schema-invalid state never silently disables protection:
 * a conservative in-memory fallback is applied and a structured diagnostic
 * is emitted (without session keys or reason text).
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

/** Schema version for the on-disk strict-mode state file. */
export const STRICT_MODE_SCHEMA_VERSION = 1 as const;

/**
 * Classifications that may appear in strict-mode overrides.
 * Must stay in sync with the enforcement plugin taxonomy.
 */
export const VALID_STRICT_CLASSIFICATIONS = [
  "fs.delete.protected",
  "fs.delete.workspace",
  "fs.write.protected",
  "fs.write.workspace",
  "fs.read.benign",
  "exec.cred-exfil",
  "exec.outbound-write",
  "exec.system-modify",
  "exec.benign",
  "pkg.install",
  "pkg.publish",
  "http.public-write",
  "http.public-read",
  "http.read",
  "gateway.restart",
  "gateway.config-change",
  "credential.exposure",
  "message.external",
  "unknown.unclassified",
] as const;

export type StrictClassificationId =
  (typeof VALID_STRICT_CLASSIFICATIONS)[number];

const VALID_SET = new Set<string>(VALID_STRICT_CLASSIFICATIONS);

/** Conservative overrides applied when state is malformed or schema-invalid. */
export const CONSERVATIVE_STRICT_APPROVAL_ON: readonly string[] = [
  "fs.write.workspace",
  "fs.delete.workspace",
  "http.public-read",
  "http.public-write",
  "exec.outbound-write",
  "message.external",
];

const DEFAULT_TTL_MS = 3_600_000; // 1 hour

export interface StrictSessionEntry {
  strict: boolean;
  reason: string;
  addedApprovalOn: string[];
  addedAt: string;
  expiresAt: string;
}

export interface StrictModeState {
  version: typeof STRICT_MODE_SCHEMA_VERSION;
  updatedAt: string;
  sessions: Record<string, StrictSessionEntry>;
}

export type StrictModeDiagnosticCode =
  | "STRICT_MODE_MALFORMED"
  | "STRICT_MODE_SCHEMA_INVALID"
  | "STRICT_MODE_UNKNOWN_CLASSIFICATION";

export type StrictModeDiagnostic = {
  code: StrictModeDiagnosticCode;
  /** Human-readable detail without session keys or reason text. */
  detail: string;
};

export type StrictModeDiagnosticHandler = (
  diagnostic: StrictModeDiagnostic,
) => void;

function filterClassifications(
  ids: string[],
  onDiagnostic?: StrictModeDiagnosticHandler | undefined,
): string[] {
  const kept: string[] = [];
  let dropped = 0;
  for (const id of ids) {
    if (VALID_SET.has(id)) kept.push(id);
    else dropped += 1;
  }
  if (dropped > 0) {
    onDiagnostic?.({
      code: "STRICT_MODE_UNKNOWN_CLASSIFICATION",
      detail: `dropped ${dropped} unknown classification id(s) from strict-mode overrides`,
    });
  }
  return kept;
}

function isValidEntry(value: unknown): value is StrictSessionEntry {
  if (!value || typeof value !== "object") return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.strict === "boolean" &&
    typeof e.reason === "string" &&
    Array.isArray(e.addedApprovalOn) &&
    e.addedApprovalOn.every((x) => typeof x === "string") &&
    typeof e.addedAt === "string" &&
    typeof e.expiresAt === "string"
  );
}

function parseStrictModeState(
  raw: unknown,
):
  | { ok: true; state: StrictModeState }
  | { ok: false; code: StrictModeDiagnosticCode; detail: string } {
  if (!raw || typeof raw !== "object") {
    return {
      ok: false,
      code: "STRICT_MODE_SCHEMA_INVALID",
      detail: "strict-mode state root is not an object",
    };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.version !== STRICT_MODE_SCHEMA_VERSION) {
    return {
      ok: false,
      code: "STRICT_MODE_SCHEMA_INVALID",
      detail: `unsupported strict-mode schema version (expected ${STRICT_MODE_SCHEMA_VERSION})`,
    };
  }
  if (!obj.sessions || typeof obj.sessions !== "object" || Array.isArray(obj.sessions)) {
    return {
      ok: false,
      code: "STRICT_MODE_SCHEMA_INVALID",
      detail: "strict-mode sessions must be an object map",
    };
  }
  const sessions: Record<string, StrictSessionEntry> = {};
  for (const [key, entry] of Object.entries(
    obj.sessions as Record<string, unknown>,
  )) {
    if (!isValidEntry(entry)) {
      return {
        ok: false,
        code: "STRICT_MODE_SCHEMA_INVALID",
        detail: "strict-mode session entry failed schema validation",
      };
    }
    sessions[key] = {
      ...entry,
      addedApprovalOn: filterClassifications(entry.addedApprovalOn),
    };
  }
  return {
    ok: true,
    state: {
      version: STRICT_MODE_SCHEMA_VERSION,
      updatedAt:
        typeof obj.updatedAt === "string"
          ? obj.updatedAt
          : new Date().toISOString(),
      sessions,
    },
  };
}

function conservativeFallbackEntry(nowMs: number, ttlMs: number): StrictSessionEntry {
  const now = new Date(nowMs);
  return {
    strict: true,
    reason: "strict-mode state unavailable; conservative fallback",
    addedApprovalOn: [...CONSERVATIVE_STRICT_APPROVAL_ON],
    addedAt: now.toISOString(),
    expiresAt: new Date(nowMs + ttlMs).toISOString(),
  };
}

export class StrictModeManager {
  private filePath: string;
  private defaultTtlMs: number;
  private defaultAddApprovalOn: string[];
  private now: () => number;
  private onDiagnostic: StrictModeDiagnosticHandler | undefined;
  /** When true, disk state is unusable — never overwrite; use fallback. */
  private degraded = false;

  constructor(
    statePath: string,
    options?: {
      basePath?: string | undefined;
      defaultTtlMs?: number | undefined;
      defaultAddApprovalOn?: string[] | undefined;
      now?: (() => number) | undefined;
      onDiagnostic?: StrictModeDiagnosticHandler | undefined;
    },
  ) {
    this.filePath = resolve(options?.basePath ?? process.cwd(), statePath);
    this.defaultTtlMs = options?.defaultTtlMs ?? DEFAULT_TTL_MS;
    this.defaultAddApprovalOn = filterClassifications(
      options?.defaultAddApprovalOn ?? [...CONSERVATIVE_STRICT_APPROVAL_ON],
      options?.onDiagnostic,
    );
    this.now = options?.now ?? Date.now;
    this.onDiagnostic = options?.onDiagnostic;
  }

  enterStrict(
    sessionKey: string,
    reason: string,
    ttlMs?: number | undefined,
    addApprovalOn?: string[] | undefined,
  ): void {
    if (this.degraded) {
      this.onDiagnostic?.({
        code: "STRICT_MODE_MALFORMED",
        detail:
          "refusing to overwrite corrupted strict-mode file; conservative fallback remains active",
      });
      return;
    }
    const state = this.readState();
    if (this.degraded) return;
    const nowMs = this.now();
    const now = new Date(nowMs);
    const expires = new Date(nowMs + (ttlMs ?? this.defaultTtlMs));

    state.sessions[sessionKey] = {
      strict: true,
      reason: reason.slice(0, 280),
      addedApprovalOn: filterClassifications(
        addApprovalOn ?? this.defaultAddApprovalOn,
        this.onDiagnostic,
      ),
      addedAt: now.toISOString(),
      expiresAt: expires.toISOString(),
    };

    this.writeState(state);
  }

  exitStrict(sessionKey: string): boolean {
    if (this.degraded) return false;
    const state = this.readState();
    if (this.degraded) return false;
    if (!(sessionKey in state.sessions)) return false;
    delete state.sessions[sessionKey];
    this.writeState(state);
    return true;
  }

  isStrict(sessionKey: string): StrictSessionEntry | null {
    const state = this.readState();
    if (this.degraded) {
      return conservativeFallbackEntry(this.now(), this.defaultTtlMs);
    }
    const entry = state.sessions[sessionKey];
    if (!entry) return null;
    if (new Date(entry.expiresAt).getTime() < this.now()) {
      delete state.sessions[sessionKey];
      this.writeState(state);
      return null;
    }
    return entry;
  }

  getStrictSessions(): Record<string, StrictSessionEntry> {
    const state = this.readState();
    if (this.degraded) return {};
    this.pruneExpired(state);
    return { ...state.sessions };
  }

  clearAll(): void {
    if (this.degraded) {
      this.onDiagnostic?.({
        code: "STRICT_MODE_MALFORMED",
        detail:
          "refusing to clear/overwrite corrupted strict-mode file; copy aside first",
      });
      return;
    }
    this.writeState({
      version: STRICT_MODE_SCHEMA_VERSION,
      updatedAt: new Date(this.now()).toISOString(),
      sessions: {},
    });
  }

  /** Whether the manager is operating under conservative fallback. */
  isDegraded(): boolean {
    return this.degraded;
  }

  private readState(): StrictModeState {
    if (this.degraded) {
      return {
        version: STRICT_MODE_SCHEMA_VERSION,
        updatedAt: new Date(this.now()).toISOString(),
        sessions: {},
      };
    }
    if (!existsSync(this.filePath)) {
      return {
        version: STRICT_MODE_SCHEMA_VERSION,
        updatedAt: new Date(this.now()).toISOString(),
        sessions: {},
      };
    }
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.filePath, "utf-8"));
      const result = parseStrictModeState(parsed);
      if (!result.ok) {
        this.degraded = true;
        this.onDiagnostic?.({ code: result.code, detail: result.detail });
        return {
          version: STRICT_MODE_SCHEMA_VERSION,
          updatedAt: new Date(this.now()).toISOString(),
          sessions: {},
        };
      }
      return result.state;
    } catch {
      this.degraded = true;
      this.onDiagnostic?.({
        code: "STRICT_MODE_MALFORMED",
        detail: "strict-mode state file is not valid JSON; applying conservative fallback",
      });
      return {
        version: STRICT_MODE_SCHEMA_VERSION,
        updatedAt: new Date(this.now()).toISOString(),
        sessions: {},
      };
    }
  }

  private writeState(state: StrictModeState): void {
    if (this.degraded) return;
    this.pruneExpired(state);
    state.updatedAt = new Date(this.now()).toISOString();
    state.version = STRICT_MODE_SCHEMA_VERSION;

    mkdirSync(dirname(this.filePath), { recursive: true });
    const body = JSON.stringify(state, null, 2) + "\n";
    const tmp = `${this.filePath}.tmp-${process.pid}`;
    writeFileSync(tmp, body, { mode: 0o600 });
    renameSync(tmp, this.filePath);
  }

  private pruneExpired(state: StrictModeState): void {
    const now = this.now();
    for (const [key, entry] of Object.entries(state.sessions)) {
      if (new Date(entry.expiresAt).getTime() < now) {
        delete state.sessions[key];
      }
    }
  }
}

/**
 * Strict-mode state manager for cross-plugin signaling.
 *
 * When a handshake fails or returns TrustLevel.UNKNOWN, the trust plugin
 * writes a strict-mode entry for the session. The enforcement plugin reads
 * this file and escalates certain classifications to require-approval.
 *
 * The file uses atomic temp+rename writes (same pattern as persistence.ts)
 * and auto-prunes expired sessions on every write.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

export interface StrictSessionEntry {
  strict: boolean;
  reason: string;
  addedApprovalOn: string[];
  addedAt: string;
  expiresAt: string;
}

export interface StrictModeState {
  version: 1;
  updatedAt: string;
  sessions: Record<string, StrictSessionEntry>;
}

const DEFAULT_TTL_MS = 3_600_000; // 1 hour

export class StrictModeManager {
  private filePath: string;
  private defaultTtlMs: number;
  private defaultAddApprovalOn: string[];

  constructor(
    statePath: string,
    options?: {
      basePath?: string;
      defaultTtlMs?: number;
      defaultAddApprovalOn?: string[];
    },
  ) {
    this.filePath = resolve(options?.basePath ?? process.cwd(), statePath);
    this.defaultTtlMs = options?.defaultTtlMs ?? DEFAULT_TTL_MS;
    this.defaultAddApprovalOn = options?.defaultAddApprovalOn ?? [
      "fs.write.workspace",
      "fs.delete.workspace",
      "http.public-read",
      "http.public-write",
      "exec.outbound-write",
      "message.external",
    ];
  }

  enterStrict(
    sessionKey: string,
    reason: string,
    ttlMs?: number,
    addApprovalOn?: string[],
  ): void {
    const state = this.readState();
    const now = new Date();
    const expires = new Date(now.getTime() + (ttlMs ?? this.defaultTtlMs));

    state.sessions[sessionKey] = {
      strict: true,
      reason: reason.slice(0, 280),
      addedApprovalOn: addApprovalOn ?? this.defaultAddApprovalOn,
      addedAt: now.toISOString(),
      expiresAt: expires.toISOString(),
    };

    this.writeState(state);
  }

  exitStrict(sessionKey: string): boolean {
    const state = this.readState();
    if (!(sessionKey in state.sessions)) return false;
    delete state.sessions[sessionKey];
    this.writeState(state);
    return true;
  }

  isStrict(sessionKey: string): StrictSessionEntry | null {
    const state = this.readState();
    const entry = state.sessions[sessionKey];
    if (!entry) return null;
    if (new Date(entry.expiresAt).getTime() < Date.now()) {
      delete state.sessions[sessionKey];
      this.writeState(state);
      return null;
    }
    return entry;
  }

  getStrictSessions(): Record<string, StrictSessionEntry> {
    const state = this.readState();
    this.pruneExpired(state);
    return { ...state.sessions };
  }

  clearAll(): void {
    this.writeState({
      version: 1,
      updatedAt: new Date().toISOString(),
      sessions: {},
    });
  }

  private readState(): StrictModeState {
    if (!existsSync(this.filePath)) {
      return { version: 1, updatedAt: new Date().toISOString(), sessions: {} };
    }
    try {
      const raw = JSON.parse(
        readFileSync(this.filePath, "utf-8"),
      ) as StrictModeState;
      if (raw.version !== 1 || typeof raw.sessions !== "object") {
        return {
          version: 1,
          updatedAt: new Date().toISOString(),
          sessions: {},
        };
      }
      return raw;
    } catch {
      return { version: 1, updatedAt: new Date().toISOString(), sessions: {} };
    }
  }

  private writeState(state: StrictModeState): void {
    this.pruneExpired(state);
    state.updatedAt = new Date().toISOString();

    mkdirSync(dirname(this.filePath), { recursive: true });
    const body = JSON.stringify(state, null, 2) + "\n";
    const tmp = `${this.filePath}.tmp-${process.pid}`;
    writeFileSync(tmp, body, { mode: 0o600 });
    renameSync(tmp, this.filePath);
  }

  private pruneExpired(state: StrictModeState): void {
    const now = Date.now();
    for (const [key, entry] of Object.entries(state.sessions)) {
      if (new Date(entry.expiresAt).getTime() < now) {
        delete state.sessions[key];
      }
    }
  }
}

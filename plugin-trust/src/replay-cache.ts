/**
 * Bounded replay-key cache for challenge-response handshakes.
 *
 * Persists consumed keys when a path is provided. On corrupt/unreadable
 * storage, resets conservatively to an empty cache (fail-closed for
 * unknown history — operators must re-challenge).
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

export type ReplayCacheOptions = {
  path?: string | undefined;
  maxEntries?: number | undefined;
  now?: (() => number) | undefined;
};

type ReplayEntry = {
  key: string;
  expiresAtMs: number;
};

type PersistedReplay = {
  version: 1;
  entries: ReplayEntry[];
};

const DEFAULT_MAX = 10_000;

export class ReplayCache {
  private entries = new Map<string, number>();
  private readonly path: string | undefined;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: ReplayCacheOptions = {}) {
    this.path = options.path !== undefined ? resolve(options.path) : undefined;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX;
    this.now = options.now ?? Date.now;
    this.load();
  }

  has(key: string): boolean {
    this.prune();
    return this.entries.has(key);
  }

  size(): number {
    this.prune();
    return this.entries.size;
  }

  /**
   * Record a replay key as consumed. Returns false if already present.
   */
  consume(key: string, expiresAtMs: number): boolean {
    this.prune();
    if (this.entries.has(key)) return false;
    this.entries.set(key, expiresAtMs);
    this.enforceCap();
    this.persist();
    return true;
  }

  prune(): number {
    const now = this.now();
    let removed = 0;
    for (const [key, expires] of this.entries) {
      if (expires < now) {
        this.entries.delete(key);
        removed++;
      }
    }
    return removed;
  }

  private enforceCap(): void {
    if (this.entries.size <= this.maxEntries) return;
    const sorted = [...this.entries.entries()].sort((a, b) => a[1] - b[1]);
    const overflow = this.entries.size - this.maxEntries;
    for (let i = 0; i < overflow; i++) {
      this.entries.delete(sorted[i]![0]);
    }
  }

  private load(): void {
    if (this.path === undefined || !existsSync(this.path)) return;
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf8")) as unknown;
      if (
        raw === null ||
        typeof raw !== "object" ||
        (raw as PersistedReplay).version !== 1 ||
        !Array.isArray((raw as PersistedReplay).entries)
      ) {
        this.entries.clear();
        return;
      }
      for (const entry of (raw as PersistedReplay).entries) {
        if (
          typeof entry?.key === "string" &&
          typeof entry?.expiresAtMs === "number"
        ) {
          this.entries.set(entry.key, entry.expiresAtMs);
        }
      }
      this.prune();
    } catch {
      // Corrupt file — conservative empty reset.
      this.entries.clear();
    }
  }

  private persist(): void {
    if (this.path === undefined) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const payload: PersistedReplay = {
      version: 1,
      entries: [...this.entries.entries()].map(([key, expiresAtMs]) => ({
        key,
        expiresAtMs,
      })),
    };
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(payload, null, 2) + "\n", "utf8");
    renameSync(tmp, this.path);
  }
}

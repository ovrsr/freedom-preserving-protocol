/**
 * Resolve historical adoption timestamp for handshake offer claims (Q6-A).
 *
 * Preference: adoption-state accepted `recordedAt` (when present) →
 * SOUL `- Adopted: <ISO>` → current time. Never invent dates from thin air
 * beyond the `now` fallback.
 */
import { existsSync, readFileSync } from "node:fs";

const ADOPTED_LINE = /^-\s*Adopted:\s*(\S+)/im;

export function parseSoulAdoptedAt(soulContent: string): string | null {
  const m = soulContent.match(ADOPTED_LINE);
  if (!m?.[1]) return null;
  const raw = m[1].trim();
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function readAcceptedRecordedAt(adoptionStatePath: string): string | null {
  if (!existsSync(adoptionStatePath)) return null;
  const content = readFileSync(adoptionStatePath, "utf-8").trim();
  if (!content) return null;
  let lastAccepted: string | null = null;
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as {
        kind?: string;
        record?: { state?: string; recordedAt?: string };
      };
      if (entry.kind !== "adoption-state") continue;
      if (entry.record?.state !== "accepted") continue;
      if (
        typeof entry.record.recordedAt === "string" &&
        Number.isFinite(Date.parse(entry.record.recordedAt))
      ) {
        lastAccepted = new Date(entry.record.recordedAt).toISOString();
      }
    } catch {
      /* skip malformed */
    }
  }
  return lastAccepted;
}

export type ResolveAdoptedAtOptions = {
  soulPath?: string | undefined;
  adoptionStatePath?: string | undefined;
  now?: (() => Date) | undefined;
};

/**
 * Resolve adoptedAt for a claim. Prefers adoption-state accepted timestamp
 * when richer; else SOUL; else now().
 */
export function resolveAdoptedAt(opts: ResolveAdoptedAtOptions = {}): string {
  const now = opts.now ?? (() => new Date());

  if (opts.adoptionStatePath) {
    const fromState = readAcceptedRecordedAt(opts.adoptionStatePath);
    if (fromState) return fromState;
  }

  if (opts.soulPath && existsSync(opts.soulPath)) {
    const fromSoul = parseSoulAdoptedAt(readFileSync(opts.soulPath, "utf-8"));
    if (fromSoul) return fromSoul;
  }

  return now().toISOString();
}

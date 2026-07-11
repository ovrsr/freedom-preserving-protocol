/**
 * Deterministic test helpers for enforcement-core.
 * Never writes under a real `.openclaw/` path.
 */
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export type TempWorkspace = {
  path: string;
  writeFile: (relativePath: string, contents: string) => string;
  cleanup: () => void;
};

export function createTempWorkspace(prefix = "fpp-enforcement-"): TempWorkspace {
  const path = mkdtempSync(join(tmpdir(), prefix));
  if (path.includes(`${join(".openclaw")}`) || /[/\\]\.openclaw([/\\]|$)/.test(path)) {
    rmSync(path, { recursive: true, force: true });
    throw new Error("refusing to create workspace under .openclaw");
  }
  return {
    path,
    writeFile(relativePath: string, contents: string): string {
      const full = join(path, relativePath);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, contents, "utf8");
      return full;
    },
    cleanup(): void {
      if (existsSync(path)) rmSync(path, { recursive: true, force: true });
    },
  };
}

export type FakeClock = {
  now: () => number;
  iso: () => string;
  advance: (ms: number) => void;
  set: (ms: number) => void;
};

export function createFakeClock(startMs = 0): FakeClock {
  let current = startMs;
  return {
    now: () => current,
    iso: () => new Date(current).toISOString(),
    advance: (ms: number) => {
      current += ms;
    },
    set: (ms: number) => {
      current = ms;
    },
  };
}

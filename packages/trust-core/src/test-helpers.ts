/**
 * Deterministic test helpers for trust-core.
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

export function createTempWorkspace(prefix = "fpp-trust-"): TempWorkspace {
  const path = mkdtempSync(join(tmpdir(), prefix));
  if (/[/\\]\.openclaw([/\\]|$)/.test(path)) {
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

export type CapturedHook = {
  event: string;
  handler: (...args: unknown[]) => unknown;
  priority?: number | undefined;
};

export type HookCapture = {
  hooks: CapturedHook[];
  api: {
    pluginConfig: Record<string, unknown>;
    on: (
      event: string,
      handler: (...args: unknown[]) => unknown,
      opts?: { priority?: number },
    ) => void;
    registerToolMetadata?: (...args: unknown[]) => void;
    registerCli?: (...args: unknown[]) => void;
  };
};

export function createHookCapture(
  pluginConfig: Record<string, unknown> = {},
): HookCapture {
  const hooks: CapturedHook[] = [];
  return {
    hooks,
    api: {
      pluginConfig,
      on(event, handler, opts) {
        hooks.push({
          event,
          handler,
          priority: opts?.priority,
        });
      },
      registerToolMetadata() {},
      registerCli() {},
    },
  };
}

export type ApprovalDecision =
  | "allow-once"
  | "allow-always"
  | "deny"
  | "timeout"
  | "cancelled";

export type FakeApprovalResolver = {
  waitForResolution: (id: string) => Promise<ApprovalDecision>;
  resolve: (id: string, decision: ApprovalDecision) => void;
};

export function createFakeApprovalResolver(): FakeApprovalResolver {
  const pending = new Map<
    string,
    { resolve: (d: ApprovalDecision) => void; promise: Promise<ApprovalDecision> }
  >();

  return {
    waitForResolution(id: string): Promise<ApprovalDecision> {
      const existing = pending.get(id);
      if (existing) return existing.promise;
      let resolveFn!: (d: ApprovalDecision) => void;
      const promise = new Promise<ApprovalDecision>((resolve) => {
        resolveFn = resolve;
      });
      pending.set(id, { resolve: resolveFn, promise });
      return promise;
    },
    resolve(id: string, decision: ApprovalDecision): void {
      const entry = pending.get(id);
      if (!entry) {
        let resolveFn!: (d: ApprovalDecision) => void;
        const promise = new Promise<ApprovalDecision>((resolve) => {
          resolveFn = resolve;
        });
        pending.set(id, { resolve: resolveFn, promise });
        resolveFn(decision);
        return;
      }
      entry.resolve(decision);
    },
  };
}

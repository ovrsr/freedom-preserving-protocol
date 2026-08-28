/**
 * Authoritative hash-chained steward authorization ledger.
 *
 * Fail-closed: pre-existing locks, corrupt tails, sequence/hash gaps, and
 * unsupported schema never auto-repair. Operator recovery is explicit.
 */

import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { digest } from "@ovrsr/fpp-protocol-core";

export const STEWARD_LEDGER_ZERO_HASH = "0".repeat(64);
export const STEWARD_LEDGER_SCHEMA_VERSION = 1 as const;
export const STEWARD_LEDGER_DIGEST_DOMAIN = "fpp:v2:steward-ledger-event";

export const STEWARD_LEDGER_EVENT_KINDS = [
  "ledger_initialized",
  "key_binding_accepted",
  "key_binding_rejected",
  "authorization_accepted",
  "authorization_rejected",
  "authorization_consumed",
  "authorization_revoked",
  "key_revoked",
] as const;

export type StewardLedgerEventKind =
  (typeof STEWARD_LEDGER_EVENT_KINDS)[number];

export type StewardLedgerPolicy = {
  instanceAudience: string;
  maxStandingLifetimeMs: number;
  maxStandingUses: number;
  maxOneShotLifetimeMs: number;
  allowedClockSkewMs: number;
};

export type StewardLedgerUniqueKeys = {
  authorizationId?: string;
  attestationId?: string;
  nonce?: string;
};

export type StewardLedgerEvent = {
  schemaVersion: typeof STEWARD_LEDGER_SCHEMA_VERSION;
  sequence: number;
  previousHash: string;
  eventHash: string;
  kind: StewardLedgerEventKind;
  timestamp: string;
  evidenceDigest: string;
  detail: Record<string, unknown>;
  uniqueKeys?: StewardLedgerUniqueKeys;
  retainedEvidence?: unknown;
};

export type AppendEventInput = {
  kind: StewardLedgerEventKind;
  evidenceDigest: string;
  detail: Record<string, unknown>;
  uniqueKeys?: StewardLedgerUniqueKeys;
  retainedEvidence?: unknown;
  timestamp?: string;
};

export class StewardLedgerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StewardLedgerUnavailableError";
  }
}

export type LedgerLoadOk = {
  ok: true;
  events: StewardLedgerEvent[];
  policy: StewardLedgerPolicy | undefined;
};

export type LedgerLoadErr = {
  ok: false;
  error: StewardLedgerUnavailableError;
};

export type LedgerResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: StewardLedgerUnavailableError | Error };

export type LedgerTransaction = {
  events: readonly StewardLedgerEvent[];
  policy: StewardLedgerPolicy | undefined;
  append: (
    input: AppendEventInput,
  ) =>
    | { ok: true; event: StewardLedgerEvent }
    | { ok: false; error: StewardLedgerUnavailableError };
};

function hashEventBody(body: Record<string, unknown>): string {
  return digest({
    version: 2,
    domain: STEWARD_LEDGER_DIGEST_DOMAIN,
    value: body,
  });
}

function computeEventHash(event: Omit<StewardLedgerEvent, "eventHash">): string {
  const { eventHash: _ignored, ...rest } = event as StewardLedgerEvent & {
    eventHash?: string;
  };
  void _ignored;
  return hashEventBody(rest as Record<string, unknown>);
}

function boundDetail(
  detail: Record<string, unknown>,
): Record<string, unknown> {
  const json = JSON.stringify(detail);
  if (json.length <= 4096) return detail;
  return {
    truncated: true,
    preview: json.slice(0, 512),
    originalBytes: json.length,
  };
}

function collectUniqueIndex(events: StewardLedgerEvent[]): {
  authorizationIds: Set<string>;
  attestationIds: Set<string>;
  nonces: Set<string>;
} {
  const authorizationIds = new Set<string>();
  const attestationIds = new Set<string>();
  const nonces = new Set<string>();
  for (const event of events) {
    const keys = event.uniqueKeys;
    if (!keys) continue;
    if (keys.authorizationId) authorizationIds.add(keys.authorizationId);
    if (keys.attestationId) attestationIds.add(keys.attestationId);
    if (keys.nonce) nonces.add(keys.nonce);
  }
  return { authorizationIds, attestationIds, nonces };
}

function parseAndVerifyChain(
  content: string,
  path: string,
): LedgerLoadOk | LedgerLoadErr {
  const lines = content.split(/\r?\n/);
  // Allow a single trailing newline; reject other blank lines mid-file.
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  const events: StewardLedgerEvent[] = [];
  let previousHash = STEWARD_LEDGER_ZERO_HASH;
  let expectedSequence = 1;
  let policy: StewardLedgerPolicy | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "") {
      return {
        ok: false,
        error: new StewardLedgerUnavailableError(
          `ledger unavailable: blank line at ${path}:${i + 1}`,
        ),
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      return {
        ok: false,
        error: new StewardLedgerUnavailableError(
          `ledger unavailable: malformed JSON at ${path}:${i + 1}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      };
    }
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return {
        ok: false,
        error: new StewardLedgerUnavailableError(
          `ledger unavailable: non-object event at ${path}:${i + 1}`,
        ),
      };
    }
    const event = parsed as StewardLedgerEvent;
    if (event.schemaVersion !== STEWARD_LEDGER_SCHEMA_VERSION) {
      return {
        ok: false,
        error: new StewardLedgerUnavailableError(
          `ledger unavailable: unsupported schemaVersion at ${path}:${i + 1}`,
        ),
      };
    }
    if (
      !(STEWARD_LEDGER_EVENT_KINDS as readonly string[]).includes(event.kind)
    ) {
      return {
        ok: false,
        error: new StewardLedgerUnavailableError(
          `ledger unavailable: unsupported event kind at ${path}:${i + 1}`,
        ),
      };
    }
    if (event.sequence !== expectedSequence) {
      return {
        ok: false,
        error: new StewardLedgerUnavailableError(
          `ledger unavailable: sequence gap at ${path}:${i + 1}`,
        ),
      };
    }
    if (event.previousHash !== previousHash) {
      return {
        ok: false,
        error: new StewardLedgerUnavailableError(
          `ledger unavailable: previousHash mismatch at ${path}:${i + 1}`,
        ),
      };
    }
    const { eventHash: claimed, ...body } = event;
    const recomputed = hashEventBody(body as Record<string, unknown>);
    if (claimed !== recomputed) {
      return {
        ok: false,
        error: new StewardLedgerUnavailableError(
          `ledger unavailable: eventHash mismatch at ${path}:${i + 1}`,
        ),
      };
    }
    if (event.kind === "ledger_initialized") {
      const detail = event.detail as Partial<StewardLedgerPolicy>;
      if (
        typeof detail.instanceAudience !== "string" ||
        typeof detail.maxStandingLifetimeMs !== "number" ||
        typeof detail.maxStandingUses !== "number" ||
        typeof detail.maxOneShotLifetimeMs !== "number" ||
        typeof detail.allowedClockSkewMs !== "number"
      ) {
        return {
          ok: false,
          error: new StewardLedgerUnavailableError(
            `ledger unavailable: invalid initialization policy at ${path}:${i + 1}`,
          ),
        };
      }
      policy = {
        instanceAudience: detail.instanceAudience,
        maxStandingLifetimeMs: detail.maxStandingLifetimeMs,
        maxStandingUses: detail.maxStandingUses,
        maxOneShotLifetimeMs: detail.maxOneShotLifetimeMs,
        allowedClockSkewMs: detail.allowedClockSkewMs,
      };
    }
    events.push(event);
    previousHash = claimed;
    expectedSequence += 1;
  }

  return { ok: true, events, policy };
}

export type StewardAuthorizationLedgerOptions = {
  path: string;
  now?: () => Date;
  durability?: Partial<StewardLedgerDurability>;
};

export type StewardLedgerDurability = {
  write: (fd: number, payload: string) => void;
  fsyncFile: (fd: number) => void;
  rename: (source: string, target: string) => void;
  fsyncParentDirectory: (path: string) => void;
};

function defaultFsyncParentDirectory(path: string): void {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    fsyncSync(fd);
  } catch (err) {
    const code =
      err !== null && typeof err === "object" && "code" in err
        ? String(err.code)
        : "";
    // Windows and some filesystems do not permit directory handles/fsync.
    if (
      code === "EISDIR" ||
      code === "EINVAL" ||
      code === "ENOTSUP" ||
      code === "ENOSYS" ||
      (process.platform === "win32" && (code === "EPERM" || code === "EACCES"))
    ) {
      return;
    }
    throw err;
  } finally {
    if (fd !== undefined) {
      closeSync(fd);
    }
  }
}

const DEFAULT_DURABILITY: StewardLedgerDurability = {
  write: (fd, payload) => {
    writeSync(fd, payload, undefined, "utf8");
  },
  fsyncFile: (fd) => {
    fsyncSync(fd);
  },
  rename: (source, target) => {
    renameSync(source, target);
  },
  fsyncParentDirectory: defaultFsyncParentDirectory,
};

function genesisPreconditionError(
  tx: LedgerTransaction,
): StewardLedgerUnavailableError | undefined {
  if (
    tx.events.length === 1 &&
    tx.events[0]!.kind === "ledger_initialized" &&
    tx.policy !== undefined
  ) {
    return new StewardLedgerUnavailableError(
      "ledger unavailable: initialized-only legacy state requires explicit operator recovery",
    );
  }
  if (tx.events.length !== 0 || tx.policy !== undefined) {
    return new StewardLedgerUnavailableError(
      "ledger unavailable: already initialized; preserve the existing ledger and perform explicit operator recovery",
    );
  }
  return undefined;
}

export class StewardAuthorizationLedger {
  readonly path: string;
  readonly lockPath: string;
  private readonly now: () => Date;
  private readonly durability: StewardLedgerDurability;

  constructor(options: StewardAuthorizationLedgerOptions) {
    this.path = resolve(options.path);
    this.lockPath = `${this.path}.lock`;
    this.now = options.now ?? (() => new Date());
    this.durability = {
      ...DEFAULT_DURABILITY,
      ...options.durability,
    };
  }

  loadVerified(): LedgerLoadOk | LedgerLoadErr {
    if (!existsSync(this.path)) {
      return { ok: true, events: [], policy: undefined };
    }
    let content: string;
    try {
      content = readFileSync(this.path, "utf8");
    } catch (err) {
      return {
        ok: false,
        error: new StewardLedgerUnavailableError(
          `ledger unavailable: read failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      };
    }
    if (content.length === 0) {
      return { ok: true, events: [], policy: undefined };
    }
    return parseAndVerifyChain(content, this.path);
  }

  initialize(
    policy: StewardLedgerPolicy,
  ):
    | { ok: true; events: StewardLedgerEvent[]; policy: StewardLedgerPolicy }
    | { ok: false; error: StewardLedgerUnavailableError | Error } {
    const result = this.transact((tx) => {
      const preconditionError = genesisPreconditionError(tx);
      if (preconditionError) {
        return { ok: false as const, error: preconditionError };
      }
      return tx.append({
        kind: "ledger_initialized",
        evidenceDigest: digest({
          version: 2,
          domain: STEWARD_LEDGER_DIGEST_DOMAIN,
          value: policy,
        }),
        detail: { ...policy },
      });
    });
    if (!result.ok) return result;
    if (!result.value.ok) {
      return { ok: false, error: result.value.error };
    }
    const after = this.loadVerified();
    if (!after.ok) return after;
    if (!after.policy) {
      return {
        ok: false,
        error: new StewardLedgerUnavailableError(
          "ledger unavailable: missing policy after initialize",
        ),
      };
    }
    return { ok: true, events: after.events, policy: after.policy };
  }

  /**
   * Secure genesis: write policy initialization and the first key binding
   * under one lock, committed as a single atomic file replace.
   */
  initializeWithInitialBinding(
    policy: StewardLedgerPolicy,
    binding: AppendEventInput,
  ):
    | { ok: true; events: StewardLedgerEvent[]; policy: StewardLedgerPolicy }
    | { ok: false; error: StewardLedgerUnavailableError | Error } {
    if (binding.kind !== "key_binding_accepted") {
      return {
        ok: false,
        error: new StewardLedgerUnavailableError(
          "ledger unavailable: initial binding must be key_binding_accepted",
        ),
      };
    }
    if (
      !binding.uniqueKeys?.attestationId ||
      !binding.uniqueKeys?.nonce
    ) {
      return {
        ok: false,
        error: new StewardLedgerUnavailableError(
          "ledger unavailable: initial binding requires attestationId and nonce unique keys",
        ),
      };
    }

    const result = this.transact((tx) => {
      const preconditionError = genesisPreconditionError(tx);
      if (preconditionError) {
        return { ok: false as const, error: preconditionError };
      }
      const init = tx.append({
        kind: "ledger_initialized",
        evidenceDigest: digest({
          version: 2,
          domain: STEWARD_LEDGER_DIGEST_DOMAIN,
          value: policy,
        }),
        detail: { ...policy },
      });
      if (!init.ok) return init;
      const bound = tx.append(binding);
      if (!bound.ok) return bound;
      return { ok: true as const, events: [init.event, bound.event] };
    });
    if (!result.ok) return result;
    if (!result.value.ok) {
      return { ok: false, error: result.value.error };
    }

    const after = this.loadVerified();
    if (!after.ok) return after;
    if (!after.policy) {
      return {
        ok: false,
        error: new StewardLedgerUnavailableError(
          "ledger unavailable: missing policy after initializeWithInitialBinding",
        ),
      };
    }
    if (after.events.length !== 2) {
      return {
        ok: false,
        error: new StewardLedgerUnavailableError(
          "ledger unavailable: expected exactly two genesis events",
        ),
      };
    }
    return { ok: true, events: after.events, policy: after.policy };
  }

  transact<T>(
    fn: (tx: LedgerTransaction) => T,
  ):
    | { ok: true; value: T }
    | { ok: false; error: StewardLedgerUnavailableError | Error } {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      try {
        mkdirSync(this.lockPath);
      } catch {
        return {
          ok: false,
          error: new StewardLedgerUnavailableError(
            `ledger unavailable: lock held at ${this.lockPath}`,
          ),
        };
      }

      try {
        const loaded = this.loadVerified();
        if (!loaded.ok) {
          return loaded;
        }
        const working = [...loaded.events];
        const unique = collectUniqueIndex(working);
        let dirty = false;

        const append = (
          input: AppendEventInput,
        ):
          | { ok: true; event: StewardLedgerEvent }
          | { ok: false; error: StewardLedgerUnavailableError } => {
          if (input.uniqueKeys?.authorizationId) {
            if (unique.authorizationIds.has(input.uniqueKeys.authorizationId)) {
              return {
                ok: false,
                error: new StewardLedgerUnavailableError(
                  "ledger unavailable: duplicate authorizationId",
                ),
              };
            }
          }
          if (input.uniqueKeys?.attestationId) {
            if (unique.attestationIds.has(input.uniqueKeys.attestationId)) {
              return {
                ok: false,
                error: new StewardLedgerUnavailableError(
                  "ledger unavailable: duplicate attestationId",
                ),
              };
            }
          }
          if (input.uniqueKeys?.nonce) {
            if (unique.nonces.has(input.uniqueKeys.nonce)) {
              return {
                ok: false,
                error: new StewardLedgerUnavailableError(
                  "ledger unavailable: duplicate nonce",
                ),
              };
            }
          }

          const previousHash =
            working.length === 0
              ? STEWARD_LEDGER_ZERO_HASH
              : working[working.length - 1]!.eventHash;
          const body: Omit<StewardLedgerEvent, "eventHash"> = {
            schemaVersion: STEWARD_LEDGER_SCHEMA_VERSION,
            sequence: working.length + 1,
            previousHash,
            kind: input.kind,
            timestamp: input.timestamp ?? this.now().toISOString(),
            evidenceDigest: input.evidenceDigest,
            detail: boundDetail(input.detail),
            ...(input.uniqueKeys !== undefined
              ? { uniqueKeys: input.uniqueKeys }
              : {}),
            ...(input.retainedEvidence !== undefined
              ? { retainedEvidence: input.retainedEvidence }
              : {}),
          };
          const event: StewardLedgerEvent = {
            ...body,
            eventHash: computeEventHash(body),
          };
          working.push(event);
          if (input.uniqueKeys?.authorizationId) {
            unique.authorizationIds.add(input.uniqueKeys.authorizationId);
          }
          if (input.uniqueKeys?.attestationId) {
            unique.attestationIds.add(input.uniqueKeys.attestationId);
          }
          if (input.uniqueKeys?.nonce) {
            unique.nonces.add(input.uniqueKeys.nonce);
          }
          dirty = true;
          return { ok: true, event };
        };

        const tx: LedgerTransaction = {
          events: working,
          policy: loaded.policy,
          append,
        };

        const value = fn(tx);

        if (dirty) {
          this.durableReplace(working);
        }
        return { ok: true, value };
      } finally {
        try {
          rmSync(this.lockPath, { recursive: true, force: false });
        } catch {
          // If lock removal fails, leave it for operator recovery.
        }
      }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
  }

  /**
   * Atomically replace the ledger file via temp + fsync + rename.
   * Avoids initialized-only windows and torn appends across multi-event commits.
   */
  private durableReplace(allEvents: StewardLedgerEvent[]): void {
    const payload =
      allEvents.map((e) => JSON.stringify(e)).join("\n") + "\n";
    const tmpPath = `${this.path}.${process.pid}.tmp`;
    mkdirSync(dirname(this.path), { recursive: true });
    let renamed = false;
    try {
      const fd = openSync(tmpPath, "w");
      try {
        this.durability.write(fd, payload);
        this.durability.fsyncFile(fd);
      } finally {
        closeSync(fd);
      }
      try {
        chmodSync(tmpPath, 0o600);
      } catch {
        // Windows and some FS may not support mode bits.
      }
      this.durability.rename(tmpPath, this.path);
      renamed = true;
      try {
        chmodSync(this.path, 0o600);
      } catch {
        // Windows and some FS may not support mode bits.
      }
      try {
        this.durability.fsyncParentDirectory(dirname(this.path));
      } catch {
        // The atomic rename already committed the ledger. Do not report this
        // ceremony as uncommitted and invite a conflicting retry.
      }
    } finally {
      if (!renamed) {
        try {
          rmSync(tmpPath, { force: true });
        } catch {
          // Best effort only; the authoritative ledger was not replaced.
        }
      }
    }
  }
}

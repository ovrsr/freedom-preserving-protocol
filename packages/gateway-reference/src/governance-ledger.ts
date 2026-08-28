/**
 * Append-only hash-chained governance event ledger for the gateway reference.
 *
 * CI demonstration only — not production custody. Signing/verification are
 * injected so this package never owns private-key material.
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
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import {
  DIGEST_DOMAINS,
  canonicalizeV2,
  digest,
  parseGovernanceEvent,
  type GovernanceEventV1,
  type GovernanceMode,
  type GovernanceStateV1,
} from "@ovrsr/fpp-protocol-core";

export const GOVERNANCE_LEDGER_ZERO_HASH = "0".repeat(64);

export class GovernanceLedgerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GovernanceLedgerUnavailableError";
  }
}

export type GovernanceEventSigner = {
  alg: string;
  keyId: string;
  sign: (message: Uint8Array) => Uint8Array;
};

export type GovernanceEventVerifier = {
  verify: (
    message: Uint8Array,
    signatureHex: string,
    keyId: string,
  ) => boolean;
};

export type AppendGovernanceEventInput = {
  kind: "governance-enabled" | "governance-disabled";
  eventId: string;
  actor: { role: string; id: string };
  reason?: string | undefined;
  ts?: string | undefined;
};

export type GovernanceLedgerOptions = {
  path: string;
  signer: GovernanceEventSigner;
  verifier: GovernanceEventVerifier;
  constitutionHash: string;
  policyEngineVersion: string;
  now?: (() => Date) | undefined;
  /** Deterministic failure-injection seams used by the CI reference tests. */
  ioHooks?: GovernanceLedgerIoHooks | undefined;
};

export type GovernanceLedgerIoHooks = {
  beforeRead?: (() => void) | undefined;
  beforeTempWrite?: (() => void) | undefined;
  beforeTempFsync?: (() => void) | undefined;
  beforeReplace?: (() => void) | undefined;
  beforeDirectoryFsync?: (() => void) | undefined;
};

export type LedgerStateOk = {
  ok: true;
  state: GovernanceStateV1;
  prevHash: string;
  events: GovernanceEventV1[];
};

export type LedgerStateErr = {
  ok: false;
  error: GovernanceLedgerUnavailableError;
};

export type AppendResult =
  | {
      ok: true;
      event: GovernanceEventV1;
      state: GovernanceStateV1;
      durable: true;
    }
  | { ok: false; error: GovernanceLedgerUnavailableError };

function signingBytes(event: Omit<GovernanceEventV1, "signature">): Uint8Array {
  return new TextEncoder().encode(canonicalizeV2(event));
}

function computeEntryHash(
  unsigned: Omit<GovernanceEventV1, "entryHash" | "signature">,
): string {
  return digest({
    version: 2,
    domain: DIGEST_DOMAINS.entry,
    value: unsigned,
  });
}

function parseAndVerifyChain(
  content: string,
  path: string,
  verifier: GovernanceEventVerifier,
  expected: {
    constitutionHash: string;
    policyEngineVersion: string;
  },
): LedgerStateOk | LedgerStateErr {
  const lines = content.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  const events: GovernanceEventV1[] = [];
  let previousHash = GOVERNANCE_LEDGER_ZERO_HASH;
  let previousEpoch = 0;
  let previousDurableMode: GovernanceMode = "enabled";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "") {
      return {
        ok: false,
        error: new GovernanceLedgerUnavailableError(
          `governance ledger unavailable: blank line at ${path}:${i + 1}`,
        ),
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      return {
        ok: false,
        error: new GovernanceLedgerUnavailableError(
          `governance ledger unavailable: malformed JSON at ${path}:${i + 1}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      };
    }

    const checked = parseGovernanceEvent(parsed);
    if (!checked.ok) {
      return {
        ok: false,
        error: new GovernanceLedgerUnavailableError(
          `governance ledger unavailable: invalid event at ${path}:${i + 1}: ${checked.error}`,
        ),
      };
    }
    const event = checked.event;
    if (
      event.constitutionHash !== expected.constitutionHash ||
      event.policyEngineVersion !== expected.policyEngineVersion
    ) {
      return {
        ok: false,
        error: new GovernanceLedgerUnavailableError(
          `governance ledger unavailable: constitution/policy context mismatch at ${path}:${i + 1}`,
        ),
      };
    }
    if (event.prevHash !== previousHash) {
      return {
        ok: false,
        error: new GovernanceLedgerUnavailableError(
          `governance ledger unavailable: prevHash mismatch at ${path}:${i + 1}`,
        ),
      };
    }
    if (event.epoch !== previousEpoch + 1) {
      return {
        ok: false,
        error: new GovernanceLedgerUnavailableError(
          `governance ledger unavailable: epoch must advance by exactly one at ${path}:${i + 1}`,
        ),
      };
    }
    const expectedKind:
      | "governance-enabled"
      | "governance-disabled" =
      previousDurableMode === "enabled"
        ? "governance-disabled"
        : "governance-enabled";
    const expectedPreviousMode: GovernanceMode =
      expectedKind === "governance-disabled" ? "draining" : "disabled";
    const expectedMode: GovernanceMode =
      expectedKind === "governance-disabled" ? "disabled" : "enabled";
    if (
      event.kind !== expectedKind ||
      event.previousMode !== expectedPreviousMode ||
      event.mode !== expectedMode
    ) {
      return {
        ok: false,
        error: new GovernanceLedgerUnavailableError(
          `governance ledger unavailable: invalid state transition at ${path}:${i + 1}`,
        ),
      };
    }

    const { signature, entryHash: claimedHash, ...rest } = event;
    const recomputed = computeEntryHash(rest);
    if (claimedHash !== recomputed) {
      return {
        ok: false,
        error: new GovernanceLedgerUnavailableError(
          `governance ledger unavailable: entryHash mismatch at ${path}:${i + 1}`,
        ),
      };
    }

    const unsigned: Omit<GovernanceEventV1, "signature"> = {
      ...rest,
      entryHash: claimedHash,
    };
    const okSig = verifier.verify(
      signingBytes(unsigned),
      signature.sig,
      signature.keyId,
    );
    if (!okSig) {
      return {
        ok: false,
        error: new GovernanceLedgerUnavailableError(
          `governance ledger unavailable: signature verification failed at ${path}:${i + 1}`,
        ),
      };
    }

    events.push(event);
    previousHash = claimedHash;
    previousEpoch = event.epoch;
    previousDurableMode = event.mode;
  }

  if (events.length === 0) {
    return {
      ok: false,
      error: new GovernanceLedgerUnavailableError(
        `governance ledger unavailable: existing empty or eventless ledger is corrupt/ambiguous at ${path}`,
      ),
    };
  }

  const last = events[events.length - 1]!;
  return {
    ok: true,
    state: {
      schemaVersion: 1,
      mode: last.mode,
      epoch: last.epoch,
    },
    prevHash: last.entryHash,
    events,
  };
}

export class GovernanceLedger {
  readonly path: string;
  readonly lockPath: string;
  private readonly signer: GovernanceEventSigner;
  private readonly verifier: GovernanceEventVerifier;
  private readonly constitutionHash: string;
  private readonly policyEngineVersion: string;
  private readonly now: () => Date;
  private readonly ioHooks: GovernanceLedgerIoHooks;

  constructor(options: GovernanceLedgerOptions) {
    this.path = resolve(options.path);
    this.lockPath = `${this.path}.lock`;
    this.signer = options.signer;
    this.verifier = options.verifier;
    this.constitutionHash = options.constitutionHash;
    this.policyEngineVersion = options.policyEngineVersion;
    this.now = options.now ?? (() => new Date());
    this.ioHooks = options.ioHooks ?? {};
  }

  getLastState(): LedgerStateOk | LedgerStateErr {
    return this.readState(false);
  }

  private readState(ignoreLock: boolean): LedgerStateOk | LedgerStateErr {
    if (!ignoreLock && existsSync(this.lockPath)) {
      return {
        ok: false,
        error: new GovernanceLedgerUnavailableError(
          `governance ledger unavailable: lock held at ${this.lockPath}`,
        ),
      };
    }
    if (!existsSync(this.path)) {
      return {
        ok: true,
        state: { schemaVersion: 1, mode: "enabled", epoch: 0 },
        prevHash: GOVERNANCE_LEDGER_ZERO_HASH,
        events: [],
      };
    }
    let content: string;
    try {
      this.ioHooks.beforeRead?.();
      content = readFileSync(this.path, "utf8");
    } catch (err) {
      return {
        ok: false,
        error: new GovernanceLedgerUnavailableError(
          `governance ledger unavailable: read failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      };
    }
    if (content.length === 0 || content.trim().length === 0) {
      return {
        ok: false,
        error: new GovernanceLedgerUnavailableError(
          `governance ledger unavailable: existing empty ledger is corrupt/ambiguous at ${this.path}`,
        ),
      };
    }
    return parseAndVerifyChain(content, this.path, this.verifier, {
      constitutionHash: this.constitutionHash,
      policyEngineVersion: this.policyEngineVersion,
    });
  }

  append(input: AppendGovernanceEventInput): AppendResult {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      try {
        mkdirSync(this.lockPath);
      } catch {
        return {
          ok: false,
          error: new GovernanceLedgerUnavailableError(
            `governance ledger unavailable: lock held at ${this.lockPath}`,
          ),
        };
      }

      try {
        const loaded = this.readState(true);
        if (!loaded.ok) return loaded;

        const nextEpoch = loaded.state.epoch + 1;
        const lastDurableMode = loaded.state.mode;
        const mode: GovernanceMode =
          input.kind === "governance-disabled" ? "disabled" : "enabled";
        // Runtime drains before disable publication; enable always leaves disabled.
        const previousMode: GovernanceMode =
          input.kind === "governance-disabled" ? "draining" : "disabled";

        if (
          input.kind === "governance-disabled" &&
          lastDurableMode === "disabled"
        ) {
          return {
            ok: false,
            error: new GovernanceLedgerUnavailableError(
              "governance ledger unavailable: already disabled",
            ),
          };
        }
        if (
          input.kind === "governance-enabled" &&
          lastDurableMode !== "disabled"
        ) {
          return {
            ok: false,
            error: new GovernanceLedgerUnavailableError(
              "governance ledger unavailable: enable requires disabled durable state",
            ),
          };
        }

        const unsignedBody: Omit<GovernanceEventV1, "entryHash" | "signature"> =
          {
            schemaVersion: 1,
            kind: input.kind,
            eventId: input.eventId,
            ts: input.ts ?? this.now().toISOString(),
            epoch: nextEpoch,
            previousMode,
            mode,
            actor: input.actor,
            constitutionHash: this.constitutionHash,
            policyEngineVersion: this.policyEngineVersion,
            prevHash: loaded.prevHash,
            ...(input.reason !== undefined ? { reason: input.reason } : {}),
          };
        const entryHash = computeEntryHash(unsignedBody);
        const unsigned: Omit<GovernanceEventV1, "signature"> = {
          ...unsignedBody,
          entryHash,
        };
        const sigBytes = this.signer.sign(signingBytes(unsigned));
        const event: GovernanceEventV1 = {
          ...unsigned,
          signature: {
            alg: this.signer.alg,
            keyId: this.signer.keyId,
            sig: Buffer.from(sigBytes).toString("hex"),
          },
        };

        const parsed = parseGovernanceEvent(event);
        if (!parsed.ok) {
          return {
            ok: false,
            error: new GovernanceLedgerUnavailableError(
              `governance ledger unavailable: constructed invalid event: ${parsed.error}`,
            ),
          };
        }

        const candidateContent =
          [...loaded.events, event].map((entry) => JSON.stringify(entry)).join(
            "\n",
          ) + "\n";
        const candidate = parseAndVerifyChain(
          candidateContent,
          this.path,
          this.verifier,
          {
            constitutionHash: this.constitutionHash,
            policyEngineVersion: this.policyEngineVersion,
          },
        );
        if (!candidate.ok) {
          return {
            ok: false,
            error: new GovernanceLedgerUnavailableError(
              `governance ledger unavailable: candidate validation failed: ${candidate.error.message}`,
            ),
          };
        }

        this.commitCandidate(candidateContent);
        return {
          ok: true,
          event,
          state: candidate.state,
          durable: true,
        };
      } finally {
        try {
          rmSync(this.lockPath, { recursive: true, force: false });
        } catch {
          // Leave lock for operator recovery if removal fails.
        }
      }
    } catch (err) {
      return {
        ok: false,
        error: new GovernanceLedgerUnavailableError(
          `governance ledger unavailable: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      };
    }
  }

  private commitCandidate(candidateContent: string): void {
    const tmp = `${this.path}.tmp`;
    let committed = false;
    try {
      this.ioHooks.beforeTempWrite?.();
      writeFileSync(tmp, candidateContent, { encoding: "utf8", mode: 0o600 });
      this.ioHooks.beforeTempFsync?.();
      const fd = openSync(tmp, "r+");
      try {
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      this.ioHooks.beforeReplace?.();
      renameSync(tmp, this.path);
      committed = true;
    } finally {
      if (!committed) {
        try {
          rmSync(tmp, { force: true });
        } catch {
          // Preserve the original ledger; stale temp cleanup is best effort.
        }
      }
    }

    // The atomic replace above is the commit point. Everything after it is
    // best effort so an unsupported chmod or directory fsync can never turn a
    // committed append into a reported failure.
    try {
      chmodSync(this.path, 0o600);
    } catch {
      // Windows and some FS may not support mode bits.
    }
    try {
      this.ioHooks.beforeDirectoryFsync?.();
      const directoryFd = openSync(dirname(this.path), "r");
      try {
        fsyncSync(directoryFd);
      } finally {
        closeSync(directoryFd);
      }
    } catch {
      // Directory fsync is unavailable on Windows and some filesystems. The
      // fully fsynced candidate has already been atomically committed.
    }
  }
}

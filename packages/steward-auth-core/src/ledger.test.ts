import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  mkdtempSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  STEWARD_LEDGER_ZERO_HASH,
  StewardAuthorizationLedger,
  StewardLedgerUnavailableError,
} from "./ledger.js";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "fpp-steward-ledger-"));
  dirs.push(dir);
  return dir;
}

const DEFAULT_POLICY = {
  instanceAudience: "instance:test-1",
  maxStandingLifetimeMs: 86_400_000,
  maxStandingUses: 100,
  maxOneShotLifetimeMs: 3_600_000,
  allowedClockSkewMs: 300_000,
} as const;

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop()!;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe("StewardAuthorizationLedger", () => {
  it("initializes an empty ledger with genesis policy event", () => {
    const dir = tempDir();
    const path = join(dir, "fpp-steward-authorization-ledger.jsonl");
    const ledger = new StewardAuthorizationLedger({ path });
    const init = ledger.initialize({ ...DEFAULT_POLICY });
    assert.equal(init.ok, true);
    if (!init.ok) return;
    assert.equal(init.events.length, 1);
    assert.equal(init.events[0]!.kind, "ledger_initialized");
    assert.equal(init.events[0]!.sequence, 1);
    assert.equal(init.events[0]!.previousHash, STEWARD_LEDGER_ZERO_HASH);
    assert.equal(existsSync(path), true);
  });

  it("appends and reloads a verified hash chain", () => {
    const dir = tempDir();
    const path = join(dir, "ledger.jsonl");
    const ledger = new StewardAuthorizationLedger({ path });
    assert.equal(ledger.initialize({ ...DEFAULT_POLICY }).ok, true);
    const appended = ledger.transact((tx) =>
      tx.append({
        kind: "authorization_accepted",
        evidenceDigest: "a".repeat(64),
        detail: { authorizationId: "authz-1" },
        uniqueKeys: { authorizationId: "authz-1", nonce: "n".repeat(32) },
        retainedEvidence: { payload: { authorizationId: "authz-1" } },
      }),
    );
    assert.equal(appended.ok, true);
    const reloaded = new StewardAuthorizationLedger({ path }).loadVerified();
    assert.equal(reloaded.ok, true);
    if (!reloaded.ok) return;
    assert.equal(reloaded.events.length, 2);
    assert.equal(reloaded.events[1]!.previousHash, reloaded.events[0]!.eventHash);
    assert.equal(reloaded.events[1]!.sequence, 2);
  });

  it("sets restrictive file mode where supported", () => {
    const dir = tempDir();
    const path = join(dir, "ledger.jsonl");
    const ledger = new StewardAuthorizationLedger({ path });
    ledger.initialize({ ...DEFAULT_POLICY });
    assert.equal(existsSync(path), true);
    if (process.platform !== "win32") {
      assert.equal(statSync(path).mode & 0o777, 0o600);
    }
  });

  it("rejects concurrent lock acquisition", () => {
    const dir = tempDir();
    const path = join(dir, "ledger.jsonl");
    const ledger = new StewardAuthorizationLedger({ path });
    ledger.initialize({ ...DEFAULT_POLICY });
    mkdirSync(`${path}.lock`);
    const result = ledger.transact((tx) =>
      tx.append({
        kind: "authorization_rejected",
        evidenceDigest: "b".repeat(64),
        detail: { reason: "test" },
      }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.error instanceof StewardLedgerUnavailableError);
      assert.match(result.error.message, /lock/i);
    }
  });

  it("fails closed on partial/malformed tail and hash mismatch", () => {
    const dir = tempDir();
    const path = join(dir, "ledger.jsonl");
    const ledger = new StewardAuthorizationLedger({ path });
    ledger.initialize({ ...DEFAULT_POLICY });
    writeFileSync(path, readFileSync(path, "utf8") + "{not-json\n", "utf8");
    assert.equal(
      new StewardAuthorizationLedger({ path }).loadVerified().ok,
      false,
    );

    const path2 = join(dir, "ledger2.jsonl");
    const ledger2 = new StewardAuthorizationLedger({ path: path2 });
    ledger2.initialize({
      ...DEFAULT_POLICY,
      instanceAudience: "instance:test-2",
    });
    const lines = readFileSync(path2, "utf8").trim().split("\n");
    const entry = JSON.parse(lines[0]!);
    entry.eventHash = "c".repeat(64);
    writeFileSync(path2, JSON.stringify(entry) + "\n", "utf8");
    assert.equal(
      new StewardAuthorizationLedger({ path: path2 }).loadVerified().ok,
      false,
    );
  });

  it("rejects duplicate authorization IDs and nonces", () => {
    const dir = tempDir();
    const path = join(dir, "ledger.jsonl");
    const ledger = new StewardAuthorizationLedger({ path });
    ledger.initialize({ ...DEFAULT_POLICY });
    const first = ledger.transact((tx) =>
      tx.append({
        kind: "authorization_accepted",
        evidenceDigest: "d".repeat(64),
        detail: { authorizationId: "authz-dup" },
        uniqueKeys: { authorizationId: "authz-dup", nonce: "u".repeat(32) },
      }),
    );
    assert.equal(first.ok, true);
    assert.equal(first.ok && first.value.ok, true);

    const dupId = ledger.transact((tx) =>
      tx.append({
        kind: "authorization_accepted",
        evidenceDigest: "e".repeat(64),
        detail: { authorizationId: "authz-dup" },
        uniqueKeys: { authorizationId: "authz-dup", nonce: "v".repeat(32) },
      }),
    );
    assert.equal(dupId.ok, true);
    assert.equal(dupId.ok && dupId.value.ok, false);

    const dupNonce = ledger.transact((tx) =>
      tx.append({
        kind: "authorization_accepted",
        evidenceDigest: "f".repeat(64),
        detail: { authorizationId: "authz-other" },
        uniqueKeys: { authorizationId: "authz-other", nonce: "u".repeat(32) },
      }),
    );
    assert.equal(dupNonce.ok, true);
    assert.equal(dupNonce.ok && dupNonce.value.ok, false);
  });

  it("releases the lock directory after exceptions", () => {
    const dir = tempDir();
    const path = join(dir, "ledger.jsonl");
    const ledger = new StewardAuthorizationLedger({ path });
    ledger.initialize({ ...DEFAULT_POLICY });
    const boom = ledger.transact(() => {
      throw new Error("boom");
    });
    assert.equal(boom.ok, false);
    assert.equal(existsSync(`${path}.lock`), false);
    assert.equal(
      ledger.transact((tx) =>
        tx.append({
          kind: "authorization_rejected",
          evidenceDigest: "g".repeat(64),
          detail: { reason: "after-boom" },
        }),
      ).ok,
      true,
    );
  });

  it("initializeWithInitialBinding commits ledger_initialized then key_binding_accepted atomically", () => {
    const dir = tempDir();
    const path = join(dir, "ledger.jsonl");
    const ledger = new StewardAuthorizationLedger({ path });
    const binding = {
      kind: "key_binding_accepted" as const,
      evidenceDigest: "h".repeat(64),
      detail: {
        stewardId: "fpp:steward:v1:aaaaaaaaaaaaaaaaaaaaaaaaaa",
        operation: "initial-bind",
        subjectKeyRef: `openpgp:${"b".repeat(40)}`,
        bootstrapProfile: "interactive-fingerprint",
      },
      uniqueKeys: {
        attestationId: "att-bootstrap-001",
        nonce: "n".repeat(32),
      },
      retainedEvidence: { attestationId: "att-bootstrap-001" },
    };
    const result = ledger.initializeWithInitialBinding(
      { ...DEFAULT_POLICY },
      binding,
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.events.length, 2);
    assert.equal(result.events[0]!.kind, "ledger_initialized");
    assert.equal(result.events[1]!.kind, "key_binding_accepted");
    assert.equal(result.events[1]!.previousHash, result.events[0]!.eventHash);
    assert.equal(result.events[0]!.previousHash, STEWARD_LEDGER_ZERO_HASH);
    assert.deepEqual(result.policy, { ...DEFAULT_POLICY });

    const reloaded = new StewardAuthorizationLedger({ path }).loadVerified();
    assert.equal(reloaded.ok, true);
    if (!reloaded.ok) return;
    assert.equal(reloaded.events.length, 2);
    assert.equal(reloaded.events[0]!.kind, "ledger_initialized");
    assert.equal(reloaded.events[1]!.kind, "key_binding_accepted");
  });

  it("aborted initializeWithInitialBinding never leaves a ledger file or initialized-only state", () => {
    const dir = tempDir();
    const path = join(dir, "ledger.jsonl");
    const ledger = new StewardAuthorizationLedger({ path });
    const aborted = ledger.transact((tx) => {
      const init = tx.append({
        kind: "ledger_initialized",
        evidenceDigest: "i".repeat(64),
        detail: { ...DEFAULT_POLICY },
      });
      assert.equal(init.ok, true);
      const bind = tx.append({
        kind: "key_binding_accepted",
        evidenceDigest: "j".repeat(64),
        detail: { operation: "initial-bind" },
        uniqueKeys: { attestationId: "att-abort", nonce: "a".repeat(32) },
      });
      assert.equal(bind.ok, true);
      throw new Error("abort before commit");
    });
    assert.equal(aborted.ok, false);
    assert.equal(existsSync(path), false);
    assert.equal(existsSync(`${path}.lock`), false);

    const retry = ledger.initializeWithInitialBinding(
      { ...DEFAULT_POLICY },
      {
        kind: "key_binding_accepted",
        evidenceDigest: "k".repeat(64),
        detail: { operation: "initial-bind" },
        uniqueKeys: { attestationId: "att-retry", nonce: "r".repeat(32) },
      },
    );
    assert.equal(retry.ok, true);
    if (!retry.ok) return;
    assert.equal(retry.events.length, 2);
  });

  it("concurrent initializeWithInitialBinding has exactly one winner", async () => {
    const { spawn } = await import("node:child_process");
    const { fileURLToPath, pathToFileURL } = await import("node:url");
    const dir = tempDir();
    const path = join(dir, "ledger.jsonl");
    const packageRoot = fileURLToPath(new URL("..", import.meta.url));
    // Import compiled JS so child processes resolve package exports without tsx.
    const ledgerHref = pathToFileURL(join(packageRoot, "dist", "ledger.js")).href;
    const workerA = join(dir, "race-a.mjs");
    const workerB = join(dir, "race-b.mjs");
    const policyJson = JSON.stringify(DEFAULT_POLICY);
    const makeWorker = (file: string, attestationId: string, nonce: string) => {
      const subjectKeyRef = `openpgp:${"b".repeat(40)}`;
      writeFileSync(
        file,
        `
import { writeFileSync } from "node:fs";
import { StewardAuthorizationLedger } from ${JSON.stringify(ledgerHref)};
const ledger = new StewardAuthorizationLedger({ path: ${JSON.stringify(path)} });
const result = ledger.initializeWithInitialBinding(${policyJson}, {
  kind: "key_binding_accepted",
  evidenceDigest: ${JSON.stringify(attestationId.padEnd(64, "0"))},
  detail: { operation: "initial-bind", subjectKeyRef: ${JSON.stringify(subjectKeyRef)} },
  uniqueKeys: { attestationId: ${JSON.stringify(attestationId)}, nonce: ${JSON.stringify(nonce)} },
});
writeFileSync(${JSON.stringify(file + ".out")}, JSON.stringify({
  ok: result.ok,
  message: result.ok ? "" : (result.error instanceof Error ? result.error.message : String(result.error)),
  events: result.ok ? result.events.map((e) => e.kind) : [],
}));
`,
        "utf8",
      );
    };
    makeWorker(workerA, "att-race-a", "a".repeat(32));
    makeWorker(workerB, "att-race-b", "c".repeat(32));

    const run = (file: string) =>
      new Promise<{ code: number | null; stderr: string }>((resolve) => {
        const chunks: Buffer[] = [];
        const child = spawn(process.execPath, [file], {
          cwd: packageRoot,
          stdio: ["ignore", "ignore", "pipe"],
          env: { ...process.env },
        });
        child.stderr?.on("data", (c: Buffer) => chunks.push(c));
        child.on("exit", (code) =>
          resolve({ code, stderr: Buffer.concat(chunks).toString("utf8") }),
        );
      });

    const [a, b] = await Promise.all([run(workerA), run(workerB)]);
    assert.equal(
      a.code,
      0,
      `worker A failed (code=${a.code}): ${a.stderr}`,
    );
    assert.equal(
      b.code,
      0,
      `worker B failed (code=${b.code}): ${b.stderr}`,
    );
    const outA = JSON.parse(readFileSync(workerA + ".out", "utf8")) as {
      ok: boolean;
      message: string;
      events: string[];
    };
    const outB = JSON.parse(readFileSync(workerB + ".out", "utf8")) as {
      ok: boolean;
      message: string;
      events: string[];
    };
    const winners = [outA, outB].filter((o) => o.ok);
    const losers = [outA, outB].filter((o) => !o.ok);
    assert.equal(winners.length, 1);
    assert.equal(losers.length, 1);
    assert.deepEqual(winners[0]!.events, [
      "ledger_initialized",
      "key_binding_accepted",
    ]);
    assert.match(losers[0]!.message, /already initialized|lock/i);

    const final = new StewardAuthorizationLedger({ path }).loadVerified();
    assert.equal(final.ok, true);
    if (!final.ok) return;
    assert.equal(final.events.length, 2);
    assert.equal(final.events[0]!.kind, "ledger_initialized");
    assert.equal(final.events[1]!.kind, "key_binding_accepted");
    assert.equal(existsSync(path), true);
  });

  it("still loads one-event initialized ledgers and existing V1 chains", () => {
    const dir = tempDir();
    const path = join(dir, "legacy.jsonl");
    const ledger = new StewardAuthorizationLedger({ path });
    const init = ledger.initialize({ ...DEFAULT_POLICY });
    assert.equal(init.ok, true);
    if (!init.ok) return;
    assert.equal(init.events.length, 1);

    const appended = ledger.transact((tx) =>
      tx.append({
        kind: "key_binding_accepted",
        evidenceDigest: "l".repeat(64),
        detail: { operation: "initial-bind", acceptTofu: true },
        uniqueKeys: { attestationId: "att-legacy", nonce: "l".repeat(32) },
      }),
    );
    assert.equal(appended.ok, true);

    const reloaded = new StewardAuthorizationLedger({ path }).loadVerified();
    assert.equal(reloaded.ok, true);
    if (!reloaded.ok) return;
    assert.equal(reloaded.events.length, 2);
    assert.deepEqual(reloaded.policy, { ...DEFAULT_POLICY });
  });

  it("rejects a stale genesis contender before it can append or replace policy", () => {
    const dir = tempDir();
    const path = join(dir, "stale-genesis.jsonl");
    const winner = new StewardAuthorizationLedger({ path });
    const winnerPolicy = { ...DEFAULT_POLICY, maxStandingUses: 7 };
    const loserPolicy = { ...DEFAULT_POLICY, maxStandingUses: 999 };
    const winnerBinding = {
      kind: "key_binding_accepted" as const,
      evidenceDigest: "a".repeat(64),
      detail: {
        operation: "initial-bind",
        subjectKeyRef: `openpgp:${"a".repeat(40)}`,
      },
      uniqueKeys: {
        attestationId: "att-stale-winner",
        nonce: "w".repeat(32),
      },
    };
    const loser = new StewardAuthorizationLedger({ path });
    const originalTransact = loser.transact.bind(loser);
    let releaseWinnerBeforeLoserLock = true;
    loser.transact = ((fn) => {
      if (releaseWinnerBeforeLoserLock) {
        releaseWinnerBeforeLoserLock = false;
        const committed = winner.initializeWithInitialBinding(
          winnerPolicy,
          winnerBinding,
        );
        assert.equal(committed.ok, true);
      }
      return originalTransact(fn);
    }) as typeof loser.transact;
    const rejected = loser.initializeWithInitialBinding(loserPolicy, {
      kind: "key_binding_accepted",
      evidenceDigest: "b".repeat(64),
      detail: {
        operation: "initial-bind",
        subjectKeyRef: `openpgp:${"b".repeat(40)}`,
      },
      uniqueKeys: {
        attestationId: "att-stale-loser",
        nonce: "l".repeat(32),
      },
    });

    assert.equal(rejected.ok, false);
    assert.match(
      rejected.ok ? "" : rejected.error.message,
      /already initialized|explicit recovery/i,
    );
    const final = winner.loadVerified();
    assert.equal(final.ok, true);
    if (!final.ok) return;
    assert.equal(final.events.length, 2);
    assert.deepEqual(final.policy, winnerPolicy);
    assert.equal(
      final.events[1]!.detail.subjectKeyRef,
      winnerBinding.detail.subjectKeyRef,
    );
  });

  it("rejects initialized-only legacy state with explicit recovery guidance and no append", () => {
    const dir = tempDir();
    const path = join(dir, "legacy-initialized-only.jsonl");
    const ledger = new StewardAuthorizationLedger({ path });
    assert.equal(ledger.initialize({ ...DEFAULT_POLICY }).ok, true);
    const before = readFileSync(path, "utf8");

    const rejected = ledger.initializeWithInitialBinding(
      { ...DEFAULT_POLICY },
      {
        kind: "key_binding_accepted",
        evidenceDigest: "c".repeat(64),
        detail: { operation: "initial-bind" },
        uniqueKeys: {
          attestationId: "att-legacy-collision",
          nonce: "c".repeat(32),
        },
      },
    );

    assert.equal(rejected.ok, false);
    assert.match(
      rejected.ok ? "" : rejected.error.message,
      /initialized-only.*explicit.*recovery/i,
    );
    assert.equal(readFileSync(path, "utf8"), before);
  });

  it("does not publish genesis when write, file fsync, or rename fails", () => {
    for (const phase of ["write", "fsyncFile", "rename"] as const) {
      const dir = tempDir();
      const path = join(dir, `${phase}.jsonl`);
      const ledger = new StewardAuthorizationLedger({
        path,
        durability: {
          [phase]: () => {
            throw new Error(`injected ${phase} failure`);
          },
        },
      } as never);

      const result = ledger.initializeWithInitialBinding(
        { ...DEFAULT_POLICY },
        {
          kind: "key_binding_accepted",
          evidenceDigest: "d".repeat(64),
          detail: { operation: "initial-bind" },
          uniqueKeys: {
            attestationId: `att-${phase}`,
            nonce: phase.padEnd(32, "x"),
          },
        },
      );

      assert.equal(result.ok, false, `${phase} must fail`);
      assert.equal(existsSync(path), false, `${phase} published a ledger`);
      assert.deepEqual(
        readdirSync(dir).filter((entry) => entry.endsWith(".tmp")),
        [],
        `${phase} left a temporary ledger`,
      );
    }
  });

  it("fsyncs the parent directory after the atomic rename", () => {
    const dir = tempDir();
    const path = join(dir, "parent-fsync.jsonl");
    const syncedParents: string[] = [];
    const ledger = new StewardAuthorizationLedger({
      path,
      durability: {
        fsyncParentDirectory: (parentPath: string) => {
          syncedParents.push(parentPath);
        },
      },
    } as never);

    const result = ledger.initializeWithInitialBinding(
      { ...DEFAULT_POLICY },
      {
        kind: "key_binding_accepted",
        evidenceDigest: "e".repeat(64),
        detail: { operation: "initial-bind" },
        uniqueKeys: {
          attestationId: "att-parent-fsync",
          nonce: "p".repeat(32),
        },
      },
    );

    assert.equal(result.ok, true);
    assert.deepEqual(syncedParents, [dir]);
  });

  it("reports committed genesis after a post-rename parent fsync failure", () => {
    const dir = tempDir();
    const path = join(dir, "parent-fsync-failure.jsonl");
    const ledger = new StewardAuthorizationLedger({
      path,
      durability: {
        fsyncParentDirectory: () => {
          throw new Error("injected parent fsync failure");
        },
      },
    } as never);

    const result = ledger.initializeWithInitialBinding(
      { ...DEFAULT_POLICY },
      {
        kind: "key_binding_accepted",
        evidenceDigest: "f".repeat(64),
        detail: { operation: "initial-bind" },
        uniqueKeys: {
          attestationId: "att-parent-fsync-failure",
          nonce: "f".repeat(32),
        },
      },
    );

    assert.equal(result.ok, true);
    assert.equal(ledger.loadVerified().ok, true);
  });
});

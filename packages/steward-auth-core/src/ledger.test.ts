import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
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
});

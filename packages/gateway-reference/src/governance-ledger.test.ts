/**
 * Reference governance event ledger tests — CI only, not production custody.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import { bytesToHex } from "@noble/hashes/utils";
import {
  DIGEST_DOMAINS,
  canonicalizeV2,
  digest,
  signMessage,
  verifySignature,
  type GovernanceEventV1,
} from "@ovrsr/fpp-protocol-core";
import {
  GOVERNANCE_LEDGER_ZERO_HASH,
  GovernanceLedger,
  GovernanceLedgerUnavailableError,
  type GovernanceEventSigner,
  type GovernanceEventVerifier,
} from "./governance-ledger.js";

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const HEX_A = "a".repeat(64);
const CONSTITUTION = "71bf60ad" + "0".repeat(56);

function makeCrypto(): {
  signer: GovernanceEventSigner;
  verifier: GovernanceEventVerifier;
} {
  const seed = new Uint8Array(32).fill(7);
  const publicKey = ed.getPublicKey(seed);
  const publicKeyHex = bytesToHex(publicKey);
  return {
    signer: {
      alg: "Ed25519",
      keyId: "host-operator-key-1",
      sign(message) {
        return signMessage(message, seed);
      },
    },
    verifier: {
      verify(message, signatureHex, keyId) {
        if (keyId !== "host-operator-key-1") return false;
        try {
          return verifySignature(
            message,
            Buffer.from(signatureHex, "hex"),
            Buffer.from(publicKeyHex, "hex"),
          );
        } catch {
          return false;
        }
      },
    },
  };
}

function signEvent(
  body: Omit<GovernanceEventV1, "entryHash" | "signature">,
  signer: GovernanceEventSigner,
): GovernanceEventV1 {
  const entryHash = digest({
    version: 2,
    domain: DIGEST_DOMAINS.entry,
    value: body,
  });
  const unsigned = { ...body, entryHash };
  return {
    ...unsigned,
    signature: {
      alg: signer.alg,
      keyId: signer.keyId,
      sig: Buffer.from(
        signer.sign(new TextEncoder().encode(canonicalizeV2(unsigned))),
      ).toString("hex"),
    },
  };
}

describe("GovernanceLedger", () => {
  const root = mkdtempSync(join(tmpdir(), "fpp-gov-ledger-"));
  after(() => rmSync(root, { recursive: true, force: true }));

  it("starts at genesis enabled epoch 0 with zero prev hash", () => {
    const { signer, verifier } = makeCrypto();
    const ledger = new GovernanceLedger({
      path: join(root, "genesis.jsonl"),
      signer,
      verifier,
      constitutionHash: CONSTITUTION,
      policyEngineVersion: "@ovrsr/fpp-enforcement-core@1.0.0",
    });
    const state = ledger.getLastState();
    assert.equal(state.ok, true);
    if (state.ok) {
      assert.equal(state.state.mode, "enabled");
      assert.equal(state.state.epoch, 0);
      assert.equal(state.prevHash, GOVERNANCE_LEDGER_ZERO_HASH);
    }
  });

  it("chains disable then enable with monotonic epochs and verified signatures", () => {
    const { signer, verifier } = makeCrypto();
    const path = join(root, "chain.jsonl");
    const ledger = new GovernanceLedger({
      path,
      signer,
      verifier,
      constitutionHash: CONSTITUTION,
      policyEngineVersion: "@ovrsr/fpp-enforcement-core@1.0.0",
    });

    const disabled = ledger.append({
      kind: "governance-disabled",
      eventId: "evt_disable_1",
      actor: { role: "operator", id: "op_local" },
      reason: "Law 2 kill-switch",
    });
    assert.equal(disabled.ok, true);
    if (!disabled.ok) return;
    assert.equal(disabled.event.kind, "governance-disabled");
    assert.equal(disabled.event.epoch, 1);
    assert.equal(disabled.event.mode, "disabled");
    assert.equal(disabled.event.previousMode, "draining");
    assert.equal(disabled.event.prevHash, GOVERNANCE_LEDGER_ZERO_HASH);

    const enabled = ledger.append({
      kind: "governance-enabled",
      eventId: "evt_enable_2",
      actor: { role: "operator", id: "op_local" },
    });
    assert.equal(enabled.ok, true);
    if (!enabled.ok) return;
    assert.equal(enabled.event.epoch, 2);
    assert.equal(enabled.event.mode, "enabled");
    assert.equal(enabled.event.previousMode, "disabled");
    assert.equal(enabled.event.prevHash, disabled.event.entryHash);

    const reloaded = ledger.getLastState();
    assert.equal(reloaded.ok, true);
    if (reloaded.ok) {
      assert.equal(reloaded.state.mode, "enabled");
      assert.equal(reloaded.state.epoch, 2);
    }
  });

  it("does not report durable until the JSONL record is written and re-verified", () => {
    const { signer, verifier } = makeCrypto();
    const path = join(root, "durable.jsonl");
    const ledger = new GovernanceLedger({
      path,
      signer,
      verifier,
      constitutionHash: CONSTITUTION,
      policyEngineVersion: "@ovrsr/fpp-enforcement-core@1.0.0",
    });
    const result = ledger.append({
      kind: "governance-disabled",
      eventId: "evt_durable",
      actor: { role: "operator", id: "op_local" },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const onDisk = readFileSync(path, "utf8").trim().split("\n");
    assert.equal(onDisk.length, 1);
    const parsed = JSON.parse(onDisk[0]!) as { entryHash: string; eventId: string };
    assert.equal(parsed.entryHash, result.event.entryHash);
    assert.equal(parsed.eventId, "evt_durable");
  });

  it("fails closed on corrupt tail", () => {
    const { signer, verifier } = makeCrypto();
    const path = join(root, "corrupt.jsonl");
    writeFileSync(path, "{not-json\n", "utf8");
    const ledger = new GovernanceLedger({
      path,
      signer,
      verifier,
      constitutionHash: CONSTITUTION,
      policyEngineVersion: "@ovrsr/fpp-enforcement-core@1.0.0",
    });
    const state = ledger.getLastState();
    assert.equal(state.ok, false);
    if (!state.ok) {
      assert.ok(state.error instanceof GovernanceLedgerUnavailableError);
    }
    const append = ledger.append({
      kind: "governance-disabled",
      eventId: "evt_after_corrupt",
      actor: { role: "operator", id: "op_local" },
    });
    assert.equal(append.ok, false);
  });

  it("fails closed when lock is already held", () => {
    const { signer, verifier } = makeCrypto();
    const path = join(root, "locked.jsonl");
    mkdirSync(`${path}.lock`);
    const ledger = new GovernanceLedger({
      path,
      signer,
      verifier,
      constitutionHash: CONSTITUTION,
      policyEngineVersion: "@ovrsr/fpp-enforcement-core@1.0.0",
    });
    const append = ledger.append({
      kind: "governance-disabled",
      eventId: "evt_locked",
      actor: { role: "operator", id: "op_local" },
    });
    assert.equal(append.ok, false);
    if (!append.ok) {
      assert.match(append.error.message, /lock/i);
    }
  });

  it("fails closed when the verifier rejects the signature", () => {
    const { signer } = makeCrypto();
    const path = join(root, "bad-sig.jsonl");
    const ledger = new GovernanceLedger({
      path,
      signer,
      verifier: {
        verify() {
          return false;
        },
      },
      constitutionHash: CONSTITUTION,
      policyEngineVersion: "@ovrsr/fpp-enforcement-core@1.0.0",
    });
    const append = ledger.append({
      kind: "governance-disabled",
      eventId: "evt_bad_sig",
      actor: { role: "operator", id: "op_local" },
    });
    assert.equal(append.ok, false);
  });

  it("rejects epoch regression across chained events", () => {
    const { signer, verifier } = makeCrypto();
    const path = join(root, "epoch-regress.jsonl");
    const ledger = new GovernanceLedger({
      path,
      signer,
      verifier,
      constitutionHash: CONSTITUTION,
      policyEngineVersion: "@ovrsr/fpp-enforcement-core@1.0.0",
    });
    const first = ledger.append({
      kind: "governance-disabled",
      eventId: "evt_e1",
      actor: { role: "operator", id: "op_local" },
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;

    // Manually craft a second line with non-monotonic epoch.
    const forged = {
      ...first.event,
      eventId: "evt_e0",
      epoch: 0,
      prevHash: first.event.entryHash,
      entryHash: HEX_A,
      kind: "governance-enabled",
      previousMode: "disabled",
      mode: "enabled",
      signature: first.event.signature,
    };
    writeFileSync(
      path,
      `${JSON.stringify(first.event)}\n${JSON.stringify(forged)}\n`,
      "utf8",
    );
    const state = ledger.getLastState();
    assert.equal(state.ok, false);
  });

  it("rejects signed but semantically impossible state-machine histories", () => {
    const { signer, verifier } = makeCrypto();
    const base = {
      schemaVersion: 1 as const,
      eventId: "evt_impossible",
      ts: "2026-07-20T12:00:00.000Z",
      actor: { role: "operator", id: "op_local" },
      constitutionHash: CONSTITUTION,
      policyEngineVersion: "@ovrsr/fpp-enforcement-core@1.0.0",
      prevHash: GOVERNANCE_LEDGER_ZERO_HASH,
    };
    const impossibleFirstEvents = [
      signEvent(
        {
          ...base,
          kind: "governance-enabled",
          epoch: 1,
          previousMode: "disabled",
          mode: "enabled",
        },
        signer,
      ),
      signEvent(
        {
          ...base,
          kind: "governance-disabled",
          epoch: 2,
          previousMode: "draining",
          mode: "disabled",
        },
        signer,
      ),
      signEvent(
        {
          ...base,
          kind: "governance-disabled",
          epoch: 1,
          previousMode: "enabled",
          mode: "disabled",
        },
        signer,
      ),
    ];

    for (const [index, event] of impossibleFirstEvents.entries()) {
      const path = join(root, `impossible-first-${index}.jsonl`);
      writeFileSync(path, `${JSON.stringify(event)}\n`, "utf8");
      const ledger = new GovernanceLedger({
        path,
        signer,
        verifier,
        constitutionHash: CONSTITUTION,
        policyEngineVersion: "@ovrsr/fpp-enforcement-core@1.0.0",
      });
      assert.equal(ledger.getLastState().ok, false);
    }

    const path = join(root, "impossible-repeat.jsonl");
    const first = signEvent(
      {
        ...base,
        eventId: "evt_disable_1",
        kind: "governance-disabled",
        epoch: 1,
        previousMode: "draining",
        mode: "disabled",
      },
      signer,
    );
    const repeated = signEvent(
      {
        ...base,
        eventId: "evt_disable_2",
        kind: "governance-disabled",
        epoch: 2,
        previousMode: "draining",
        mode: "disabled",
        prevHash: first.entryHash,
      },
      signer,
    );
    writeFileSync(
      path,
      `${JSON.stringify(first)}\n${JSON.stringify(repeated)}\n`,
      "utf8",
    );
    const repeatedLedger = new GovernanceLedger({
      path,
      signer,
      verifier,
      constitutionHash: CONSTITUTION,
      policyEngineVersion: "@ovrsr/fpp-enforcement-core@1.0.0",
    });
    assert.equal(repeatedLedger.getLastState().ok, false);
  });

  it("keeps the previous tail authoritative on every pre-commit I/O failure", () => {
    const { signer, verifier } = makeCrypto();
    const failures = [
      "beforeRead",
      "beforeTempWrite",
      "beforeTempFsync",
      "beforeReplace",
    ] as const;

    for (const failure of failures) {
      const path = join(root, `atomic-${failure}.jsonl`);
      const baseline = new GovernanceLedger({
        path,
        signer,
        verifier,
        constitutionHash: CONSTITUTION,
        policyEngineVersion: "@ovrsr/fpp-enforcement-core@1.0.0",
      });
      assert.equal(
        baseline.append({
          kind: "governance-disabled",
          eventId: `evt_${failure}_baseline`,
          actor: { role: "operator", id: "op_local" },
        }).ok,
        true,
      );
      const original = readFileSync(path, "utf8");
      const faulty = new GovernanceLedger({
        path,
        signer,
        verifier,
        constitutionHash: CONSTITUTION,
        policyEngineVersion: "@ovrsr/fpp-enforcement-core@1.0.0",
        ioHooks: {
          [failure]: () => {
            throw new Error(`injected ${failure} failure`);
          },
        },
      });
      const result = faulty.append({
        kind: "governance-enabled",
        eventId: `evt_${failure}_candidate`,
        actor: { role: "operator", id: "op_local" },
      });
      assert.equal(result.ok, false, failure);
      assert.equal(readFileSync(path, "utf8"), original, failure);
    }
  });

  it("returns committed success when parent-directory fsync is unsupported", () => {
    const { signer, verifier } = makeCrypto();
    const path = join(root, "directory-fsync.jsonl");
    const ledger = new GovernanceLedger({
      path,
      signer,
      verifier,
      constitutionHash: CONSTITUTION,
      policyEngineVersion: "@ovrsr/fpp-enforcement-core@1.0.0",
      ioHooks: {
        beforeDirectoryFsync: () => {
          throw new Error("directory fsync unsupported");
        },
      },
    });
    const result = ledger.append({
      kind: "governance-disabled",
      eventId: "evt_directory_fsync",
      actor: { role: "operator", id: "op_local" },
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.durable, true);
      assert.deepEqual(result.state, {
        schemaVersion: 1,
        mode: "disabled",
        epoch: 1,
      });
    }
    assert.equal(ledger.getLastState().ok, true);
  });

  it("rejects a valid signed ledger replayed under a different constitution or policy", () => {
    const { signer, verifier } = makeCrypto();
    const path = join(root, "context-bound.jsonl");
    const original = new GovernanceLedger({
      path,
      signer,
      verifier,
      constitutionHash: CONSTITUTION,
      policyEngineVersion: "@ovrsr/fpp-enforcement-core@1.0.0",
    });
    assert.equal(
      original.append({
        kind: "governance-disabled",
        eventId: "evt_context_bound",
        actor: { role: "operator", id: "op_local" },
      }).ok,
      true,
    );

    const wrongConstitution = new GovernanceLedger({
      path,
      signer,
      verifier,
      constitutionHash: "aa".repeat(32),
      policyEngineVersion: "@ovrsr/fpp-enforcement-core@1.0.0",
    });
    const constitutionReplay = wrongConstitution.getLastState();
    assert.equal(constitutionReplay.ok, false);
    if (!constitutionReplay.ok) {
      assert.match(
        constitutionReplay.error.message,
        /constitution|policy|context/i,
      );
    }

    const wrongPolicy = new GovernanceLedger({
      path,
      signer,
      verifier,
      constitutionHash: CONSTITUTION,
      policyEngineVersion: "@ovrsr/fpp-enforcement-core@9.9.9",
    });
    const policyReplay = wrongPolicy.getLastState();
    assert.equal(policyReplay.ok, false);
    if (!policyReplay.ok) {
      assert.match(policyReplay.error.message, /constitution|policy|context/i);
    }
  });

  it("treats an existing zero-byte ledger as corrupt rather than genesis", () => {
    const { signer, verifier } = makeCrypto();
    const path = join(root, "empty-existing.jsonl");
    writeFileSync(path, "", "utf8");
    assert.equal(existsSync(path), true);
    assert.equal(readFileSync(path, "utf8").length, 0);

    const ledger = new GovernanceLedger({
      path,
      signer,
      verifier,
      constitutionHash: CONSTITUTION,
      policyEngineVersion: "@ovrsr/fpp-enforcement-core@1.0.0",
    });
    const state = ledger.getLastState();
    assert.equal(state.ok, false);
    if (!state.ok) {
      assert.match(state.error.message, /empty|corrupt|ambiguous|zero/i);
    }

    const missingPath = join(root, "missing-genesis.jsonl");
    assert.equal(existsSync(missingPath), false);
    const missing = new GovernanceLedger({
      path: missingPath,
      signer,
      verifier,
      constitutionHash: CONSTITUTION,
      policyEngineVersion: "@ovrsr/fpp-enforcement-core@1.0.0",
    });
    const genesis = missing.getLastState();
    assert.equal(genesis.ok, true);
    if (genesis.ok) {
      assert.deepEqual(genesis.state, {
        schemaVersion: 1,
        mode: "enabled",
        epoch: 0,
      });
      assert.equal(genesis.events.length, 0);
    }
  });

  // Keep canonicalize available for future signing-shape assertions.
  void canonicalizeV2;
});

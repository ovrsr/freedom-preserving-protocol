import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import {
  canonicalizeV2,
  mandateSigningFields,
  signMessage,
  verifyMandateSignature,
  type StandingMandateV1,
} from "@ovrsr/fpp-protocol-core";
import { MandateStore } from "./mandate-store.js";
import { createTempWorkspace } from "./test-helpers.js";

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

/** Legacy signer — full object minus signature (pre-Issue #5). */
function signMandateLegacy(
  mandate: Omit<StandingMandateV1, "signature" | "publicKey">,
  seed: Uint8Array,
): StandingMandateV1 {
  const publicKey = Buffer.from(ed.getPublicKey(seed)).toString("hex");
  const unsigned = { ...mandate, publicKey };
  const message = Buffer.from(canonicalizeV2(unsigned), "utf8");
  const signature = Buffer.from(signMessage(message, seed)).toString("hex");
  return { ...unsigned, signature };
}

/** New signer — mutable fields excluded from payload. */
function signMandate(
  mandate: Omit<StandingMandateV1, "signature" | "publicKey">,
  seed: Uint8Array,
): StandingMandateV1 {
  const publicKey = Buffer.from(ed.getPublicKey(seed)).toString("hex");
  const withKey = { ...mandate, publicKey } as StandingMandateV1;
  const message = Buffer.from(
    canonicalizeV2(mandateSigningFields(withKey)),
    "utf8",
  );
  const signature = Buffer.from(signMessage(message, seed)).toString("hex");
  return { ...withKey, signature };
}

describe("MandateStore", () => {
  const ws = createTempWorkspace("fpp-mandate-");
  after(() => ws.cleanup());

  const seed = ed.utils.randomPrivateKey();
  const nowMs = Date.parse("2026-07-15T12:00:00.000Z");

  const baseMandate = {
    schemaVersion: 1 as const,
    mandateId: "m-valid",
    issuerClass: "operator" as const,
    issuerId: "operator:alice",
    scope: { classifications: ["pkg.install"] },
    budgets: { maxActions: 5, remainingActions: 5 },
    validFrom: "2026-07-01T00:00:00.000Z",
    validTo: "2026-08-01T00:00:00.000Z",
    revocable: true,
    evidenceRef: "evidence:1",
  };

  it("accepts a valid signed mandate and finds coverage", () => {
    const storePath = join(ws.path, "mandates-valid.json");
    const store = new MandateStore(storePath);
    const mandate = signMandate(baseMandate, seed);
    store.put(mandate);
    const coverage = store.findCoverage("pkg.install", { nowMs });
    assert.ok(coverage);
    assert.equal(coverage!.mandateId, "m-valid");
    assert.equal(coverage!.authorization, "mandate");
  });

  it("rejects bad signatures", () => {
    const storePath = join(ws.path, "mandates-badsig.json");
    const store = new MandateStore(storePath);
    const mandate = signMandate(baseMandate, seed);
    mandate.signature = "00".repeat(64);
    assert.throws(() => store.put(mandate), /signature/i);
  });

  it("rejects expired mandates at findCoverage", () => {
    const storePath = join(ws.path, "mandates-expired.json");
    const store = new MandateStore(storePath);
    const mandate = signMandate(baseMandate, seed);
    store.put(mandate);
    const coverage = store.findCoverage("pkg.install", {
      nowMs: Date.parse("2026-09-01T00:00:00.000Z"),
    });
    assert.equal(coverage, null);
  });

  it("rejects over-budget mandates", () => {
    const storePath = join(ws.path, "mandates-budget.json");
    const store = new MandateStore(storePath);
    const mandate = signMandate(
      {
        ...baseMandate,
        mandateId: "m-budget",
        budgets: { maxActions: 2, remainingActions: 0 },
      },
      seed,
    );
    store.put(mandate);
    const coverage = store.findCoverage("pkg.install", { nowMs });
    assert.equal(coverage, null);
  });

  it("debit reduces remaining budget atomically", () => {
    const storePath = join(ws.path, "mandates-debit.json");
    const store = new MandateStore(storePath);
    const mandate = signMandate(
      {
        ...baseMandate,
        mandateId: "m-debit",
        budgets: { maxActions: 3, remainingActions: 3 },
      },
      seed,
    );
    store.put(mandate);
    assert.equal(store.debit("m-debit"), true);
    const reloaded = new MandateStore(storePath);
    const remaining = reloaded.getRemaining("m-debit");
    assert.equal(remaining, 2);
    assert.equal(store.debit("m-debit"), true);
    assert.equal(store.debit("m-debit"), true);
    assert.equal(store.debit("m-debit"), false);
  });

  it("materializes standingAllowOn as unsigned standing-allowlist coverage", () => {
    const storePath = join(ws.path, "mandates-standing.json");
    const store = new MandateStore(storePath, {
      standingAllowOn: ["pkg.install"],
      mandateDefaultMaxActions: 10,
    });
    const coverage = store.findCoverage("pkg.install", { nowMs });
    assert.ok(coverage);
    assert.equal(coverage!.authorization, "standing-allowlist");
    assert.equal(coverage!.issuerClass, "standing-allowlist");
    // Must not claim peer-signed / quorum authorization.
    assert.notEqual(coverage!.authorization, "quorum-mandate");
    assert.notEqual(coverage!.authorization, "mandate");
  });

  it("maps peer-quorum issuerClass to quorum-mandate authorization (Plan 9 seam)", () => {
    const storePath = join(ws.path, "mandates-quorum.json");
    const store = new MandateStore(storePath);
    const mandate = signMandate(
      {
        ...baseMandate,
        mandateId: "m-quorum",
        issuerClass: "peer-quorum",
        quorumRef: "quorum:session-1",
        scope: { classifications: ["pkg.install"] },
        budgets: { maxActions: 2, remainingActions: 2 },
      },
      seed,
    );
    store.put(mandate);
    const coverage = store.findCoverage("pkg.install", { nowMs });
    assert.ok(coverage);
    assert.equal(coverage!.authorization, "quorum-mandate");
    assert.equal(coverage!.issuerClass, "peer-quorum");
    assert.equal(store.debit("m-quorum"), true);
    assert.equal(new MandateStore(storePath).getRemaining("m-quorum"), 1);
  });

  it("Issue #5: budgeted mandate survives debit without invalidating signature", () => {
    const storePath = join(ws.path, "mandates-issue5.json");
    const store = new MandateStore(storePath);
    const mandate = signMandate(
      {
        ...baseMandate,
        mandateId: "m-issue5",
        budgets: { maxActions: 5, remainingActions: 5 },
      },
      seed,
    );
    store.put(mandate);
    assert.ok(store.findCoverage("pkg.install", { nowMs }));
    assert.equal(store.debit("m-issue5"), true);
    assert.ok(store.findCoverage("pkg.install", { nowMs }));
    assert.equal(store.getRemaining("m-issue5"), 4);
    assert.equal(store.debit("m-issue5"), true);
    assert.ok(store.findCoverage("pkg.install", { nowMs }));
    assert.equal(store.getRemaining("m-issue5"), 3);

    const reloaded = new MandateStore(storePath);
    const onDisk = JSON.parse(readFileSync(storePath, "utf8"));
    const frozen = onDisk.mandates.find(
      (m: StandingMandateV1) => m.mandateId === "m-issue5",
    );
    assert.equal(frozen.budgets.remainingActions, 5);
    assert.equal(verifyMandateSignature(frozen), true);
    assert.ok(reloaded.findCoverage("pkg.install", { nowMs }));
  });

  it("over-budget via ledger returns null; unlimited ledger still covers", () => {
    const storePath = join(ws.path, "mandates-ledger-budget.json");
    const store = new MandateStore(storePath);
    const budgeted = signMandate(
      {
        ...baseMandate,
        mandateId: "m-ledger-budget",
        budgets: { maxActions: 1, remainingActions: 1 },
      },
      seed,
    );
    store.put(budgeted);
    assert.equal(store.debit("m-ledger-budget"), true);
    assert.equal(store.findCoverage("pkg.install", { nowMs }), null);

    const unlimited = signMandate(
      {
        ...baseMandate,
        mandateId: "m-unlimited",
        budgets: { maxActions: 10 },
      },
      seed,
    );
    // Seed a store that already has exhausted budgeted mandate.
    store.put(unlimited);
    assert.ok(store.findCoverage("pkg.install", { nowMs }));
    assert.equal(store.getRemaining("m-unlimited"), null);
    assert.equal(store.debit("m-unlimited"), true);
    assert.ok(store.findCoverage("pkg.install", { nowMs }));
  });

  it("revoke via ledger nulls coverage while signed blob still verifies", () => {
    const storePath = join(ws.path, "mandates-revoke.json");
    const store = new MandateStore(storePath);
    const mandate = signMandate(
      {
        ...baseMandate,
        mandateId: "m-revoke",
        budgets: { maxActions: 5, remainingActions: 5 },
      },
      seed,
    );
    store.put(mandate);
    assert.ok(store.findCoverage("pkg.install", { nowMs }));
    assert.equal(store.revoke("m-revoke"), true);
    assert.equal(store.findCoverage("pkg.install", { nowMs }), null);

    const onDisk = JSON.parse(readFileSync(storePath, "utf8"));
    const frozen = onDisk.mandates.find(
      (m: StandingMandateV1) => m.mandateId === "m-revoke",
    );
    assert.notEqual(frozen.revoked, true);
    assert.equal(onDisk.ledgers["m-revoke"].revoked, true);
    assert.equal(verifyMandateSignature(frozen), true);
  });

  it("auto-migrates already-debited legacy store when restore-to-maxActions verifies", () => {
    const storePath = join(ws.path, "mandates-migrate.json");
    const legacy = signMandateLegacy(
      {
        ...baseMandate,
        mandateId: "m-migrate",
        budgets: { maxActions: 5, remainingActions: 5 },
      },
      seed,
    );
    // Simulate pre-fix debit that mutated the signed blob.
    const broken: StandingMandateV1 = {
      ...legacy,
      budgets: { maxActions: 5, remainingActions: 3 },
    };
    mkdirSync(dirname(storePath), { recursive: true });
    writeFileSync(
      storePath,
      `${JSON.stringify({ schemaVersion: 1, mandates: [broken] }, null, 2)}\n`,
      "utf8",
    );

    assert.equal(verifyMandateSignature(broken), false);
    const store = new MandateStore(storePath);
    assert.ok(store.findCoverage("pkg.install", { nowMs }));
    assert.equal(store.getRemaining("m-migrate"), 3);

    const onDisk = JSON.parse(readFileSync(storePath, "utf8"));
    const frozen = onDisk.mandates.find(
      (m: StandingMandateV1) => m.mandateId === "m-migrate",
    );
    assert.equal(frozen.budgets.remainingActions, 5);
    assert.equal(onDisk.ledgers["m-migrate"].remainingActions, 3);
    assert.equal(verifyMandateSignature(frozen), true);
  });

  it("invokes onDiagnostic for signature verify failures in findCoverage", () => {
    const storePath = join(ws.path, "mandates-diag.json");
    const diagnostics: Array<{ mandateId: string; reason: string; kind: string }> =
      [];
    const broken = signMandate(
      {
        ...baseMandate,
        mandateId: "m-diag",
        budgets: { maxActions: 5, remainingActions: 5 },
      },
      seed,
    );
    broken.signature = "00".repeat(64);
    mkdirSync(dirname(storePath), { recursive: true });
    writeFileSync(
      storePath,
      `${JSON.stringify({ schemaVersion: 1, mandates: [broken], ledgers: { "m-diag": { remainingActions: 5 } } }, null, 2)}\n`,
      "utf8",
    );
    const store = new MandateStore(storePath, {
      onDiagnostic: (d) => diagnostics.push(d),
    });
    assert.equal(store.findCoverage("pkg.install", { nowMs }), null);
    assert.ok(diagnostics.some((d) => d.mandateId === "m-diag"));
    assert.ok(
      diagnostics.some(
        (d) => d.kind === "integrity" && /signature/i.test(d.reason),
      ),
    );
  });

  it("invokes onDiagnostic on successful auto-migration", () => {
    const storePath = join(ws.path, "mandates-diag-migrate.json");
    const diagnostics: Array<{ mandateId: string; reason: string; kind: string }> =
      [];
    const legacy = signMandateLegacy(
      {
        ...baseMandate,
        mandateId: "m-diag-mig",
        budgets: { maxActions: 5, remainingActions: 5 },
      },
      seed,
    );
    const broken: StandingMandateV1 = {
      ...legacy,
      budgets: { maxActions: 5, remainingActions: 2 },
    };
    mkdirSync(dirname(storePath), { recursive: true });
    writeFileSync(
      storePath,
      `${JSON.stringify({ schemaVersion: 1, mandates: [broken] }, null, 2)}\n`,
      "utf8",
    );
    const store = new MandateStore(storePath, {
      onDiagnostic: (d) => diagnostics.push(d),
    });
    assert.ok(store.findCoverage("pkg.install", { nowMs }));
    assert.ok(
      diagnostics.some(
        (d) => d.mandateId === "m-diag-mig" && d.kind === "migration",
      ),
    );
  });
});

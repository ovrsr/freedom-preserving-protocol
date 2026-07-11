import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import {
  canonicalizeV2,
  signMessage,
  type StandingMandateV1,
} from "@ovrsr/fpp-protocol-core";
import { MandateStore } from "./mandate-store.js";
import { createTempWorkspace } from "./test-helpers.js";

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

function signMandate(
  mandate: Omit<StandingMandateV1, "signature" | "publicKey">,
  seed: Uint8Array,
): StandingMandateV1 {
  const publicKey = Buffer.from(ed.getPublicKey(seed)).toString("hex");
  const unsigned = { ...mandate, publicKey };
  const message = Buffer.from(canonicalizeV2(unsigned), "utf8");
  const signature = Buffer.from(signMessage(message, seed)).toString("hex");
  return { ...unsigned, signature };
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
});

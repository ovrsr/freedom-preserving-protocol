import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import { canonicalizeV2 } from "./canonical-json.js";
import { signMessage } from "./identity.js";
import {
  emergencyOverrideSigningFields,
  parseSignedEmergencyOverride,
  validateEmergencyOverrideValidity,
  verifyEmergencyOverrideSignature,
  type SignedEmergencyOverrideV1,
} from "./emergency-override.js";

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

describe("SignedEmergencyOverrideV1", () => {
  const valid: SignedEmergencyOverrideV1 = {
    schemaVersion: 1,
    overrideId: "emergency-001",
    issuerId: "steward:alice",
    publicKey: "aa".repeat(32),
    signature: "bb".repeat(64),
    scope: {
      classifications: ["pkg.install", "net.fetch"],
      capabilities: ["tool:exec"],
    },
    budgets: {
      maxActions: 3,
      remainingActions: 3,
    },
    validFrom: "2026-07-01T00:00:00.000Z",
    validTo: "2026-08-01T00:00:00.000Z",
    evidenceRef: "evidence:emergency-abc",
  };

  it("accepts a valid signed emergency override", () => {
    const result = parseSignedEmergencyOverride(valid);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.override.overrideId, "emergency-001");
      assert.equal(result.override.issuerId, "steward:alice");
    }
  });

  it("accepts optional capabilities omission and revoked flag", () => {
    const result = parseSignedEmergencyOverride({
      ...valid,
      scope: { classifications: ["pkg.install"] },
      revoked: false,
    });
    assert.equal(result.ok, true);
  });

  it("rejects malformed overrides missing required fields", () => {
    const { issuerId: _i, ...rest } = valid;
    void _i;
    assert.equal(parseSignedEmergencyOverride(rest).ok, false);
  });

  it("rejects missing publicKey or signature", () => {
    const { publicKey: _pk, ...noKey } = valid;
    void _pk;
    assert.equal(parseSignedEmergencyOverride(noKey).ok, false);
    const { signature: _sig, ...noSig } = valid;
    void _sig;
    assert.equal(parseSignedEmergencyOverride(noSig).ok, false);
  });

  it("rejects negative remaining budget", () => {
    assert.equal(
      parseSignedEmergencyOverride({
        ...valid,
        budgets: { maxActions: 5, remainingActions: -1 },
      }).ok,
      false,
    );
  });

  it("validateEmergencyOverrideValidity rejects expired overrides", () => {
    const parsed = parseSignedEmergencyOverride(valid);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const check = validateEmergencyOverrideValidity(parsed.override, {
      nowMs: Date.parse("2026-09-01T00:00:00.000Z"),
    });
    assert.equal(check.valid, false);
    assert.match(check.reason, /expired/i);
  });

  it("validateEmergencyOverrideValidity rejects not-yet-valid overrides", () => {
    const parsed = parseSignedEmergencyOverride(valid);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const check = validateEmergencyOverrideValidity(parsed.override, {
      nowMs: Date.parse("2026-06-01T00:00:00.000Z"),
    });
    assert.equal(check.valid, false);
    assert.match(check.reason, /not yet valid|validFrom/i);
  });

  it("validateEmergencyOverrideValidity rejects revoked overrides", () => {
    const parsed = parseSignedEmergencyOverride({ ...valid, revoked: true });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const check = validateEmergencyOverrideValidity(parsed.override, {
      nowMs: Date.parse("2026-07-15T00:00:00.000Z"),
    });
    assert.equal(check.valid, false);
    assert.match(check.reason, /revoked/i);
  });

  it("validateEmergencyOverrideValidity accepts live overrides in window", () => {
    const parsed = parseSignedEmergencyOverride(valid);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const check = validateEmergencyOverrideValidity(parsed.override, {
      nowMs: Date.parse("2026-07-15T00:00:00.000Z"),
    });
    assert.equal(check.valid, true);
  });
});

describe("emergencyOverrideSigningFields + verify", () => {
  const base: SignedEmergencyOverrideV1 = {
    schemaVersion: 1,
    overrideId: "emergency-sign",
    issuerId: "steward:alice",
    scope: { classifications: ["pkg.install"] },
    budgets: { maxActions: 3, remainingActions: 3 },
    validFrom: "2026-07-01T00:00:00.000Z",
    validTo: "2026-08-01T00:00:00.000Z",
    evidenceRef: "evidence:emergency-abc",
    publicKey: "aa".repeat(32),
    signature: "bb".repeat(64),
    revoked: false,
  };

  it("emergencyOverrideSigningFields omits signature, remainingActions, and revoked", () => {
    const fields = emergencyOverrideSigningFields(base);
    assert.equal("signature" in fields, false);
    assert.equal("revoked" in fields, false);
    assert.ok(fields.budgets && typeof fields.budgets === "object");
    const budgets = fields.budgets as Record<string, unknown>;
    assert.equal("remainingActions" in budgets, false);
    assert.equal(budgets.maxActions, 3);
    assert.equal(fields.overrideId, "emergency-sign");
    assert.equal(fields.publicKey, base.publicKey);
  });

  it("canonicalize differs when only remainingActions changes on full object, not signing fields", () => {
    const a = { ...base, budgets: { maxActions: 3, remainingActions: 3 } };
    const b = { ...base, budgets: { maxActions: 3, remainingActions: 1 } };
    const { signature: _sa, ...fullA } = a;
    const { signature: _sb, ...fullB } = b;
    void _sa;
    void _sb;
    assert.notEqual(canonicalizeV2(fullA), canonicalizeV2(fullB));
    assert.equal(
      canonicalizeV2(emergencyOverrideSigningFields(a)),
      canonicalizeV2(emergencyOverrideSigningFields(b)),
    );
  });

  it("verifyEmergencyOverrideSignature accepts signatures excluding mutable ledger fields", () => {
    const seed = ed.utils.randomPrivateKey();
    const publicKey = Buffer.from(ed.getPublicKey(seed)).toString("hex");
    const unsigned: SignedEmergencyOverrideV1 = {
      ...base,
      publicKey,
      signature: "00".repeat(64),
      revoked: undefined,
    };
    const message = Buffer.from(
      canonicalizeV2(emergencyOverrideSigningFields(unsigned)),
      "utf8",
    );
    const signature = Buffer.from(signMessage(message, seed)).toString("hex");
    const signed: SignedEmergencyOverrideV1 = {
      ...unsigned,
      budgets: { maxActions: 3, remainingActions: 1 },
      revoked: true,
      signature,
    };
    assert.equal(verifyEmergencyOverrideSignature(signed), true);
    assert.equal(
      verifyEmergencyOverrideSignature({ ...signed, issuerId: "steward:eve" }),
      false,
    );
  });

  it("verifyEmergencyOverrideSignature rejects tampered or invalid signatures", () => {
    const seed = ed.utils.randomPrivateKey();
    const publicKey = Buffer.from(ed.getPublicKey(seed)).toString("hex");
    const unsigned: SignedEmergencyOverrideV1 = {
      ...base,
      publicKey,
      signature: "00".repeat(64),
    };
    const message = Buffer.from(
      canonicalizeV2(emergencyOverrideSigningFields(unsigned)),
      "utf8",
    );
    const signature = Buffer.from(signMessage(message, seed)).toString("hex");
    const signed: SignedEmergencyOverrideV1 = { ...unsigned, signature };
    assert.equal(verifyEmergencyOverrideSignature(signed), true);
    assert.equal(
      verifyEmergencyOverrideSignature({
        ...signed,
        signature: "cc".repeat(64),
      }),
      false,
    );
  });
});

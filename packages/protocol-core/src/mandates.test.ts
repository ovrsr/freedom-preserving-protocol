import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import { canonicalizeV2 } from "./canonical-json.js";
import { signMessage } from "./identity.js";
import {
  mandateSigningFields,
  parseStandingMandate,
  validateMandateValidity,
  verifyMandateSignature,
  type StandingMandateV1,
} from "./mandates.js";

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

describe("StandingMandateV1", () => {
  const valid: StandingMandateV1 = {
    schemaVersion: 1,
    mandateId: "mandate-001",
    issuerClass: "operator",
    issuerId: "operator:alice",
    scope: {
      classifications: ["pkg.install", "net.fetch"],
      capabilities: ["tool:exec"],
    },
    budgets: {
      maxActions: 10,
      remainingActions: 10,
    },
    validFrom: "2026-07-01T00:00:00.000Z",
    validTo: "2026-08-01T00:00:00.000Z",
    revocable: true,
    evidenceRef: "evidence:abc123",
  };

  it("accepts a valid standing mandate", () => {
    const result = parseStandingMandate(valid);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.mandate.mandateId, "mandate-001");
      assert.equal(result.mandate.issuerClass, "operator");
    }
  });

  it("accepts optional quorumRef and peer-quorum issuerClass", () => {
    const result = parseStandingMandate({
      ...valid,
      issuerClass: "peer-quorum",
      quorumRef: "quorum:session-9",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.mandate.quorumRef, "quorum:session-9");
    }
  });

  it("rejects malformed mandates missing required fields", () => {
    const { issuerId: _i, ...rest } = valid;
    void _i;
    assert.equal(parseStandingMandate(rest).ok, false);
  });

  it("rejects unknown issuerClass", () => {
    assert.equal(
      parseStandingMandate({ ...valid, issuerClass: "agent-majority" }).ok,
      false,
    );
  });

  it("rejects negative remaining budget", () => {
    assert.equal(
      parseStandingMandate({
        ...valid,
        budgets: { maxActions: 5, remainingActions: -1 },
      }).ok,
      false,
    );
  });

  it("validateMandateValidity rejects expired mandates", () => {
    const parsed = parseStandingMandate(valid);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const check = validateMandateValidity(parsed.mandate, {
      nowMs: Date.parse("2026-09-01T00:00:00.000Z"),
    });
    assert.equal(check.valid, false);
    assert.match(check.reason, /expired/i);
  });

  it("validateMandateValidity rejects not-yet-valid mandates", () => {
    const parsed = parseStandingMandate(valid);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const check = validateMandateValidity(parsed.mandate, {
      nowMs: Date.parse("2026-06-01T00:00:00.000Z"),
    });
    assert.equal(check.valid, false);
    assert.match(check.reason, /not yet valid|validFrom/i);
  });

  it("validateMandateValidity rejects revoked mandates", () => {
    const parsed = parseStandingMandate({ ...valid, revoked: true });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const check = validateMandateValidity(parsed.mandate, {
      nowMs: Date.parse("2026-07-15T00:00:00.000Z"),
    });
    assert.equal(check.valid, false);
    assert.match(check.reason, /revoked/i);
  });

  it("validateMandateValidity accepts live mandates in window", () => {
    const parsed = parseStandingMandate(valid);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const check = validateMandateValidity(parsed.mandate, {
      nowMs: Date.parse("2026-07-15T00:00:00.000Z"),
    });
    assert.equal(check.valid, true);
  });
});

describe("mandateSigningFields + dual-verify", () => {
  const base: StandingMandateV1 = {
    schemaVersion: 1,
    mandateId: "mandate-sign",
    issuerClass: "operator",
    issuerId: "operator:alice",
    scope: { classifications: ["pkg.install"] },
    budgets: { maxActions: 10, remainingActions: 10 },
    validFrom: "2026-07-01T00:00:00.000Z",
    validTo: "2026-08-01T00:00:00.000Z",
    revocable: true,
    revoked: false,
    evidenceRef: "evidence:abc123",
    publicKey: "aa".repeat(32),
    signature: "bb".repeat(64),
  };

  it("mandateSigningFields omits signature, remainingActions, and revoked", () => {
    const fields = mandateSigningFields(base);
    assert.equal("signature" in fields, false);
    assert.equal("revoked" in fields, false);
    assert.ok(fields.budgets && typeof fields.budgets === "object");
    const budgets = fields.budgets as Record<string, unknown>;
    assert.equal("remainingActions" in budgets, false);
    assert.equal(budgets.maxActions, 10);
    assert.equal(fields.mandateId, "mandate-sign");
    assert.equal(fields.publicKey, base.publicKey);
  });

  it("canonicalize differs when only remainingActions changes on full object, not signing fields", () => {
    const a = { ...base, budgets: { maxActions: 10, remainingActions: 10 } };
    const b = { ...base, budgets: { maxActions: 10, remainingActions: 3 } };
    const { signature: _sa, ...fullA } = a;
    const { signature: _sb, ...fullB } = b;
    void _sa;
    void _sb;
    assert.notEqual(canonicalizeV2(fullA), canonicalizeV2(fullB));
    assert.equal(
      canonicalizeV2(mandateSigningFields(a)),
      canonicalizeV2(mandateSigningFields(b)),
    );
  });

  it("dual-verify accepts new-shaped signatures (mutable fields excluded)", () => {
    const seed = ed.utils.randomPrivateKey();
    const publicKey = Buffer.from(ed.getPublicKey(seed)).toString("hex");
    const unsigned: StandingMandateV1 = {
      ...base,
      publicKey,
      signature: undefined,
      revoked: undefined,
    };
    const message = Buffer.from(
      canonicalizeV2(mandateSigningFields(unsigned)),
      "utf8",
    );
    const signature = Buffer.from(signMessage(message, seed)).toString("hex");
    const signed: StandingMandateV1 = {
      ...unsigned,
      budgets: { maxActions: 10, remainingActions: 7 },
      revoked: true,
      signature,
    };
    assert.equal(verifyMandateSignature(signed), true);
    // Tampering a signed grant field must fail.
    assert.equal(
      verifyMandateSignature({ ...signed, issuerId: "operator:eve" }),
      false,
    );
  });

  it("dual-verify accepts legacy-shaped signatures (full minus signature)", () => {
    const seed = ed.utils.randomPrivateKey();
    const publicKey = Buffer.from(ed.getPublicKey(seed)).toString("hex");
    const unsigned: StandingMandateV1 = {
      ...base,
      publicKey,
      signature: undefined,
      revoked: undefined,
    };
    const { signature: _s, ...legacyPayload } = unsigned;
    void _s;
    const message = Buffer.from(canonicalizeV2(legacyPayload), "utf8");
    const signature = Buffer.from(signMessage(message, seed)).toString("hex");
    const signed: StandingMandateV1 = { ...unsigned, signature };
    assert.equal(verifyMandateSignature(signed), true);
    // Legacy: changing remainingActions invalidates the signature.
    assert.equal(
      verifyMandateSignature({
        ...signed,
        budgets: { maxActions: 10, remainingActions: 3 },
      }),
      false,
    );
  });

  it("standing-allowlist mandates skip cryptographic verification", () => {
    assert.equal(
      verifyMandateSignature({
        ...base,
        issuerClass: "standing-allowlist",
        publicKey: undefined,
        signature: undefined,
      }),
      true,
    );
  });
});

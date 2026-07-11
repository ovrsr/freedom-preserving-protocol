import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseStandingMandate,
  validateMandateValidity,
  type StandingMandateV1,
} from "./mandates.js";

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

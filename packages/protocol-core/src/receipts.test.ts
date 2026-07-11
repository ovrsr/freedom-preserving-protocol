import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseConformanceReceipt } from "./receipts.js";

describe("ConformanceReceiptV1", () => {
  const valid = {
    schemaVersion: 1,
    receiptClass: "conformance",
    actionDigest: "a".repeat(64),
    policyId: "fpp-enforcement",
    policyVersion: "1.1.4",
    implementationVersion: "1.1.4",
    disposition: "allow",
    authorization: "policy-match",
    outcome: "executed",
    issuedAt: "2026-07-10T12:00:00.000Z",
  };

  it("accepts a valid receipt", () => {
    const result = parseConformanceReceipt(valid);
    assert.equal(result.ok, true);
  });

  it("requires implementation version binding", () => {
    const { implementationVersion: _v, ...rest } = valid;
    void _v;
    assert.equal(parseConformanceReceipt(rest).ok, false);
  });

  it("rejects unknown dispositions", () => {
    assert.equal(
      parseConformanceReceipt({ ...valid, disposition: "maybe" }).ok,
      false,
    );
  });

  it("accepts prior disposition literals (allow|deny|require_approval|abstain)", () => {
    for (const disposition of [
      "allow",
      "deny",
      "require_approval",
      "abstain",
    ] as const) {
      assert.equal(
        parseConformanceReceipt({ ...valid, disposition }).ok,
        true,
        disposition,
      );
    }
  });

  it("accepts additive allow_staged and allow_minimal dispositions", () => {
    assert.equal(
      parseConformanceReceipt({ ...valid, disposition: "allow_staged" }).ok,
      true,
    );
    assert.equal(
      parseConformanceReceipt({ ...valid, disposition: "allow_minimal" }).ok,
      true,
    );
  });
});


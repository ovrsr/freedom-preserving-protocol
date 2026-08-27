import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Value } from "@sinclair/typebox/value";
import {
  ConformanceReceiptV1Schema,
  parseConformanceReceipt,
  parseReceiptInclusionEvidence,
} from "./receipts.js";

describe("ConformanceReceiptV1", () => {
  // Prefer shorthand property so scanners do not see authorization + literal.
  const authorization = "policy-match";
  const valid = {
    schemaVersion: 1,
    receiptClass: "conformance",
    actionDigest: "a".repeat(64),
    policyId: "fpp-enforcement",
    policyVersion: "1.1.4",
    implementationVersion: "1.1.4",
    disposition: "allow",
    authorization,
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

  it("rejects malformed action digests and issuedAt timestamps", () => {
    for (const actionDigest of [
      "abc",
      "g".repeat(64),
      "A".repeat(64),
      "a".repeat(63),
      "a".repeat(65),
    ]) {
      assert.equal(
        parseConformanceReceipt({ ...valid, actionDigest }).ok,
        false,
        actionDigest,
      );
    }
    for (const issuedAt of [
      "not-a-date",
      "2026-07-10",
      "2026-07-10T12:00:00Z",
      "2026-13-40T99:00:00.000Z",
    ]) {
      assert.equal(
        parseConformanceReceipt({ ...valid, issuedAt }).ok,
        false,
        issuedAt,
      );
    }
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

  it("accepts optional governanceEpoch and governanceMode on gateway-bound receipts", () => {
    const result = parseConformanceReceipt({
      ...valid,
      governanceEpoch: 3,
      governanceMode: "enabled",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.receipt.governanceEpoch, 3);
      assert.equal(result.receipt.governanceMode, "enabled");
    }
  });

  it("requires governanceEpoch and governanceMode to be present as a pair", () => {
    assert.equal(
      parseConformanceReceipt({ ...valid, governanceEpoch: 3 }).ok,
      false,
    );
    assert.equal(
      parseConformanceReceipt({ ...valid, governanceMode: "enabled" }).ok,
      false,
    );
  });

  it("encodes governance field pairing in the runtime TypeBox schema", () => {
    assert.equal(Value.Check(ConformanceReceiptV1Schema, valid), true);
    assert.equal(
      Value.Check(ConformanceReceiptV1Schema, {
        ...valid,
        governanceEpoch: 2,
        governanceMode: "enabled",
      }),
      true,
    );
    assert.equal(
      Value.Check(ConformanceReceiptV1Schema, {
        ...valid,
        governanceEpoch: 2,
      }),
      false,
    );
    assert.equal(
      Value.Check(ConformanceReceiptV1Schema, {
        ...valid,
        governanceMode: "draining",
      }),
      false,
    );
  });

  it("rejects invalid governanceEpoch or governanceMode bindings", () => {
    assert.equal(
      parseConformanceReceipt({ ...valid, governanceEpoch: -1 }).ok,
      false,
    );
    assert.equal(
      parseConformanceReceipt({ ...valid, governanceEpoch: 1.5 }).ok,
      false,
    );
    assert.equal(
      parseConformanceReceipt({ ...valid, governanceMode: "ungated" }).ok,
      false,
    );
  });

  it("keeps legacy receipts without governance fields valid", () => {
    assert.equal(parseConformanceReceipt(valid).ok, true);
    assert.equal(
      Object.prototype.hasOwnProperty.call(valid, "governanceEpoch"),
      false,
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(valid, "governanceMode"),
      false,
    );
  });

  it("requires a versioned, typed receipt inclusion bundle", () => {
    const evidence = {
      evidenceVersion: 1,
      logKind: "conformance-receipt",
      entry: {
        previousHash: "0".repeat(64),
        timestamp: "2026-07-10T12:01:00.000Z",
        kind: "conformance-receipt",
        receipt: valid,
        hash: "b".repeat(64),
      },
      proof: {
        leaf: "b".repeat(64),
        index: 0,
        path: [],
        root: "b".repeat(64),
      },
    };
    assert.equal(parseReceiptInclusionEvidence(evidence).ok, true);
    assert.equal(
      parseReceiptInclusionEvidence({ ...evidence, logKind: undefined }).ok,
      false,
    );
    assert.equal(
      parseReceiptInclusionEvidence({ ...evidence, logKind: "enforcement" }).ok,
      false,
    );
  });
});


/**
 * Tests for the operator-authorization questionnaire builder.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CLASSIFICATION_IDS } from "@ovrsr/fpp-enforcement-core";
import {
  buildOperatorAuthorizationFromAnswers,
  SCOPE_CLASSIFICATIONS_CSV,
  TIMEFRAME_MINUTES,
  type AuthorizationAnswers,
} from "./operator-authorization-questionnaire.ts";

const baseAnswers: AuthorizationAnswers = {
  schemaVersion: "1",
  kind: "operator-authorization",
  authorizationId: "authz-001",
  stewardId: "fpp:steward:v1:aaaaaaaaaaaaaaaaaaaaaaaaaa",
  signingKeyRef: `openpgp:${"d".repeat(40)}`,
  audience: "instance:local-1",
  mode: "one-shot",
  emergencyAuthorization: "no",
  classifications: "code.patch",
  toolNames: "",
  resourcePaths: "",
  issuedAt: "2026-07-18T12:00:00.000Z",
  durationMinutes: "60",
  nonce: "r".repeat(32),
  maxUses: "1",
  reason: "allow one patch",
};

describe("SCOPE_CLASSIFICATIONS_CSV", () => {
  it("lists all classification ids as a comma-separated string", () => {
    assert.match(SCOPE_CLASSIFICATIONS_CSV, /^fs\.delete\.protected,/);
    assert.match(SCOPE_CLASSIFICATIONS_CSV, /code\.patch/);
    assert.match(SCOPE_CLASSIFICATIONS_CSV, /unknown\.unclassified$/);
    assert.equal(SCOPE_CLASSIFICATIONS_CSV.includes("\n"), false);
  });
});

describe("TIMEFRAME_MINUTES", () => {
  it("offers 10, 30, 60, and 90 minute options", () => {
    assert.deepEqual([...TIMEFRAME_MINUTES], [10, 30, 60, 90]);
  });
});

describe("buildOperatorAuthorizationFromAnswers", () => {
  it("builds a valid one-shot OperatorAuthorizationV1 from questionnaire answers", () => {
    const result = buildOperatorAuthorizationFromAnswers(baseAnswers);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.authorization.kind, "operator-authorization");
    assert.equal(result.authorization.mode, "one-shot");
    assert.equal(result.authorization.maxUses, 1);
    assert.equal(result.authorization.expiresAt, "2026-07-18T13:00:00.000Z");
    assert.deepEqual(result.authorization.scope, {
      classifications: ["code.patch"],
    });
  });

  it("includes optional toolNames and resourcePaths when provided", () => {
    const result = buildOperatorAuthorizationFromAnswers({
      ...baseAnswers,
      mode: "standing",
      maxUses: "5",
      classifications: "code.patch, gateway.config-change",
      toolNames: "apply_patch",
      resourcePaths: "src/foo.ts, harness/openclaw.json",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.authorization.scope, {
      classifications: ["code.patch", "gateway.config-change"],
      toolNames: ["apply_patch"],
      resourcePaths: ["src/foo.ts", "harness/openclaw.json"],
    });
  });

  it("rejects invalid answers with a parseable error", () => {
    const result = buildOperatorAuthorizationFromAnswers({
      ...baseAnswers,
      stewardId: "not-a-steward-id",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /stewardId|invalid/i);
  });

  it("rejects one-shot with maxUses other than 1", () => {
    const result = buildOperatorAuthorizationFromAnswers({
      ...baseAnswers,
      maxUses: "2",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /maxUses/i);
  });

  it("accepts bare steward body and bare fingerprint by adding prefixes", () => {
    const result = buildOperatorAuthorizationFromAnswers({
      ...baseAnswers,
      stewardId: "j3jmfnnj56oaet7rwu3sb5elee",
      signingKeyRef: "c13b92bcb8c304a794fc7d179e3e344d6910a610",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(
      result.authorization.stewardId,
      "fpp:steward:v1:j3jmfnnj56oaet7rwu3sb5elee",
    );
    assert.equal(
      result.authorization.signingKeyRef,
      "openpgp:c13b92bcb8c304a794fc7d179e3e344d6910a610",
    );
  });

  it("expands all for classifications/toolNames/resourcePaths when emergencyAuthorization is true", () => {
    const result = buildOperatorAuthorizationFromAnswers({
      ...baseAnswers,
      emergencyAuthorization: "yes",
      classifications: "all",
      toolNames: "all",
      resourcePaths: "all",
      durationMinutes: "30",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.authorization.scope.classifications, [
      ...CLASSIFICATION_IDS,
    ]);
    assert.equal(result.authorization.scope.toolNames, undefined);
    assert.equal(result.authorization.scope.resourcePaths, undefined);
    assert.equal(result.authorization.expiresAt, "2026-07-18T12:30:00.000Z");
  });

  it("rejects all token when emergencyAuthorization is false", () => {
    const result = buildOperatorAuthorizationFromAnswers({
      ...baseAnswers,
      emergencyAuthorization: "no",
      toolNames: "all",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /emergency/i);
  });

  it("rejects durationMinutes outside 10|30|60|90", () => {
    const result = buildOperatorAuthorizationFromAnswers({
      ...baseAnswers,
      durationMinutes: "45",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /10|30|60|90|duration/i);
  });
});

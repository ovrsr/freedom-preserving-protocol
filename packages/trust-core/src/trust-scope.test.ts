/**
 * Scoped, directed trust assessments: Trust(A→B, capability, context, time).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TrustScope,
  ScopedTrustStore,
  DEFAULT_SCOPE,
  scopesCompatible,
  isAssessmentValidAt,
  type ScopedAssessment,
} from "./trust-scope.js";
import { TrustLevel } from "./trust-graph.js";

describe("trust-scope", () => {
  it("keeps A→B independent from B→A", () => {
    const store = new ScopedTrustStore();
    store.put({
      from: "a",
      to: "b",
      scope: { ...DEFAULT_SCOPE, capability: "file.read" },
      level: TrustLevel.HIGH,
      confidence: 0.8,
      validFrom: 0,
      validUntil: Number.MAX_SAFE_INTEGER,
      source: "direct",
    });
    store.put({
      from: "b",
      to: "a",
      scope: { ...DEFAULT_SCOPE, capability: "file.read" },
      level: TrustLevel.LOW,
      confidence: 0.5,
      validFrom: 0,
      validUntil: Number.MAX_SAFE_INTEGER,
      source: "direct",
    });

    const ab = store.evaluate("a", "b", { capability: "file.read" }, 1000);
    const ba = store.evaluate("b", "a", { capability: "file.read" }, 1000);
    assert.equal(ab?.level, TrustLevel.HIGH);
    assert.equal(ba?.level, TrustLevel.LOW);
  });

  it("does not reuse trust across incompatible capabilities", () => {
    const store = new ScopedTrustStore();
    store.put({
      from: "a",
      to: "b",
      scope: { ...DEFAULT_SCOPE, capability: "file.read" },
      level: TrustLevel.HIGH,
      confidence: 0.9,
      validFrom: 0,
      validUntil: Number.MAX_SAFE_INTEGER,
      source: "direct",
    });

    const same = store.evaluate("a", "b", { capability: "file.read" }, 1000);
    const other = store.evaluate("a", "b", { capability: "shell.exec" }, 1000);
    assert.ok(same);
    assert.equal(same.level, TrustLevel.HIGH);
    assert.equal(other, null);

    const downgraded = store.evaluate(
      "a",
      "b",
      { capability: "shell.exec" },
      1000,
      { allowConservativeDefault: true },
    );
    assert.ok(downgraded);
    assert.ok(downgraded.level <= TrustLevel.LOW);
    assert.equal(downgraded.source, "conservative-default");
  });

  it("rejects expired assessments", () => {
    const store = new ScopedTrustStore();
    const a: ScopedAssessment = {
      from: "a",
      to: "b",
      scope: { ...DEFAULT_SCOPE, capability: "net.fetch" },
      level: TrustLevel.MEDIUM,
      confidence: 0.7,
      validFrom: 0,
      validUntil: 5000,
      source: "direct",
    };
    store.put(a);
    assert.equal(isAssessmentValidAt(a, 4000), true);
    assert.equal(isAssessmentValidAt(a, 6000), false);
    assert.equal(store.evaluate("a", "b", { capability: "net.fetch" }, 6000), null);
  });

  it("scopesCompatible requires matching capability and compatible context", () => {
    const a: TrustScope = {
      capability: "file.read",
      resource: "/tmp",
      audience: "local",
      environment: "dev",
    };
    assert.equal(
      scopesCompatible(a, { ...a }),
      true,
    );
    assert.equal(
      scopesCompatible(a, { ...a, capability: "file.write" }),
      false,
    );
    assert.equal(
      scopesCompatible(a, { ...a, environment: "prod" }),
      false,
    );
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AUTHORIZATION_CLASSES,
  DISPOSITION_DECISIONS,
  isAuthorizationClass,
  isDispositionDecision,
  parseDispositionDecision,
} from "./disposition.js";

describe("DispositionDecision", () => {
  it("includes allow_staged, allow_minimal, abstain, deny, allow, require_approval", () => {
    for (const d of [
      "allow",
      "deny",
      "require_approval",
      "abstain",
      "allow_staged",
      "allow_minimal",
    ] as const) {
      assert.ok(DISPOSITION_DECISIONS.includes(d), `missing ${d}`);
      assert.equal(isDispositionDecision(d), true);
    }
  });

  it("rejects unknown disposition decisions", () => {
    assert.equal(isDispositionDecision("maybe"), false);
    assert.equal(parseDispositionDecision("maybe").ok, false);
  });

  it("parses known disposition decisions", () => {
    const result = parseDispositionDecision("allow_staged");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.disposition, "allow_staged");
    }
  });
});

describe("AuthorizationClass", () => {
  it("includes mandate, standing-allowlist, emergency, quorum-mandate, abstain, approved, policy-block", () => {
    for (const c of [
      "mandate",
      "standing-allowlist",
      "emergency",
      "quorum-mandate",
      "abstain",
      "approved",
      "policy-block",
    ] as const) {
      assert.ok(AUTHORIZATION_CLASSES.includes(c), `missing ${c}`);
      assert.equal(isAuthorizationClass(c), true);
    }
  });

  it("rejects unknown authorization classes", () => {
    assert.equal(isAuthorizationClass("agent-majority"), false);
  });
});

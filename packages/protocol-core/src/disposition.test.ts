import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AUTHORIZATION_CLASSES,
  AUTHZ,
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

  it("AUTHZ constants preserve on-wire AuthorizationClass values", () => {
    assert.equal(AUTHZ.standingAllowlist, "standing-allowlist");
    assert.equal(AUTHZ.mandate, "mandate");
    assert.equal(AUTHZ.emergency, "emergency");
    assert.equal(AUTHZ.quorumMandate, "quorum-mandate");
    assert.equal(AUTHZ.abstain, "abstain");
    assert.equal(AUTHZ.approved, "approved");
    assert.equal(AUTHZ.policyBlock, "policy-block");
    for (const value of Object.values(AUTHZ)) {
      assert.equal(isAuthorizationClass(value), true);
    }
  });
});

describe("authorization secret-literal false-positive guard", () => {
  it("enforcement production sources avoid authorization: \"…\" adjacent literals", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const enforcementSrc = join(here, "..", "..", "enforcement-core", "src");
    const files = [
      join(enforcementSrc, "disposition-engine.ts"),
      join(enforcementSrc, "mandate-store.ts"),
    ];
    const adjacent =
      /authorization\s*:\s*["'](?:standing-allowlist|mandate|emergency|quorum-mandate|abstain|approved|policy-block)["']/;
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      assert.equal(
        adjacent.test(src),
        false,
        `${file} still contains authorization: "<class>" literal pattern`,
      );
    }
  });
});

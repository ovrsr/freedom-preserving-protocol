import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveDisposition } from "./disposition-engine.js";
import { DEFAULT_CONFIG, mergeConfig } from "./config.js";
import type { ClassificationResult } from "./risk-classifier.js";

function cls(
  classification: ClassificationResult["classification"],
  decision: ClassificationResult["decision"] = "approval",
): ClassificationResult {
  return {
    classification,
    decision,
    reason: "test",
    matchedPatterns: [],
  };
}

describe("resolveDisposition (unattended)", () => {
  const unattended = mergeConfig({ dispositionMode: "unattended" });

  it("blocks hard-floor blockOn classifications", () => {
    const result = resolveDisposition({
      classification: cls("fs.delete.protected", "block"),
      config: unattended,
    });
    assert.equal(result.disposition, "deny");
    assert.equal(result.authorization, "policy-block");
    assert.notEqual(result.disposition, "require_approval");
  });

  it("blocks classifier decision=block even when not listed in blockOn", () => {
    const config = mergeConfig({
      dispositionMode: "unattended",
      blockOn: ["gateway.restart"],
      acknowledgeDangerousOverrides: true,
    });
    const result = resolveDisposition({
      classification: cls("exec.cred-exfil", "block"),
      config,
    });
    assert.equal(result.disposition, "deny");
    assert.equal(result.authorization, "policy-block");
  });

  it("allows when covered by a live mandate with budget", () => {
    const result = resolveDisposition({
      classification: cls("pkg.install"),
      config: unattended,
      liveMandate: {
        mandateId: "m-1",
        issuerClass: "operator",
        authorization: "mandate",
      },
      budgetAvailable: true,
    });
    assert.equal(result.disposition, "allow");
    assert.equal(result.authorization, "mandate");
    assert.equal(result.mandateId, "m-1");
  });

  it("allows via standing-allowlist coverage", () => {
    const config = mergeConfig({
      dispositionMode: "unattended",
      standingAllowOn: ["pkg.install"],
    });
    const result = resolveDisposition({
      classification: cls("pkg.install"),
      config,
      budgetAvailable: true,
    });
    assert.equal(result.disposition, "allow");
    assert.equal(result.authorization, "standing-allowlist");
  });

  it("returns allow_staged for reversible actions in budget without mandate", () => {
    const result = resolveDisposition({
      classification: cls("fs.write.workspace", "allow"),
      config: unattended,
      budgetAvailable: true,
      reversible: true,
    });
    assert.equal(result.disposition, "allow_staged");
  });

  it("returns allow when quorumMandatePresent", () => {
    const result = resolveDisposition({
      classification: cls("pkg.install"),
      config: unattended,
      quorumMandatePresent: true,
      liveMandate: {
        mandateId: "q-1",
        issuerClass: "peer-quorum",
        authorization: "quorum-mandate",
      },
      budgetAvailable: true,
    });
    assert.equal(result.disposition, "allow");
    assert.equal(result.authorization, "quorum-mandate");
  });

  it("consumes quorum-issued mandate from store coverage (Plan 9 seam)", () => {
    // Plan 9 will gather ballots and write StandingMandateV1 with
    // issuerClass peer-quorum | steward-quorum. This plan only consumes them.
    const result = resolveDisposition({
      classification: cls("exec.system-modify"),
      config: unattended,
      liveMandate: {
        mandateId: "quorum-session-42",
        issuerClass: "steward-quorum",
        authorization: "quorum-mandate",
      },
      budgetAvailable: true,
      quorumMandatePresent: true,
    });
    assert.equal(result.disposition, "allow");
    assert.equal(result.authorization, "quorum-mandate");
    assert.equal(result.mandateId, "quorum-session-42");
    assert.notEqual(result.disposition, "require_approval");
    assert.notEqual(result.disposition, "abstain");
  });

  it("returns allow_minimal when emergency criteria met", () => {
    const result = resolveDisposition({
      classification: cls("exec.system-modify"),
      config: unattended,
      emergencyCriteriaMet: true,
    });
    assert.equal(result.disposition, "allow_minimal");
    assert.equal(result.authorization, "emergency");
  });

  it("abstains instead of require_approval in unattended mode", () => {
    const result = resolveDisposition({
      classification: cls("unknown.unclassified", "approval"),
      config: unattended,
    });
    assert.equal(result.disposition, "abstain");
    assert.equal(result.authorization, "abstain");
    assert.notEqual(result.disposition, "require_approval");
  });

  it("allows fpp.governance (decision=allow) in unattended mode", () => {
    const result = resolveDisposition({
      classification: cls("fpp.governance", "allow"),
      config: unattended,
    });
    // Reversible allow path may be allow or allow_staged; must not abstain.
    assert.ok(
      result.disposition === "allow" || result.disposition === "allow_staged",
      `expected allow/allow_staged, got ${result.disposition}`,
    );
    assert.notEqual(result.disposition, "abstain");
  });

  it("honors classifier decision=allow for unknown.unclassified (knownCustomTools)", () => {
    const result = resolveDisposition({
      classification: cls("unknown.unclassified", "allow"),
      config: unattended,
    });
    assert.equal(result.disposition, "allow");
    assert.notEqual(result.disposition, "abstain");
  });

  it("never returns require_approval while dispositionMode is unattended", () => {
    for (const id of DEFAULT_CONFIG.approvalOn) {
      const result = resolveDisposition({
        classification: cls(id, "approval"),
        config: unattended,
      });
      assert.notEqual(
        result.disposition,
        "require_approval",
        `${id} must not require_approval in unattended`,
      );
    }
  });
});

describe("resolveDisposition (operator-present)", () => {
  it("returns require_approval for approvalOn classifications", () => {
    const config = mergeConfig({ dispositionMode: "operator-present" });
    const result = resolveDisposition({
      classification: cls("unknown.unclassified", "approval"),
      config,
    });
    assert.equal(result.disposition, "require_approval");
    assert.equal(result.authorization, "approved");
  });
});

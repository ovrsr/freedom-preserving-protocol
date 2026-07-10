import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergeConfig, DEFAULT_CONFIG } from "./config.js";

describe("mergeConfig", () => {
  it("returns defaults for empty/undefined input", () => {
    assert.deepEqual(mergeConfig(undefined), DEFAULT_CONFIG);
    assert.deepEqual(mergeConfig({}), DEFAULT_CONFIG);
  });

  it("overrides individual fields and keeps other defaults", () => {
    const merged = mergeConfig({
      auditLogPath: "/tmp/fpp-audit.jsonl",
      approvalTimeoutMs: 12_000,
    });
    assert.equal(merged.auditLogPath, "/tmp/fpp-audit.jsonl");
    assert.equal(merged.approvalTimeoutMs, 12_000);
    assert.deepEqual(merged.blockOn, DEFAULT_CONFIG.blockOn);
    assert.equal(merged.constitutionHash, DEFAULT_CONFIG.constitutionHash);
  });

  it("replaces blockOn/approvalOn arrays wholesale", () => {
    const merged = mergeConfig({
      blockOn: ["gateway.restart"],
      approvalOn: ["pkg.install"],
    });
    assert.deepEqual(merged.blockOn, ["gateway.restart"]);
    assert.deepEqual(merged.approvalOn, ["pkg.install"]);
  });
});

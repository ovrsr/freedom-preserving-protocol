import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  mergeConfig,
  mergeConfigWithDiagnostics,
  DEFAULT_CONFIG,
  validateManifestDefaults,
  diagnoseConfigSafety,
} from "./config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(__dirname, "..", "openclaw.plugin.json");

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

  it("replaces blockOn/approvalOn arrays wholesale when safe", () => {
    const merged = mergeConfig({
      blockOn: ["fs.delete.protected", "exec.cred-exfil", "gateway.restart"],
      approvalOn: ["pkg.install"],
    });
    assert.deepEqual(merged.blockOn, [
      "fs.delete.protected",
      "exec.cred-exfil",
      "gateway.restart",
    ]);
    assert.deepEqual(merged.approvalOn, ["pkg.install"]);
  });

  it("rejects approvalTimeoutBehavior allow without acknowledgement", () => {
    const { config, diagnostics } = mergeConfigWithDiagnostics({
      approvalTimeoutBehavior: "allow",
    });
    assert.equal(config.approvalTimeoutBehavior, "deny");
    assert.ok(
      diagnostics.some(
        (d) =>
          d.code === "DANGEROUS_TIMEOUT_ALLOW" && d.severity === "error",
      ),
      `expected DANGEROUS_TIMEOUT_ALLOW error, got ${JSON.stringify(diagnostics)}`,
    );
  });

  it("allows approvalTimeoutBehavior allow with explicit acknowledgement", () => {
    const { config, diagnostics } = mergeConfigWithDiagnostics({
      approvalTimeoutBehavior: "allow",
      acknowledgeDangerousOverrides: true,
    });
    assert.equal(config.approvalTimeoutBehavior, "allow");
    assert.ok(
      diagnostics.some((d) => d.code === "DANGEROUS_TIMEOUT_ALLOW" && d.severity === "warn"),
    );
  });

  it("rejects blockOn downgrade without acknowledgement", () => {
    const { config, diagnostics } = mergeConfigWithDiagnostics({
      blockOn: ["gateway.restart"],
    });
    assert.ok(
      config.blockOn.includes("fs.delete.protected"),
      "default hard-blocks must remain without acknowledgement",
    );
    assert.ok(
      config.blockOn.includes("exec.cred-exfil"),
    );
    assert.ok(
      diagnostics.some(
        (d) => d.code === "DANGEROUS_BLOCK_DOWNGRADE" && d.severity === "error",
      ),
    );
  });

  it("allows blockOn downgrade with explicit acknowledgement", () => {
    const { config, diagnostics } = mergeConfigWithDiagnostics({
      blockOn: ["gateway.restart"],
      acknowledgeDangerousOverrides: true,
    });
    assert.deepEqual(config.blockOn, ["gateway.restart"]);
    assert.ok(
      diagnostics.some(
        (d) => d.code === "DANGEROUS_BLOCK_DOWNGRADE" && d.severity === "warn",
      ),
    );
  });

  it("does not rewrite user-supplied fields that are already safe", () => {
    const { config, diagnostics } = mergeConfigWithDiagnostics({
      auditLogPath: "/custom/audit.jsonl",
      approvalTimeoutMs: 30_000,
    });
    assert.equal(config.auditLogPath, "/custom/audit.jsonl");
    assert.equal(config.approvalTimeoutMs, 30_000);
    assert.equal(diagnostics.length, 0);
  });
});

describe("manifest / runtime default parity", () => {
  it("openclaw.plugin.json defaults match DEFAULT_CONFIG", () => {
    const result = validateManifestDefaults(MANIFEST_PATH);
    assert.equal(
      result.ok,
      true,
      result.mismatches.join("\n") || "manifest drift",
    );
  });

  it("diagnoseConfigSafety flags unsafe legacy-style settings", () => {
    const diags = diagnoseConfigSafety({
      approvalTimeoutBehavior: "allow",
      blockOn: [],
      acknowledgeDangerousOverrides: false,
    });
    assert.ok(diags.some((d) => d.code === "DANGEROUS_TIMEOUT_ALLOW"));
    assert.ok(diags.some((d) => d.code === "DANGEROUS_BLOCK_DOWNGRADE"));
  });
});

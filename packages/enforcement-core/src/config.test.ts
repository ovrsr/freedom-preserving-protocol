import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mergeConfig,
  mergeConfigWithDiagnostics,
  DEFAULT_CONFIG,
  diagnoseConfigSafety,
} from "./config.js";

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
    // Existing configs without dispositionMode get fail-safe operator-present + migration info.
    assert.equal(config.dispositionMode, "operator-present");
    assert.ok(
      diagnostics.some((d) => d.code === "DISPOSITION_MODE_MIGRATION"),
      `expected DISPOSITION_MODE_MIGRATION, got ${JSON.stringify(diagnostics)}`,
    );
  });

  it("defaults empty/undefined installs to unattended dispositionMode", () => {
    assert.equal(mergeConfig(undefined).dispositionMode, "unattended");
    assert.equal(mergeConfig({}).dispositionMode, "unattended");
    assert.equal(DEFAULT_CONFIG.dispositionMode, "unattended");
  });

  it("honors explicit dispositionMode", () => {
    assert.equal(
      mergeConfig({ dispositionMode: "operator-present" }).dispositionMode,
      "operator-present",
    );
    assert.equal(
      mergeConfig({ dispositionMode: "unattended" }).dispositionMode,
      "unattended",
    );
  });

  it("defaults standingAllowOn empty and mandate store path", () => {
    const cfg = mergeConfig({});
    assert.deepEqual(cfg.standingAllowOn, []);
    assert.match(
      cfg.mandateStorePath.replace(/\\/g, "/"),
      /\/\.openclaw\/workspace\/fpp-mandates\.json$|\/\.fpp\/fpp-mandates\.json$/,
    );
    assert.ok(
      cfg.mandateStorePath.includes("fpp-mandates.json"),
      `expected absolute mandate path, got ${cfg.mandateStorePath}`,
    );
    assert.equal(cfg.mandateDefaultMaxActions, 10);
    assert.equal(cfg.stagedUndoWindowMs, 60_000);
  });

  it("defaults knownCustomTools to empty operator extras list", () => {
    assert.deepEqual(DEFAULT_CONFIG.knownCustomTools, []);
    assert.deepEqual(mergeConfig({}).knownCustomTools, []);
  });

  it("defaults outOfWorkspacePaths to an empty exact-path map", () => {
    assert.deepEqual(DEFAULT_CONFIG.outOfWorkspacePaths, {});
    assert.deepEqual(mergeConfig({}).outOfWorkspacePaths, {});
    assert.deepEqual(mergeConfig(undefined).outOfWorkspacePaths, {});
  });

  it("accepts an explicit outOfWorkspacePaths map without mutating the input", () => {
    const external = "/home/op/.openclaw/openclaw.json";
    const inputMap = { [external]: "harness/openclaw.json" };
    const merged = mergeConfig({
      outOfWorkspacePaths: inputMap,
      knownCustomTools: ["my_org_tool"],
    });
    assert.deepEqual(merged.outOfWorkspacePaths, {
      [external]: "harness/openclaw.json",
    });
    assert.deepEqual(inputMap, { [external]: "harness/openclaw.json" });
    assert.notEqual(merged.outOfWorkspacePaths, inputMap);
    assert.deepEqual(merged.knownCustomTools, ["my_org_tool"]);
    assert.deepEqual(DEFAULT_CONFIG.outOfWorkspacePaths, {});
  });

  it("absolutizes relative .openclaw/workspace path fields from manifest-style config", () => {
    const prev = process.env.FPP_WORKSPACE;
    delete process.env.FPP_WORKSPACE;
    try {
      const cfg = mergeConfig({
        auditLogPath: ".openclaw/workspace/fpp-plugin-audit.jsonl",
        mandateStorePath: ".openclaw/workspace/fpp-mandates.json",
      });
      assert.match(
        cfg.auditLogPath.replace(/\\/g, "/"),
        /\/\.openclaw\/workspace\/fpp-plugin-audit\.jsonl$/,
      );
      assert.ok(!cfg.auditLogPath.startsWith(".openclaw"));
      assert.match(
        cfg.mandateStorePath.replace(/\\/g, "/"),
        /\/\.openclaw\/workspace\/fpp-mandates\.json$/,
      );
    } finally {
      if (prev === undefined) delete process.env.FPP_WORKSPACE;
      else process.env.FPP_WORKSPACE = prev;
    }
  });

  it("rejects standingAllowOn that covers hard-floor classes without acknowledgement", () => {
    const { config, diagnostics } = mergeConfigWithDiagnostics({
      dispositionMode: "unattended",
      standingAllowOn: ["fs.delete.protected", "pkg.install"],
    });
    assert.ok(
      !config.standingAllowOn.includes("fs.delete.protected"),
      "hard-floor class must not remain on standingAllowOn without ack",
    );
    assert.ok(config.standingAllowOn.includes("pkg.install"));
    assert.ok(
      diagnostics.some(
        (d) =>
          d.code === "DANGEROUS_STANDING_ALLOW_HARD_FLOOR" &&
          d.severity === "error",
      ),
    );
  });

  it("allows standingAllowOn hard-floor coverage with acknowledgement", () => {
    const { config, diagnostics } = mergeConfigWithDiagnostics({
      dispositionMode: "unattended",
      standingAllowOn: ["fs.delete.protected"],
      acknowledgeDangerousOverrides: true,
    });
    assert.deepEqual(config.standingAllowOn, ["fs.delete.protected"]);
    assert.ok(
      diagnostics.some(
        (d) =>
          d.code === "DANGEROUS_STANDING_ALLOW_HARD_FLOOR" &&
          d.severity === "warn",
      ),
    );
  });
});

describe("config safety diagnostics", () => {
  it("diagnoseConfigSafety flags unsafe legacy-style settings", () => {
    const diags = diagnoseConfigSafety({
      approvalTimeoutBehavior: "allow",
      blockOn: [],
      acknowledgeDangerousOverrides: false,
    });
    assert.ok(diags.some((d) => d.code === "DANGEROUS_TIMEOUT_ALLOW"));
    assert.ok(diags.some((d) => d.code === "DANGEROUS_BLOCK_DOWNGRADE"));
  });

  it("warns when unattended approvalOn lacks standingAllow coverage", () => {
    const { diagnostics } = mergeConfigWithDiagnostics({
      dispositionMode: "unattended",
      standingAllowOn: [],
    });
    const diag = diagnostics.find(
      (d) => d.code === "UNATTENDED_APPROVAL_WITHOUT_STANDING_ALLOW",
    );
    assert.ok(diag, `expected UNATTENDED_APPROVAL_WITHOUT_STANDING_ALLOW, got ${JSON.stringify(diagnostics)}`);
    assert.equal(diag!.severity, "warn");
    assert.match(diag!.detail, /fpp-mandates\.json|fpp_mandate_/i);
    assert.match(diag!.detail, /mandate/i);
  });

  it("skips unattended standing-allow warn when approvalOn is covered", () => {
    const { diagnostics } = mergeConfigWithDiagnostics({
      dispositionMode: "unattended",
      approvalOn: ["pkg.install"],
      standingAllowOn: ["pkg.install"],
    });
    assert.ok(
      !diagnostics.some(
        (d) => d.code === "UNATTENDED_APPROVAL_WITHOUT_STANDING_ALLOW",
      ),
    );
  });

  it("skips unattended standing-allow warn in operator-present mode", () => {
    const { diagnostics } = mergeConfigWithDiagnostics({
      dispositionMode: "operator-present",
      standingAllowOn: [],
    });
    assert.ok(
      !diagnostics.some(
        (d) => d.code === "UNATTENDED_APPROVAL_WITHOUT_STANDING_ALLOW",
      ),
    );
  });
});

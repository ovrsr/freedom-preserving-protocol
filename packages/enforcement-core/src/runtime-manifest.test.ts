import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeClassifierRulesetHash,
  computeEffectiveConfigHash,
  computePackageBuildHash,
  buildRuntimeManifest,
  type RuntimeManifest,
} from "./runtime-manifest.js";
import { DEFAULT_CONFIG, type FppPluginConfig } from "./config.js";

describe("runtime manifest binding", () => {
  it("produces a stable classifier ruleset hash", () => {
    const a = computeClassifierRulesetHash();
    const b = computeClassifierRulesetHash();
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{64}$/);
  });

  it("changes effective config hash when policy lists change", () => {
    const base = computeEffectiveConfigHash(DEFAULT_CONFIG);
    const changed: FppPluginConfig = {
      ...DEFAULT_CONFIG,
      blockOn: [...DEFAULT_CONFIG.blockOn, "fs.write.protected"],
    };
    const next = computeEffectiveConfigHash(changed);
    assert.notEqual(base, next);
  });

  it("excludes secrets and machine-specific paths from config hash", () => {
    const a = computeEffectiveConfigHash({
      ...DEFAULT_CONFIG,
      auditLogPath: "C:\\Users\\alice\\.openclaw\\audit.jsonl",
      identityKeyPath: "/home/alice/.openclaw/id.key",
      receiptLogPath: "/var/tmp/receipts.jsonl",
      strictModeStatePath: "D:/secrets/strict.json",
    });
    const b = computeEffectiveConfigHash({
      ...DEFAULT_CONFIG,
      auditLogPath: "/completely/different/path.jsonl",
      identityKeyPath: "Z:/other/id.key",
      receiptLogPath: "E:/else/receipts.jsonl",
      strictModeStatePath: "/tmp/strict.json",
    });
    assert.equal(a, b);
  });

  it("binds package build and constitution into the runtime manifest", () => {
    const manifest = buildRuntimeManifest({
      config: DEFAULT_CONFIG,
      constitutionHash: DEFAULT_CONFIG.constitutionHash,
      degraded: false,
    });
    assert.equal(manifest.schemaVersion, 1);
    assert.match(manifest.classifierRulesetHash, /^[0-9a-f]{64}$/);
    assert.match(manifest.effectiveConfigHash, /^[0-9a-f]{64}$/);
    assert.match(manifest.packageBuildHash, /^[0-9a-f]{64}$/);
    assert.equal(manifest.constitutionHash, DEFAULT_CONFIG.constitutionHash);
    assert.ok(manifest.implementationVersion.length > 0);
    assert.ok(manifest.pluginApiCompat.length > 0);
    assert.equal(manifest.runtimeState, "ok");
  });

  it("records degraded runtime state explicitly", () => {
    const manifest = buildRuntimeManifest({
      config: DEFAULT_CONFIG,
      constitutionHash: DEFAULT_CONFIG.constitutionHash,
      degraded: true,
      degradedReason: "strict-mode-malformed",
    });
    assert.equal(manifest.runtimeState, "degraded");
    assert.equal(manifest.degradedReason, "strict-mode-malformed");
  });

  it("changes package build hash when version vector changes", () => {
    const a = computePackageBuildHash({
      name: "@ovrsr/openclaw-fpp-plugin",
      version: "1.1.4",
      pluginApi: ">=2026.3.28",
    });
    const b = computePackageBuildHash({
      name: "@ovrsr/openclaw-fpp-plugin",
      version: "1.1.5",
      pluginApi: ">=2026.3.28",
    });
    assert.notEqual(a, b);
  });

  it("policyId combines constitution and executable policy hashes", () => {
    const m: RuntimeManifest = buildRuntimeManifest({
      config: DEFAULT_CONFIG,
      constitutionHash: DEFAULT_CONFIG.constitutionHash,
      degraded: false,
    });
    assert.ok(m.policyId.includes(m.classifierRulesetHash.slice(0, 8)));
    assert.ok(m.policyVersion.length > 0);
  });
});

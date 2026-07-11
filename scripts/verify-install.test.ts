/**
 * Tests for scripts/verify-install.ts — layered install reporting with
 * injected root directories, log paths, and plugin listers.
 *
 * Uses temporary directories and injects a fake pluginLister so the tests
 * never invoke the real `openclaw` binary or touch ~/.openclaw.
 */
import { describe, it, after, before } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import {
  runVerifyInstall,
  createOpenClawRuntimeProbe,
  type PluginListResult,
  type RuntimeProbe,
} from "./verify-install.ts";
import { appendAuditEntry } from "./audit-append.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL_ROOT = resolve(__dirname, "..");

const unavailableLister = (): PluginListResult => ({ available: false });
const bothInstalledLister = (): PluginListResult => ({
  available: true,
  stdout: JSON.stringify([
    "@ovrsr/openclaw-fpp-plugin",
    "@ovrsr/openclaw-fpp-trust",
  ]),
});

describe("verify-install runVerifyInstall", () => {
  let workdir: string;

  before(() => {
    workdir = mkdtempSync(join(tmpdir(), "fpp-verify-install-"));
  });

  after(() => {
    if (workdir && existsSync(workdir)) rmSync(workdir, { recursive: true, force: true });
  });

  it("reports pass on the real repo constitution when no soul/memory are provided", () => {
    const report = runVerifyInstall({
      log: join(workdir, "does-not-exist.jsonl"),
      pluginLister: unavailableLister,
    });
    const byId = new Map(report.checks.map((c) => [c.id, c]));
    assert.equal(byId.get("constitution.hash")?.status, "pass");
    assert.equal(byId.get("constitution.signature")?.status, "pass");
    assert.equal(byId.get("soul.marker")?.status, "skip");
    assert.equal(byId.get("memory.marker")?.status, "skip");
    assert.equal(byId.get("audit.chain")?.status, "skip");
    assert.equal(byId.get("plugin.enforcement.installed")?.status, "warn");
    assert.equal(byId.get("plugin.trust.installed")?.status, "warn");
    assert.equal(report.ok, true, "required checks pass with no soul/memory demanded");
    assert.equal(report.summary.promptLayerActive, false);
    assert.equal(report.summary.dispatcherLayerActive, false);
    assert.equal(report.summary.trustLayerActive, false);
  });

  it("reports fail for a SOUL file that lacks the adoption marker", () => {
    const soul = join(workdir, "SOUL-no-marker.md");
    writeFileSync(soul, "# just a diary\n");
    const report = runVerifyInstall({
      log: join(workdir, "no-log.jsonl"),
      soul,
      pluginLister: unavailableLister,
    });
    const soulCheck = report.checks.find((c) => c.id === "soul.marker");
    assert.equal(soulCheck?.status, "fail");
    assert.equal(report.ok, false, "required soul.marker check failed");
  });

  it("reports pass for a SOUL file that contains the adoption marker", () => {
    const soul = join(workdir, "SOUL-with-marker.md");
    writeFileSync(soul, "# preface\n\nFreedom Preserving Protocol\n");
    const report = runVerifyInstall({
      log: join(workdir, "no-log.jsonl"),
      soul,
      pluginLister: unavailableLister,
    });
    const soulCheck = report.checks.find((c) => c.id === "soul.marker");
    assert.equal(soulCheck?.status, "pass");
    assert.equal(report.ok, true);
    assert.equal(report.summary.promptLayerActive, true);
  });

  it("reports fail when the injected root has the wrong constitution hash", () => {
    const badRoot = mkdtempSync(join(tmpdir(), "fpp-verify-badroot-"));
    try {
      writeFileSync(join(badRoot, "constitution.json"), "{\"laws\":[]}");
      writeFileSync(join(badRoot, "signature.ed25519.txt"), "00");
      writeFileSync(join(badRoot, "pubkey.ed25519.txt"), "00");
      const report = runVerifyInstall({
        rootDir: badRoot,
        log: join(workdir, "unused.jsonl"),
        pluginLister: unavailableLister,
      });
      const hashCheck = report.checks.find((c) => c.id === "constitution.hash");
      const sigCheck = report.checks.find((c) => c.id === "constitution.signature");
      assert.equal(hashCheck?.status, "fail");
      assert.equal(sigCheck?.status, "fail");
      assert.equal(report.ok, false);
    } finally {
      rmSync(badRoot, { recursive: true, force: true });
    }
  });

  it("reports pass on the audit chain when a valid log is provided", () => {
    const log = join(workdir, "audit-ok.jsonl");
    appendAuditEntry({ log, kind: "heartbeat", notes: "test" });
    const report = runVerifyInstall({
      log,
      pluginLister: unavailableLister,
    });
    const chain = report.checks.find((c) => c.id === "audit.chain");
    assert.equal(chain?.status, "pass");
  });

  it("reports fail on the audit chain when tampered", () => {
    const log = join(workdir, "audit-tampered.jsonl");
    appendAuditEntry({ log, kind: "heartbeat", notes: "one" });
    appendAuditEntry({ log, kind: "heartbeat", notes: "two" });
    writeFileSync(log, "not json\n");

    const report = runVerifyInstall({
      log,
      pluginLister: unavailableLister,
    });
    const chain = report.checks.find((c) => c.id === "audit.chain");
    assert.equal(chain?.status, "fail");
  });

  it("marks plugins as pass when the injected lister reports them installed", () => {
    const report = runVerifyInstall({
      rootDir: REAL_ROOT,
      log: join(workdir, "no-log.jsonl"),
      pluginLister: bothInstalledLister,
    });
    const enf = report.checks.find((c) => c.id === "plugin.enforcement.installed");
    const trust = report.checks.find((c) => c.id === "plugin.trust.installed");
    assert.equal(enf?.status, "pass");
    assert.equal(trust?.status, "pass");
    assert.equal(report.summary.dispatcherLayerActive, true);
    assert.equal(report.summary.trustLayerActive, true);
  });

  it("marks plugins as warn when the injected lister reports the CLI is unavailable", () => {
    const report = runVerifyInstall({
      rootDir: REAL_ROOT,
      log: join(workdir, "no-log.jsonl"),
      pluginLister: unavailableLister,
    });
    const enf = report.checks.find((c) => c.id === "plugin.enforcement.installed");
    const trust = report.checks.find((c) => c.id === "plugin.trust.installed");
    assert.equal(enf?.status, "warn");
    assert.equal(trust?.status, "warn");
  });

  it("warns on unsafe enforcement config without acknowledgement", () => {
    const report = runVerifyInstall({
      rootDir: REAL_ROOT,
      log: join(workdir, "no-log.jsonl"),
      pluginLister: unavailableLister,
      enforcementConfig: {
        approvalTimeoutBehavior: "allow",
        blockOn: ["gateway.restart"],
      },
    });
    const timeout = report.checks.find((c) => c.id === "config.enforcement.timeout");
    const block = report.checks.find((c) => c.id === "config.enforcement.blockOn");
    assert.equal(timeout?.status, "fail");
    assert.equal(block?.status, "fail");
    assert.match(timeout?.detail ?? "", /acknowledgeDangerousOverrides/);
  });

  it("passes unsafe enforcement config when acknowledgement is present", () => {
    const report = runVerifyInstall({
      rootDir: REAL_ROOT,
      log: join(workdir, "no-log.jsonl"),
      pluginLister: unavailableLister,
      enforcementConfig: {
        approvalTimeoutBehavior: "allow",
        blockOn: ["gateway.restart"],
        acknowledgeDangerousOverrides: true,
      },
    });
    const timeout = report.checks.find((c) => c.id === "config.enforcement.timeout");
    const block = report.checks.find((c) => c.id === "config.enforcement.blockOn");
    assert.equal(timeout?.status, "warn");
    assert.equal(block?.status, "warn");
  });

  it("warns on legacy-unsafe trust config without acknowledgement", () => {
    const report = runVerifyInstall({
      rootDir: REAL_ROOT,
      log: join(workdir, "no-log.jsonl"),
      pluginLister: unavailableLister,
      trustConfig: {
        verificationPolicy: "legacy-unsafe",
      },
    });
    const legacy = report.checks.find((c) => c.id === "config.trust.legacy");
    assert.equal(legacy?.status, "fail");
    assert.match(legacy?.detail ?? "", /acknowledgeDangerousOverrides|legacy-unsafe/);
  });

  it("accepts injected RuntimeProbe results and surfaces them in the report", () => {
    const fakeProbe: RuntimeProbe = {
      harnessId: "fake-harness",
      probe: () => "active",
    };
    const report = runVerifyInstall({
      rootDir: REAL_ROOT,
      log: join(workdir, "no-log.jsonl"),
      pluginLister: unavailableLister,
      probes: [fakeProbe],
    });
    const probeCheck = report.checks.find(
      (c) => c.id === "runtime.probe.fake-harness",
    );
    assert.equal(probeCheck?.status, "pass");
    assert.match(probeCheck?.detail ?? "", /active/i);
    assert.ok(report.probes?.some((p) => p.harnessId === "fake-harness"));
    assert.equal(
      report.probes?.find((p) => p.harnessId === "fake-harness")?.status,
      "active",
    );
  });

  it("OpenClaw probe reports active when CLI lists enforcement plugin", () => {
    const probe = createOpenClawRuntimeProbe(bothInstalledLister);
    assert.equal(probe.harnessId, "openclaw");
    assert.equal(probe.probe(), "active");
  });

  it("OpenClaw probe reports unknown when CLI is unavailable", () => {
    const probe = createOpenClawRuntimeProbe(unavailableLister);
    assert.equal(probe.probe(), "unknown");
  });

  it("generic profile without OpenClaw CLI reports probes honestly (not OpenClaw-only failure)", () => {
    const report = runVerifyInstall({
      rootDir: REAL_ROOT,
      log: join(workdir, "no-log.jsonl"),
      profile: "generic",
      pluginLister: unavailableLister,
    });
    const openclawProbe = report.checks.find(
      (c) => c.id === "runtime.probe.openclaw",
    );
    assert.ok(openclawProbe, "expected openclaw runtime probe check");
    assert.equal(openclawProbe.status, "warn");
    assert.match(openclawProbe.detail, /unknown|inactive/i);
    assert.doesNotMatch(
      openclawProbe.detail,
      /cannot check plugin installation/i,
    );
    assert.equal(report.summary.dispatcherLayerActive, false);
    assert.equal(report.summary.trustLayerActive, false);
    assert.ok(report.probes?.some((p) => p.harnessId === "openclaw"));
    assert.equal(
      report.probes?.find((p) => p.harnessId === "openclaw")?.status,
      "unknown",
    );
  });

  it("cursor profile probe reports active when adapter package is present", () => {
    const report = runVerifyInstall({
      rootDir: REAL_ROOT,
      log: join(workdir, "no-log.jsonl"),
      profile: "cursor",
      pluginLister: unavailableLister,
    });
    const cursorProbe = report.checks.find(
      (c) => c.id === "runtime.probe.cursor",
    );
    assert.ok(cursorProbe);
    assert.equal(cursorProbe.status, "pass");
    assert.equal(
      report.probes?.find((p) => p.harnessId === "cursor")?.status,
      "active",
    );
    assert.equal(report.summary.dispatcherLayerActive, true);
    // Must not claim OpenClaw plugin pass just because cursor adapter is active
    assert.equal(
      report.checks.find((c) => c.id === "plugin.enforcement.installed"),
      undefined,
    );
  });

  it("unknown profile warns and does not false-PASS dispatcher", () => {
    const report = runVerifyInstall({
      rootDir: REAL_ROOT,
      log: join(workdir, "no-log.jsonl"),
      profile: "totally-unknown-harness",
      pluginLister: unavailableLister,
    });
    const unknownProbe = report.checks.find(
      (c) => c.id === "runtime.probe.totally-unknown-harness",
    );
    assert.ok(unknownProbe);
    assert.equal(unknownProbe.status, "warn");
    assert.match(unknownProbe.detail, /unknown/i);
    assert.equal(report.summary.dispatcherLayerActive, false);
  });

  it("claude-code and codex profiles select their adapter probes", () => {
    for (const profile of ["claude-code", "codex"] as const) {
      const report = runVerifyInstall({
        rootDir: REAL_ROOT,
        log: join(workdir, "no-log.jsonl"),
        profile,
        pluginLister: unavailableLister,
      });
      const probe = report.probes?.find((p) => p.harnessId === profile);
      assert.ok(probe, `expected probe for ${profile}`);
      assert.equal(probe.status, "active");
      assert.equal(report.summary.dispatcherLayerActive, true);
    }
  });
});

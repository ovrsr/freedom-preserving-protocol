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
  type PluginListResult,
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
});

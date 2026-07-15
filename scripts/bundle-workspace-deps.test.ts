/**
 * Tests for staging workspace packages into a consumer's local node_modules
 * so npm pack embeds them via bundledDependencies.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "scripts", "bundle-workspace-deps.ts");

function writeConsumer(
  dir: string,
  opts: {
    deps: Record<string, string>;
    bundled?: string[];
  },
): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name: "test-consumer",
        version: "0.0.0",
        private: true,
        dependencies: opts.deps,
        bundledDependencies: opts.bundled ?? Object.keys(opts.deps),
      },
      null,
      2,
    ),
  );
}

describe("bundle-workspace-deps", () => {
  const tmp = mkdtempSync(join(tmpdir(), "fpp-bundle-"));

  after(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("exports bundleWorkspaceDeps and isExactVersion", async () => {
    const mod = await import("./bundle-workspace-deps.js");
    assert.equal(typeof mod.bundleWorkspaceDeps, "function");
    assert.equal(typeof mod.isExactVersion, "function");
  });

  it("isExactVersion accepts plain semver and rejects ranges", async () => {
    const { isExactVersion } = await import("./bundle-workspace-deps.js");
    assert.equal(isExactVersion("1.0.0"), true);
    assert.equal(isExactVersion("0.1.0"), true);
    assert.equal(isExactVersion("^1.0.0"), false);
    assert.equal(isExactVersion("~1.0.0"), false);
    assert.equal(isExactVersion("*"), false);
    assert.equal(isExactVersion(">=1.0.0"), false);
  });

  it("stages declared packages into consumer/node_modules/@ovrsr/...", async () => {
    const consumer = join(tmp, "stage-ok");
    writeConsumer(consumer, {
      deps: { "@ovrsr/fpp-protocol-core": "1.0.0" },
      bundled: ["@ovrsr/fpp-protocol-core"],
    });

    const { bundleWorkspaceDeps } = await import("./bundle-workspace-deps.js");
    await bundleWorkspaceDeps({
      repoRoot: root,
      packageDir: consumer,
    });

    const staged = join(
      consumer,
      "node_modules",
      "@ovrsr",
      "fpp-protocol-core",
      "package.json",
    );
    assert.ok(existsSync(staged), `expected staged package at ${staged}`);
    const pkg = JSON.parse(readFileSync(staged, "utf8")) as { version: string; name: string };
    assert.equal(pkg.name, "@ovrsr/fpp-protocol-core");
    assert.equal(pkg.version, "1.0.0");
  });

  it("refuses version mismatch vs consumer dependencies pin", async () => {
    const consumer = join(tmp, "mismatch");
    writeConsumer(consumer, {
      deps: { "@ovrsr/fpp-protocol-core": "9.9.9" },
      bundled: ["@ovrsr/fpp-protocol-core"],
    });

    const { bundleWorkspaceDeps } = await import("./bundle-workspace-deps.js");
    await assert.rejects(
      () =>
        bundleWorkspaceDeps({
          repoRoot: root,
          packageDir: consumer,
        }),
      /mismatch|version/i,
    );
  });

  it("refuses missing workspace package", async () => {
    const consumer = join(tmp, "missing");
    writeConsumer(consumer, {
      deps: { "@ovrsr/fpp-does-not-exist": "1.0.0" },
      bundled: ["@ovrsr/fpp-does-not-exist"],
    });

    const { bundleWorkspaceDeps } = await import("./bundle-workspace-deps.js");
    await assert.rejects(
      () =>
        bundleWorkspaceDeps({
          repoRoot: root,
          packageDir: consumer,
        }),
      /not found|missing|unknown/i,
    );
  });

  it("refuses range pins in consumer dependencies", async () => {
    const consumer = join(tmp, "range");
    writeConsumer(consumer, {
      deps: { "@ovrsr/fpp-protocol-core": "^1.0.0" },
      bundled: ["@ovrsr/fpp-protocol-core"],
    });

    const { bundleWorkspaceDeps } = await import("./bundle-workspace-deps.js");
    await assert.rejects(
      () =>
        bundleWorkspaceDeps({
          repoRoot: root,
          packageDir: consumer,
        }),
      /exact|range|\^|~/i,
    );
  });

  it("CLI --package plugin reads bundledDependencies when present", () => {
    // Contract: CLI entry exists and missing package fails clearly.
    // Full plugin wiring is Task 2; here we only require the script to parse --package.
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", script, "--package", "does-not-exist-pkg"],
      { cwd: root, encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
    const out = `${result.stdout ?? ""}\n${result.stderr ?? ""}\n${result.error ?? ""}`;
    assert.match(out, /not found|missing|package/i);
  });
});

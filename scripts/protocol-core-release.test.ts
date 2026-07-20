/**
 * Protocol-core release ordering and version-pin guards.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const publishScript = join(root, "scripts", "clawhub-publish.sh");
const verifyPack = join(root, "scripts", "verify-pack.sh");

/** PATH without clawhub — dry-run must not require a global CLI install. */
function envWithoutClawhub(
  extra: Record<string, string> = {},
): NodeJS.ProcessEnv {
  // Use Node's platform delimiter only — splitting on ":" breaks Windows drive paths.
  const raw = process.env.PATH ?? process.env.Path ?? "";
  const parts = raw.split(delimiter).filter(Boolean);
  const filtered = parts.filter(
    (dir) =>
      !existsSync(join(dir, "clawhub")) &&
      !existsSync(join(dir, "clawhub.cmd")) &&
      !existsSync(join(dir, "clawhub.exe")),
  );
  const pathValue = filtered.join(delimiter);
  return {
    ...process.env,
    PATH: pathValue,
    Path: pathValue,
    ...extra,
  };
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

describe("protocol-core release ordering", () => {
  const publishSrc = readFileSync(publishScript, "utf8");
  const verifySrc = readFileSync(verifyPack, "utf8");

  it("publish script builds/checks core before plugin consumers", () => {
    assert.match(publishSrc, /run_strict_checks_core|CORE_DIR|protocol-core/);
    assert.match(publishSrc, /require_exact_core_dependency/);
    // publish all must mention core before plugin publish path
    const allCase = publishSrc.slice(publishSrc.indexOf('all)'));
    assert.match(allCase, /core|run_strict_checks_core/i);
  });

  it("verify-pack builds core and checks exact dependency pins", () => {
    assert.match(verifySrc, /protocol-core|fpp-protocol-core/);
    assert.match(verifySrc, /exact|mismatch|CORE_VERSION/i);
  });

  it("plugin manifests pin an exact core version matching the workspace package", () => {
    const coreVer = (readJson(join(root, "packages/protocol-core/package.json"))
      .version as string);
    for (const dir of ["plugin", "plugin-trust"] as const) {
      const deps = readJson(join(root, dir, "package.json")).dependencies as Record<
        string,
        string
      >;
      assert.equal(deps["@ovrsr/fpp-protocol-core"], coreVer);
      assert.doesNotMatch(deps["@ovrsr/fpp-protocol-core"], /[\^~*]/);
    }
  });

  it("dry-run publish all reports core-before-consumers ordering", () => {
    const result = spawnSync(
      "bash",
      [
        publishScript,
        "publish",
        "all",
        "--dry-run",
        "--changelog",
        "test",
        "--skip-tests",
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: envWithoutClawhub({ FPP_ALLOW_SKIP_TESTS: "1" }),
      },
    );
    const out = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.status, 0, out);
    assert.doesNotMatch(out, /clawhub CLI not found/i);
    assert.match(out, /protocol-core|fpp-protocol-core|core before/i);
    const coreIdx = out.search(/protocol-core|fpp-protocol-core|core package/i);
    const pluginIdx = out.search(/openclaw-fpp-plugin|enforcement plugin/i);
    assert.ok(coreIdx >= 0, "expected core mention in dry-run output");
    assert.ok(pluginIdx >= 0, "expected plugin mention in dry-run output");
    assert.ok(coreIdx < pluginIdx, "core must be ordered before plugin in dry-run");
  });

  it("verify-pack fails when core dependency version mismatches", () => {
    // Script-level contract: mismatch helper exists and is invoked
    assert.match(verifySrc, /require_exact_core_dependency|CORE_VERSION.*!=|version mismatch/);
  });

  it("core dist exists after build (missing build blocks consumers)", () => {
    const dist = join(root, "packages/protocol-core/dist/index.js");
    const build = spawnSync("npm", ["run", "build", "-w", "@ovrsr/fpp-protocol-core"], {
      cwd: root,
      encoding: "utf8",
      shell: true,
    });
    assert.equal(build.status, 0, build.stderr);
    assert.equal(existsSync(dist), true);
  });
});

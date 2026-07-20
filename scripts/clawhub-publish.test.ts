/**
 * Publish-path fail-hard tests.
 * Asserts clawhub-publish.sh no longer soft-fails enforcement tests
 * and always runs trust tests; dry-runs never hit the registry.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const publishScript = join(root, "scripts", "clawhub-publish.sh");

/** PATH without clawhub, so dry-run cannot accidentally depend on a global install. */
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

describe("clawhub-publish fail-hard", () => {
  const src = readFileSync(publishScript, "utf8");

  it("does not soft-fail enforcement plugin tests", () => {
    assert.equal(
      /npm test\)\s*\|\|\s*yellow/.test(src),
      false,
      "enforcement npm test must not be soft-failed with || yellow",
    );
    assert.match(
      src,
      /PLUGIN_DIR.*\n(?:.*\n){0,20}.*npm (?:run )?test/m,
    );
  });

  it("runs trust plugin tests before publish", () => {
    assert.match(src, /run_strict_checks_trust/);
    assert.match(src, /publish_trust[\s\S]*run_strict_checks_trust/);
    const checks = src.slice(src.indexOf("run_strict_checks_trust()"));
    const end = checks.indexOf("\n# ── Version bump");
    const body = end === -1 ? checks.slice(0, 800) : checks.slice(0, end);
    assert.match(body, /npm (?:run )?test/);
    assert.match(body, /npm run typecheck|npm run build/);
  });

  it("marks --skip-tests as unsafe/maintainer-only in usage", () => {
    assert.match(src, /skip-tests.*unsafe|UNSAFE|--skip-tests.*maintainer/i);
    assert.match(src, /FPP_ALLOW_SKIP_TESTS/);
  });

  it("refuses --skip-tests without FPP_ALLOW_SKIP_TESTS=1", () => {
    const env = { ...process.env };
    delete env.FPP_ALLOW_SKIP_TESTS;
    const result = spawnSync(
      "bash",
      [
        publishScript,
        "publish",
        "skill",
        "--dry-run",
        "--changelog",
        "test",
        "--skip-tests",
      ],
      { cwd: root, encoding: "utf8", env },
    );
    const out = `${result.stdout}\n${result.stderr}`;
    assert.notEqual(result.status, 0, out);
    assert.match(out, /FPP_ALLOW_SKIP_TESTS/i);
  });

  it("dry-run publish skill stages skill-dist and does not invoke clawhub", () => {
    const result = spawnSync(
      "bash",
      [
        publishScript,
        "publish",
        "skill",
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
    assert.match(out, /\[dry-run\]/);
    assert.match(out, /skill-dist|stage-skill/i);
    assert.match(out, /--name ["']?Freedom Preserving Protocol["']?/);
    assert.doesNotMatch(out, /published$/m);
    assert.doesNotMatch(out, /clawhub CLI not found/i);
  });

  it("dry-run publish plugin and trust do not invoke clawhub", () => {
    for (const target of ["plugin", "trust"] as const) {
      const result = spawnSync(
        "bash",
        [
          publishScript,
          "publish",
          target,
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
      assert.equal(result.status, 0, `${target}: ${out}`);
      assert.match(out, /\[dry-run\]/);
      assert.doesNotMatch(out, /clawhub CLI not found/i);
    }
  });

  it("windows pack path extracts .tgz filename from multiline npm pack output", () => {
    // bundle:deps used to print "Staged …" on stdout during prepack; raw
    // capture of `npm pack --silent` then failed -f checks. Must grep .tgz.
    assert.match(src, /grep.*\\.tgz\$|grep '\.tgz\$'/);
    assert.match(src, /tail -1/);
    assert.match(src, /needs_tarball_publish[\s\S]*npm pack --silent/);
  });
});

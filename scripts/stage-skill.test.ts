/**
 * Tests for OpenClaw-only skill staging (allowlist → skill-dist).
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, dirname, relative } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const FORBIDDEN_PREFIXES = [
  "adapters/",
  "plugin/",
  "plugin-trust/",
  "packages/",
  "test/",
  "assurance-artifacts/",
  "docs/plans/",
  "MASTER_CONTEXT.md",
  "scripts/clawhub-publish.sh",
  "scripts/package-reproducibility.ts",
  "scripts/rfc-citation-check.ts",
  "scripts/bundle-workspace-deps.ts",
];

function walkRelative(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(base, full).replace(/\\/g, "/");
    if (statSync(full).isDirectory()) {
      out.push(...walkRelative(full, base));
    } else {
      out.push(rel);
    }
  }
  return out;
}

describe("stage-skill", () => {
  const tmp = mkdtempSync(join(tmpdir(), "fpp-stage-skill-"));

  after(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("exports stageSkill and reads ALLOWLIST", async () => {
    const mod = await import("./stage-skill.js");
    assert.equal(typeof mod.stageSkill, "function");
    assert.equal(typeof mod.readAllowlist, "function");
    assert.equal(typeof mod.assertNoForbiddenPaths, "function");
  });

  it("stages required OpenClaw skill files and never includes forbidden paths", async () => {
    const { stageSkill, assertNoForbiddenPaths } = await import(
      "./stage-skill.js"
    );
    const outDir = join(tmp, "skill-dist");
    const result = stageSkill({ repoRoot: root, outDir });

    assert.equal(result.outDir, outDir);
    assert.ok(existsSync(join(outDir, "SKILL.md")));
    assert.ok(existsSync(join(outDir, "constitution.json")));
    assert.ok(existsSync(join(outDir, "constitution.yaml")));
    assert.ok(existsSync(join(outDir, "pubkey.ed25519.txt")));
    assert.ok(existsSync(join(outDir, "signature.ed25519.txt")));
    assert.ok(existsSync(join(outDir, "adoption", "SOUL-BLOCK.md")));
    assert.ok(existsSync(join(outDir, "hooks", "pre-action-check", "SKILL.md")));
    assert.ok(
      existsSync(join(outDir, "hooks", "constitution-audit", "SKILL.md")),
    );
    assert.ok(existsSync(join(outDir, ".skill-stage.json")));

    const staged = walkRelative(outDir);
    assertNoForbiddenPaths(staged);

    for (const prefix of FORBIDDEN_PREFIXES) {
      assert.equal(
        staged.some(
          (p) =>
            p === prefix.replace(/\/$/, "") ||
            p.startsWith(prefix) ||
            p === prefix,
        ),
        false,
        `forbidden path must not be staged: ${prefix}`,
      );
    }

    const stamp = JSON.parse(
      readFileSync(join(outDir, ".skill-stage.json"), "utf8"),
    ) as { files: string[]; generatedAt: string };
    assert.ok(Array.isArray(stamp.files));
    assert.ok(stamp.files.length > 0);
    assert.ok(typeof stamp.generatedAt === "string");
  });

  it("stages OpenClaw-only package.json and README without workspaces or adapter hooks", async () => {
    const { stageSkill } = await import("./stage-skill.js");
    const outDir = join(tmp, "skill-dist-manifest");
    stageSkill({ repoRoot: root, outDir });

    assert.ok(existsSync(join(outDir, "package.json")));
    assert.ok(existsSync(join(outDir, "README.md")));

    const pkg = JSON.parse(readFileSync(join(outDir, "package.json"), "utf8")) as {
      workspaces?: unknown;
      engines?: { node?: string };
      scripts?: Record<string, string>;
    };
    assert.equal(pkg.workspaces, undefined);
    assert.ok(pkg.engines?.node);
    const pkgText = readFileSync(join(outDir, "package.json"), "utf8");
    assert.doesNotMatch(pkgText, /adapters\//);

    const readme = readFileSync(join(outDir, "README.md"), "utf8");
    assert.match(readme, /clawhub:ovrsr\/openclaw-fpp-plugin/);
    assert.doesNotMatch(
      readme,
      /settings\.fragment\.json|merge.*claude-code.*hooks/i,
    );
  });

  it("assertNoForbiddenPaths throws when adapters are present", async () => {
    const { assertNoForbiddenPaths } = await import("./stage-skill.js");
    assert.throws(
      () => assertNoForbiddenPaths(["SKILL.md", "adapters/cursor/hooks.json"]),
      /forbidden|adapters/i,
    );
  });
});

/**
 * Ownership-aware in-place updater safety tests.
 *
 * Uses FPP_UPDATE_TEST_STAGE to inject a pre-staged skill tree so tests never
 * run real package install / npm pack / stage-skill.
 */
import { describe, it, after, before } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const updaterScript = join(root, "scripts", "update-installed-assets.sh");
const MANIFEST_NAME = ".fpp-updater-manifest.json";

type OwnedManifest = {
  version: number;
  files: string[];
};

function writeManifest(dir: string, files: string[]): void {
  const manifest: OwnedManifest = { version: 1, files: [...files].sort() };
  writeFileSync(join(dir, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`);
}

function readManifest(dir: string): OwnedManifest | null {
  const path = join(dir, MANIFEST_NAME);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as OwnedManifest;
}

function seedStage(stageRoot: string): void {
  const skill = join(stageRoot, "skill");
  mkdirSync(skill, { recursive: true });
  writeFileSync(join(skill, "SKILL.md"), "# staged skill v2\n");
  writeFileSync(join(skill, "package.json"), '{"name":"fpp-skill","version":"9.9.9"}\n');
  mkdirSync(join(skill, "hooks"), { recursive: true });
  writeFileSync(join(skill, "hooks", "check.md"), "staged hook\n");
}

function seedTargetWithState(target: string): void {
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "SKILL.md"), "# old skill\n");
  writeFileSync(join(target, "package.json"), '{"name":"fpp-skill","version":"1.0.0"}\n');
  writeFileSync(join(target, "SOUL.md"), "operator soul — do not delete\n");
  writeFileSync(join(target, "MEMORY.md"), "operator memory — do not delete\n");
  mkdirSync(join(target, "state"), { recursive: true });
  writeFileSync(join(target, "state", "audit.jsonl"), '{"kind":"heartbeat"}\n');
  writeFileSync(join(target, "state", "trust-graph.json"), '{"nodes":[]}\n');
  writeFileSync(join(target, "operator-notes.txt"), "unowned local note\n");
  writeFileSync(join(target, "stale-owned.txt"), "was owned previously\n");
}

function runUpdater(opts: {
  stageRoot: string;
  skillDir: string;
  backupRoot: string;
  dryRun?: boolean;
  env?: NodeJS.ProcessEnv;
}): { status: number | null; stdout: string; stderr: string; out: string } {
  const args = [
    updaterScript,
    "--skill-dir",
    opts.skillDir,
    "--backup-root",
    opts.backupRoot,
  ];
  if (opts.dryRun) args.push("--dry-run");

  const result = spawnSync("bash", args, {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      ...opts.env,
      FPP_UPDATE_TEST_STAGE: opts.stageRoot,
      // Force both sync backends across platforms when requested.
      ...(opts.env ?? {}),
    },
  });

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  return {
    status: result.status,
    stdout,
    stderr,
    out: `${stdout}\n${stderr}`,
  };
}

function listBackupDirs(backupRoot: string): string[] {
  if (!existsSync(backupRoot)) return [];
  return readdirSync(backupRoot).filter((name) => {
    const full = join(backupRoot, name);
    return existsSync(join(full, "skill"));
  });
}

describe("update-installed-assets ownership safety", () => {
  let work: string;
  let stageRoot: string;
  let skillDir: string;
  let backupRoot: string;

  before(() => {
    work = mkdtempSync(join(tmpdir(), "fpp-updater-"));
    stageRoot = join(work, "stage");
    skillDir = join(work, "target-skill");
    backupRoot = join(work, "backups");
    seedStage(stageRoot);
  });

  after(() => {
    if (work && existsSync(work)) {
      rmSync(work, { recursive: true, force: true });
    }
  });

  it("preserves SOUL/MEMORY/audit/trust and arbitrary unowned files after update", () => {
    rmSync(skillDir, { recursive: true, force: true });
    seedTargetWithState(skillDir);
    // First update: no prior manifest → additive only; keep stale-owned for this case.
    writeFileSync(join(skillDir, "extra-unowned.md"), "local only\n");

    const result = runUpdater({ stageRoot, skillDir, backupRoot });
    assert.equal(result.status, 0, result.out);

    assert.equal(
      readFileSync(join(skillDir, "SOUL.md"), "utf8"),
      "operator soul — do not delete\n",
    );
    assert.equal(
      readFileSync(join(skillDir, "MEMORY.md"), "utf8"),
      "operator memory — do not delete\n",
    );
    assert.equal(
      readFileSync(join(skillDir, "state", "audit.jsonl"), "utf8"),
      '{"kind":"heartbeat"}\n',
    );
    assert.equal(
      readFileSync(join(skillDir, "state", "trust-graph.json"), "utf8"),
      '{"nodes":[]}\n',
    );
    assert.equal(
      readFileSync(join(skillDir, "operator-notes.txt"), "utf8"),
      "unowned local note\n",
    );
    assert.equal(
      readFileSync(join(skillDir, "extra-unowned.md"), "utf8"),
      "local only\n",
    );
    assert.equal(
      readFileSync(join(skillDir, "SKILL.md"), "utf8"),
      "# staged skill v2\n",
    );
    assert.ok(existsSync(join(skillDir, MANIFEST_NAME)), "ownership manifest written");
  });

  it("removes only stale previously-owned files and keeps a full pre-update backup", () => {
    rmSync(skillDir, { recursive: true, force: true });
    seedTargetWithState(skillDir);
    writeManifest(skillDir, [
      "SKILL.md",
      "package.json",
      "stale-owned.txt",
      "hooks/old-hook.md",
    ]);
    mkdirSync(join(skillDir, "hooks"), { recursive: true });
    writeFileSync(join(skillDir, "hooks", "old-hook.md"), "old owned hook\n");

    const beforeSoul = readFileSync(join(skillDir, "SOUL.md"), "utf8");
    const beforeStale = readFileSync(join(skillDir, "stale-owned.txt"), "utf8");

    const result = runUpdater({ stageRoot, skillDir, backupRoot });
    assert.equal(result.status, 0, result.out);

    assert.equal(existsSync(join(skillDir, "stale-owned.txt")), false);
    assert.equal(existsSync(join(skillDir, "hooks", "old-hook.md")), false);
    assert.equal(existsSync(join(skillDir, "operator-notes.txt")), true);
    assert.equal(readFileSync(join(skillDir, "SOUL.md"), "utf8"), beforeSoul);

    const stamps = listBackupDirs(backupRoot);
    assert.ok(stamps.length >= 1, "expected at least one backup stamp");
    const latest = stamps.sort().at(-1)!;
    const backupSkill = join(backupRoot, latest, "skill");
    assert.ok(existsSync(join(backupSkill, "stale-owned.txt")));
    assert.equal(
      readFileSync(join(backupSkill, "stale-owned.txt"), "utf8"),
      beforeStale,
    );
    assert.ok(existsSync(join(backupSkill, MANIFEST_NAME)));
    assert.ok(existsSync(join(backupSkill, "SOUL.md")));

    const manifest = readManifest(skillDir);
    assert.ok(manifest);
    assert.equal(manifest.version, 1);
    assert.deepEqual(
      [...manifest.files].sort(),
      ["SKILL.md", "hooks/check.md", "package.json"].sort(),
    );
  });

  it("dry-run reports planned owned-file removals without changing target or manifest", () => {
    rmSync(skillDir, { recursive: true, force: true });
    seedTargetWithState(skillDir);
    const priorFiles = [
      "SKILL.md",
      "package.json",
      "stale-owned.txt",
    ];
    writeManifest(skillDir, priorFiles);
    const priorManifest = readFileSync(join(skillDir, MANIFEST_NAME), "utf8");
    const priorSkill = readFileSync(join(skillDir, "SKILL.md"), "utf8");

    const result = runUpdater({
      stageRoot,
      skillDir,
      backupRoot,
      dryRun: true,
    });
    assert.equal(result.status, 0, result.out);
    assert.match(result.out, /stale-owned\.txt/);
    assert.match(result.out, /dry-run|would remove|planned/i);

    assert.equal(readFileSync(join(skillDir, "SKILL.md"), "utf8"), priorSkill);
    assert.equal(readFileSync(join(skillDir, MANIFEST_NAME), "utf8"), priorManifest);
    assert.equal(existsSync(join(skillDir, "stale-owned.txt")), true);
  });

  it("rejects unsafe ownership-manifest paths that escape the target", () => {
    rmSync(skillDir, { recursive: true, force: true });
    seedTargetWithState(skillDir);
    writeManifest(skillDir, ["SKILL.md", "../escape.txt", "package.json"]);

    const result = runUpdater({ stageRoot, skillDir, backupRoot });
    assert.notEqual(result.status, 0, result.out);
    assert.match(result.out, /unsafe|escape|invalid.*manifest|reject/i);
    assert.equal(
      readFileSync(join(skillDir, "SKILL.md"), "utf8"),
      "# old skill\n",
      "failed update must not overwrite target",
    );
  });

  it("preserves unowned files when forced onto the cp fallback path", () => {
    rmSync(skillDir, { recursive: true, force: true });
    seedTargetWithState(skillDir);
    writeFileSync(join(skillDir, "fallback-unowned.txt"), "keep me\n");

    // Hide rsync so the updater uses the non-rsync branch.
    const result = runUpdater({
      stageRoot,
      skillDir,
      backupRoot,
      env: {
        PATH: join(work, "empty-bin") + (process.env.PATH ? `:${process.env.PATH}` : ""),
        FPP_UPDATE_FORCE_CP: "1",
      },
    });
    assert.equal(result.status, 0, result.out);
    assert.equal(
      readFileSync(join(skillDir, "fallback-unowned.txt"), "utf8"),
      "keep me\n",
    );
    assert.equal(
      readFileSync(join(skillDir, "SOUL.md"), "utf8"),
      "operator soul — do not delete\n",
    );
  });
});

describe("update-installed-assets test seam", () => {
  it("documents FPP_UPDATE_TEST_STAGE in the updater script", () => {
    const src = readFileSync(updaterScript, "utf8");
    assert.match(src, /FPP_UPDATE_TEST_STAGE/);
  });
});

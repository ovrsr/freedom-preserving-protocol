/**
 * Portability: staged skill scripts must run without monorepo packages/ or plugin/.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
  cpSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("skill-lib portability", () => {
  const tmp = mkdtempSync(join(tmpdir(), "fpp-skill-portable-"));

  after(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("hashEntryV1 matches @ovrsr/fpp-protocol-core for a golden entry", async () => {
    const skill = await import("./skill-lib/index.js");
    const core = await import("@ovrsr/fpp-protocol-core");
    const entry = {
      previousHash: "0".repeat(64),
      timestamp: "2026-07-15T00:00:00.000Z",
      adoptionIntact: true,
      lawsInvoked: ["law1"],
      actionsReviewed: 1,
      abstentions: 0,
      escalations: 0,
      notes: "",
      kind: "heartbeat",
    };
    assert.equal(skill.hashEntryV1(entry), core.hashEntryV1(entry));
  });

  it("staged skill can append and verify an audit entry without packages/", async () => {
    const { stageSkill } = await import("./stage-skill.js");
    const stageDir = join(tmp, "stage");
    stageSkill({ repoRoot: root, outDir: stageDir });

    assert.equal(existsSync(join(stageDir, "packages")), false);
    assert.equal(existsSync(join(stageDir, "plugin")), false);
    assert.ok(existsSync(join(stageDir, "scripts", "skill-lib", "index.ts")));
    assert.ok(existsSync(join(stageDir, "scripts", "audit-append.ts")));

    // Isolated copy: no sibling monorepo packages/
    const iso = join(tmp, "isolated");
    cpSync(stageDir, iso, { recursive: true });
    // Install only noble + tsx like a ClawHub consumer would
    const install = spawnSync(
      "npm",
      ["install", "--omit=peer", "--ignore-scripts"],
      { cwd: iso, encoding: "utf8", shell: true },
    );
    assert.equal(install.status, 0, install.stderr || install.stdout);

    const logPath = join(iso, "audit-test.jsonl");
    const append = spawnSync(
      "npx",
      [
        "tsx",
        "scripts/audit-append.ts",
        "--log",
        logPath,
        "--kind",
        "heartbeat",
        "--laws",
        "law1",
        "--actions",
        "1",
        "--abstentions",
        "0",
        "--escalations",
        "0",
      ],
      { cwd: iso, encoding: "utf8", shell: true },
    );
    assert.equal(append.status, 0, append.stderr || append.stdout);
    assert.ok(existsSync(logPath));

    const verify = spawnSync(
      "npx",
      ["tsx", "scripts/audit-verify.ts", "--log", logPath],
      { cwd: iso, encoding: "utf8", shell: true },
    );
    assert.equal(verify.status, 0, verify.stderr || verify.stdout);
  });
});

/**
 * Tests for scripts/safe-append.ts — idempotent adoption, backups, dry-run.
 *
 * These tests never touch the real ~/.openclaw or user agent workspaces.
 * All file operations are scoped to a fresh os.tmpdir()-backed directory.
 */
import { describe, it, after, before } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  appendSafely,
  alreadyAdopted,
  fillTemplate,
  backupName,
  ADOPTION_MARKER,
  computeConstitutionHash,
  adoptTargets,
  resolveEnforcementGradeForProfile,
} from "./safe-append.ts";

describe("safe-append", () => {
  let workdir: string;

  before(() => {
    workdir = mkdtempSync(join(tmpdir(), "fpp-safe-append-"));
  });

  after(() => {
    if (workdir && existsSync(workdir)) rmSync(workdir, { recursive: true, force: true });
  });

  it("refuses to run under a real .openclaw path", () => {
    assert.ok(!/[\\/]\.openclaw([\\/]|$)/.test(workdir));
  });

  it("appendSafely creates the target when missing", () => {
    const target = join(workdir, "SOUL-new.md");
    const block = `## ${ADOPTION_MARKER}\nhash=abc\n`;
    const result = appendSafely(target, block, "SOUL ", false);
    assert.equal(result, "created");
    assert.ok(existsSync(target));
    assert.match(readFileSync(target, "utf-8"), new RegExp(ADOPTION_MARKER));
  });

  it("appendSafely appends to an existing file and creates a timestamped backup", () => {
    const target = join(workdir, "SOUL-existing.md");
    writeFileSync(target, "# Preface\n");
    const block = `## ${ADOPTION_MARKER}\nhash=abc\n`;

    const result = appendSafely(target, block, "SOUL ", false);
    assert.equal(result, "appended");

    const content = readFileSync(target, "utf-8");
    assert.ok(content.startsWith("# Preface"));
    assert.ok(content.includes(ADOPTION_MARKER));

    const backups = readdirSync(workdir).filter(
      (f) => f.startsWith("SOUL-existing.md.") && f.endsWith(".bak"),
    );
    assert.equal(backups.length, 1, "expected exactly one .bak file");
    assert.equal(readFileSync(join(workdir, backups[0]!), "utf-8"), "# Preface\n");
  });

  it("appendSafely is idempotent when the adoption marker is already present", () => {
    const target = join(workdir, "SOUL-adopted.md");
    writeFileSync(
      target,
      `# Preface\n\n## ${ADOPTION_MARKER}\nhash=abc\n`,
    );
    const before = readFileSync(target, "utf-8");
    const result = appendSafely(target, "irrelevant block", "SOUL ", false);
    assert.equal(result, "skipped");
    assert.equal(readFileSync(target, "utf-8"), before);

    const backups = readdirSync(workdir).filter(
      (f) => f.startsWith("SOUL-adopted.md.") && f.endsWith(".bak"),
    );
    assert.equal(backups.length, 0, "idempotent skip must not create a backup");
  });

  it("appendSafely --dry-run does not write and reports 'appended'", () => {
    const target = join(workdir, "SOUL-dryrun.md");
    writeFileSync(target, "# Preface\n");
    const before = readFileSync(target, "utf-8");
    const result = appendSafely(target, `## ${ADOPTION_MARKER}\n`, "SOUL ", true);
    assert.equal(result, "appended");
    assert.equal(readFileSync(target, "utf-8"), before);
    const backups = readdirSync(workdir).filter(
      (f) => f.startsWith("SOUL-dryrun.md.") && f.endsWith(".bak"),
    );
    assert.equal(backups.length, 0, "dry-run must not create a backup");
  });

  it("appendSafely --dry-run reports 'created' but does not write when target missing", () => {
    const target = join(workdir, "does-not-exist.md");
    const result = appendSafely(target, `## ${ADOPTION_MARKER}\n`, "SOUL ", true);
    assert.equal(result, "created");
    assert.equal(existsSync(target), false);
  });

  it("alreadyAdopted detects the adoption marker", () => {
    assert.equal(alreadyAdopted(`no marker here`), false);
    assert.equal(
      alreadyAdopted(`something\n## ${ADOPTION_MARKER}\n`),
      true,
    );
  });

  it("fillTemplate substitutes hash and timestamp placeholders", () => {
    const tmpl = `hash: [CONSTITUTION_HASH]\ntime: [TIMESTAMP]\n`;
    const out = fillTemplate(tmpl, "abc123", "2026-01-01T00:00:00Z");
    assert.equal(out, `hash: abc123\ntime: 2026-01-01T00:00:00Z\n`);
  });

  it("backupName is deterministic given an injected clock", () => {
    const name = backupName("/tmp/foo.md", () => "2026-01-02T03:04:05.678Z");
    assert.equal(name, "/tmp/foo.md.2026-01-02T03-04-05-678Z.bak");
  });

  it("computeConstitutionHash reads a supplied root directory", () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), "fpp-safe-hash-"));
    try {
      writeFileSync(join(fakeRoot, "constitution.json"), "{\"laws\":[]}");
      const hash = computeConstitutionHash(fakeRoot);
      assert.match(hash, /^[0-9a-f]{64}$/);
    } finally {
      rmSync(fakeRoot, { recursive: true, force: true });
    }
  });

  it("adopt with --profile cursor writes reviewed then accepted with native-hook grade", () => {
    const root = mkdtempSync(join(tmpdir(), "fpp-adopt-grade-"));
    try {
      writeFileSync(join(root, "constitution.json"), '{"laws":[]}');
      mkdirSync(join(root, "adoption"), { recursive: true });
      writeFileSync(
        join(root, "adoption", "SOUL-BLOCK.md"),
        `## ${ADOPTION_MARKER}\nhash=[CONSTITUTION_HASH]\n`,
      );
      const soul = join(root, "SOUL.md");
      const prev = process.env.FPP_WORKSPACE;
      process.env.FPP_WORKSPACE = join(root, "ws");
      try {
        assert.equal(resolveEnforcementGradeForProfile("cursor"), "native-hook");
        const result = adoptTargets({
          soul,
          rootDir: root,
          profile: "cursor",
        });
        assert.equal(result.adoptionState, "accepted");
        assert.equal(result.enforcementGrade, "native-hook");
        assert.equal(result.peerAdvertisableHint, false);
        const logPath = join(root, "ws", "fpp-adoption-state.jsonl");
        assert.ok(existsSync(logPath));
        const lines = readFileSync(logPath, "utf-8")
          .trim()
          .split("\n")
          .map((l) => JSON.parse(l));
        assert.equal(lines.length, 2);
        assert.equal(lines[0].record.state, "reviewed");
        assert.equal(lines[1].record.state, "accepted");
        assert.equal(lines[1].record.schemaVersion, 2);
        assert.equal(lines[1].record.harnessId, "cursor");
        assert.equal(lines[1].record.enforcementGrade, "native-hook");
      } finally {
        if (prev === undefined) delete process.env.FPP_WORKSPACE;
        else process.env.FPP_WORKSPACE = prev;
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("prompt-only profile sets runtime_degraded and never hints peer-advertisable", () => {
    const root = mkdtempSync(join(tmpdir(), "fpp-adopt-prompt-"));
    try {
      writeFileSync(join(root, "constitution.json"), '{"laws":[]}');
      mkdirSync(join(root, "adoption"), { recursive: true });
      writeFileSync(
        join(root, "adoption", "MEMORY-ENTRY.md"),
        `## ${ADOPTION_MARKER}\nhash=[CONSTITUTION_HASH]\n`,
      );
      const memory = join(root, "MEMORY.md");
      const prev = process.env.FPP_WORKSPACE;
      process.env.FPP_WORKSPACE = join(root, "ws");
      try {
        assert.equal(
          resolveEnforcementGradeForProfile("generic"),
          "prompt-only",
        );
        const result = adoptTargets({
          memory,
          rootDir: root,
          profile: "generic",
        });
        assert.equal(result.enforcementGrade, "prompt-only");
        assert.equal(result.peerAdvertisableHint, false);
        const logPath = join(root, "ws", "fpp-adoption-state.jsonl");
        const last = JSON.parse(
          readFileSync(logPath, "utf-8").trim().split("\n").at(-1)!,
        );
        assert.equal(last.record.enforcementGrade, "prompt-only");
        assert.ok(last.record.overlays.includes("runtime_degraded"));
        // Must not claim active peer advertisability (negation in notes is OK).
        assert.equal(result.peerAdvertisableHint, false);
        assert.match(String(last.record.notes ?? ""), /not peer-advertisable/i);
      } finally {
        if (prev === undefined) delete process.env.FPP_WORKSPACE;
        else process.env.FPP_WORKSPACE = prev;
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

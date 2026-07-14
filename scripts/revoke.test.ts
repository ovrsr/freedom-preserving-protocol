/**
 * Tests for scripts/revoke.ts — symmetric revocation annotation.
 *
 * All file operations are scoped to a fresh os.tmpdir()-backed directory;
 * tests never touch the real ~/.openclaw or user agent workspaces.
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
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  annotateSoul,
  appendMemoryRevocation,
  insertAfterMarker,
  writeMarker,
  revokeAdoption,
  ADOPTION_MARKER,
} from "./revoke.ts";
import { appendAdoptionState } from "./adoption-state.ts";

const FIXED_TS = "2026-07-10T12:00:00.000Z";
const REASON = "user-requested test revocation";

describe("revoke", () => {
  let workdir: string;

  before(() => {
    workdir = mkdtempSync(join(tmpdir(), "fpp-revoke-"));
  });

  after(() => {
    if (workdir && existsSync(workdir)) rmSync(workdir, { recursive: true, force: true });
  });

  it("annotateSoul returns 'skipped-no-file' when the SOUL path does not exist", () => {
    const result = annotateSoul(
      join(workdir, "missing-SOUL.md"),
      REASON,
      FIXED_TS,
      false,
    );
    assert.equal(result.status, "skipped-no-file");
  });

  it("annotateSoul returns 'skipped-no-marker' when the file lacks the adoption marker", () => {
    const target = join(workdir, "SOUL-no-marker.md");
    writeFileSync(target, "# Just a diary\n");
    const result = annotateSoul(target, REASON, FIXED_TS, false);
    assert.equal(result.status, "skipped-no-marker");
    assert.equal(readFileSync(target, "utf-8"), "# Just a diary\n");
  });

  it("annotateSoul inserts a REVOKED tag after the adoption marker and creates a backup", () => {
    const target = join(workdir, "SOUL-adopted.md");
    const original = `# Preface\n\n## ${ADOPTION_MARKER}\nhash=abc\n`;
    writeFileSync(target, original);

    const result = annotateSoul(target, REASON, FIXED_TS, false);
    assert.equal(result.status, "annotated");
    assert.ok(result.backup, "expected a backup path");
    assert.ok(existsSync(result.backup!), "expected a backup file on disk");
    assert.equal(readFileSync(result.backup!, "utf-8"), original);

    const updated = readFileSync(target, "utf-8");
    assert.ok(updated.includes(`[REVOKED ${FIXED_TS}]`));
    assert.ok(updated.includes(REASON));
    assert.ok(updated.includes(ADOPTION_MARKER), "original marker must be preserved");
    assert.ok(updated.includes("hash=abc"), "prior adoption content must be preserved");
  });

  it("annotateSoul is idempotent when the adoption block is already annotated", () => {
    const target = join(workdir, "SOUL-already-revoked.md");
    writeFileSync(
      target,
      `# Preface\n\n## ${ADOPTION_MARKER}\n\n> **[REVOKED 2025-01-01T00:00:00.000Z]** Reason: earlier\n`,
    );
    const before = readFileSync(target, "utf-8");
    const result = annotateSoul(target, REASON, FIXED_TS, false);
    assert.equal(result.status, "skipped-already-revoked");
    assert.equal(readFileSync(target, "utf-8"), before);
  });

  it("annotateSoul --dry-run does not modify the file", () => {
    const target = join(workdir, "SOUL-dryrun.md");
    const original = `# Preface\n\n## ${ADOPTION_MARKER}\nhash=abc\n`;
    writeFileSync(target, original);
    const result = annotateSoul(target, REASON, FIXED_TS, true);
    assert.equal(result.status, "dry-run");
    assert.equal(readFileSync(target, "utf-8"), original);
  });

  it("appendMemoryRevocation creates the file when it does not exist", () => {
    const target = join(workdir, "MEMORY-new.md");
    const result = appendMemoryRevocation(target, REASON, FIXED_TS, false);
    assert.equal(result.status, "created");
    const content = readFileSync(target, "utf-8");
    assert.match(content, /Constitutional Adoption — REVOKED/);
    assert.match(content, new RegExp(`Revoked: ${FIXED_TS}`));
    assert.match(content, new RegExp(REASON));
  });

  it("appendMemoryRevocation appends a revocation block and creates a backup", () => {
    const target = join(workdir, "MEMORY-existing.md");
    const original = "# History\n\n- First entry\n";
    writeFileSync(target, original);
    const result = appendMemoryRevocation(target, REASON, FIXED_TS, false);
    assert.equal(result.status, "appended");
    assert.ok(result.backup);
    assert.ok(existsSync(result.backup!));
    assert.equal(readFileSync(result.backup!, "utf-8"), original);

    const content = readFileSync(target, "utf-8");
    assert.ok(content.startsWith(original), "original content must be preserved");
    assert.match(content, /Constitutional Adoption — REVOKED/);
  });

  it("appendMemoryRevocation --dry-run does not modify the file", () => {
    const target = join(workdir, "MEMORY-dryrun.md");
    const original = "# History\n";
    writeFileSync(target, original);
    const result = appendMemoryRevocation(target, REASON, FIXED_TS, true);
    assert.equal(result.status, "dry-run");
    assert.equal(readFileSync(target, "utf-8"), original);
  });

  it("insertAfterMarker returns the original string when the marker is absent", () => {
    const out = insertAfterMarker("abc\ndef\n", "not-here", "INSERTED");
    assert.equal(out, "abc\ndef\n");
  });

  it("insertAfterMarker inserts after the first newline following the marker", () => {
    const out = insertAfterMarker(
      `line1\n## ${ADOPTION_MARKER}\nrest\n`,
      ADOPTION_MARKER,
      "\nINSERTED",
    );
    assert.equal(out, `line1\n## ${ADOPTION_MARKER}\nINSERTED\nrest\n`);
  });

  it("writeMarker writes .fpp-revoked next to the log path", () => {
    const nested = mkdtempSync(join(workdir, "audit-"));
    const logPath = join(nested, "constitution-audit.jsonl");
    const result = writeMarker(logPath, REASON, FIXED_TS, false);
    assert.equal(result.wrote, true);
    assert.ok(existsSync(result.path));
    const content = readFileSync(result.path, "utf-8");
    assert.match(content, new RegExp(FIXED_TS));
    assert.match(content, new RegExp(REASON));
  });

  it("writeMarker --dry-run does not create the marker", () => {
    const nested = mkdtempSync(join(workdir, "audit-dry-"));
    const logPath = join(nested, "constitution-audit.jsonl");
    const result = writeMarker(logPath, REASON, FIXED_TS, true);
    assert.equal(result.wrote, false);
    assert.equal(existsSync(result.path), false);
  });

  it("annotateSoul + appendMemoryRevocation together produce symmetric annotations", () => {
    const soulPath = join(workdir, "SOUL-symmetric.md");
    const memPath = join(workdir, "MEMORY-symmetric.md");
    writeFileSync(
      soulPath,
      `# Preface\n\n## ${ADOPTION_MARKER}\nhash=abc\n`,
    );
    writeFileSync(memPath, `## ${ADOPTION_MARKER}\n- Adopted: earlier\n`);

    const soulRes = annotateSoul(soulPath, REASON, FIXED_TS, false);
    const memRes = appendMemoryRevocation(memPath, REASON, FIXED_TS, false);

    assert.equal(soulRes.status, "annotated");
    assert.equal(memRes.status, "appended");

    const soul = readFileSync(soulPath, "utf-8");
    const mem = readFileSync(memPath, "utf-8");
    assert.ok(soul.includes(FIXED_TS) && soul.includes(REASON));
    assert.ok(mem.includes(FIXED_TS) && mem.includes(REASON));
  });

  it("revokeAdoption annotates graded ledger and clears active peer acceptance", () => {
    const nested = mkdtempSync(join(workdir, "revoke-grade-"));
    const logPath = join(nested, "constitution-audit.jsonl");
    const adoptionLog = join(nested, "fpp-adoption-state.jsonl");
    appendAdoptionState(adoptionLog, {
      agentId: "local-adopter",
      state: "reviewed",
      constitutionHash: "a".repeat(64),
      harnessId: "cursor",
      enforcementGrade: "native-hook",
      overlays: [],
    });
    appendAdoptionState(adoptionLog, {
      agentId: "local-adopter",
      state: "accepted",
      constitutionHash: "a".repeat(64),
      harnessId: "cursor",
      enforcementGrade: "native-hook",
      overlays: [],
    });

    revokeAdoption({
      log: logPath,
      reason: REASON,
      dryRun: false,
    });

    const history = readFileSync(adoptionLog, "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    assert.ok(history.length >= 3);
    const last = history.at(-1)!;
    assert.equal(last.record.state, "revoked");
    assert.ok(
      String(last.record.notes ?? "").includes("peer") ||
        String(last.record.notes ?? "").includes(REASON),
    );
    assert.ok(history.some((e) => e.record.state === "accepted"));
  });
});

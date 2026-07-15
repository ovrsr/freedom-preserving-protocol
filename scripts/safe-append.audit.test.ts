/**
 * Adopt must initialize constitution-audit.jsonl with kind=adoption.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { adoptTargets, ADOPTION_MARKER } from "./safe-append.ts";
import { verify as verifyAuditChain } from "./audit-verify.ts";

describe("safe-append constitution-audit on adopt", () => {
  const root = mkdtempSync(join(tmpdir(), "fpp-adopt-audit-"));

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("successful adopt creates hash-chained kind=adoption entry", () => {
    writeFileSync(join(root, "constitution.json"), '{"laws":[]}');
    mkdirSync(join(root, "adoption"), { recursive: true });
    writeFileSync(
      join(root, "adoption", "SOUL-BLOCK.md"),
      `## ${ADOPTION_MARKER}\nhash=[CONSTITUTION_HASH]\n`,
    );
    const soul = join(root, "SOUL.md");
    const ws = join(root, "ws");
    const prev = process.env.FPP_WORKSPACE;
    process.env.FPP_WORKSPACE = ws;
    try {
      const result = adoptTargets({ soul, rootDir: root, profile: "openclaw" });
      assert.equal(result.adoptionState, "accepted");

      const auditPath = join(ws, "constitution-audit.jsonl");
      assert.ok(
        existsSync(auditPath),
        `expected constitution-audit at ${auditPath}`,
      );
      const lines = readFileSync(auditPath, "utf-8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));
      assert.ok(lines.some((e) => e.kind === "adoption"));
      const report = verifyAuditChain(auditPath);
      assert.equal(report.ok, true, report.errors.join("; "));
    } finally {
      if (prev === undefined) delete process.env.FPP_WORKSPACE;
      else process.env.FPP_WORKSPACE = prev;
    }
  });

  it("dry-run does not write constitution-audit", () => {
    const dryRoot = mkdtempSync(join(root, "dry-"));
    writeFileSync(join(dryRoot, "constitution.json"), '{"laws":[]}');
    mkdirSync(join(dryRoot, "adoption"), { recursive: true });
    writeFileSync(
      join(dryRoot, "adoption", "SOUL-BLOCK.md"),
      `## ${ADOPTION_MARKER}\nhash=[CONSTITUTION_HASH]\n`,
    );
    const soul = join(dryRoot, "SOUL-dry.md");
    const ws = join(dryRoot, "ws");
    const prev = process.env.FPP_WORKSPACE;
    process.env.FPP_WORKSPACE = ws;
    try {
      adoptTargets({
        soul,
        rootDir: dryRoot,
        profile: "openclaw",
        dryRun: true,
      });
      assert.equal(
        existsSync(join(ws, "constitution-audit.jsonl")),
        false,
      );
    } finally {
      if (prev === undefined) delete process.env.FPP_WORKSPACE;
      else process.env.FPP_WORKSPACE = prev;
    }
  });
});

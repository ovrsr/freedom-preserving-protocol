/**
 * Non-model constitution-audit bootstrap (Q4-B).
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { verify as verifyAuditChain } from "./audit-verify.ts";

const ADOPTION_MARKER = "Freedom Preserving Protocol";

describe("audit-bootstrap", () => {
  const root = mkdtempSync(join(tmpdir(), "fpp-audit-boot-"));

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("creates chain-valid constitution-audit when adopted SOUL present and log missing", async () => {
    const { bootstrapConstitutionAudit } = await import("./audit-bootstrap.js");
    assert.equal(typeof bootstrapConstitutionAudit, "function");

    const ws = join(root, "ws-create");
    const soul = join(root, "SOUL-create.md");
    writeFileSync(
      soul,
      `# Agent\n\n## ${ADOPTION_MARKER}\n- Adopted: 2026-05-01T00:00:00.000Z\n`,
    );
    mkdirSync(ws, { recursive: true });

    const prev = process.env.FPP_WORKSPACE;
    process.env.FPP_WORKSPACE = ws;
    try {
      const result = bootstrapConstitutionAudit({ soul });
      assert.equal(result.created, true);
      assert.ok(result.logPath.includes(ws.replace(/\\/g, "/")) || result.logPath.startsWith(ws));
      assert.ok(existsSync(result.logPath));

      const report = verifyAuditChain(result.logPath);
      assert.equal(report.ok, true, report.errors.join("; "));
      assert.ok(report.entries >= 1);

      const lines = readFileSync(result.logPath, "utf-8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));
      assert.ok(
        lines.some((e) => e.kind === "heartbeat" || e.kind === "adoption"),
      );
    } finally {
      if (prev === undefined) delete process.env.FPP_WORKSPACE;
      else process.env.FPP_WORKSPACE = prev;
    }
  });

  it("second run appends without breaking chain (idempotent create)", async () => {
    const { bootstrapConstitutionAudit } = await import("./audit-bootstrap.js");
    const ws = join(root, "ws-second");
    const soul = join(root, "SOUL-second.md");
    writeFileSync(
      soul,
      `# Agent\n\n## ${ADOPTION_MARKER}\n- Adopted: 2026-05-01T00:00:00.000Z\n`,
    );
    mkdirSync(ws, { recursive: true });

    const prev = process.env.FPP_WORKSPACE;
    process.env.FPP_WORKSPACE = ws;
    try {
      const first = bootstrapConstitutionAudit({ soul });
      assert.equal(first.created, true);
      const second = bootstrapConstitutionAudit({ soul });
      assert.equal(second.created, false);
      assert.equal(second.appended, true);

      const report = verifyAuditChain(second.logPath);
      assert.equal(report.ok, true, report.errors.join("; "));
      assert.ok(report.entries >= 2);
    } finally {
      if (prev === undefined) delete process.env.FPP_WORKSPACE;
      else process.env.FPP_WORKSPACE = prev;
    }
  });

  it("refuses when never adopted", async () => {
    const { bootstrapConstitutionAudit } = await import("./audit-bootstrap.js");
    const ws = join(root, "ws-never");
    const soul = join(root, "SOUL-never.md");
    writeFileSync(soul, "# Agent\n\nNo adoption here.\n");
    mkdirSync(ws, { recursive: true });

    const prev = process.env.FPP_WORKSPACE;
    process.env.FPP_WORKSPACE = ws;
    try {
      assert.throws(
        () => bootstrapConstitutionAudit({ soul }),
        /never adopted|not adopted|adoption/i,
      );
      assert.equal(
        existsSync(join(ws, "constitution-audit.jsonl")),
        false,
      );
    } finally {
      if (prev === undefined) delete process.env.FPP_WORKSPACE;
      else process.env.FPP_WORKSPACE = prev;
    }
  });

  it("refuses when .fpp-revoked marker present", async () => {
    const { bootstrapConstitutionAudit } = await import("./audit-bootstrap.js");
    const ws = join(root, "ws-revoked");
    const soul = join(root, "SOUL-revoked.md");
    writeFileSync(
      soul,
      `# Agent\n\n## ${ADOPTION_MARKER}\n- Adopted: 2026-05-01T00:00:00.000Z\n`,
    );
    mkdirSync(ws, { recursive: true });
    writeFileSync(join(ws, ".fpp-revoked"), "revoked\n");

    const prev = process.env.FPP_WORKSPACE;
    process.env.FPP_WORKSPACE = ws;
    try {
      assert.throws(
        () => bootstrapConstitutionAudit({ soul }),
        /revok/i,
      );
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

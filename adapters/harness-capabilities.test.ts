/**
 * Machine-readable harness capability matrix — required fields per harness.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MATRIX_PATH = join(__dirname, "harness-capabilities.json");

const REQUIRED_HARNESSES = ["openclaw", "cursor", "claude-code", "codex"] as const;
const REQUIRED_FIELDS = [
  "harnessId",
  "preToolHook",
  "approvalUi",
  "toolRegistration",
  "workspaceProfile",
  "interceptionStrategy",
  "gradedGuarantee",
] as const;

describe("harness-capabilities matrix", () => {
  it("exists and lists required fields for every supported harness", () => {
    assert.equal(existsSync(MATRIX_PATH), true, "adapters/harness-capabilities.json must exist");
    const raw = JSON.parse(readFileSync(MATRIX_PATH, "utf8")) as {
      version: number;
      harnesses: Record<string, Record<string, unknown>>;
    };
    assert.equal(raw.version, 1);
    for (const id of REQUIRED_HARNESSES) {
      const entry = raw.harnesses[id];
      assert.ok(entry, `missing harness entry: ${id}`);
      for (const field of REQUIRED_FIELDS) {
        assert.notEqual(
          entry[field],
          undefined,
          `${id} missing required field: ${field}`,
        );
      }
      assert.equal(entry.harnessId, id);
      assert.equal(typeof entry.preToolHook, "boolean");
      assert.equal(typeof entry.approvalUi, "boolean");
      assert.equal(typeof entry.toolRegistration, "boolean");
      assert.equal(typeof entry.workspaceProfile, "string");
      assert.equal(typeof entry.interceptionStrategy, "string");
      assert.equal(typeof entry.gradedGuarantee, "string");
    }
  });

  it("has stub package.json for cursor, claude-code, and codex adapters", () => {
    for (const id of ["cursor", "claude-code", "codex"] as const) {
      const pkgPath = join(__dirname, id, "package.json");
      assert.equal(existsSync(pkgPath), true, `missing ${id}/package.json`);
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
        name: string;
        private?: boolean;
      };
      assert.match(pkg.name, /fpp-adapter/);
    }
  });
});

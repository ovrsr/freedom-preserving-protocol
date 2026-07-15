/**
 * Monorepo hardening: workspace-bound FPP_ENFORCEMENT_CONFIG + shell:false spawns.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("enforcement config path binding", () => {
  it("rejects FPP_ENFORCEMENT_CONFIG outside the workspace profile root", async () => {
    const { assertConfigPathAllowed } = await import(
      "../packages/enforcement-core/src/config-path.js"
    );
    const ws = mkdtempSync(join(tmpdir(), "fpp-ws-"));
    const outside = join(tmpdir(), `fpp-outside-${Date.now()}.json`);
    writeFileSync(outside, "{}");
    try {
      assert.throws(
        () =>
          assertConfigPathAllowed({
            configPath: outside,
            workspaceRoot: ws,
          }),
        /outside|workspace|FPP_ENFORCEMENT_CONFIG/i,
      );
    } finally {
      rmSync(ws, { recursive: true, force: true });
      try {
        rmSync(outside);
      } catch {
        /* ignore */
      }
    }
  });

  it("accepts FPP_ENFORCEMENT_CONFIG under the workspace profile root", async () => {
    const { assertConfigPathAllowed } = await import(
      "../packages/enforcement-core/src/config-path.js"
    );
    const ws = mkdtempSync(join(tmpdir(), "fpp-ws-ok-"));
    const inside = join(ws, "fpp-enforcement.json");
    writeFileSync(inside, "{}");
    try {
      const resolved = assertConfigPathAllowed({
        configPath: inside,
        workspaceRoot: ws,
      });
      assert.equal(resolved, resolve(inside));
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });
});

describe("package-reproducibility spawn", () => {
  it("uses shell:false for npm pack/build spawns", () => {
    const src = readFileSync(
      join(root, "scripts", "package-reproducibility.ts"),
      "utf8",
    );
    assert.match(src, /shell:\s*false/);
    assert.doesNotMatch(src, /shell:\s*true/);
    assert.match(src, /npmCmd|npm\.cmd|process\.platform/);
  });
});

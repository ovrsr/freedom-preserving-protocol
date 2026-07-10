/**
 * RED/GREEN tests for deterministic package inventory + checksums.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("package-reproducibility", () => {
  const outDir = mkdtempSync(join(tmpdir(), "fpp-repro-"));

  after(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it("exports inventoryAndChecksums and compareInventories", async () => {
    const mod = await import("./package-reproducibility.js");
    assert.equal(typeof mod.inventoryAndChecksums, "function");
    assert.equal(typeof mod.compareInventories, "function");
    assert.equal(typeof mod.generateSbom, "function");
  });

  it("produces deterministic file inventory for a dry-run pack", async () => {
    const { inventoryFromPackDryRun, compareInventories } = await import(
      "./package-reproducibility.js"
    );
    const a = await inventoryFromPackDryRun(join(root, "plugin"), outDir);
    const b = await inventoryFromPackDryRun(join(root, "plugin"), outDir);
    assert.ok(a.files.length > 0);
    assert.ok(a.files.some((f: { path: string }) => f.path.includes("dist/index.js")));
    const diff = compareInventories(a, b);
    assert.deepEqual(diff.added, []);
    assert.deepEqual(diff.removed, []);
    assert.deepEqual(diff.changed, []);
  });

  it("writes CycloneDX SBOM JSON for a package", async () => {
    const { generateSbom } = await import("./package-reproducibility.js");
    const sbomPath = join(outDir, "plugin.cdx.json");
    await generateSbom(join(root, "plugin"), sbomPath);
    assert.ok(existsSync(sbomPath));
    const sbom = JSON.parse(readFileSync(sbomPath, "utf8"));
    assert.equal(sbom.bomFormat, "CycloneDX");
    assert.ok(sbom.components?.length >= 1);
  });
});

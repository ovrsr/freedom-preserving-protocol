/**
 * Asserts root workspace links required by adapter typecheck remain intact.
 *
 * Nested `npm ci` inside plugin/ or plugin-trust/ rewrites the monorepo
 * install and can drop packages such as @ovrsr/fpp-tool-proxy that adapters
 * resolve via the root workspace tree.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOOL_PROXY = "@ovrsr/fpp-tool-proxy";

function workspaceLinkPath(pkgName: string): string {
  return join(root, "node_modules", ...pkgName.split("/"));
}

/** Walk upward from a workspace like Node/TypeScript module resolution. */
function findInstalledPackage(fromDir: string, pkgName: string): string | null {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, "node_modules", ...pkgName.split("/"), "package.json");
    if (existsSync(candidate)) return dirname(candidate);
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

describe("workspace package links", () => {
  it("keeps @ovrsr/fpp-tool-proxy linked from the root install", () => {
    const linkPath = workspaceLinkPath(TOOL_PROXY);
    assert.equal(
      existsSync(linkPath),
      true,
      `${TOOL_PROXY} missing under node_modules — nested plugin npm ci may have pruned workspace links`,
    );
    const stat = lstatSync(linkPath);
    assert.equal(
      stat.isSymbolicLink() || stat.isDirectory(),
      true,
      `${TOOL_PROXY} must be a workspace link or directory`,
    );
    const pkg = JSON.parse(
      readFileSync(join(realpathSync(linkPath), "package.json"), "utf8"),
    ) as { name?: string };
    assert.equal(pkg.name, TOOL_PROXY);
  });

  it("resolves @ovrsr/fpp-tool-proxy from every adapter workspace", () => {
    for (const adapter of ["cursor", "claude-code", "codex"] as const) {
      const adapterRoot = join(root, "adapters", adapter);
      const resolved = findInstalledPackage(adapterRoot, TOOL_PROXY);
      assert.ok(
        resolved,
        `${TOOL_PROXY} does not resolve from adapters/${adapter} — nested plugin npm ci may have pruned workspace links`,
      );
      assert.match(
        resolved.replace(/\\/g, "/"),
        /(?:^|\/)(?:packages\/tool-proxy|node_modules\/@ovrsr\/fpp-tool-proxy)$/,
        `unexpected resolution from adapters/${adapter}: ${resolved}`,
      );
    }
  });
});

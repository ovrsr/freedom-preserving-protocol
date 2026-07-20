/**
 * Shared pack-contract for harness adapters: tarball embeds unpublished
 * @ovrsr cores + tool-proxy and installs alone under OpenClaw-style flags.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { resolveNpmSpawn } from "../scripts/package-reproducibility.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const ADAPTERS = [
  { rel: "adapters/cursor", pkgPrefix: "ovrsr-fpp-adapter-cursor" },
  { rel: "adapters/claude-code", pkgPrefix: "ovrsr-fpp-adapter-claude-code" },
  { rel: "adapters/codex", pkgPrefix: "ovrsr-fpp-adapter-codex" },
] as const;

function run(
  cmd: string,
  args: string[],
  cwd: string,
): { status: number | null; stdout: string; stderr: string } {
  const npm = cmd === "npm" ? resolveNpmSpawn() : null;
  const r = spawnSync(npm ? npm.command : cmd, npm ? [...npm.prefixArgs, ...args] : args, {
    cwd,
    encoding: "utf8",
    shell: false,
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function tarList(tgzPath: string, cwd: string): string {
  const force = run("tar", ["--force-local", "-tzf", tgzPath], cwd);
  if (force.status === 0) return force.stdout;
  return run("tar", ["-tzf", tgzPath], cwd).stdout;
}

describe("adapter pack-bundle", { concurrency: false }, () => {
  const tmp = mkdtempSync(join(tmpdir(), "fpp-adapter-pack-"));

  after(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  for (const adapter of ADAPTERS) {
    it(`${adapter.rel} packs bundled deps and installs in isolation`, () => {
      const dir = join(root, adapter.rel);
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
        name: string;
        bundledDependencies?: string[];
      };
      assert.ok(
        pkg.bundledDependencies?.includes("@ovrsr/fpp-tool-proxy"),
        `${adapter.rel} must list tool-proxy in bundledDependencies`,
      );
      assert.ok(
        pkg.bundledDependencies?.includes("@ovrsr/fpp-steward-auth-core"),
        `${adapter.rel} must list steward-auth-core in bundledDependencies (enforcement-core import)`,
      );

      const build = run("npm", ["run", "build"], dir);
      assert.equal(build.status, 0, build.stderr || build.stdout);

      const bundle = run("npm", ["run", "bundle:deps"], dir);
      assert.equal(bundle.status, 0, bundle.stderr || bundle.stdout);

      const pack = run(
        "npm",
        ["pack", "--pack-destination", tmp, "--ignore-scripts"],
        dir,
      );
      assert.equal(pack.status, 0, pack.stderr || pack.stdout);

      const tgz = readdirSync(tmp).find(
        (f) => f.startsWith(adapter.pkgPrefix) && f.endsWith(".tgz"),
      );
      assert.ok(tgz, `expected ${adapter.pkgPrefix}-*.tgz`);

      const listing = tarList(join(tmp, tgz!), tmp);
      assert.match(listing, /node_modules\/@ovrsr\/fpp-protocol-core\//);
      assert.match(listing, /node_modules\/@ovrsr\/fpp-enforcement-core\//);
      assert.match(listing, /node_modules\/@ovrsr\/fpp-steward-auth-core\//);
      assert.match(listing, /node_modules\/@ovrsr\/fpp-tool-proxy\//);
      assert.match(listing, /dist\/index\.js/);

      const isol = join(tmp, `isol-${adapter.pkgPrefix}`);
      mkdirSync(isol, { recursive: true });
      writeFileSync(
        join(isol, "package.json"),
        JSON.stringify({ name: "isol-adapter", private: true, version: "0.0.0" }),
      );

      const install = run(
        "npm",
        [
          "install",
          "--omit=dev",
          "--omit=peer",
          "--legacy-peer-deps",
          "--ignore-scripts",
          join(tmp, tgz!),
        ],
        isol,
      );
      assert.equal(install.status, 0, install.stderr || install.stdout);

      const scope = join(isol, "node_modules", "@ovrsr");
      const installedName = readdirSync(scope).find((e) =>
        e.startsWith("fpp-adapter-"),
      );
      assert.ok(installedName);
      const adapterInstall = join(scope, installedName!);
      assert.ok(
        existsSync(
          join(adapterInstall, "node_modules/@ovrsr/fpp-enforcement-core/package.json"),
        ),
      );
      assert.ok(
        existsSync(
          join(adapterInstall, "node_modules/@ovrsr/fpp-steward-auth-core/package.json"),
        ),
        "bundled steward-auth-core must land under the installed adapter",
      );

      const importScript = join(adapterInstall, "check-import.mjs");
      writeFileSync(
        importScript,
        "import('@ovrsr/fpp-enforcement-core').then((m) => {\n" +
          "  if (!m || typeof m !== 'object') process.exit(1);\n" +
          "}).catch((e) => { console.error(e); process.exit(1); });\n",
      );
      const importCheck = spawnSync(process.execPath, [importScript], {
        cwd: adapterInstall,
        encoding: "utf8",
      });
      assert.equal(
        importCheck.status,
        0,
        (importCheck.stderr || "") + (importCheck.stdout || ""),
      );
    });
  }
});

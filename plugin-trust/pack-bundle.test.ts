/**
 * Pack-contract: trust plugin tarball embeds protocol-core + trust-core via
 * bundledDependencies and installs alone under OpenClaw-style npm flags.
 *
 * Kept outside src/ so it is not published in the package `files` list.
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
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const pluginDir = dirname(fileURLToPath(import.meta.url));
const root = join(pluginDir, "..");

function run(
  cmd: string,
  args: string[],
  cwd: string,
): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: { ...process.env },
  });
  return {
    status: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

function tarList(tgzPath: string, cwd: string): string {
  const force = run("tar", ["--force-local", "-tzf", tgzPath], cwd);
  if (force.status === 0) return force.stdout;
  const plain = run("tar", ["-tzf", tgzPath], cwd);
  return plain.stdout + plain.stderr;
}

describe("plugin-trust pack-bundle", { concurrency: false }, () => {
  const tmp = mkdtempSync(join(tmpdir(), "fpp-trust-pack-"));

  after(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("packs bundled cores and installs in isolation under OpenClaw flags", () => {
    const build = run("npm", ["run", "build"], pluginDir);
    assert.equal(build.status, 0, build.stderr || build.stdout);

    const bundle = run("npm", ["run", "bundle:deps"], pluginDir);
    assert.equal(bundle.status, 0, bundle.stderr || bundle.stdout);

    assert.ok(
      existsSync(
        join(pluginDir, "node_modules/@ovrsr/fpp-protocol-core/package.json"),
      ),
    );
    assert.ok(
      existsSync(join(pluginDir, "node_modules/@ovrsr/fpp-trust-core/package.json")),
    );

    const pack = run(
      "npm",
      ["pack", "--pack-destination", tmp, "--ignore-scripts"],
      pluginDir,
    );
    assert.equal(pack.status, 0, pack.stderr || pack.stdout);

    const tgz = readdirSync(tmp).find(
      (f) => f.startsWith("ovrsr-openclaw-fpp-trust-") && f.endsWith(".tgz"),
    );
    assert.ok(tgz, `expected trust tarball in ${tmp}`);

    const listing = tarList(join(tmp, tgz!), tmp);
    assert.match(listing, /node_modules\/@ovrsr\/fpp-protocol-core\//);
    assert.match(listing, /node_modules\/@ovrsr\/fpp-trust-core\//);
    assert.match(listing, /dist\/index\.js/);

    const isol = join(tmp, "isol");
    mkdirSync(isol, { recursive: true });
    writeFileSync(
      join(isol, "package.json"),
      JSON.stringify({ name: "isol-trust", private: true, version: "0.0.0" }),
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

    // typebox must resolve from registry deps (not required in the bundle)
    const typeboxPath = join(
      isol,
      "node_modules",
      "@ovrsr",
      "openclaw-fpp-trust",
      "node_modules",
      "@sinclair",
      "typebox",
    );
    const typeboxHoisted = join(isol, "node_modules", "@sinclair", "typebox");
    assert.ok(
      existsSync(typeboxPath) || existsSync(typeboxHoisted),
      "expected @sinclair/typebox from registry install",
    );

    const pluginInstall = join(
      isol,
      "node_modules",
      "@ovrsr",
      "openclaw-fpp-trust",
    );
    assert.ok(
      existsSync(join(pluginInstall, "node_modules/@ovrsr/fpp-trust-core/package.json")),
    );

    const importScript = join(pluginInstall, "check-import.mjs");
    writeFileSync(
      importScript,
      "import('@ovrsr/fpp-trust-core').then((m) => {\n" +
        "  if (!m || typeof m !== 'object') process.exit(1);\n" +
        "}).catch((e) => { console.error(e); process.exit(1); });\n",
    );
    const importCheck = spawnSync(process.execPath, [importScript], {
      cwd: pluginInstall,
      encoding: "utf8",
    });
    assert.equal(
      importCheck.status,
      0,
      (importCheck.stderr || "") + (importCheck.stdout || ""),
    );
  });
});

/**
 * Pack-contract: enforcement plugin tarball embeds workspace cores via
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
  readFileSync,
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

describe("plugin pack-bundle", { concurrency: false }, () => {
  const tmp = mkdtempSync(join(tmpdir(), "fpp-plugin-pack-"));

  after(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("packs bundled cores and installs in isolation under OpenClaw flags", () => {
    const build = run("npm", ["run", "build"], pluginDir);
    assert.equal(build.status, 0, build.stderr || build.stdout);

    // prepack also bundles; call explicitly so failures are attributed here
    const bundle = run("npm", ["run", "bundle:deps"], pluginDir);
    assert.equal(bundle.status, 0, bundle.stderr || bundle.stdout);

    assert.ok(
      existsSync(
        join(pluginDir, "node_modules/@ovrsr/fpp-protocol-core/package.json"),
      ),
      "expected staged protocol-core in plugin/node_modules",
    );
    assert.ok(
      existsSync(
        join(pluginDir, "node_modules/@ovrsr/fpp-enforcement-core/package.json"),
      ),
      "expected staged enforcement-core in plugin/node_modules",
    );

    const pack = run("npm", ["pack", "--pack-destination", tmp, "--ignore-scripts"], pluginDir);
    assert.equal(pack.status, 0, pack.stderr || pack.stdout);

    const tgz = readdirSync(tmp).find(
      (f) => f.startsWith("ovrsr-openclaw-fpp-plugin-") && f.endsWith(".tgz"),
    );
    assert.ok(tgz, `expected plugin tarball in ${tmp}, got: ${readdirSync(tmp).join(", ")}`);

    const listing = tarList(join(tmp, tgz!), tmp);
    assert.match(listing, /node_modules\/@ovrsr\/fpp-protocol-core\//);
    assert.match(listing, /node_modules\/@ovrsr\/fpp-enforcement-core\//);
    assert.match(listing, /node_modules\/@ovrsr\/fpp-steward-auth-core\//);
    assert.match(listing, /dist\/index\.js/);

    const isol = join(tmp, "isol");
    mkdirSync(isol, { recursive: true });
    writeFileSync(
      join(isol, "package.json"),
      JSON.stringify({ name: "isol-plugin", private: true, version: "0.0.0" }),
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

    const pluginInstall = join(
      isol,
      "node_modules",
      "@ovrsr",
      "openclaw-fpp-plugin",
    );
    assert.ok(
      existsSync(join(pluginInstall, "node_modules/@ovrsr/fpp-enforcement-core/package.json")),
      "bundled enforcement-core must land under the installed plugin",
    );

    const nestedCorePkg = JSON.parse(
      readFileSync(
        join(
          pluginInstall,
          "node_modules/@ovrsr/fpp-enforcement-core/package.json",
        ),
        "utf8",
      ),
    ) as { name: string; version: string };
    assert.equal(nestedCorePkg.name, "@ovrsr/fpp-enforcement-core");
    assert.equal(nestedCorePkg.version, "1.0.3");

    const pluginPkg = JSON.parse(
      readFileSync(join(pluginInstall, "package.json"), "utf8"),
    ) as {
      version: string;
      dependencies?: Record<string, string>;
    };
    assert.equal(pluginPkg.version, "1.1.18");
    assert.equal(
      pluginPkg.dependencies?.["@ovrsr/fpp-enforcement-core"],
      "1.0.3",
    );

    const actionDescriptorJs = readFileSync(
      join(
        pluginInstall,
        "node_modules/@ovrsr/fpp-enforcement-core/dist/action-descriptor.js",
      ),
      "utf8",
    );
    assert.match(actionDescriptorJs, /"command"/);
    assert.match(actionDescriptorJs, /params\?\.changes|extractStructuredChangeTargets/);
    assert.match(actionDescriptorJs, /outOfWorkspacePaths/);

    // Script must live under the plugin package so Node resolves @ovrsr/* from there
    const importScript = join(pluginInstall, "check-import.mjs");
    writeFileSync(
      importScript,
      "import('@ovrsr/fpp-enforcement-core').then((m) => {\n" +
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

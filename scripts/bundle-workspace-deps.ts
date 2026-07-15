/**
 * bundle-workspace-deps.ts
 *
 * Packs exact-pin workspace packages and installs them into a consumer
 * package's local node_modules so `npm pack` embeds them via
 * `bundledDependencies`.
 *
 * Usage:
 *   npx tsx scripts/bundle-workspace-deps.ts --package plugin
 *   npx tsx scripts/bundle-workspace-deps.ts --package plugin-trust
 *   npx tsx scripts/bundle-workspace-deps.ts --package adapters/cursor
 *   npx tsx scripts/bundle-workspace-deps.ts --package plugin --deps @ovrsr/fpp-protocol-core@1.0.0
 *
 * Default deps: consumer package.json `bundledDependencies` with exact pins
 * from `dependencies`. Refuses ranges and version mismatches.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  cpSync,
  readdirSync,
} from "node:fs";
import { join, dirname, resolve, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = join(SCRIPT_DIR, "..");

export type BundleOptions = {
  repoRoot: string;
  packageDir: string;
  /** Explicit name@version list; default: bundledDependencies from package.json */
  deps?: string[];
};

type PackageJson = {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  bundledDependencies?: string[];
  bundleDependencies?: string[];
};

/** Plain semver only — no ^ ~ * x ranges or comparators. */
export function isExactVersion(v: string): boolean {
  return /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.test(v.trim());
}

function readJson(path: string): PackageJson {
  return JSON.parse(readFileSync(path, "utf8")) as PackageJson;
}

/** Map @ovrsr package name → packages/<dir> or adapters/<dir> under repo root. */
export function findWorkspacePackageDir(
  repoRoot: string,
  name: string,
): string | null {
  const candidates = [
    join(repoRoot, "packages"),
    join(repoRoot, "adapters"),
    join(repoRoot, "plugin"),
    join(repoRoot, "plugin-trust"),
  ];

  // Direct package roots that are themselves workspaces
  for (const direct of [
    join(repoRoot, "plugin"),
    join(repoRoot, "plugin-trust"),
  ]) {
    const pj = join(direct, "package.json");
    if (existsSync(pj) && readJson(pj).name === name) return direct;
  }

  for (const parent of [join(repoRoot, "packages"), join(repoRoot, "adapters")]) {
    if (!existsSync(parent)) continue;
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(parent, entry.name);
      const pj = join(dir, "package.json");
      if (existsSync(pj) && readJson(pj).name === name) return dir;
    }
  }

  // Also scan candidates list for completeness (unused parents skipped above)
  void candidates;
  return null;
}

function parseDepSpec(spec: string): { name: string; version?: string } {
  // @scope/name@version or name@version
  const at = spec.lastIndexOf("@");
  if (spec.startsWith("@") && at > 0) {
    return { name: spec.slice(0, at), version: spec.slice(at + 1) || undefined };
  }
  if (!spec.startsWith("@") && at > 0) {
    return { name: spec.slice(0, at), version: spec.slice(at + 1) || undefined };
  }
  return { name: spec };
}

function resolveDepsToBundle(
  consumer: PackageJson,
  explicit?: string[],
): Array<{ name: string; pinned: string }> {
  const deps = consumer.dependencies ?? {};
  const bundled =
    consumer.bundledDependencies ?? consumer.bundleDependencies ?? [];

  if (explicit && explicit.length > 0) {
    return explicit.map((spec) => {
      const { name, version } = parseDepSpec(spec);
      const pinned = version ?? deps[name];
      if (!pinned) {
        throw new Error(
          `Missing version pin for ${name}: pass name@version or list it in dependencies`,
        );
      }
      return { name, pinned };
    });
  }

  if (bundled.length === 0) {
    throw new Error(
      "No bundledDependencies in package.json and no --deps provided",
    );
  }

  return bundled.map((name) => {
    const pinned = deps[name];
    if (!pinned) {
      throw new Error(
        `bundledDependency ${name} is not listed in dependencies`,
      );
    }
    return { name, pinned };
  });
}

/**
 * Pack each workspace dep and extract into packageDir/node_modules/<name>.
 */
export async function bundleWorkspaceDeps(
  options: BundleOptions,
): Promise<void> {
  const { repoRoot, packageDir } = options;
  const pkgPath = join(packageDir, "package.json");
  if (!existsSync(pkgPath)) {
    throw new Error(`package.json not found: ${pkgPath}`);
  }

  const consumer = readJson(pkgPath);
  const toBundle = resolveDepsToBundle(consumer, options.deps);

  for (const { name, pinned } of toBundle) {
    if (!isExactVersion(pinned)) {
      throw new Error(
        `Refusing range pin for ${name}: "${pinned}" — exact semver required (no ^ ~ *)`,
      );
    }

    const wsDir = findWorkspacePackageDir(repoRoot, name);
    if (!wsDir) {
      throw new Error(`Workspace package not found: ${name}`);
    }

    const wsPkg = readJson(join(wsDir, "package.json"));
    if (wsPkg.version !== pinned) {
      throw new Error(
        `Version mismatch for ${name}: consumer pin=${pinned} workspace=${wsPkg.version}`,
      );
    }

    // Ensure dist exists (prepack builds cores, but callers may stage early)
    const distJs = join(wsDir, "dist", "index.js");
    if (!existsSync(distJs)) {
      const build = spawnSync("npm", ["run", "build", "--if-present"], {
        cwd: wsDir,
        encoding: "utf8",
        shell: process.platform === "win32",
      });
      if (build.status !== 0) {
        throw new Error(
          `Failed to build ${name} before pack:\n${build.stdout}\n${build.stderr}`,
        );
      }
    }

    const packTmp = mkdtempSync(join(tmpdir(), "fpp-ws-pack-"));
    try {
      // Stage by copying the workspace package's publishable files into a
      // temporary package/ tree, then into the consumer node_modules.
      // Avoid nested `npm pack`: parent pack/dry-run lifecycles leave env that
      // causes nested pack to print a filename without writing a tarball.
      const stagedPkg = join(packTmp, "package");
      mkdirSync(stagedPkg, { recursive: true });

      const wsPkgFull = readJson(join(wsDir, "package.json"));
      const publishFiles = (wsPkgFull as { files?: string[] }).files ?? [
        "dist",
        "package.json",
      ];
      // Always include package.json + license/readme when present
      const always = ["package.json", "LICENSE", "README.md", "readme.md"];
      const toCopy = new Set<string>([...always, ...publishFiles]);

      for (const entry of toCopy) {
        const src = join(wsDir, entry);
        if (!existsSync(src)) continue;
        const dest = join(stagedPkg, entry);
        // files entries may be "dist/" or "dist"
        const destPath = dest.replace(/[/\\]$/, "");
        mkdirSync(dirname(destPath), { recursive: true });
        cpSync(src, destPath, { recursive: true });
      }

      if (!existsSync(join(stagedPkg, "package.json"))) {
        throw new Error(`Failed to stage package.json for ${name}`);
      }
      if (!existsSync(join(stagedPkg, "dist", "index.js"))) {
        throw new Error(
          `Staged ${name} is missing dist/index.js — run build first`,
        );
      }

      const parts = name.startsWith("@") ? name.split("/") : [name];
      const dest = join(packageDir, "node_modules", ...parts);
      mkdirSync(dirname(dest), { recursive: true });
      rmSync(dest, { recursive: true, force: true });
      cpSync(stagedPkg, dest, { recursive: true });

      console.error(`Staged ${name}@${pinned} → ${dest}`);
    } finally {
      rmSync(packTmp, { recursive: true, force: true });
    }
  }
}

function printUsage(): void {
  console.log(`Usage: npx tsx scripts/bundle-workspace-deps.ts --package <path> [--deps name@version…]

  --package   Consumer path relative to repo root (plugin, plugin-trust, adapters/cursor, …)
  --deps      Optional explicit list; default = package.json bundledDependencies`);
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  let packageRel: string | undefined;
  const deps: string[] = [];
  let repoRoot = DEFAULT_ROOT;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--package" && argv[i + 1]) {
      packageRel = argv[++i];
    } else if (a === "--deps") {
      while (argv[i + 1] && !argv[i + 1]!.startsWith("--")) {
        deps.push(argv[++i]!);
      }
    } else if (a === "--root" && argv[i + 1]) {
      repoRoot = resolve(argv[++i]!);
    } else if (a === "--help" || a === "-h") {
      printUsage();
      return;
    } else if (a?.startsWith("--")) {
      throw new Error(`Unknown flag: ${a}`);
    } else if (a) {
      // bare deps after --package
      deps.push(a);
    }
  }

  if (!packageRel) {
    printUsage();
    throw new Error("Missing --package <path>");
  }

  const packageDir = isAbsolute(packageRel)
    ? packageRel
    : join(repoRoot, packageRel);

  if (!existsSync(join(packageDir, "package.json"))) {
    throw new Error(`package not found: ${packageDir}`);
  }

  await bundleWorkspaceDeps({
    repoRoot,
    packageDir,
    deps: deps.length > 0 ? deps : undefined,
  });
}

const isMain =
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` ||
  import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}`;

if (isMain) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

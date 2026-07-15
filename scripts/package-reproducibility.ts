/**
 * Deterministic package inventory, checksum comparison, and CycloneDX SBOM
 * generation from npm pack --dry-run (no registry publish).
 */
import {
  createHash,
  randomUUID,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, relative, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export type FileEntry = {
  path: string;
  size: number;
  sha256: string;
};

export type PackageInventory = {
  packageName: string;
  version: string;
  files: FileEntry[];
};

export type InventoryDiff = {
  added: string[];
  removed: string[];
  changed: string[];
};

function normalizePath(p: string): string {
  return p.split(sep).join("/").replace(/^\.\//, "");
}

function sha256File(absPath: string): string {
  const hash = createHash("sha256");
  hash.update(readFileSync(absPath));
  return hash.digest("hex");
}

function walkFiles(dir: string, base = dir): FileEntry[] {
  const out: FileEntry[] = [];
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === ".git") continue;
      out.push(...walkFiles(abs, base));
    } else if (st.isFile()) {
      out.push({
        path: normalizePath(relative(base, abs)),
        size: st.size,
        sha256: sha256File(abs),
      });
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export function inventoryAndChecksums(
  packageDir: string,
  fileList: string[],
): PackageInventory {
  const pkg = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as {
    name: string;
    version: string;
  };
  const files: FileEntry[] = [];
  for (const rel of fileList.map(normalizePath).sort()) {
    const abs = join(packageDir, rel);
    if (!existsSync(abs) || !statSync(abs).isFile()) continue;
    files.push({
      path: rel,
      size: statSync(abs).size,
      sha256: sha256File(abs),
    });
  }
  return { packageName: pkg.name, version: pkg.version, files };
}

export function compareInventories(
  a: PackageInventory,
  b: PackageInventory,
): InventoryDiff {
  const mapA = new Map(a.files.map((f) => [f.path, f]));
  const mapB = new Map(b.files.map((f) => [f.path, f]));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const path of mapB.keys()) {
    if (!mapA.has(path)) added.push(path);
  }
  for (const [path, fa] of mapA) {
    const fb = mapB.get(path);
    if (!fb) {
      removed.push(path);
      continue;
    }
    if (fa.sha256 !== fb.sha256 || fa.size !== fb.size) changed.push(path);
  }
  return {
    added: added.sort(),
    removed: removed.sort(),
    changed: changed.sort(),
  };
}

function parsePackDryRunPaths(output: string): string[] {
  const paths: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    // npm pack --dry-run lists paths like "npm notice 1.2kB dist/index.js"
    const notice = trimmed.match(/^npm notice\s+(?:\d+(?:\.\d+)?[kKmMgG]?B\s+)?(.+)$/);
    if (notice) {
      const p = notice[1]!.trim();
      if (p && !p.startsWith("Tarball") && !p.startsWith("package:") && !p.includes(":")) {
        paths.push(normalizePath(p));
      }
      continue;
    }
    // Some npm versions print bare relative paths
    if (/^(dist|src)\//.test(trimmed) || trimmed.endsWith(".json") || trimmed.endsWith(".md")) {
      paths.push(normalizePath(trimmed));
    }
  }
  return [...new Set(paths)].sort();
}

export async function inventoryFromPackDryRun(
  packageDir: string,
  _outDir?: string,
): Promise<PackageInventory> {
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  // Ensure dist exists for plugins — never enable shell for npm (lifecycle script risk).
  if (existsSync(join(packageDir, "tsconfig.json"))) {
    spawnSync(npmCmd, ["run", "build", "--if-present"], {
      cwd: packageDir,
      encoding: "utf8",
      shell: false,
    });
  }
  const result = spawnSync(npmCmd, ["pack", "--dry-run"], {
    cwd: packageDir,
    encoding: "utf8",
    shell: false,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0) {
    throw new Error(`npm pack --dry-run failed in ${packageDir}:\n${output}`);
  }
  let paths = parsePackDryRunPaths(output);
  if (paths.length === 0) {
    // Fallback: walk package files declared in package.json "files"
    const pkg = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as {
      files?: string[];
    };
    const entries = walkFiles(packageDir).map((f) => f.path);
    if (pkg.files?.length) {
      paths = entries.filter((p) =>
        pkg.files!.some((prefix) => p === prefix.replace(/\/$/, "") || p.startsWith(prefix.replace(/\/$/, "") + "/") || p.startsWith(prefix)),
      );
    } else {
      paths = entries;
    }
  }
  return inventoryAndChecksums(packageDir, paths);
}

export async function generateSbom(
  packageDir: string,
  outPath: string,
): Promise<void> {
  const pkg = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as {
    name: string;
    version: string;
    license?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const components: Array<Record<string, unknown>> = [
    {
      type: "library",
      name: pkg.name,
      version: pkg.version,
      "bom-ref": `pkg:npm/${pkg.name}@${pkg.version}`,
      licenses: pkg.license ? [{ license: { id: pkg.license } }] : undefined,
    },
  ];
  for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
    components.push({
      type: "library",
      name,
      version: version.replace(/^[^0-9]*/, "") || version,
      "bom-ref": `pkg:npm/${name}@${version}`,
      scope: "required",
    });
  }
  // Omit openclaw from SBOM runtime deps listing noise if only a peer — still
  // record declared dependencies above. DevDependencies intentionally omitted
  // from the distributable SBOM (build-time only).
  void pkg.devDependencies;

  const sbom = {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber: `urn:uuid:${randomUUID()}`,
    version: 1,
    metadata: {
      // Normalize timestamp for reviewability; not used in inventory compare.
      timestamp: "1970-01-01T00:00:00.000Z",
      component: components[0],
      tools: [{ name: "fpp-package-reproducibility", version: "1.0.0" }],
    },
    components,
  };

  mkdirSync(join(outPath, ".."), { recursive: true });
  writeFileSync(outPath, JSON.stringify(sbom, null, 2) + "\n", "utf8");
}

function isDirectInvocation(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return /package-reproducibility\.(ts|js)$/.test(entry.replace(/\\/g, "/"));
}

async function main(): Promise<void> {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const outDir = process.argv[2] ?? join(root, "assurance-artifacts");
  mkdirSync(outDir, { recursive: true });

  const targets = [
    { dir: root, label: "skill" },
    { dir: join(root, "packages", "protocol-core"), label: "protocol-core" },
    { dir: join(root, "packages", "enforcement-core"), label: "enforcement-core" },
    { dir: join(root, "packages", "trust-core"), label: "trust-core" },
    { dir: join(root, "plugin"), label: "plugin" },
    { dir: join(root, "plugin-trust"), label: "plugin-trust" },
  ];

  for (const t of targets) {
    if (!existsSync(join(t.dir, "package.json"))) continue;
    const inv = await inventoryFromPackDryRun(t.dir, outDir);
    const invPath = join(outDir, `${t.label}.inventory.json`);
    writeFileSync(invPath, JSON.stringify(inv, null, 2) + "\n", "utf8");
    const sbomPath = join(outDir, `${t.label}.cdx.json`);
    await generateSbom(t.dir, sbomPath);
    console.log(`Wrote ${invPath} (${inv.files.length} files) and ${sbomPath}`);
  }
}

if (isDirectInvocation()) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

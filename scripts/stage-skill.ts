/**
 * stage-skill.ts — build an OpenClaw-only ClawHub skill root from an allowlist.
 *
 * Usage:
 *   npx tsx scripts/stage-skill.ts [--out skill-dist] [--repo-root .]
 *
 * Copies only paths listed in skill/ALLOWLIST into the output directory.
 * Refuses to leave the stage if forbidden monorepo paths would be present.
 */
import {
  existsSync,
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
  cpSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, dirname, resolve, relative, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(__dirname, "..");

export const FORBIDDEN_PATH_PREFIXES = [
  "adapters/",
  "plugin/",
  "plugin-trust/",
  "packages/",
  "test/",
  "assurance-artifacts/",
  "docs/plans/",
  "MASTER_CONTEXT.md",
  "scripts/clawhub-publish.sh",
  "scripts/package-reproducibility.ts",
  "scripts/rfc-citation-check.ts",
  "scripts/bundle-workspace-deps.ts",
] as const;

export type StageSkillOptions = {
  repoRoot?: string;
  outDir?: string;
  allowlistPath?: string;
};

export type StageSkillResult = {
  outDir: string;
  files: string[];
};

function walkRelative(dir: string, base = dir): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(base, full).replace(/\\/g, "/");
    if (statSync(full).isDirectory()) {
      out.push(...walkRelative(full, base));
    } else {
      out.push(rel);
    }
  }
  return out;
}

export function readAllowlist(allowlistPath: string): string[] {
  const raw = readFileSync(allowlistPath, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

export function assertNoForbiddenPaths(relativePaths: string[]): void {
  for (const p of relativePaths) {
    const norm = p.replace(/\\/g, "/");
    for (const prefix of FORBIDDEN_PATH_PREFIXES) {
      const bare = prefix.replace(/\/$/, "");
      if (
        norm === prefix ||
        norm === bare ||
        norm.startsWith(prefix) ||
        (prefix.endsWith("/") && norm.startsWith(prefix))
      ) {
        throw new Error(
          `forbidden path staged: ${norm} (matches ${prefix})`,
        );
      }
    }
  }
}

function expandAllowlistEntry(
  repoRoot: string,
  entry: string,
): { src: string; destRel: string; isDir: boolean }[] {
  const norm = entry.replace(/\\/g, "/");
  // Templates under skill/ are published at the staged skill root.
  const destOverride: Record<string, string> = {
    "skill/package.json": "package.json",
    "skill/README.md": "README.md",
  };
  if (norm.endsWith("/**")) {
    const dirRel = norm.slice(0, -3);
    const src = join(repoRoot, dirRel);
    if (!existsSync(src)) {
      throw new Error(`allowlist directory missing: ${dirRel}`);
    }
    return [{ src, destRel: dirRel, isDir: true }];
  }
  const src = join(repoRoot, norm);
  if (!existsSync(src)) {
    throw new Error(`allowlist path missing: ${norm}`);
  }
  const destRel = destOverride[norm] ?? norm;
  return [{ src, destRel, isDir: statSync(src).isDirectory() }];
}

export function stageSkill(opts: StageSkillOptions = {}): StageSkillResult {
  const repoRoot = resolve(opts.repoRoot ?? DEFAULT_ROOT);
  const outDir = resolve(opts.outDir ?? join(repoRoot, "skill-dist"));
  const allowlistPath = resolve(
    opts.allowlistPath ?? join(repoRoot, "skill", "ALLOWLIST"),
  );

  if (!existsSync(allowlistPath)) {
    throw new Error(`ALLOWLIST not found: ${allowlistPath}`);
  }

  const entries = readAllowlist(allowlistPath);
  if (entries.length === 0) {
    throw new Error("ALLOWLIST is empty");
  }

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  for (const entry of entries) {
    for (const item of expandAllowlistEntry(repoRoot, entry)) {
      const dest = join(outDir, item.destRel);
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(item.src, dest, { recursive: item.isDir });
    }
  }

  const files = walkRelative(outDir).filter((f) => f !== ".skill-stage.json");
  assertNoForbiddenPaths(files);

  const stamp = {
    generatedAt: new Date().toISOString(),
    files: files.sort(),
  };
  writeFileSync(join(outDir, ".skill-stage.json"), JSON.stringify(stamp, null, 2));

  return { outDir, files: stamp.files };
}

function parseArgs(argv: string[]): StageSkillOptions {
  const opts: StageSkillOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out" && argv[i + 1]) {
      opts.outDir = argv[++i];
    } else if (a === "--repo-root" && argv[i + 1]) {
      opts.repoRoot = argv[++i];
    } else if (a === "--allowlist" && argv[i + 1]) {
      opts.allowlistPath = argv[++i];
    }
  }
  return opts;
}

const isDirect =
  process.argv[1] &&
  normalize(fileURLToPath(import.meta.url)) === normalize(resolve(process.argv[1]));

if (isDirect) {
  const result = stageSkill(parseArgs(process.argv.slice(2)));
  console.log(`Staged ${result.files.length} files → ${result.outDir}`);
}

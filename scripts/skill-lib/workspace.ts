/**
 * Workspace path helpers (skill-portable copy of protocol-core workspace-profile).
 *
 * - `openclaw` → `<homedir>/.openclaw/workspace` (absolute OpenClaw default)
 * - `generic` → `$FPP_WORKSPACE` or `~/.fpp`
 * - `cursor` / `claude-code` / `codex` → `~/.fpp/<profile>`
 *
 * When `FPP_WORKSPACE` is set, it overrides the profile root for any profile.
 *
 * Legacy relative configs (e.g. `.openclaw/workspace/x`) are absolutized via
 * `absolutizeWorkspacePath` so scripts never accidentally resolve against skill CWD.
 */
import { homedir as osHomedir } from "node:os";
import { isAbsolute, join } from "node:path";

export type WorkspaceProfileId =
  | "openclaw"
  | "generic"
  | "cursor"
  | "claude-code"
  | "codex";

export const DEFAULT_WORKSPACE_PROFILE: WorkspaceProfileId = "openclaw";

const HARNESS_PROFILES = new Set<string>(["cursor", "claude-code", "codex"]);

const OPENCLAW_RELATIVE_PREFIX = ".openclaw/workspace";

export type ResolveWorkspaceOptions = {
  profile?: WorkspaceProfileId | string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  homedir?: (() => string) | undefined;
};

export type AbsolutizeWorkspaceOptions = ResolveWorkspaceOptions & {
  /** Optional detected OpenClaw workspace absolute path when FPP_WORKSPACE is unset. */
  openclawWorkspace?: string | undefined;
};

function normalizeRoot(root: string): string {
  return root.replace(/\\/g, "/").replace(/\/+$/, "");
}

function isAbsolutePath(p: string): boolean {
  const n = p.replace(/\\/g, "/");
  return isAbsolute(n) || /^[A-Za-z]:\//.test(n);
}

export function resolveWorkspaceRoot(
  options: ResolveWorkspaceOptions = {},
): string {
  const env = options.env ?? process.env;
  const override = env.FPP_WORKSPACE?.trim();
  if (override) {
    return normalizeRoot(override);
  }

  const profile = (options.profile ?? DEFAULT_WORKSPACE_PROFILE) as string;
  const home = () => (options.homedir ?? osHomedir)();

  if (profile === "generic") {
    return normalizeRoot(join(home(), ".fpp"));
  }

  if (HARNESS_PROFILES.has(profile)) {
    return normalizeRoot(join(home(), ".fpp", profile));
  }

  return normalizeRoot(join(home(), ".openclaw", "workspace"));
}

export function workspaceFile(
  filename: string,
  options: ResolveWorkspaceOptions = {},
): string {
  const root = resolveWorkspaceRoot(options);
  const name = filename.replace(/^\/+/, "");
  return `${root}/${name}`;
}

/**
 * Resolve a possibly-relative workspace path to an absolute path.
 *
 * Absolute inputs are returned normalized. Relative inputs resolve against:
 *   `FPP_WORKSPACE` → `openclawWorkspace` (if provided) → `homedir()`
 *
 * Legacy `.openclaw/workspace/...` strings map onto the workspace root + remainder
 * when the base is an explicit workspace override (FPP_WORKSPACE / openclawWorkspace).
 */
export function absolutizeWorkspacePath(
  inputPath: string,
  options: AbsolutizeWorkspaceOptions = {},
): string {
  const normalized = inputPath.replace(/\\/g, "/");
  if (isAbsolutePath(normalized)) {
    return normalizeRoot(normalized);
  }

  const env = options.env ?? process.env;
  const fppWs = env.FPP_WORKSPACE?.trim();
  const detected = options.openclawWorkspace?.trim();
  const home = (options.homedir ?? osHomedir)();

  const stripOpenclawPrefix = (base: string): string => {
    const root = normalizeRoot(base);
    if (
      normalized === OPENCLAW_RELATIVE_PREFIX ||
      normalized.startsWith(`${OPENCLAW_RELATIVE_PREFIX}/`)
    ) {
      const rest = normalized
        .slice(OPENCLAW_RELATIVE_PREFIX.length)
        .replace(/^\//, "");
      return rest ? `${root}/${rest}` : root;
    }
    return normalizeRoot(join(root, normalized));
  };

  if (fppWs) {
    return stripOpenclawPrefix(fppWs);
  }
  if (detected) {
    return stripOpenclawPrefix(detected);
  }
  return normalizeRoot(join(home, normalized));
}

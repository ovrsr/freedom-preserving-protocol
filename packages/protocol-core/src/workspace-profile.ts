/**
 * Harness-neutral workspace path profiles.
 *
 * - `openclaw` → `.openclaw/workspace` (preserves existing OpenClaw defaults)
 * - `generic` → `$FPP_WORKSPACE` or `~/.fpp`
 * - `cursor` / `claude-code` / `codex` → `~/.fpp/<profile>`
 *
 * When `FPP_WORKSPACE` is set, it overrides the profile root for any profile.
 */

import { homedir as osHomedir } from "node:os";
import { join } from "node:path";

export type WorkspaceProfileId =
  | "openclaw"
  | "generic"
  | "cursor"
  | "claude-code"
  | "codex";

export const DEFAULT_WORKSPACE_PROFILE: WorkspaceProfileId = "openclaw";

const HARNESS_PROFILES = new Set<string>(["cursor", "claude-code", "codex"]);

export type ResolveWorkspaceOptions = {
  profile?: WorkspaceProfileId | string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  homedir?: (() => string) | undefined;
};

function normalizeRoot(root: string): string {
  return root.replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * Resolve the workspace root directory for the active profile.
 */
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

  // openclaw (default) and unknown profiles preserve OpenClaw layout
  return ".openclaw/workspace";
}

/**
 * Join a filename under the resolved workspace root using forward slashes
 * (stable across hosts for config defaults and docs).
 */
export function workspaceFile(
  filename: string,
  options: ResolveWorkspaceOptions = {},
): string {
  const root = resolveWorkspaceRoot(options);
  const name = filename.replace(/^\/+/, "");
  return `${root}/${name}`;
}

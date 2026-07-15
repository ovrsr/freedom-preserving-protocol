/**
 * Workspace path helpers (skill-portable copy of protocol-core workspace-profile).
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

  return ".openclaw/workspace";
}

export function workspaceFile(
  filename: string,
  options: ResolveWorkspaceOptions = {},
): string {
  const root = resolveWorkspaceRoot(options);
  const name = filename.replace(/^\/+/, "");
  return `${root}/${name}`;
}

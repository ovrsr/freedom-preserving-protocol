/**
 * Bind optional FPP_ENFORCEMENT_CONFIG paths to a workspace profile root.
 */
import { resolve, normalize, sep } from "node:path";

export type AssertConfigPathOptions = {
  configPath: string;
  workspaceRoot: string;
};

/**
 * Resolve configPath and ensure it stays under workspaceRoot (no escape).
 * Returns the absolute resolved path.
 */
export function assertConfigPathAllowed(
  opts: AssertConfigPathOptions,
): string {
  const root = normalize(resolve(opts.workspaceRoot));
  const resolved = normalize(resolve(opts.configPath));
  const rootPrefix = root.endsWith(sep) ? root : root + sep;
  if (resolved !== root && !resolved.startsWith(rootPrefix)) {
    throw new Error(
      `FPP_ENFORCEMENT_CONFIG path is outside workspace root: ${resolved} (root=${root})`,
    );
  }
  return resolved;
}

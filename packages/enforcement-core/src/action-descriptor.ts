/**
 * Build steward ActionDescriptors from tool-call events.
 * First vertical slice: exact path extraction for apply_patch.
 */

import {
  isAbsolute as pathIsAbsolute,
  relative as pathRelative,
  resolve as pathResolve,
  sep as pathSep,
} from "node:path";
import { normalizeOpenClawToolName } from "./risk-classifier.js";

export type EnforcementActionDescriptor = {
  classification: string;
  toolName: string;
  resourcePaths: string[];
  targetsAmbiguous: boolean;
};

export type ToolCallLike = {
  toolName: string;
  params?: Record<string, unknown> | undefined;
};

const PATCH_HEADER_RE =
  /^\*\*\* (Add File|Update File|Delete File|Move to):\s*(.+?)\s*$/;

const FLAT_PATCH_TEXT_KEYS = [
  "patch",
  "input",
  "diff",
  "content",
  "text",
  "command",
] as const;

function validateRelativeResourcePath(raw: string): string | undefined {
  const trimmed = raw.trim().replace(/\\/g, "/");
  if (
    trimmed === "" ||
    trimmed.includes("\0") ||
    trimmed.includes("..") ||
    trimmed.startsWith("/") ||
    /^[a-zA-Z]:\//.test(trimmed)
  ) {
    return undefined;
  }
  return trimmed.replace(/^\.\//, "");
}

function looksAbsolute(pathStr: string): boolean {
  const slashNormalized = pathStr.replace(/\\/g, "/");
  return (
    pathIsAbsolute(pathStr) ||
    slashNormalized.startsWith("/") ||
    /^[a-zA-Z]:\//.test(slashNormalized)
  );
}

function normalizeWorkspaceRelativePath(
  raw: string,
  workspaceRoot: string,
  outOfWorkspacePaths?: Readonly<Record<string, string>>,
): string | undefined {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.includes("\0")) {
    return undefined;
  }

  const slashNormalized = trimmed.replace(/\\/g, "/");

  if (looksAbsolute(trimmed)) {
    // Resolve native absolutes and Unix-style /paths. Foreign drive-letter
    // forms on non-Windows hosts remain fail-closed.
    const canResolve =
      pathIsAbsolute(trimmed) || slashNormalized.startsWith("/");
    if (!canResolve) {
      return undefined;
    }

    const resolvedTarget = pathResolve(
      pathIsAbsolute(trimmed) ? trimmed : slashNormalized,
    );
    const alias = outOfWorkspacePaths?.[resolvedTarget];
    if (alias !== undefined) {
      return validateRelativeResourcePath(alias);
    }

    const rel = pathRelative(pathResolve(workspaceRoot), resolvedTarget);
    if (rel === "" || rel.startsWith("..") || pathIsAbsolute(rel)) {
      return undefined;
    }
    return rel.split(pathSep).join("/");
  }

  return validateRelativeResourcePath(slashNormalized);
}

/**
 * Extract every affected path from an apply_patch / V4A-style patch body.
 * Any unsupported/malformed header or unsafe path marks the result ambiguous
 * and clears the path list (fail closed — never return a partial list).
 */
export function extractApplyPatchTargets(
  patchText: string,
  workspaceRoot: string,
  outOfWorkspacePaths?: Readonly<Record<string, string>>,
): { paths: string[]; ambiguous: boolean } {
  if (typeof patchText !== "string" || patchText.trim() === "") {
    return { paths: [], ambiguous: true };
  }

  const paths: string[] = [];
  const seen = new Map<string, string>(); // path -> first operation
  let sawHeader = false;

  for (const line of patchText.split(/\r?\n/)) {
    const match = PATCH_HEADER_RE.exec(line);
    if (!match) continue;
    sawHeader = true;
    const op = match[1]!;
    const rawPath = match[2]!;
    const normalized = normalizeWorkspaceRelativePath(
      rawPath,
      workspaceRoot,
      outOfWorkspacePaths,
    );
    if (normalized === undefined) {
      return { paths: [], ambiguous: true };
    }
    const prior = seen.get(normalized);
    if (prior !== undefined && prior !== op) {
      return { paths: [], ambiguous: true };
    }
    if (prior === undefined) {
      seen.set(normalized, op);
      paths.push(normalized);
    }
  }

  if (!sawHeader) {
    return { paths: [], ambiguous: true };
  }
  return { paths, ambiguous: false };
}

function extractStructuredChangeTargets(
  changes: unknown[],
  workspaceRoot: string,
  outOfWorkspacePaths?: Readonly<Record<string, string>>,
): { paths: string[]; ambiguous: boolean } {
  if (changes.length === 0) {
    return { paths: [], ambiguous: true };
  }

  const paths: string[] = [];
  const seen = new Set<string>();

  for (const entry of changes) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return { paths: [], ambiguous: true };
    }
    const rawPath = (entry as { path?: unknown }).path;
    if (typeof rawPath !== "string") {
      return { paths: [], ambiguous: true };
    }
    const normalized = normalizeWorkspaceRelativePath(
      rawPath,
      workspaceRoot,
      outOfWorkspacePaths,
    );
    if (normalized === undefined) {
      return { paths: [], ambiguous: true };
    }
    if (seen.has(normalized)) {
      return { paths: [], ambiguous: true };
    }
    seen.add(normalized);
    paths.push(normalized);
  }

  return { paths, ambiguous: false };
}

function readPatchText(params: Record<string, unknown> | undefined): string | undefined {
  if (!params) return undefined;
  for (const key of FLAT_PATCH_TEXT_KEYS) {
    const value = params[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

/**
 * Translate an attempted tool call into the steward scope ActionDescriptor.
 */
export function buildActionDescriptor(
  event: ToolCallLike,
  classification: string,
  workspaceRoot: string,
  options?: {
    knownCustomTools?: readonly string[];
    outOfWorkspacePaths?: Readonly<Record<string, string>>;
  },
): EnforcementActionDescriptor {
  const toolName = normalizeOpenClawToolName(
    event.toolName,
    options?.knownCustomTools ?? [],
  );
  const outOfWorkspacePaths = options?.outOfWorkspacePaths;

  if (!/^apply_patch$/i.test(toolName)) {
    return {
      classification,
      toolName,
      resourcePaths: [],
      targetsAmbiguous: false,
    };
  }

  if (Array.isArray(event.params?.changes)) {
    const extracted = extractStructuredChangeTargets(
      event.params.changes,
      workspaceRoot,
      outOfWorkspacePaths,
    );
    return {
      classification,
      toolName,
      resourcePaths: extracted.ambiguous ? [] : extracted.paths,
      targetsAmbiguous: extracted.ambiguous,
    };
  }

  const patchText = readPatchText(event.params);
  if (patchText === undefined) {
    return {
      classification,
      toolName,
      resourcePaths: [],
      targetsAmbiguous: true,
    };
  }

  const extracted = extractApplyPatchTargets(
    patchText,
    workspaceRoot,
    outOfWorkspacePaths,
  );
  return {
    classification,
    toolName,
    resourcePaths: extracted.ambiguous ? [] : extracted.paths,
    targetsAmbiguous: extracted.ambiguous,
  };
}

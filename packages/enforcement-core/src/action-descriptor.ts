/**
 * Build steward ActionDescriptors from tool-call events.
 * First vertical slice: exact path extraction for apply_patch.
 */

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

function normalizeWorkspaceRelativePath(
  raw: string,
  _workspaceRoot: string,
): string | undefined {
  const trimmed = raw.trim().replace(/\\/g, "/");
  if (
    trimmed === "" ||
    trimmed.startsWith("/") ||
    /^[a-zA-Z]:\//.test(trimmed) ||
    trimmed.includes("..") ||
    trimmed.includes("\0")
  ) {
    return undefined;
  }
  return trimmed.replace(/^\.\//, "");
}

/**
 * Extract every affected path from an apply_patch / V4A-style patch body.
 * Any unsupported/malformed header or unsafe path marks the result ambiguous
 * and clears the path list (fail closed — never return a partial list).
 */
export function extractApplyPatchTargets(
  patchText: string,
  workspaceRoot: string,
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
    const normalized = normalizeWorkspaceRelativePath(rawPath, workspaceRoot);
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

function readPatchText(params: Record<string, unknown> | undefined): string | undefined {
  if (!params) return undefined;
  for (const key of ["patch", "input", "diff", "content", "text"] as const) {
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
  options?: { knownCustomTools?: readonly string[] },
): EnforcementActionDescriptor {
  const toolName = normalizeOpenClawToolName(
    event.toolName,
    options?.knownCustomTools ?? [],
  );

  if (!/^apply_patch$/i.test(toolName)) {
    return {
      classification,
      toolName,
      resourcePaths: [],
      targetsAmbiguous: false,
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

  const extracted = extractApplyPatchTargets(patchText, workspaceRoot);
  return {
    classification,
    toolName,
    resourcePaths: extracted.ambiguous ? [] : extracted.paths,
    targetsAmbiguous: extracted.ambiguous,
  };
}

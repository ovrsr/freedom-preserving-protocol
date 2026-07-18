/**
 * Exact scope matching for operator authorizations.
 */

export type ActionDescriptor = {
  classification: string;
  toolName: string;
  resourcePaths: string[];
  /** True when targets could not be extracted unambiguously. */
  targetsAmbiguous: boolean;
};

export type ScopeMatchReason =
  | "matched"
  | "none"
  | "scope-mismatch"
  | "target-ambiguous";

export type ScopeMatchResult = {
  matched: boolean;
  reason: ScopeMatchReason;
};

function normalizeToolName(name: string): string {
  return name.trim().toLowerCase();
}

function normalizePath(path: string): string | undefined {
  const trimmed = path.replace(/\\/g, "/").replace(/^\.\//, "");
  if (
    trimmed === "" ||
    trimmed.startsWith("/") ||
    trimmed.includes("..") ||
    trimmed.includes("*")
  ) {
    return undefined;
  }
  return trimmed;
}

export function matchesAuthorizationScope(
  scope: {
    classifications: string[];
    toolNames?: string[] | undefined;
    resourcePaths?: string[] | undefined;
  },
  action: ActionDescriptor,
): ScopeMatchResult {
  if (!scope.classifications.includes(action.classification)) {
    return { matched: false, reason: "scope-mismatch" };
  }

  if (scope.toolNames !== undefined && scope.toolNames.length > 0) {
    const allowed = new Set(scope.toolNames.map(normalizeToolName));
    if (!allowed.has(normalizeToolName(action.toolName))) {
      return { matched: false, reason: "scope-mismatch" };
    }
  }

  if (scope.resourcePaths !== undefined && scope.resourcePaths.length > 0) {
    if (action.targetsAmbiguous) {
      return { matched: false, reason: "target-ambiguous" };
    }
    if (action.resourcePaths.length === 0) {
      return { matched: false, reason: "target-ambiguous" };
    }
    const allowedPaths = new Set<string>();
    for (const p of scope.resourcePaths) {
      const n = normalizePath(p);
      if (n === undefined) {
        return { matched: false, reason: "scope-mismatch" };
      }
      allowedPaths.add(n);
    }
    for (const target of action.resourcePaths) {
      const n = normalizePath(target);
      if (n === undefined || !allowedPaths.has(n)) {
        return { matched: false, reason: "scope-mismatch" };
      }
    }
  }

  return { matched: true, reason: "matched" };
}

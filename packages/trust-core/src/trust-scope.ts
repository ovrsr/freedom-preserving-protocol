/**
 * Capability/context/time scoped directed trust assessments.
 *
 * Trust(A → B, capability, context, time) — never an unscoped symmetric level.
 */

import { TrustLevel } from "./trust-graph.js";

export type TrustScope = {
  capability: string;
  resource?: string;
  audience?: string;
  environment?: string;
};

export const DEFAULT_SCOPE: TrustScope = {
  capability: "*",
  resource: "*",
  audience: "*",
  environment: "*",
};

export type ScopedAssessment = {
  from: string;
  to: string;
  scope: TrustScope;
  level: TrustLevel;
  confidence: number;
  validFrom: number;
  validUntil: number;
  source: "direct" | "propagated" | "steward-override" | "conservative-default" | "legacy";
  rationale?: string;
};

export type EvaluateOptions = {
  allowConservativeDefault?: boolean;
};

export function scopesCompatible(
  stored: TrustScope,
  requested: Partial<TrustScope>,
): boolean {
  const reqCap = requested.capability ?? "*";
  if (stored.capability !== "*" && stored.capability !== reqCap && reqCap !== "*") {
    return false;
  }
  if (
    stored.environment &&
    stored.environment !== "*" &&
    requested.environment &&
    requested.environment !== "*" &&
    stored.environment !== requested.environment
  ) {
    return false;
  }
  if (
    stored.audience &&
    stored.audience !== "*" &&
    requested.audience &&
    requested.audience !== "*" &&
    stored.audience !== requested.audience
  ) {
    return false;
  }
  if (
    stored.resource &&
    stored.resource !== "*" &&
    requested.resource &&
    requested.resource !== "*" &&
    stored.resource !== requested.resource
  ) {
    return false;
  }
  return true;
}

export function isAssessmentValidAt(
  assessment: ScopedAssessment,
  atMs: number,
): boolean {
  return atMs >= assessment.validFrom && atMs <= assessment.validUntil;
}

function assessmentKey(from: string, to: string, scope: TrustScope): string {
  return [
    from,
    to,
    scope.capability,
    scope.resource ?? "*",
    scope.audience ?? "*",
    scope.environment ?? "*",
  ].join("|");
}

export class ScopedTrustStore {
  private assessments = new Map<string, ScopedAssessment>();

  put(assessment: ScopedAssessment): void {
    this.assessments.set(
      assessmentKey(assessment.from, assessment.to, assessment.scope),
      assessment,
    );
  }

  list(): ScopedAssessment[] {
    return [...this.assessments.values()];
  }

  evaluate(
    from: string,
    to: string,
    requested: Partial<TrustScope>,
    atMs: number,
    options?: EvaluateOptions,
  ): ScopedAssessment | null {
    const matches: ScopedAssessment[] = [];
    for (const a of this.assessments.values()) {
      if (a.from !== from || a.to !== to) continue;
      if (!isAssessmentValidAt(a, atMs)) continue;
      if (!scopesCompatible(a.scope, requested)) continue;
      matches.push(a);
    }

    if (matches.length > 0) {
      // Prefer exact capability match, then highest confidence
      matches.sort((x, y) => {
        const req = requested.capability ?? "*";
        const xe = x.scope.capability === req ? 1 : 0;
        const ye = y.scope.capability === req ? 1 : 0;
        if (xe !== ye) return ye - xe;
        return y.confidence - x.confidence;
      });
      return matches[0]!;
    }

    if (options?.allowConservativeDefault) {
      return {
        from,
        to,
        scope: {
          capability: requested.capability ?? DEFAULT_SCOPE.capability,
          resource: requested.resource ?? "*",
          audience: requested.audience ?? "*",
          environment: requested.environment ?? "*",
        },
        level: TrustLevel.LOW,
        confidence: 0.2,
        validFrom: atMs,
        validUntil: atMs,
        source: "conservative-default",
        rationale: "no matching scoped assessment; conservative default applied",
      };
    }
    return null;
  }

  /** Format scope for tool/CLI display. */
  static formatScope(scope: Partial<TrustScope>): string {
    return (
      `capability=${scope.capability ?? "*"}` +
      ` resource=${scope.resource ?? "*"}` +
      ` audience=${scope.audience ?? "*"}` +
      ` env=${scope.environment ?? "*"}`
    );
  }
}

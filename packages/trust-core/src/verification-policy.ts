/**
 * Versioned handshake verification policy.
 *
 * New installs default to hardened-v2. Weaker modes are explicit and emit
 * prominent diagnostics so operators cannot enable them silently.
 */

export const VERIFICATION_POLICIES = [
  "hardened-v2",
  "v2-with-legacy-declarations",
  "legacy-unsafe",
] as const;

export type VerificationPolicy = (typeof VERIFICATION_POLICIES)[number];

export type ResolvedVerificationPolicy = {
  policy: VerificationPolicy;
  requireSignedClaims: boolean;
  requireFreshness: boolean;
  /** Allow parsing/inspecting v1 claims without trust elevation. */
  allowLegacyDeclarations: boolean;
  diagnostic: string;
};

const HARDENED: ResolvedVerificationPolicy = {
  policy: "hardened-v2",
  requireSignedClaims: true,
  requireFreshness: true,
  allowLegacyDeclarations: false,
  diagnostic: "verificationPolicy=hardened-v2 (signed fresh v2 claims required)",
};

/**
 * Resolve a verification policy from raw plugin config.
 * Unknown values fail closed to hardened-v2.
 * legacy-unsafe requires acknowledgeDangerousOverrides: true.
 */
export function resolveVerificationPolicy(
  raw: Record<string, unknown>,
): ResolvedVerificationPolicy {
  const value = raw.verificationPolicy;
  const ack = raw.acknowledgeDangerousOverrides === true;

  if (value === undefined || value === null || value === "") {
    return { ...HARDENED };
  }

  if (value === "hardened-v2") return { ...HARDENED };

  if (value === "v2-with-legacy-declarations") {
    return {
      policy: "v2-with-legacy-declarations",
      requireSignedClaims: true,
      requireFreshness: true,
      allowLegacyDeclarations: true,
      diagnostic:
        "WARNING: verificationPolicy=v2-with-legacy-declarations — " +
        "legacy v1 claims are declaration-only and cannot elevate trust. " +
        "Prefer hardened-v2 for production.",
    };
  }

  if (value === "legacy-unsafe") {
    if (!ack) {
      return {
        ...HARDENED,
        diagnostic:
          "DANGEROUS_LEGACY_UNSAFE: verificationPolicy=legacy-unsafe requires " +
          "acknowledgeDangerousOverrides: true. Failing closed to hardened-v2. " +
          "Config file was not rewritten.",
      };
    }
    return {
      policy: "legacy-unsafe",
      requireSignedClaims: false,
      requireFreshness: false,
      allowLegacyDeclarations: true,
      diagnostic:
        "WARNING: verificationPolicy=legacy-unsafe — VISIBLY WEAKER. " +
        "Unsigned and unchallenged claims may be accepted. " +
        "Do not use outside controlled migration windows.",
    };
  }

  return {
    ...HARDENED,
    diagnostic: `unknown verificationPolicy=${String(value)}; failing closed to hardened-v2`,
  };
}

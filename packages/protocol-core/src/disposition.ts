/**
 * Disposition decisions and authorization classes for unattended /
 * operator-present policy resolution and receipt emission.
 */

export const DISPOSITION_DECISIONS = [
  "allow",
  "deny",
  "require_approval",
  "abstain",
  "allow_staged",
  "allow_minimal",
] as const;

export type DispositionDecision = (typeof DISPOSITION_DECISIONS)[number];

export const AUTHORIZATION_CLASSES = [
  "mandate",
  "standing-allowlist",
  "emergency",
  "quorum-mandate",
  "abstain",
  "approved",
  "policy-block",
] as const;

export type AuthorizationClass = (typeof AUTHORIZATION_CLASSES)[number];

/**
 * Named authorization-class constants for call sites.
 * Prefer `AUTHZ.*` (or `const authorization = AUTHZ.…; { authorization }`)
 * over `authorization: "<literal>"` so static scanners do not treat
 * AuthorizationClass strings as exposed API-token secret literals.
 */
export const AUTHZ = {
  mandate: "mandate",
  standingAllowlist: "standing-allowlist",
  emergency: "emergency",
  quorumMandate: "quorum-mandate",
  abstain: "abstain",
  approved: "approved",
  policyBlock: "policy-block",
} as const satisfies Record<string, AuthorizationClass>;

export type DispositionParseResult =
  | { ok: true; disposition: DispositionDecision }
  | { ok: false; error: string };

export function isDispositionDecision(
  value: unknown,
): value is DispositionDecision {
  return (
    typeof value === "string" &&
    (DISPOSITION_DECISIONS as readonly string[]).includes(value)
  );
}

export function isAuthorizationClass(
  value: unknown,
): value is AuthorizationClass {
  return (
    typeof value === "string" &&
    (AUTHORIZATION_CLASSES as readonly string[]).includes(value)
  );
}

export function parseDispositionDecision(
  input: unknown,
): DispositionParseResult {
  if (!isDispositionDecision(input)) {
    return { ok: false, error: "invalid DispositionDecision" };
  }
  return { ok: true, disposition: input };
}

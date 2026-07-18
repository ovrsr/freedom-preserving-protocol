/**
 * Steward / operator authorization wire contracts.
 *
 * Key-independent human steward identity and OpenPGP-signed authorization
 * payloads. Verification backends live in `@ovrsr/fpp-steward-auth-core`;
 * this module defines schemas, mint/parse helpers, and domain digests only.
 */

import { randomBytes } from "node:crypto";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { digest } from "./digest.js";

/** RFC 4648 base32 alphabet (lowercase, no padding). */
const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

const STEWARD_ID_RE = /^fpp:steward:v1:([a-z2-7]{26})$/;
/** OpenPGP V4 fingerprint is 40 hex chars; V5 is 64. Accept both lowercase. */
const OPENPGP_KEY_REF_RE = /^openpgp:([0-9a-f]{40}|[0-9a-f]{64})$/;
/** High-entropy nonce: ≥32 chars of base64url / hex / base32. */
const NONCE_RE = /^[A-Za-z0-9_-]{32,128}$/;
const ISO_8601_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/** Classifications that operator authority must never satisfy. */
const NON_DELEGABLE_CLASSIFICATIONS = new Set([
  "affected-party-consent",
  "data-subject-consent",
  "constitutional-ratification",
]);

export const STEWARD_DIGEST_DOMAINS = {
  evidence: "fpp:v2:steward-evidence",
  replay: "fpp:v2:steward-replay",
  attestation: "fpp:v2:steward-attestation",
  authorization: "fpp:v2:steward-authorization",
  revocation: "fpp:v2:steward-authorization-revocation",
} as const;

export type StewardIdV1 = `fpp:steward:v1:${string}`;

export type ParsedStewardIdV1 = {
  kind: "v1";
  raw: StewardIdV1;
  idBody: string;
};

export type StewardIdParseResult =
  | { ok: true; stewardId: ParsedStewardIdV1 }
  | { ok: false; error: string };

export type ParsedKeyRef = {
  algorithm: string;
  identifier: string;
  raw: string;
};

export type KeyRefParseResult =
  | { ok: true; keyRef: ParsedKeyRef }
  | { ok: false; error: string };

function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]!;
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31]!;
  }
  return output;
}

/** Mint a key-independent steward ID from 128 random bits. */
export function mintStewardIdV1(): StewardIdV1 {
  const body = encodeBase32(randomBytes(16));
  return `fpp:steward:v1:${body}`;
}

export function isStewardIdV1(value: unknown): value is StewardIdV1 {
  return typeof value === "string" && STEWARD_ID_RE.test(value);
}

export function parseStewardIdV1(value: unknown): StewardIdParseResult {
  if (typeof value !== "string") {
    return { ok: false, error: "steward id must be a string" };
  }
  const match = STEWARD_ID_RE.exec(value);
  if (!match) {
    return {
      ok: false,
      error: "steward id must be fpp:steward:v1:<26 lowercase base32 chars>",
    };
  }
  return {
    ok: true,
    stewardId: {
      kind: "v1",
      raw: value as StewardIdV1,
      idBody: match[1]!,
    },
  };
}

export const KeyRefSchema = Type.String({
  minLength: 1,
  pattern: "^[a-z0-9]+:[a-z0-9]+$",
});

export function parseKeyRef(value: unknown): KeyRefParseResult {
  if (typeof value !== "string") {
    return { ok: false, error: "key ref must be a string" };
  }
  const openpgp = OPENPGP_KEY_REF_RE.exec(value);
  if (openpgp) {
    return {
      ok: true,
      keyRef: {
        algorithm: "openpgp",
        identifier: openpgp[1]!,
        raw: value,
      },
    };
  }
  // Future algorithms: algorithm:identifier with lowercase identifier body.
  const generic = /^([a-z][a-z0-9]*):([a-z0-9]{8,128})$/.exec(value);
  if (generic && generic[1] !== "openpgp") {
    return {
      ok: true,
      keyRef: {
        algorithm: generic[1]!,
        identifier: generic[2]!,
        raw: value,
      },
    };
  }
  return {
    ok: false,
    error:
      "key ref must be algorithm-qualified (e.g. openpgp:<lowercase fingerprint>)",
  };
}

const StewardSubjectKeySchema = Type.Object(
  {
    algorithm: Type.String({ minLength: 1 }),
    keyRef: Type.String({ minLength: 1 }),
    publicKeyArmored: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

export const StewardKeyAttestationV1Schema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    kind: Type.Literal("steward-key-attestation"),
    attestationId: Type.String({ minLength: 1 }),
    operation: Type.Union([
      Type.Literal("initial-bind"),
      Type.Literal("add"),
      Type.Literal("rotate"),
      Type.Literal("revoke"),
    ]),
    stewardId: Type.String({ minLength: 1 }),
    audience: Type.String({ minLength: 1 }),
    subjectKey: StewardSubjectKeySchema,
    replacesKeyRef: Type.Optional(Type.String({ minLength: 1 })),
    issuedAt: Type.String({ minLength: 1 }),
    nonce: Type.String({ minLength: 1 }),
    reason: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type StewardKeyAttestationV1 = Static<
  typeof StewardKeyAttestationV1Schema
>;

export type StewardKeyAttestationParseResult =
  | { ok: true; attestation: StewardKeyAttestationV1 }
  | { ok: false; error: string };

const AuthorizationScopeSchema = Type.Object(
  {
    classifications: Type.Array(Type.String({ minLength: 1 }), {
      minItems: 1,
    }),
    toolNames: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
    ),
    resourcePaths: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
    ),
  },
  { additionalProperties: false },
);

export const OperatorAuthorizationV1Schema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    kind: Type.Literal("operator-authorization"),
    authorizationId: Type.String({ minLength: 1 }),
    stewardId: Type.String({ minLength: 1 }),
    signingKeyRef: Type.String({ minLength: 1 }),
    audience: Type.String({ minLength: 1 }),
    mode: Type.Union([Type.Literal("one-shot"), Type.Literal("standing")]),
    scope: AuthorizationScopeSchema,
    issuedAt: Type.String({ minLength: 1 }),
    expiresAt: Type.String({ minLength: 1 }),
    nonce: Type.String({ minLength: 1 }),
    maxUses: Type.Integer({ minimum: 1 }),
    reason: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type OperatorAuthorizationV1 = Static<
  typeof OperatorAuthorizationV1Schema
>;

export type OperatorAuthorizationParseResult =
  | { ok: true; authorization: OperatorAuthorizationV1 }
  | { ok: false; error: string };

export const OperatorAuthorizationRevocationV1Schema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    kind: Type.Literal("operator-authorization-revocation"),
    authorizationId: Type.String({ minLength: 1 }),
    stewardId: Type.String({ minLength: 1 }),
    signingKeyRef: Type.String({ minLength: 1 }),
    audience: Type.String({ minLength: 1 }),
    issuedAt: Type.String({ minLength: 1 }),
    nonce: Type.String({ minLength: 1 }),
    reason: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type OperatorAuthorizationRevocationV1 = Static<
  typeof OperatorAuthorizationRevocationV1Schema
>;

export type OperatorAuthorizationRevocationParseResult =
  | { ok: true; revocation: OperatorAuthorizationRevocationV1 }
  | { ok: false; error: string };

export type BoundsResult = { ok: true } | { ok: false; error: string };

function firstTypeboxError(
  schema: Parameters<typeof Value.Errors>[0],
  input: unknown,
  fallback: string,
): string {
  const errors = [...Value.Errors(schema, input)];
  return errors[0] !== undefined
    ? `${errors[0].path}: ${errors[0].message}`
    : fallback;
}

function hasDuplicateStrings(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

function isValidIso8601(value: string): boolean {
  if (!ISO_8601_RE.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

function validateSharedIdentityFields(fields: {
  stewardId: string;
  audience: string;
  nonce: string;
  issuedAt: string;
  keyRef: string;
}): string | undefined {
  if (!isStewardIdV1(fields.stewardId)) {
    return "invalid stewardId";
  }
  if (fields.audience.trim().length === 0) {
    return "audience must be non-empty";
  }
  if (!NONCE_RE.test(fields.nonce)) {
    return "nonce must be 32–128 URL-safe alphanumeric characters";
  }
  if (!isValidIso8601(fields.issuedAt)) {
    return "issuedAt must be ISO-8601 UTC";
  }
  if (!parseKeyRef(fields.keyRef).ok) {
    return "invalid key ref";
  }
  return undefined;
}

function validateScope(
  scope: OperatorAuthorizationV1["scope"],
): string | undefined {
  if (scope.classifications.length === 0) {
    return "classifications must be non-empty";
  }
  if (hasDuplicateStrings(scope.classifications)) {
    return "duplicate classifications";
  }
  for (const c of scope.classifications) {
    if (c.includes("*") || c === "") {
      return "wildcard/empty classifications are forbidden";
    }
    if (NON_DELEGABLE_CLASSIFICATIONS.has(c)) {
      return `operator authority cannot satisfy classification: ${c}`;
    }
  }
  if (scope.toolNames !== undefined) {
    if (scope.toolNames.length === 0) {
      return "toolNames must be non-empty when present";
    }
    if (hasDuplicateStrings(scope.toolNames)) {
      return "duplicate toolNames";
    }
    for (const t of scope.toolNames) {
      if (t.includes("*") || t === "") {
        return "wildcard/empty toolNames are forbidden";
      }
    }
  }
  if (scope.resourcePaths !== undefined) {
    if (scope.resourcePaths.length === 0) {
      return "resourcePaths must be non-empty when present";
    }
    if (hasDuplicateStrings(scope.resourcePaths)) {
      return "duplicate resourcePaths";
    }
    for (const p of scope.resourcePaths) {
      if (p.includes("*") || p === "" || p.startsWith("/") || p.includes("..")) {
        return "invalid resourcePaths entry";
      }
    }
  }
  return undefined;
}

export function parseStewardKeyAttestation(
  input: unknown,
): StewardKeyAttestationParseResult {
  if (!Value.Check(StewardKeyAttestationV1Schema, input)) {
    return {
      ok: false,
      error: firstTypeboxError(
        StewardKeyAttestationV1Schema,
        input,
        "invalid StewardKeyAttestationV1",
      ),
    };
  }
  const attestation = input;
  const shared = validateSharedIdentityFields({
    stewardId: attestation.stewardId,
    audience: attestation.audience,
    nonce: attestation.nonce,
    issuedAt: attestation.issuedAt,
    keyRef: attestation.subjectKey.keyRef,
  });
  if (shared) {
    return { ok: false, error: shared };
  }
  if (attestation.subjectKey.algorithm.trim().length === 0) {
    return { ok: false, error: "subjectKey.algorithm required" };
  }
  if (
    attestation.operation === "rotate" &&
    (attestation.replacesKeyRef === undefined ||
      !parseKeyRef(attestation.replacesKeyRef).ok)
  ) {
    return { ok: false, error: "rotate requires valid replacesKeyRef" };
  }
  if (
    attestation.replacesKeyRef !== undefined &&
    !parseKeyRef(attestation.replacesKeyRef).ok
  ) {
    return { ok: false, error: "invalid replacesKeyRef" };
  }
  return { ok: true, attestation };
}

export function parseOperatorAuthorization(
  input: unknown,
): OperatorAuthorizationParseResult {
  if (!Value.Check(OperatorAuthorizationV1Schema, input)) {
    return {
      ok: false,
      error: firstTypeboxError(
        OperatorAuthorizationV1Schema,
        input,
        "invalid OperatorAuthorizationV1",
      ),
    };
  }
  const authorization = input;
  const shared = validateSharedIdentityFields({
    stewardId: authorization.stewardId,
    audience: authorization.audience,
    nonce: authorization.nonce,
    issuedAt: authorization.issuedAt,
    keyRef: authorization.signingKeyRef,
  });
  if (shared) {
    return { ok: false, error: shared };
  }
  if (!isValidIso8601(authorization.expiresAt)) {
    return { ok: false, error: "expiresAt must be ISO-8601 UTC" };
  }
  const scopeError = validateScope(authorization.scope);
  if (scopeError) {
    return { ok: false, error: scopeError };
  }
  const bounds = validateOperatorAuthorizationBounds(authorization);
  if (!bounds.ok) {
    return { ok: false, error: bounds.error };
  }
  return { ok: true, authorization };
}

export function parseOperatorAuthorizationRevocation(
  input: unknown,
): OperatorAuthorizationRevocationParseResult {
  if (!Value.Check(OperatorAuthorizationRevocationV1Schema, input)) {
    return {
      ok: false,
      error: firstTypeboxError(
        OperatorAuthorizationRevocationV1Schema,
        input,
        "invalid OperatorAuthorizationRevocationV1",
      ),
    };
  }
  const revocation = input;
  const shared = validateSharedIdentityFields({
    stewardId: revocation.stewardId,
    audience: revocation.audience,
    nonce: revocation.nonce,
    issuedAt: revocation.issuedAt,
    keyRef: revocation.signingKeyRef,
  });
  if (shared) {
    return { ok: false, error: shared };
  }
  return { ok: true, revocation };
}

/**
 * Temporal / mode bounds for a schema-shaped authorization.
 * Local policy caps (max lifetime / maxUses) are applied by steward-auth-core.
 */
export function validateOperatorAuthorizationBounds(
  authorization: OperatorAuthorizationV1,
): BoundsResult {
  const issued = Date.parse(authorization.issuedAt);
  const expires = Date.parse(authorization.expiresAt);
  if (Number.isNaN(issued) || Number.isNaN(expires)) {
    return { ok: false, error: "issuedAt/expiresAt must be ISO-8601" };
  }
  if (expires <= issued) {
    return { ok: false, error: "expiresAt must be after issuedAt" };
  }
  if (authorization.mode === "one-shot" && authorization.maxUses !== 1) {
    return { ok: false, error: "one-shot authorizations require maxUses: 1" };
  }
  if (authorization.mode === "standing" && authorization.maxUses < 1) {
    return {
      ok: false,
      error: "standing authorizations require finite positive maxUses",
    };
  }
  return { ok: true };
}

/** Signed bytes are exactly canonicalizeV2 of these fields (no trailing newline). */
export function attestationSigningFields(
  attestation: StewardKeyAttestationV1,
): Record<string, unknown> {
  return { ...attestation };
}

export function authorizationSigningFields(
  authorization: OperatorAuthorizationV1,
): Record<string, unknown> {
  return { ...authorization };
}

export function authorizationRevocationSigningFields(
  revocation: OperatorAuthorizationRevocationV1,
): Record<string, unknown> {
  return { ...revocation };
}

export function buildStewardEvidenceDigest(payload: unknown): string {
  return digest({
    version: 2,
    domain: STEWARD_DIGEST_DOMAINS.evidence,
    value: payload,
  });
}

export function buildStewardReplayDigest(payload: unknown): string {
  return digest({
    version: 2,
    domain: STEWARD_DIGEST_DOMAINS.replay,
    value: payload,
  });
}

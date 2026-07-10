/**
 * Versioned constitutional claim schemas and parsers.
 *
 * Untrusted peer JSON is runtime-validated. Legacy v1 claims are accepted
 * only as declaration-only input and are never silently upgraded to v2.
 */

import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { KEY_ALGORITHM } from "./identity.js";
import { FreshnessEnvelopeSchema } from "./freshness.js";

export const CLAIM_CLASSES = [
  "identity",
  "configuration",
  "runtime",
  "event",
  "completeness",
  "behavioral",
] as const;

export type ClaimClass = (typeof CLAIM_CLASSES)[number];

export const LegacyConstitutionalClaimV1Schema = Type.Object(
  {
    agentId: Type.String({ minLength: 1 }),
    constitutionHash: Type.String({ minLength: 1 }),
    adoptedAt: Type.String({ minLength: 1 }),
    auditMerkleRoot: Type.String({ minLength: 1 }),
    auditEntryCount: Type.Integer({ minimum: 0 }),
    chainIntact: Type.Boolean(),
    recentLaws: Type.Array(Type.String()),
  },
  { additionalProperties: true },
);

export type LegacyConstitutionalClaimV1 = Static<
  typeof LegacyConstitutionalClaimV1Schema
>;

export const ConstitutionalClaimV2Schema = Type.Object(
  {
    schemaVersion: Type.Literal(2),
    claimClass: Type.Union(
      CLAIM_CLASSES.map((c) => Type.Literal(c)) as [
        ReturnType<typeof Type.Literal<(typeof CLAIM_CLASSES)[number]>>,
        ...ReturnType<typeof Type.Literal<(typeof CLAIM_CLASSES)[number]>>[],
      ],
    ),
    agentId: Type.String({ pattern: "^fpp:ed25519:[0-9a-fA-F]{64}$" }),
    keyAlgorithm: Type.Literal(KEY_ALGORITHM),
    constitutionHash: Type.String({ minLength: 1 }),
    adoptedAt: Type.String({ minLength: 1 }),
    auditMerkleRoot: Type.String({ minLength: 1 }),
    auditEntryCount: Type.Integer({ minimum: 0 }),
    chainIntact: Type.Boolean(),
    recentLaws: Type.Array(Type.String()),
    /** When present, freshness fields are part of the signed canonical payload. */
    freshness: Type.Optional(FreshnessEnvelopeSchema),
  },
  { additionalProperties: true },
);

export type ConstitutionalClaimV2 = Static<typeof ConstitutionalClaimV2Schema>;

export type ClaimParseResult =
  | {
      ok: true;
      kind: "legacy-v1";
      assurance: "declaration-only";
      claim: LegacyConstitutionalClaimV1;
      diagnostics: string[];
    }
  | {
      ok: true;
      kind: "v2";
      assurance: "schema-validated";
      claim: ConstitutionalClaimV2;
      diagnostics: string[];
    }
  | {
      ok: false;
      error: string;
      diagnostics: string[];
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Parse untrusted claim JSON into an explicit v1 or v2 result.
 * Unknown critical versions fail closed. V1 never escalates to v2 assurance.
 */
export function parseClaim(input: unknown): ClaimParseResult {
  if (!isRecord(input)) {
    return {
      ok: false,
      error: "claim must be a JSON object",
      diagnostics: ["expected object"],
    };
  }

  if ("schemaVersion" in input) {
    if (input.schemaVersion === 2) {
      const errors = [...Value.Errors(ConstitutionalClaimV2Schema, input)];
      if (errors.length > 0) {
        return {
          ok: false,
          error: "malformed constitutional claim v2",
          diagnostics: errors.map((e) => `${e.path}: ${e.message}`),
        };
      }
      return {
        ok: true,
        kind: "v2",
        assurance: "schema-validated",
        claim: input as ConstitutionalClaimV2,
        diagnostics: [],
      };
    }
    return {
      ok: false,
      error: `unsupported critical schema version: ${String(input.schemaVersion)}`,
      diagnostics: [`schemaVersion=${String(input.schemaVersion)}`],
    };
  }

  const errors = [...Value.Errors(LegacyConstitutionalClaimV1Schema, input)];
  if (errors.length > 0) {
    return {
      ok: false,
      error: "malformed legacy constitutional claim v1",
      diagnostics: errors.map((e) => `${e.path}: ${e.message}`),
    };
  }

  return {
    ok: true,
    kind: "legacy-v1",
    assurance: "declaration-only",
    claim: input as LegacyConstitutionalClaimV1,
    diagnostics: [
      "legacy-v1 accepted as declaration-only; not escalated to v2 assurance",
    ],
  };
}

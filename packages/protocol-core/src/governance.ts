/**
 * Gateway governance transition contracts: modes, epochs, and audited events.
 *
 * These schemas define the voluntary constitutional-layer state machine
 * (enabled → draining → disabled) without implying gateway enforcement is shipped.
 */

import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export const GOVERNANCE_MODES = ["enabled", "draining", "disabled"] as const;

export type GovernanceMode = (typeof GOVERNANCE_MODES)[number];

export const GOVERNANCE_EVENT_KINDS = [
  "governance-enabled",
  "governance-disabled",
] as const;

export type GovernanceEventKind = (typeof GOVERNANCE_EVENT_KINDS)[number];

/** SHA-256 hex digest (64 lowercase or uppercase hex chars). */
const HexDigest64 = Type.String({ pattern: "^[0-9a-fA-F]{64}$" });

export const GovernanceEpochSchema = Type.Integer({ minimum: 0 });

export const GovernanceModeSchema = Type.Union(
  GOVERNANCE_MODES.map((m) => Type.Literal(m)) as [
    ReturnType<typeof Type.Literal<(typeof GOVERNANCE_MODES)[number]>>,
    ...ReturnType<typeof Type.Literal<(typeof GOVERNANCE_MODES)[number]>>[],
  ],
);

export const GovernanceStateV1Schema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    mode: GovernanceModeSchema,
    epoch: GovernanceEpochSchema,
  },
  { additionalProperties: false },
);

export type GovernanceStateV1 = Static<typeof GovernanceStateV1Schema>;

export const GovernanceActorSchema = Type.Object(
  {
    role: Type.String({ minLength: 1 }),
    id: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export const GovernanceEventSignatureSchema = Type.Object(
  {
    alg: Type.String({ minLength: 1 }),
    keyId: Type.String({ minLength: 1 }),
    sig: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

/**
 * Tamper-evident governance enable/disable event.
 * `epoch` is the published epoch after the transition; `previousMode` is the
 * mode immediately before durable publication of this event.
 */
export const GovernanceEventV1Schema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    kind: Type.Union([
      Type.Literal("governance-enabled"),
      Type.Literal("governance-disabled"),
    ]),
    eventId: Type.String({ minLength: 1 }),
    ts: Type.String({ minLength: 1 }),
    epoch: GovernanceEpochSchema,
    previousMode: GovernanceModeSchema,
    mode: GovernanceModeSchema,
    actor: GovernanceActorSchema,
    constitutionHash: HexDigest64,
    policyEngineVersion: Type.String({ minLength: 1 }),
    prevHash: HexDigest64,
    entryHash: HexDigest64,
    reason: Type.Optional(Type.String({ minLength: 1 })),
    signature: GovernanceEventSignatureSchema,
  },
  { additionalProperties: false },
);

export type GovernanceEventV1 = Static<typeof GovernanceEventV1Schema>;

export type GovernanceEpochParseResult =
  | { ok: true; epoch: number }
  | { ok: false; error: string };

export type GovernanceStateParseResult =
  | { ok: true; state: GovernanceStateV1 }
  | { ok: false; error: string };

export type GovernanceEventParseResult =
  | { ok: true; event: GovernanceEventV1 }
  | { ok: false; error: string };

export function isGovernanceMode(value: unknown): value is GovernanceMode {
  return (
    typeof value === "string" &&
    (GOVERNANCE_MODES as readonly string[]).includes(value)
  );
}

export function parseGovernanceEpoch(
  input: unknown,
): GovernanceEpochParseResult {
  if (!Value.Check(GovernanceEpochSchema, input)) {
    return { ok: false, error: "invalid GovernanceEpoch" };
  }
  return { ok: true, epoch: input };
}

export function parseGovernanceState(
  input: unknown,
): GovernanceStateParseResult {
  if (!Value.Check(GovernanceStateV1Schema, input)) {
    return { ok: false, error: "invalid GovernanceStateV1" };
  }
  return { ok: true, state: input };
}

/**
 * Parse a governance event and enforce kind ↔ terminal mode consistency:
 * disabled events publish mode "disabled"; enabled events publish "enabled".
 */
export function parseGovernanceEvent(
  input: unknown,
): GovernanceEventParseResult {
  if (!Value.Check(GovernanceEventV1Schema, input)) {
    return { ok: false, error: "invalid GovernanceEventV1" };
  }
  if (input.kind === "governance-disabled" && input.mode !== "disabled") {
    return {
      ok: false,
      error: "governance-disabled event must publish mode disabled",
    };
  }
  if (input.kind === "governance-enabled" && input.mode !== "enabled") {
    return {
      ok: false,
      error: "governance-enabled event must publish mode enabled",
    };
  }
  return { ok: true, event: input };
}

/**
 * Append-only signed trust-event ledger and v2 snapshot cache.
 *
 * Evidence events are durable and signed. Snapshots are mutable caches
 * validated against the event root — never an authoritative unsigned score file.
 */

import { createHash } from "node:crypto";
import { canonicalize } from "@ovrsr/fpp-protocol-core";
import type { AgentIdentity } from "./identity.js";
import { verifySignature } from "./identity.js";
import type { TrustNode, TrustRelationship } from "./trust-graph.js";

export type TrustEventKind =
  | "legacy_import"
  | "evidence_observed"
  | "assessment_cached"
  | "steward_override"
  | "key_rotation"
  | "key_revocation"
  | "dispute"
  | "remediation";

export interface TrustEventPayload {
  sequence: number;
  kind: TrustEventKind;
  timestamp: string;
  actorId: string;
  data: unknown;
}

export interface SignedTrustEvent {
  eventId: string;
  payload: TrustEventPayload;
  publicKey: string;
  signature: string;
  keyAlgorithm: "ed25519";
}

export interface LegacyObservation {
  source: "legacy_v1";
  confidence: number;
  nodeId?: string;
  relationshipKey?: string;
  data: unknown;
}

export interface TrustSnapshotV2 {
  version: 2;
  savedAt: string;
  eventRoot: string;
  eventCount: number;
  signerPublicKey: string;
  signerAgentId: string;
  signature: string;
  nodes: TrustNode[];
  relationships: TrustRelationship[];
  legacyObservations: LegacyObservation[];
}

export interface EventVerification {
  valid: boolean;
  reason: string;
}

const LEGACY_CONFIDENCE_CEILING = 0.4;

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function eventPayloadForSign(payload: TrustEventPayload): string {
  return canonicalize(payload);
}

export function computeEventId(payload: TrustEventPayload): string {
  return sha256Hex(eventPayloadForSign(payload));
}

export function computeEventRoot(events: readonly SignedTrustEvent[]): string {
  let acc = "";
  for (const ev of events) {
    acc = sha256Hex(`${acc}:${ev.eventId}`);
  }
  return sha256Hex(acc || "empty");
}

export function signTrustEventPayload(
  payload: TrustEventPayload,
  identity: AgentIdentity,
): SignedTrustEvent {
  const body = eventPayloadForSign(payload);
  const signature = Buffer.from(
    identity.sign(new TextEncoder().encode(body)),
  ).toString("hex");
  return {
    eventId: computeEventId(payload),
    payload,
    publicKey: identity.publicKeyHex,
    signature,
    keyAlgorithm: "ed25519",
  };
}

export function verifyTrustEvent(event: SignedTrustEvent): EventVerification {
  if (!event.publicKey || !event.signature) {
    return { valid: false, reason: "missing publicKey or signature" };
  }
  let pubBytes: Uint8Array;
  let sigBytes: Uint8Array;
  try {
    pubBytes = Buffer.from(event.publicKey, "hex");
    sigBytes = Buffer.from(event.signature, "hex");
  } catch {
    return { valid: false, reason: "publicKey or signature is not valid hex" };
  }
  if (pubBytes.length !== 32) {
    return { valid: false, reason: "publicKey must be 32 bytes" };
  }
  if (sigBytes.length !== 64) {
    return { valid: false, reason: "signature must be 64 bytes" };
  }

  const expectedId = computeEventId(event.payload);
  if (expectedId !== event.eventId) {
    return { valid: false, reason: "eventId does not match payload" };
  }

  const body = eventPayloadForSign(event.payload);
  const ok = verifySignature(
    new TextEncoder().encode(body),
    sigBytes,
    pubBytes,
  );
  return ok
    ? { valid: true, reason: "signature verified" }
    : { valid: false, reason: "signature does not match event payload" };
}

export class TrustEventLedger {
  private _events: SignedTrustEvent[] = [];

  get events(): readonly SignedTrustEvent[] {
    return this._events;
  }

  get nextSequence(): number {
    return this._events.length + 1;
  }

  clear(): void {
    this._events = [];
  }

  load(events: SignedTrustEvent[]): void {
    this._events = [];
    for (const ev of events) {
      this.appendVerified(ev);
    }
  }

  appendVerified(event: SignedTrustEvent): void {
    const check = verifyTrustEvent(event);
    if (!check.valid) {
      throw new Error(`invalid trust event: ${check.reason}`);
    }
    const expected = this.nextSequence;
    if (event.payload.sequence !== expected) {
      throw new Error(
        `trust event sequence gap or duplicate: expected ${expected}, got ${event.payload.sequence}`,
      );
    }
    if (this._events.length > 0) {
      const prev = this._events[this._events.length - 1]!;
      if (event.payload.actorId !== prev.payload.actorId) {
        // Allow multi-actor later; for local ledger require same steward identity
        // unless kind is peer evidence (verified separately by caller).
      }
    }
    this._events.push(event);
  }
}

export function appendTrustEvent(
  ledger: TrustEventLedger,
  identity: AgentIdentity,
  input: { kind: TrustEventKind; data: unknown; timestamp?: string },
): SignedTrustEvent {
  const payload: TrustEventPayload = {
    sequence: ledger.nextSequence,
    kind: input.kind,
    timestamp: input.timestamp ?? new Date().toISOString(),
    actorId: identity.agentId,
    data: input.data,
  };
  const signed = signTrustEventPayload(payload, identity);
  ledger.appendVerified(signed);
  return signed;
}

function snapshotBodyForSign(
  snapshot: Omit<TrustSnapshotV2, "signature">,
): string {
  return canonicalize(snapshot);
}

export function buildSnapshotFromEvents(
  events: readonly SignedTrustEvent[],
  identity: AgentIdentity,
  cache?: {
    nodes?: TrustNode[];
    relationships?: TrustRelationship[];
    legacyObservations?: LegacyObservation[];
  },
): TrustSnapshotV2 {
  const unsigned: Omit<TrustSnapshotV2, "signature"> = {
    version: 2,
    savedAt: new Date().toISOString(),
    eventRoot: computeEventRoot(events),
    eventCount: events.length,
    signerPublicKey: identity.publicKeyHex,
    signerAgentId: identity.agentId,
    nodes: cache?.nodes ?? [],
    relationships: cache?.relationships ?? [],
    legacyObservations: cache?.legacyObservations ?? extractLegacy(events),
  };
  return signSnapshot(unsigned as TrustSnapshotV2, identity);
}

export function signSnapshot(
  snapshot: TrustSnapshotV2 | Omit<TrustSnapshotV2, "signature">,
  identity: AgentIdentity,
): TrustSnapshotV2 {
  const { signature: _drop, ...rest } = snapshot as TrustSnapshotV2;
  void _drop;
  const body = snapshotBodyForSign({
    ...rest,
    signerPublicKey: identity.publicKeyHex,
    signerAgentId: identity.agentId,
  });
  const signature = Buffer.from(
    identity.sign(new TextEncoder().encode(body)),
  ).toString("hex");
  return {
    ...rest,
    signerPublicKey: identity.publicKeyHex,
    signerAgentId: identity.agentId,
    signature,
  };
}

export function verifySnapshot(
  snapshot: TrustSnapshotV2,
  events: readonly SignedTrustEvent[],
): EventVerification {
  if (snapshot.version !== 2) {
    return { valid: false, reason: "unsupported snapshot version" };
  }
  const expectedRoot = computeEventRoot(events);
  if (snapshot.eventRoot !== expectedRoot) {
    return { valid: false, reason: "snapshot eventRoot does not match events" };
  }
  if (snapshot.eventCount !== events.length) {
    return { valid: false, reason: "snapshot eventCount mismatch" };
  }

  const { signature, ...rest } = snapshot;
  if (!signature) {
    return { valid: false, reason: "missing snapshot signature" };
  }
  let pubBytes: Uint8Array;
  let sigBytes: Uint8Array;
  try {
    pubBytes = Buffer.from(snapshot.signerPublicKey, "hex");
    sigBytes = Buffer.from(signature, "hex");
  } catch {
    return { valid: false, reason: "invalid hex in snapshot signature material" };
  }
  if (pubBytes.length !== 32 || sigBytes.length !== 64) {
    return { valid: false, reason: "invalid snapshot key or signature length" };
  }

  const body = snapshotBodyForSign(rest);
  const ok = verifySignature(
    new TextEncoder().encode(body),
    sigBytes,
    pubBytes,
  );
  return ok
    ? { valid: true, reason: "snapshot verified" }
    : { valid: false, reason: "snapshot signature invalid (tampered)" };
}

export function extractLegacy(
  events: readonly SignedTrustEvent[],
): LegacyObservation[] {
  const out: LegacyObservation[] = [];
  for (const ev of events) {
    if (ev.payload.kind !== "legacy_import") continue;
    const data = ev.payload.data as {
      nodes?: TrustNode[];
      relationships?: TrustRelationship[];
    };
    for (const node of data.nodes ?? []) {
      out.push({
        source: "legacy_v1",
        confidence: LEGACY_CONFIDENCE_CEILING,
        nodeId: node.id,
        data: node,
      });
    }
    for (const rel of data.relationships ?? []) {
      out.push({
        source: "legacy_v1",
        confidence: LEGACY_CONFIDENCE_CEILING,
        relationshipKey: `${rel.agentA}:${rel.agentB}`,
        data: rel,
      });
    }
  }
  return out;
}

export function legacyObservationsFromV1(data: {
  nodes: TrustNode[];
  relationships: TrustRelationship[];
}): LegacyObservation[] {
  const out: LegacyObservation[] = [];
  for (const node of data.nodes) {
    out.push({
      source: "legacy_v1",
      confidence: LEGACY_CONFIDENCE_CEILING,
      nodeId: node.id,
      data: node,
    });
  }
  for (const rel of data.relationships) {
    out.push({
      source: "legacy_v1",
      confidence: LEGACY_CONFIDENCE_CEILING,
      relationshipKey: `${rel.agentA}:${rel.agentB}`,
      data: rel,
    });
  }
  return out;
}

export { LEGACY_CONFIDENCE_CEILING };

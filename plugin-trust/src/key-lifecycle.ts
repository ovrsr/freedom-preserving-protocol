/**
 * Signed key lifecycle events: rotation, revocation, recovery, fork.
 * Conforms to docs/governance/KEY_GOVERNANCE.md (provisional).
 */

import { canonicalize } from "@ovrsr/fpp-protocol-core";
import type { AgentIdentity } from "./identity.js";
import { verifySignature } from "./identity.js";
import type { TrustGraphProtocol } from "./trust-graph.js";

export type KeyLifecycleKind =
  | "rotation"
  | "revocation"
  | "recovery"
  | "fork";

export type KeyLifecycleEvent = {
  kind: KeyLifecycleKind;
  agentId: string;
  atMs: number;
  reason: string;
  oldPublicKeyHex?: string;
  newPublicKeyHex?: string;
  publicKeyHex?: string;
  compromisedAtMs?: number;
  ancestorAgentId?: string;
  forkAgentId?: string;
  stewardAuthorized?: boolean;
  publicKey: string;
  signature: string;
  keyAlgorithm: "ed25519";
};

export type KeyValidityInterval = {
  publicKeyHex: string;
  agentId: string;
  validFrom: number;
  validUntil: number | null;
  revoked: boolean;
  compromisedAtMs: number | null;
};

function signEvent(
  payload: Omit<KeyLifecycleEvent, "publicKey" | "signature" | "keyAlgorithm">,
  signer: AgentIdentity,
): KeyLifecycleEvent {
  const body = canonicalize(payload);
  const signature = Buffer.from(
    signer.sign(new TextEncoder().encode(body)),
  ).toString("hex");
  return {
    ...payload,
    publicKey: signer.publicKeyHex,
    signature,
    keyAlgorithm: "ed25519",
  };
}

function verifyEvent(event: KeyLifecycleEvent): boolean {
  const { publicKey, signature, keyAlgorithm: _k, ...rest } = event;
  void _k;
  try {
    const pub = Buffer.from(publicKey, "hex");
    const sig = Buffer.from(signature, "hex");
    return verifySignature(
      new TextEncoder().encode(canonicalize(rest)),
      sig,
      pub,
    );
  } catch {
    return false;
  }
}

export class KeyLifecycleLedger {
  private events: KeyLifecycleEvent[] = [];
  private intervals = new Map<string, KeyValidityInterval>();
  private forks = new Map<string, string>(); // forkAgentId -> ancestor

  historyFor(agentId: string): KeyLifecycleEvent[] {
    return this.events.filter((e) => e.agentId === agentId || e.forkAgentId === agentId);
  }

  allEvents(): KeyLifecycleEvent[] {
    return [...this.events];
  }

  private upsertInterval(iv: KeyValidityInterval): void {
    this.intervals.set(iv.publicKeyHex, iv);
  }

  /** @internal used by apply* helpers */
  setInterval(iv: KeyValidityInterval): void {
    this.upsertInterval(iv);
  }

  getInterval(publicKeyHex: string): KeyValidityInterval | undefined {
    return this.intervals.get(publicKeyHex);
  }

  recordFork(input: {
    ancestorAgentId: string;
    forkAgentId: string;
    atMs: number;
    signer: AgentIdentity;
  }): KeyLifecycleEvent {
    const event = signEvent(
      {
        kind: "fork",
        agentId: input.forkAgentId,
        atMs: input.atMs,
        reason: "identity-fork",
        ancestorAgentId: input.ancestorAgentId,
        forkAgentId: input.forkAgentId,
      },
      input.signer,
    );
    this.events.push(event);
    this.forks.set(input.forkAgentId, input.ancestorAgentId);
    return event;
  }

  isForkOf(forkAgentId: string, ancestorAgentId: string): boolean {
    return this.forks.get(forkAgentId) === ancestorAgentId;
  }

  canImpersonate(actorId: string, targetId: string): boolean {
    if (actorId === targetId) return true;
    // Forks never inherit ancestor identity
    if (this.forks.has(actorId) && this.forks.get(actorId) === targetId) {
      return false;
    }
    return false;
  }

  /** Internal append after verification. */
  append(event: KeyLifecycleEvent): void {
    if (!verifyEvent(event)) {
      throw new Error("invalid key lifecycle signature");
    }
    this.events.push(event);
  }
}

export function isKeyValidAt(
  ledger: KeyLifecycleLedger,
  publicKeyHex: string,
  atMs: number,
): boolean {
  const iv = ledger.getInterval(publicKeyHex);
  if (!iv) {
    // Unknown key with no interval yet — treat as valid only if never revoked
    return true;
  }
  if (iv.revoked) return false;
  if (atMs < iv.validFrom) return false;
  if (iv.validUntil !== null && atMs > iv.validUntil) return false;
  if (iv.compromisedAtMs !== null && atMs >= iv.compromisedAtMs) return false;
  return true;
}

export function evidenceAffectedByCompromise(
  ledger: KeyLifecycleLedger,
  publicKeyHex: string,
  evidenceAtMs: number,
): boolean {
  const iv = ledger.getInterval(publicKeyHex);
  if (!iv || iv.compromisedAtMs === null) return false;
  return evidenceAtMs >= iv.compromisedAtMs;
}

export function applyRotation(
  graph: TrustGraphProtocol,
  ledger: KeyLifecycleLedger,
  input: {
    agentId: string;
    oldPublicKeyHex: string;
    newPublicKeyHex: string;
    reason: string;
    atMs: number;
    signer?: AgentIdentity;
  },
): boolean {
  if (!input.signer) return false;
  if (input.signer.publicKeyHex !== input.oldPublicKeyHex) return false;
  const node = graph.getAgent(input.agentId);
  if (!node || node.publicKeyHex !== input.oldPublicKeyHex) return false;

  const event = signEvent(
    {
      kind: "rotation",
      agentId: input.agentId,
      atMs: input.atMs,
      reason: input.reason,
      oldPublicKeyHex: input.oldPublicKeyHex,
      newPublicKeyHex: input.newPublicKeyHex,
    },
    input.signer,
  );
  ledger.append(event);

  const oldIv = ledger.getInterval(input.oldPublicKeyHex);
  ledger.setInterval({
    publicKeyHex: input.oldPublicKeyHex,
    agentId: input.agentId,
    validFrom: oldIv?.validFrom ?? 0,
    validUntil: input.atMs,
    revoked: false,
    compromisedAtMs: oldIv?.compromisedAtMs ?? null,
  });
  ledger.setInterval({
    publicKeyHex: input.newPublicKeyHex,
    agentId: input.agentId,
    validFrom: input.atMs,
    validUntil: null,
    revoked: false,
    compromisedAtMs: null,
  });

  return graph.updateAgentPublicKey(input.agentId, input.newPublicKeyHex, {
    rotationProof: { kind: "operator-attested", reason: input.reason },
  });
}

export function applyRevocation(
  ledger: KeyLifecycleLedger,
  input: {
    agentId: string;
    publicKeyHex: string;
    reason: string;
    compromisedAtMs: number;
    signer: AgentIdentity;
  },
): KeyLifecycleEvent {
  const event = signEvent(
    {
      kind: "revocation",
      agentId: input.agentId,
      atMs: input.compromisedAtMs,
      reason: input.reason,
      publicKeyHex: input.publicKeyHex,
      compromisedAtMs: input.compromisedAtMs,
    },
    input.signer,
  );
  ledger.append(event);
  const prev = ledger.getInterval(input.publicKeyHex);
  ledger.setInterval({
    publicKeyHex: input.publicKeyHex,
    agentId: input.agentId,
    validFrom: prev?.validFrom ?? 0,
    validUntil: input.compromisedAtMs,
    revoked: true,
    compromisedAtMs: input.compromisedAtMs,
  });
  return event;
}

export function applyRecovery(
  graph: TrustGraphProtocol,
  ledger: KeyLifecycleLedger,
  input: {
    agentId: string;
    newPublicKeyHex: string;
    reason: string;
    atMs: number;
    signer: AgentIdentity;
    stewardAuthorized?: boolean;
  },
): boolean {
  if (!input.stewardAuthorized) return false;
  const event = signEvent(
    {
      kind: "recovery",
      agentId: input.agentId,
      atMs: input.atMs,
      reason: input.reason,
      newPublicKeyHex: input.newPublicKeyHex,
      stewardAuthorized: true,
    },
    input.signer,
  );
  ledger.append(event);
  ledger.setInterval({
    publicKeyHex: input.newPublicKeyHex,
    agentId: input.agentId,
    validFrom: input.atMs,
    validUntil: null,
    revoked: false,
    compromisedAtMs: null,
  });
  return graph.updateAgentPublicKey(input.agentId, input.newPublicKeyHex, {
    rotationProof: { kind: "operator-attested", reason: `recovery:${input.reason}` },
  });
}

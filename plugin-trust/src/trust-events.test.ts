/**
 * RED tests for signed trust-event ledger and v2 snapshot cache.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTempWorkspace } from "./test-helpers.js";
import { loadOrCreateIdentity } from "./identity.js";
import {
  TrustEventLedger,
  appendTrustEvent,
  verifyTrustEvent,
  computeEventRoot,
  buildSnapshotFromEvents,
  signSnapshot,
  signTrustEventPayload,
  verifySnapshot,
  type SignedTrustEvent,
  type TrustSnapshotV2,
} from "./trust-events.js";
import {
  loadTrustGraph,
  saveTrustGraph,
  migrateV1ToV2,
} from "./persistence.js";
import { TrustGraphProtocol, TrustLevel } from "./trust-graph.js";

describe("trust-events ledger", () => {
  const ws = createTempWorkspace("fpp-trust-events-");
  after(() => ws.cleanup());

  it("rejects a tampered signed trust event", () => {
    const identity = loadOrCreateIdentity("agent.key", ws.path);
    const ledger = new TrustEventLedger();
    const event = appendTrustEvent(ledger, identity, {
      kind: "evidence_observed",
      data: { subjectId: "peer-1", observation: "handshake", weight: 0.8 },
    });
    assert.equal(verifyTrustEvent(event).valid, true);

    const tampered: SignedTrustEvent = {
      ...event,
      payload: {
        ...event.payload,
        data: { subjectId: "peer-1", observation: "handshake", weight: 0.99 },
      },
    };
    assert.equal(verifyTrustEvent(tampered).valid, false);
  });

  it("enforces monotonic sequence numbers", () => {
    const identity = loadOrCreateIdentity("agent.key", ws.path);
    const ledger = new TrustEventLedger();
    appendTrustEvent(ledger, identity, {
      kind: "evidence_observed",
      data: { subjectId: "a", observation: "ok" },
    });
    const second = appendTrustEvent(ledger, identity, {
      kind: "evidence_observed",
      data: { subjectId: "b", observation: "ok" },
    });
    assert.equal(second.payload.sequence, 2);

    const forged = signTrustEventPayload(
      { ...second.payload, sequence: 1 },
      identity,
    );
    assert.throws(
      () => ledger.appendVerified(forged),
      /sequence|gap|duplicate/i,
    );
  });

  it("rebuilds a snapshot from the event chain with matching root", () => {
    const identity = loadOrCreateIdentity("agent.key", ws.path);
    const ledger = new TrustEventLedger();
    appendTrustEvent(ledger, identity, {
      kind: "legacy_import",
      data: {
        nodes: [{ id: "a", constitutionHash: "h", trustScore: 0.5 }],
        relationships: [],
      },
    });
    appendTrustEvent(ledger, identity, {
      kind: "evidence_observed",
      data: { subjectId: "a", observation: "direct", weight: 0.7 },
    });

    const root = computeEventRoot(ledger.events);
    const snapshot = buildSnapshotFromEvents(ledger.events, identity);
    assert.equal(snapshot.version, 2);
    assert.equal(snapshot.eventRoot, root);
    assert.equal(snapshot.eventCount, 2);
    assert.equal(verifySnapshot(snapshot, ledger.events).valid, true);
  });

  it("rejects a tampered v2 snapshot signature or root", () => {
    const identity = loadOrCreateIdentity("agent.key", ws.path);
    const ledger = new TrustEventLedger();
    appendTrustEvent(ledger, identity, {
      kind: "evidence_observed",
      data: { subjectId: "x", observation: "ok" },
    });
    const snapshot = buildSnapshotFromEvents(ledger.events, identity);
    const signed = signSnapshot(snapshot, identity);
    assert.equal(verifySnapshot(signed, ledger.events).valid, true);

    const badRoot: TrustSnapshotV2 = {
      ...signed,
      eventRoot: "0".repeat(64),
    };
    assert.equal(verifySnapshot(badRoot, ledger.events).valid, false);

    const badSig: TrustSnapshotV2 = {
      ...signed,
      signature: "ab".repeat(64),
    };
    assert.equal(verifySnapshot(badSig, ledger.events).valid, false);
  });
});

describe("persistence v2 migration", () => {
  const ws = createTempWorkspace("fpp-persist-v2-");
  after(() => ws.cleanup());

  it("imports v1 as labeled low-confidence legacy observations without destroying source", async () => {
    const path = "graph.json";
    const g = new TrustGraphProtocol();
    g.addAgent("a", "hash-a");
    g.addAgent("b", "hash-b");
    g.establishTrust("a", "b", TrustLevel.HIGH, TrustLevel.MEDIUM);
    await saveTrustGraph(path, g, ws.path);

    const v1Body = readFileSync(join(ws.path, path), "utf8");
    assert.ok(v1Body.includes('"version": 1'));

    const identity = loadOrCreateIdentity("agent.key", ws.path);
    const result = migrateV1ToV2(path, identity, ws.path);

    assert.equal(result.version, 2);
    assert.ok(existsSync(join(ws.path, `${path}.v1.bak`)));
    const bak = readFileSync(join(ws.path, `${path}.v1.bak`), "utf8");
    assert.equal(bak, v1Body);

    const loaded = loadTrustGraph(path, ws.path, { identity });
    const legacy = loaded.getLegacyObservations?.() ?? [];
    assert.ok(legacy.length > 0);
    for (const obs of legacy) {
      assert.equal(obs.source, "legacy_v1");
      assert.ok(obs.confidence <= 0.4);
    }
  });

  it("rejects forged/invalid schema on load", () => {
    const path = "bad.json";
    writeFileSync(
      join(ws.path, path),
      JSON.stringify({ version: 99, nodes: [] }),
      "utf8",
    );
    assert.throws(() => loadTrustGraph(path, ws.path), /invalid|unsupported/i);
  });

  it("recovers atomically: incomplete tmp does not replace good snapshot", async () => {
    const identity = loadOrCreateIdentity("agent.key", ws.path);
    const path = "atomic.json";
    const g = new TrustGraphProtocol();
    g.addAgent("a", "h");
    await saveTrustGraph(path, g, ws.path, { identity });

    const good = readFileSync(join(ws.path, path), "utf8");
    // Simulate crash: leave a tmp file, do not rename over good file
    writeFileSync(join(ws.path, `${path}.tmp-99999`), "{broken", "utf8");
    const stillGood = readFileSync(join(ws.path, path), "utf8");
    assert.equal(stillGood, good);

    const loaded = loadTrustGraph(path, ws.path, { identity });
    assert.ok(loaded.getAgent("a"));
  });

  it("rejects tampered v2 state on load", async () => {
    const identity = loadOrCreateIdentity("agent.key", ws.path);
    const path = "tamper.json";
    const g = new TrustGraphProtocol();
    g.addAgent("a", "h");
    await saveTrustGraph(path, g, ws.path, { identity });

    const parsed = JSON.parse(readFileSync(join(ws.path, path), "utf8"));
    parsed.eventRoot = "ff".repeat(32);
    writeFileSync(join(ws.path, path), JSON.stringify(parsed, null, 2), "utf8");

    assert.throws(
      () => loadTrustGraph(path, ws.path, { identity }),
      /tamper|invalid|signature|root/i,
    );
  });
});

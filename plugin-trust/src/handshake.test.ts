import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { TrustGraphProtocol, TrustLevel } from "./trust-graph.js";
import { ConstitutionalHandshake } from "./handshake.js";
import { signClaim } from "./claims.js";
import { loadOrCreateIdentity } from "./identity.js";
import { ReplayCache } from "./replay-cache.js";
import {
  createFakeClock,
  createTempWorkspace,
} from "./test-helpers.js";

const HASH = "71bf60ad917c5413cc17b0f65e83c7a29218e24a2740725a819058ed9c6b1993";
const LOCAL = "fpp:ed25519:" + "b".repeat(64);

function baseClaim(agentId: string) {
  return {
    agentId,
    constitutionHash: HASH,
    adoptedAt: "2026-01-01T00:00:00.000Z",
    auditMerkleRoot: "a".repeat(64),
    auditEntryCount: 1,
    chainIntact: true,
    recentLaws: ["law1"],
  };
}

describe("ConstitutionalHandshake", () => {
  const ws = createTempWorkspace("fpp-hs-");
  after(() => ws.cleanup());

  it("accepts a valid signed current-version claim", () => {
    const identity = loadOrCreateIdentity(join(ws.path, "peer.key"), "/");
    const graph = new TrustGraphProtocol();
    graph.addAgent("local-agent", HASH);
    const hs = new ConstitutionalHandshake(graph, HASH, {
      requireSignedClaims: true,
      requireMerkleProof: false,
      requireFreshness: false,
    });
    const claim = signClaim(baseClaim(identity.agentId), identity);
    const result = hs.verifyFromClaim("local-agent", claim);
    assert.equal(result.success, true);
    assert.ok(result.trustLevel >= TrustLevel.LOW);
  });

  it("self-asserted chainIntact alone cannot produce HIGH trust", () => {
    const identity = loadOrCreateIdentity(join(ws.path, "self-assert.key"), "/");
    const graph = new TrustGraphProtocol();
    graph.addAgent("local-agent", HASH);
    const hs = new ConstitutionalHandshake(graph, HASH, {
      requireSignedClaims: true,
      requireFreshness: false,
    });
    const claim = signClaim(
      {
        ...baseClaim(identity.agentId),
        chainIntact: true,
        auditEntryCount: 999,
      },
      identity,
    );
    const result = hs.verifyFromClaim("local-agent", claim);
    assert.equal(result.success, true);
    assert.ok(
      result.trustLevel < TrustLevel.HIGH,
      `expected below HIGH, got ${result.trustLevel}`,
    );
    const attestation = result.evidence.find(
      (e) => e.type === "attestation_summary",
    );
    assert.ok(attestation);
    assert.equal(
      (attestation!.data as { evidenceClass?: string }).evidenceClass,
      "configuration",
    );
    assert.ok(
      (attestation!.data as { standing?: string }).standing ===
        "self-asserted" ||
        attestation!.confidence <= 0.4,
    );
  });

  it("rejects a 2020 stale claim under freshness policy", () => {
    const identity = loadOrCreateIdentity(join(ws.path, "stale.key"), "/");
    const clock = createFakeClock(Date.parse("2026-07-10T12:00:00.000Z"));
    const graph = new TrustGraphProtocol();
    graph.addAgent(LOCAL, HASH);
    const replay = new ReplayCache({
      path: join(ws.path, "replay-stale.json"),
      now: clock.now,
    });
    const hs = new ConstitutionalHandshake(graph, HASH, {
      requireSignedClaims: true,
      requireFreshness: true,
      replayCache: replay,
      now: clock.now,
      localAudience: LOCAL,
    });
    const claim = signClaim(
      {
        ...baseClaim(identity.agentId),
        freshness: {
          audience: LOCAL,
          challenge: "old-nonce",
          issuedAt: "2020-01-01T00:00:00.000Z",
          expiresAt: "2020-01-01T00:05:00.000Z",
        },
      },
      identity,
    );
    const result = hs.verifyFromClaim(LOCAL, claim);
    assert.equal(result.success, false);
    assert.ok(result.errors.some((e) => /expir|fresh|stale/i.test(e)));
  });

  it("rejects wrong audience", () => {
    const identity = loadOrCreateIdentity(join(ws.path, "aud.key"), "/");
    const clock = createFakeClock(Date.parse("2026-07-10T12:00:00.000Z"));
    const graph = new TrustGraphProtocol();
    graph.addAgent(LOCAL, HASH);
    const hs = new ConstitutionalHandshake(graph, HASH, {
      requireSignedClaims: true,
      requireFreshness: true,
      replayCache: new ReplayCache({
        path: join(ws.path, "replay-aud.json"),
        now: clock.now,
      }),
      now: clock.now,
      localAudience: LOCAL,
    });
    const challenge = hs.issueChallenge(LOCAL);
    const claim = signClaim(
      {
        ...baseClaim(identity.agentId),
        freshness: {
          ...challenge,
          audience: "fpp:ed25519:" + "c".repeat(64),
        },
      },
      identity,
    );
    const result = hs.verifyFromClaim(LOCAL, claim);
    assert.equal(result.success, false);
    assert.ok(result.errors.some((e) => /audience/i.test(e)));
  });

  it("rejects future issue time beyond skew", () => {
    const identity = loadOrCreateIdentity(join(ws.path, "future.key"), "/");
    const clock = createFakeClock(Date.parse("2026-07-10T12:00:00.000Z"));
    const graph = new TrustGraphProtocol();
    graph.addAgent(LOCAL, HASH);
    const hs = new ConstitutionalHandshake(graph, HASH, {
      requireSignedClaims: true,
      requireFreshness: true,
      replayCache: new ReplayCache({
        path: join(ws.path, "replay-future.json"),
        now: clock.now,
      }),
      now: clock.now,
      localAudience: LOCAL,
      allowedClockSkewMs: 60_000,
    });
    const claim = signClaim(
      {
        ...baseClaim(identity.agentId),
        freshness: {
          audience: LOCAL,
          challenge: "future-nonce",
          issuedAt: "2026-07-10T12:10:00.000Z",
          expiresAt: "2026-07-10T12:15:00.000Z",
        },
      },
      identity,
    );
    const result = hs.verifyFromClaim(LOCAL, claim);
    assert.equal(result.success, false);
    assert.ok(result.errors.some((e) => /future/i.test(e)));
  });

  it("rejects expired response and accepts a fresh one-time response", () => {
    const identity = loadOrCreateIdentity(join(ws.path, "fresh.key"), "/");
    const clock = createFakeClock(Date.parse("2026-07-10T12:00:00.000Z"));
    const graph = new TrustGraphProtocol();
    graph.addAgent(LOCAL, HASH);
    const replay = new ReplayCache({
      path: join(ws.path, "replay-fresh.json"),
      now: clock.now,
    });
    const hs = new ConstitutionalHandshake(graph, HASH, {
      requireSignedClaims: true,
      requireFreshness: true,
      replayCache: replay,
      now: clock.now,
      localAudience: LOCAL,
      allowedClockSkewMs: 5_000,
    });

    const challenge = hs.issueChallenge(LOCAL, { lifetimeMs: 60_000 });
    clock.advance(120_000);
    const expired = signClaim(
      { ...baseClaim(identity.agentId), freshness: challenge },
      identity,
    );
    assert.equal(hs.verifyFromClaim(LOCAL, expired).success, false);

    clock.set(Date.parse("2026-07-10T12:00:00.000Z"));
    const freshChallenge = hs.issueChallenge(LOCAL, { lifetimeMs: 60_000 });
    const fresh = signClaim(
      { ...baseClaim(identity.agentId), freshness: freshChallenge },
      identity,
    );
    const ok = hs.verifyFromClaim(LOCAL, fresh);
    assert.equal(ok.success, true);

    const replayed = hs.verifyFromClaim(LOCAL, fresh);
    assert.equal(replayed.success, false);
    assert.ok(replayed.errors.some((e) => /replay/i.test(e)));
  });
});

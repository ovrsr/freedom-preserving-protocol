/**
 * End-to-end security regression suite for the trust plugin.
 * Each case maps to a demonstrated Plan 4 finding. Do not weaken these
 * assertions without updating docs/CAPABILITY_STATUS.md.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { createTrustStack } from "./index.js";
import { signClaim, verifyClaim, canonicalize } from "./claims.js";
import { loadOrCreateIdentity } from "./identity.js";
import { TrustLevel } from "./trust-graph.js";
import { ConstitutionalHandshake } from "./handshake.js";
import { TrustGraphProtocol } from "./trust-graph.js";
import { ReplayCache } from "./replay-cache.js";
import { createFakeClock, createTempWorkspace } from "./test-helpers.js";

const HASH = "71bf60ad917c5413cc17b0f65e83c7a29218e24a2740725a819058ed9c6b1993";
const LOCAL = "fpp:ed25519:" + "b".repeat(64);

describe("security regressions (trust)", () => {
  const ws = createTempWorkspace("fpp-sec-trust-");
  after(() => ws.cleanup());

  it("REGRESSION: spoofed agentId with valid signature is rejected", () => {
    const identity = loadOrCreateIdentity(join(ws.path, "spoof.key"), "/");
    const spoofedId = "fpp:ed25519:" + "a".repeat(64);
    assert.notEqual(spoofedId, identity.agentId);
    const spoofedPayload = {
      agentId: spoofedId,
      constitutionHash: HASH,
      adoptedAt: "2026-01-01T00:00:00Z",
      auditMerkleRoot: "f".repeat(64),
      auditEntryCount: 1,
      chainIntact: true,
      recentLaws: [] as string[],
      keyAlgorithm: "ed25519",
    };
    const payload = canonicalize(spoofedPayload);
    const sig = identity.sign(new TextEncoder().encode(payload));
    const result = verifyClaim({
      ...spoofedPayload,
      publicKey: identity.publicKeyHex,
      signature: Buffer.from(sig).toString("hex"),
    });
    assert.equal(result.valid, false);
    assert.match(result.reason, /agentId does not match/i);
  });

  it("REGRESSION: 2020 stale claim is rejected under hardened freshness", () => {
    const identity = loadOrCreateIdentity(join(ws.path, "stale.key"), "/");
    const clock = createFakeClock(Date.parse("2026-07-10T12:00:00.000Z"));
    const graph = new TrustGraphProtocol();
    graph.addAgent(LOCAL, HASH);
    const hs = new ConstitutionalHandshake(graph, HASH, {
      requireSignedClaims: true,
      requireFreshness: true,
      replayCache: new ReplayCache({
        path: join(ws.path, "replay-stale.json"),
        now: clock.now,
      }),
      now: clock.now,
      localAudience: LOCAL,
    });
    const claim = signClaim(
      {
        agentId: identity.agentId,
        constitutionHash: HASH,
        adoptedAt: "2020-01-01T00:00:00.000Z",
        auditMerkleRoot: "a".repeat(64),
        auditEntryCount: 1,
        chainIntact: true,
        recentLaws: ["law1"],
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

  it("REGRESSION: replayed challenge response is rejected", () => {
    const identity = loadOrCreateIdentity(join(ws.path, "replay.key"), "/");
    const clock = createFakeClock(Date.parse("2026-07-10T12:00:00.000Z"));
    const graph = new TrustGraphProtocol();
    graph.addAgent(LOCAL, HASH);
    const replay = new ReplayCache({
      path: join(ws.path, "replay-once.json"),
      now: clock.now,
    });
    const hs = new ConstitutionalHandshake(graph, HASH, {
      requireSignedClaims: true,
      requireFreshness: true,
      replayCache: replay,
      now: clock.now,
      localAudience: LOCAL,
    });
    const challenge = hs.issueChallenge(LOCAL);
    const claim = signClaim(
      {
        agentId: identity.agentId,
        constitutionHash: HASH,
        adoptedAt: "2026-01-01T00:00:00.000Z",
        auditMerkleRoot: "a".repeat(64),
        auditEntryCount: 1,
        chainIntact: true,
        recentLaws: ["law1"],
        freshness: challenge,
      },
      identity,
    );
    const first = hs.verifyFromClaim(LOCAL, claim);
    assert.equal(first.success, true);
    const second = hs.verifyFromClaim(LOCAL, claim);
    assert.equal(second.success, false);
    assert.ok(second.errors.some((e) => /replay/i.test(e)));
  });

  it("REGRESSION: unsigned v2 claim rejected under default hardened-v2", () => {
    const stack = createTrustStack({
      constitutionHash: HASH,
      trustGraphPath: join(ws.path, "graph-unsigned.json"),
      identityKeyPath: join(ws.path, "id-unsigned.key"),
      auditLogPath: join(ws.path, "audit-unsigned.jsonl"),
      fallbackAuditLogPath: null,
      strictModeStatePath: join(ws.path, "strict-unsigned.json"),
      replayCachePath: join(ws.path, "replay-unsigned.json"),
    });
    assert.equal(stack.config.verificationPolicy, "hardened-v2");
    const unsigned = {
      agentId: "fpp:ed25519:" + "d".repeat(64),
      constitutionHash: HASH,
      adoptedAt: "2026-01-01T00:00:00.000Z",
      auditMerkleRoot: "a".repeat(64),
      auditEntryCount: 1,
      chainIntact: true,
      recentLaws: [],
    };
    const result = stack.handshake.verifyFromClaim(
      stack.identity.agentId,
      unsigned,
    );
    assert.equal(result.success, false);
  });

  it("REGRESSION: self-asserted chainIntact cannot reach HIGH trust", () => {
    const identity = loadOrCreateIdentity(join(ws.path, "high.key"), "/");
    const graph = new TrustGraphProtocol();
    graph.addAgent("local-agent", HASH);
    const hs = new ConstitutionalHandshake(graph, HASH, {
      requireSignedClaims: true,
      requireFreshness: false,
    });
    const claim = signClaim(
      {
        agentId: identity.agentId,
        constitutionHash: HASH,
        adoptedAt: "2026-01-01T00:00:00.000Z",
        auditMerkleRoot: "a".repeat(64),
        auditEntryCount: 999,
        chainIntact: true,
        recentLaws: ["law1", "law2", "law3", "law4", "law5"],
      },
      identity,
    );
    const result = hs.verifyFromClaim("local-agent", claim);
    assert.equal(result.success, true);
    assert.ok(
      result.trustLevel < TrustLevel.HIGH,
      `expected below HIGH, got ${result.trustLevel}`,
    );
  });

  it("CONTROL: well-formed signed claim without freshness still verifies when freshness off", () => {
    const identity = loadOrCreateIdentity(join(ws.path, "benign.key"), "/");
    const graph = new TrustGraphProtocol();
    graph.addAgent("local-agent", HASH);
    const hs = new ConstitutionalHandshake(graph, HASH, {
      requireSignedClaims: true,
      requireFreshness: false,
    });
    const claim = signClaim(
      {
        agentId: identity.agentId,
        constitutionHash: HASH,
        adoptedAt: "2026-01-01T00:00:00.000Z",
        auditMerkleRoot: "a".repeat(64),
        auditEntryCount: 1,
        chainIntact: true,
        recentLaws: ["law1"],
      },
      identity,
    );
    const result = hs.verifyFromClaim("local-agent", claim);
    assert.equal(result.success, true);
  });

  it("CONTROL: malformed unsigned empty object does not throw", () => {
    const stack = createTrustStack({
      constitutionHash: HASH,
      trustGraphPath: join(ws.path, "graph-mal.json"),
      identityKeyPath: join(ws.path, "id-mal.key"),
      auditLogPath: join(ws.path, "audit-mal.jsonl"),
      fallbackAuditLogPath: null,
      strictModeStatePath: join(ws.path, "strict-mal.json"),
      replayCachePath: join(ws.path, "replay-mal.json"),
    });
    const result = stack.handshake.verifyFromClaim(
      stack.identity.agentId,
      {} as never,
    );
    assert.equal(result.success, false);
  });
});

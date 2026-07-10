import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { loadOrCreateIdentity } from "./identity.js";
import { TrustGraphProtocol } from "./trust-graph.js";
import { ConstitutionalHandshake } from "./handshake.js";
import { MerkleBridge } from "./merkle-bridge.js";
import { StrictModeManager } from "./strict-mode.js";
import { GroupContextManager } from "./group-context.js";
import { ReplayCache } from "./replay-cache.js";
import {
  executeHandshakeChallenge,
  executeHandshakeOffer,
  executeHandshakeVerify,
  executeTrustStatus,
} from "./tools.js";
import { createFakeClock, createTempWorkspace } from "./test-helpers.js";

const HASH = "71bf60ad917c5413cc17b0f65e83c7a29218e24a2740725a819058ed9c6b1993";

describe("tools", () => {
  const ws = createTempWorkspace("fpp-tools-");
  after(() => ws.cleanup());

  it("executeHandshakeOffer and executeTrustStatus return structured results", () => {
    const identity = loadOrCreateIdentity(join(ws.path, "id.key"), "/");
    const trustGraph = new TrustGraphProtocol();
    trustGraph.addAgent(identity.agentId, HASH);
    const handshake = new ConstitutionalHandshake(trustGraph, HASH);
    const merkleBridge = new MerkleBridge(join(ws.path, "audit.jsonl"));
    const strictMode = new StrictModeManager(join(ws.path, "strict.json"));
    const groupContext = new GroupContextManager(trustGraph, identity.agentId);
    const deps = {
      identity,
      trustGraph,
      handshake,
      merkleBridge,
      strictMode,
      groupContext,
      constitutionHash: HASH,
      strictModeOnHandshakeFailure: false,
      strictModeTtlMs: 60_000,
    };
    const offer = executeHandshakeOffer({}, deps);
    assert.ok(offer.content[0]?.text);
    const status = executeTrustStatus({ targetAgentId: identity.agentId }, deps);
    assert.ok(status.content[0]?.text);
  });

  it("challenge → answer → verify-once flow binds freshness and rejects replay", () => {
    const clock = createFakeClock(Date.parse("2026-07-10T12:00:00.000Z"));
    const verifier = loadOrCreateIdentity(join(ws.path, "verifier.key"), "/");
    const peer = loadOrCreateIdentity(join(ws.path, "peer.key"), "/");
    const trustGraph = new TrustGraphProtocol();
    trustGraph.addAgent(verifier.agentId, HASH);
    const replay = new ReplayCache({
      path: join(ws.path, "tools-replay.json"),
      now: clock.now,
    });
    const handshake = new ConstitutionalHandshake(trustGraph, HASH, {
      requireSignedClaims: true,
      requireFreshness: true,
      replayCache: replay,
      now: clock.now,
      localAudience: verifier.agentId,
      allowedClockSkewMs: 5_000,
    });
    const merkleBridge = new MerkleBridge(join(ws.path, "tools-audit.jsonl"));
    const strictMode = new StrictModeManager(join(ws.path, "tools-strict.json"));
    const groupContext = new GroupContextManager(trustGraph, verifier.agentId);

    const verifierDeps = {
      identity: verifier,
      trustGraph,
      handshake,
      merkleBridge,
      strictMode,
      groupContext,
      constitutionHash: HASH,
      strictModeOnHandshakeFailure: false,
      strictModeTtlMs: 60_000,
    };
    const peerDeps = {
      ...verifierDeps,
      identity: peer,
    };

    const challengeResult = executeHandshakeChallenge({}, verifierDeps);
    const challengeJson = (challengeResult.details as { copyableJson: string })
      .copyableJson;

    const offer = executeHandshakeOffer(
      { peerChallenge: challengeJson },
      peerDeps,
    );
    assert.equal(
      (offer.details as { freshnessBound: boolean }).freshnessBound,
      true,
    );
    const claimJson = (offer.details as { copyableJson: string }).copyableJson;

    const verified = executeHandshakeVerify(
      { peerClaim: claimJson },
      verifierDeps,
    );
    assert.equal((verified.details as { ok?: boolean }).ok, true);

    const replayed = executeHandshakeVerify(
      { peerClaim: claimJson },
      verifierDeps,
    );
    assert.equal((replayed.details as { ok?: boolean }).ok, false);
    assert.match(
      ((replayed.details as { errors?: string[] }).errors ?? []).join(" "),
      /replay/i,
    );
  });

  it("handshake verify reports precise claim classes, not blanket VERIFIED", () => {
    const clock = createFakeClock(Date.parse("2026-07-10T12:00:00.000Z"));
    const verifier = loadOrCreateIdentity(join(ws.path, "v2.key"), "/");
    const peer = loadOrCreateIdentity(join(ws.path, "p2.key"), "/");
    const trustGraph = new TrustGraphProtocol();
    trustGraph.addAgent(verifier.agentId, HASH);
    const replay = new ReplayCache({
      path: join(ws.path, "tools-replay-precise.json"),
      now: clock.now,
    });
    const handshake = new ConstitutionalHandshake(trustGraph, HASH, {
      requireSignedClaims: true,
      requireFreshness: true,
      replayCache: replay,
      now: clock.now,
      localAudience: verifier.agentId,
      allowedClockSkewMs: 5_000,
    });
    const merkleBridge = new MerkleBridge(join(ws.path, "tools-audit-precise.jsonl"));
    const strictMode = new StrictModeManager(join(ws.path, "tools-strict-precise.json"));
    const groupContext = new GroupContextManager(trustGraph, verifier.agentId);

    const verifierDeps = {
      identity: verifier,
      trustGraph,
      handshake,
      merkleBridge,
      strictMode,
      groupContext,
      constitutionHash: HASH,
      strictModeOnHandshakeFailure: false,
      strictModeTtlMs: 60_000,
    };
    const peerDeps = { ...verifierDeps, identity: peer };

    const challengeJson = (
      executeHandshakeChallenge({}, verifierDeps).details as {
        copyableJson: string;
      }
    ).copyableJson;
    const claimJson = (
      executeHandshakeOffer({ peerChallenge: challengeJson }, peerDeps)
        .details as { copyableJson: string }
    ).copyableJson;

    const verified = executeHandshakeVerify(
      { peerClaim: claimJson },
      verifierDeps,
    );
    const text = verified.content[0]?.text ?? "";
    assert.doesNotMatch(text, /FPP handshake VERIFIED/i);
    assert.match(text, /identity/i);
    assert.match(text, /configuration/i);
    assert.doesNotMatch(text, /behavioral compliance verified/i);
    assert.match(text, /not behavioral/i);

    const details = verified.details as {
      ok?: boolean;
      identityVerified?: boolean;
      configurationClaimVerified?: boolean;
      freshnessVerified?: boolean;
      evidenceLevel?: string;
      standing?: string;
      fppVerified?: boolean;
    };
    assert.equal(details.ok, true);
    assert.equal(details.identityVerified, true);
    assert.equal(details.configurationClaimVerified, true);
    assert.equal(details.freshnessVerified, true);
    assert.ok(typeof details.evidenceLevel === "string");
    assert.ok(typeof details.standing === "string");
    assert.notEqual(details.standing, "behavioral");
    // Deprecated compatibility: derived from standing, not a blanket true.
    assert.equal(details.fppVerified, true);
  });
});

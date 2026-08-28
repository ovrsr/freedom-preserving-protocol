import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import {
  KEY_ALGORITHM,
  DIGEST_DOMAINS,
  canonicalizeV2,
  deriveAgentIdV2,
  digest,
  publicKeyFromSeed,
  signMessage,
} from "@ovrsr/fpp-protocol-core";
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
  executeReceiptVerify,
  executeReceiptProofExport,
  executeCapsuleOffer,
} from "./tools.js";
import { createFakeClock, createTempWorkspace } from "./test-helpers.js";

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const HASH = "71bf60ad917c5413cc17b0f65e83c7a29218e24a2740725a819058ed9c6b1993";

function makeSignedReceipt(seed: Uint8Array, overrides: Record<string, unknown> = {}) {
  const pub = publicKeyFromSeed(seed);
  const publicKeyHex = Buffer.from(pub).toString("hex");
  const agentId = deriveAgentIdV2(publicKeyHex);
  const base: Record<string, unknown> = {
    schemaVersion: 1,
    receiptClass: "conformance",
    actionDigest: "a".repeat(64),
    policyId: "fpp-enforcement:deadbeef",
    policyVersion: "pol-1",
    implementationVersion: "1.1.4",
    disposition: "allow",
    authorization: "policy-match",
    outcome: "executed",
    issuedAt: "2026-07-10T12:00:00.000Z",
    signingStatus: "signed",
    trustElevating: true,
    canonicalizationVersion: 2,
    keyAlgorithm: KEY_ALGORITHM,
    agentId,
    keyFingerprint: agentId.slice(-64),
    classifierRulesetHash: "c".repeat(64),
    ...overrides,
  };
  const { signature: _s, publicKey: _p, payloadDigest: _d, ...rest } = base;
  void _s;
  void _p;
  void _d;
  const message = new TextEncoder().encode(canonicalizeV2(rest));
  const sig = signMessage(message, seed);
  return {
    ...rest,
    publicKey: publicKeyHex,
    signature: Buffer.from(sig).toString("hex"),
  };
}

function makeInclusionEvidence(receipt: Record<string, unknown>) {
  const entryPreimage = {
    previousHash: "0".repeat(64),
    timestamp: "2026-07-10T12:01:00.000Z",
    kind: "conformance-receipt",
    receipt,
  };
  const hash = digest({
    version: 2,
    domain: DIGEST_DOMAINS.entry,
    value: entryPreimage,
  });
  return {
    evidenceVersion: 1,
    logKind: "conformance-receipt",
    entry: { ...entryPreimage, hash },
    proof: {
      leaf: hash,
      index: 0,
      path: [],
      root: hash,
    },
  };
}

function minimalDeps(wsPath: string) {
  const identity = loadOrCreateIdentity(join(wsPath, "id.key"), "/");
  const trustGraph = new TrustGraphProtocol();
  trustGraph.addAgent(identity.agentId, HASH);
  return {
    identity,
    trustGraph,
    handshake: new ConstitutionalHandshake(trustGraph, HASH),
    merkleBridge: new MerkleBridge(join(wsPath, "audit.jsonl")),
    strictMode: new StrictModeManager(join(wsPath, "strict.json")),
    groupContext: new GroupContextManager(trustGraph, identity.agentId),
    constitutionHash: HASH,
    strictModeOnHandshakeFailure: false,
    strictModeTtlMs: 60_000,
  };
}

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

  it("executeReceiptVerify names instrumented-boundary-disposition and keeps limitations", () => {
    const deps = minimalDeps(ws.path);
    const receipt = makeSignedReceipt(ed.utils.randomPrivateKey(), {
      disposition: "deny",
      authorization: "policy-match",
      actionDigest: "d".repeat(64),
      constitutionHash: deps.constitutionHash,
    });
    const result = executeReceiptVerify(
      {
        receiptJson: JSON.stringify(receipt),
        expectedPolicyId: receipt.policyId,
        expectedPolicyVersion: receipt.policyVersion,
      },
      deps,
    );
    const text = result.content[0]?.text ?? "";
    assert.match(text, /instrumented-boundary-disposition/i);
    assert.match(text, /disposition deny/i);
    assert.match(text, /authorization policy-match/i);
    assert.match(text, /action digest/i);
    assert.match(text, /proven_under_assumptions/i);
    assert.match(text, /schema/i);
    assert.match(text, /signature/i);
    assert.match(text, /assumptions:/i);
    assert.match(text, /behavioral|completeness/i);
    assert.match(text, /not (?:prove )?exact downstream parameter/i);
    assert.match(text, /bypass|uninstrumented/i);
    assert.match(text, /uncompromised runtime|runtime was uncompromised/i);
    assert.match(text, /does not independently prove boundary traversal/i);
    assert.doesNotMatch(text, /proves exact downstream/i);
    assert.doesNotMatch(text, /behavioral compliance verified/i);

    const details = result.details as {
      valid?: boolean;
      attestation?: { kind?: string; maximumConclusion?: string };
    };
    assert.equal(details.valid, true);
    assert.equal(details.attestation?.kind, "instrumented-boundary-disposition");
    assert.ok(details.attestation?.maximumConclusion);
  });

  it("executeReceiptVerify never affirms disposition for invalid receipts", () => {
    const deps = minimalDeps(ws.path);
    const valid = makeSignedReceipt(ed.utils.randomPrivateKey());
    const bad = { ...valid, signature: "00".repeat(64) };
    const result = executeReceiptVerify(
      { receiptJson: JSON.stringify(bad) },
      deps,
    );
    const text = result.content[0]?.text ?? "";
    assert.match(text, /failed/i);
    assert.doesNotMatch(text, /\battested\b/i);
    assert.doesNotMatch(text, /\bconstrained\b/i);
    assert.doesNotMatch(text, /instrumented-boundary-disposition/);
    assert.doesNotMatch(text, /recorded disposition/i);
    assert.doesNotMatch(text, /traversed (the )?(active )?boundary/i);
    assert.match(text, /ceiling=0/i);
    const details = result.details as {
      valid?: boolean;
      confidenceCeiling?: number;
      attestation?: unknown;
    };
    assert.equal(details.valid, false);
    assert.equal(details.confidenceCeiling, 0);
    assert.equal(details.attestation, undefined);
  });

  it("executeReceiptVerify exposes independent expectations and zero invalid confidence", () => {
    const deps = minimalDeps(ws.path);
    const receipt = makeSignedReceipt(ed.utils.randomPrivateKey(), {
      constitutionHash: "d".repeat(64),
      effectiveConfigHash: "e".repeat(64),
    });
    const result = executeReceiptVerify(
      {
        receiptJson: JSON.stringify(receipt),
        expectedActionDigest: "f".repeat(64),
        expectedAgentId: receipt.agentId,
        expectedPolicyId: receipt.policyId,
        expectedPolicyVersion: receipt.policyVersion,
        expectedImplementationVersion: receipt.implementationVersion,
        expectedConstitutionHash: receipt.constitutionHash,
        expectedClassifierRulesetHash: receipt.classifierRulesetHash,
        expectedEffectiveConfigHash: receipt.effectiveConfigHash,
      } as Parameters<typeof executeReceiptVerify>[0] & Record<string, unknown>,
      deps,
    );
    const text = result.content[0]?.text ?? "";
    const details = result.details as {
      valid?: boolean;
      confidenceCeiling?: number;
      expectedComparisons?: Record<string, { matched: boolean }>;
      attestation?: unknown;
    };
    assert.match(text, /failed|insufficient/i);
    assert.equal(details.valid, false);
    assert.equal(details.confidenceCeiling, 0);
    assert.equal(details.expectedComparisons?.actionDigest?.matched, false);
    assert.equal(details.expectedComparisons?.agentId?.matched, true);
    assert.equal(details.expectedComparisons?.policyId?.matched, true);
    assert.equal(details.expectedComparisons?.policyVersion?.matched, true);
    assert.equal(
      details.expectedComparisons?.implementationVersion?.matched,
      true,
    );
    assert.equal(details.expectedComparisons?.constitutionHash?.matched, true);
    assert.equal(
      details.expectedComparisons?.classifierRulesetHash?.matched,
      true,
    );
    assert.equal(details.expectedComparisons?.effectiveConfigHash?.matched, true);
    assert.equal(details.attestation, undefined);
  });

  it("executeReceiptVerify defaults the trusted constitution but withholds attestation without policy context", () => {
    const deps = minimalDeps(ws.path);
    const receipt = makeSignedReceipt(ed.utils.randomPrivateKey(), {
      constitutionHash: deps.constitutionHash,
    });
    const result = executeReceiptVerify(
      { receiptJson: JSON.stringify(receipt) },
      deps,
    );
    const text = result.content[0]?.text ?? "";
    const details = result.details as {
      valid?: boolean;
      attestation?: unknown;
      attestationEligibility?: { eligible?: boolean };
      trustedVerificationContext?: Record<
        "constitutionHash" | "policyId" | "policyVersion",
        { status?: string }
      >;
      signerVerification?: {
        selfCertifiedKeyIdentifier?: boolean;
        expectedIdentifier?: { status?: string };
      };
    };

    assert.equal(details.valid, true);
    assert.equal(details.attestation, undefined);
    assert.equal(details.attestationEligibility?.eligible, false);
    assert.equal(
      details.trustedVerificationContext?.constitutionHash.status,
      "matched",
    );
    assert.equal(
      details.trustedVerificationContext?.policyId.status,
      "unrequested",
    );
    assert.equal(
      details.trustedVerificationContext?.policyVersion.status,
      "unrequested",
    );
    assert.equal(details.signerVerification?.selfCertifiedKeyIdentifier, true);
    assert.match(text, /self-certified signer key\/identifier/i);
    assert.match(
      text,
      /positive attestation withheld.*independent.*policy id.*policy version/i,
    );
    assert.doesNotMatch(text, /agent identity verified/i);
    assert.doesNotMatch(text, /\battested\b/i);
  });

  it("executeReceiptVerify reports an expected identifier match without implying trusted identity", () => {
    const deps = minimalDeps(ws.path);
    const receipt = makeSignedReceipt(ed.utils.randomPrivateKey(), {
      constitutionHash: deps.constitutionHash,
    });
    const result = executeReceiptVerify(
      {
        receiptJson: JSON.stringify(receipt),
        expectedAgentId: receipt.agentId,
        expectedPolicyId: receipt.policyId,
        expectedPolicyVersion: receipt.policyVersion,
      },
      deps,
    );
    const text = result.content[0]?.text ?? "";
    const details = result.details as {
      attestation?: { kind?: string };
      signerVerification?: {
        expectedIdentifier?: { status?: string };
        trustedKeyProvenance?: boolean;
        legalIdentityEstablished?: boolean;
      };
    };

    assert.equal(
      details.attestation?.kind,
      "instrumented-boundary-disposition",
    );
    assert.equal(
      details.signerVerification?.expectedIdentifier?.status,
      "matched",
    );
    assert.equal(details.signerVerification?.trustedKeyProvenance, false);
    assert.equal(details.signerVerification?.legalIdentityEstablished, false);
    assert.match(text, /supplied signer identifier matched/i);
    assert.match(text, /does not establish trusted key provenance|legal identity/i);
    assert.doesNotMatch(text, /agent identity verified/i);
  });

  it("executeReceiptVerify separates proof validity under a claimed root from anchored inclusion", () => {
    const deps = minimalDeps(ws.path);
    const receipt = makeSignedReceipt(ed.utils.randomPrivateKey(), {
      constitutionHash: deps.constitutionHash,
    });
    const inclusionEvidence = makeInclusionEvidence(receipt);
    const baseParams = {
      receiptJson: JSON.stringify(receipt),
      expectedPolicyId: receipt.policyId,
      expectedPolicyVersion: receipt.policyVersion,
      inclusionEvidenceJson: JSON.stringify(inclusionEvidence),
    };

    const claimedOnly = executeReceiptVerify(
      baseParams as Parameters<typeof executeReceiptVerify>[0],
      deps,
    );
    const claimedText = claimedOnly.content[0]?.text ?? "";
    const claimedDetails = claimedOnly.details as {
      valid?: boolean;
      confidenceCeiling?: number;
      inclusionVerification?: {
        exactEntryBound?: boolean;
        proofValidUnderClaimedRoot?: boolean;
        rootAnchored?: boolean;
        inclusionVerified?: boolean;
      };
    };
    assert.equal(claimedDetails.valid, false);
    assert.equal(claimedDetails.confidenceCeiling, 0);
    assert.equal(claimedDetails.inclusionVerification?.exactEntryBound, true);
    assert.equal(
      claimedDetails.inclusionVerification?.proofValidUnderClaimedRoot,
      true,
    );
    assert.equal(claimedDetails.inclusionVerification?.rootAnchored, false);
    assert.equal(
      claimedDetails.inclusionVerification?.inclusionVerified,
      false,
    );
    assert.match(claimedText, /proof valid under (?:the )?claimed root/i);
    assert.match(claimedText, /root (?:is )?not independently anchored/i);
    assert.match(claimedText, /signature valid/i);
    assert.match(claimedText, /self-certified signer/i);
    assert.match(claimedText, /does not prove.*completeness/i);
    assert.doesNotMatch(claimedText, /anchored inclusion verified:\s*yes/i);

    const anchored = executeReceiptVerify(
      {
        ...baseParams,
        expectedReceiptRoot: inclusionEvidence.proof.root,
      } as Parameters<typeof executeReceiptVerify>[0],
      deps,
    );
    const anchoredText = anchored.content[0]?.text ?? "";
    const anchoredDetails = anchored.details as {
      valid?: boolean;
      inclusionVerification?: {
        proofValidUnderClaimedRoot?: boolean;
        rootAnchored?: boolean;
        inclusionVerified?: boolean;
      };
    };
    assert.equal(anchoredDetails.valid, true);
    assert.equal(
      anchoredDetails.inclusionVerification?.proofValidUnderClaimedRoot,
      true,
    );
    assert.equal(anchoredDetails.inclusionVerification?.rootAnchored, true);
    assert.equal(
      anchoredDetails.inclusionVerification?.inclusionVerified,
      true,
    );
    assert.match(anchoredText, /exact-entry proof valid/i);
    assert.match(anchoredText, /root independently anchored/i);
  });

  it("executeReceiptProofExport returns exact-entry inclusion evidence", () => {
    const receipt = makeSignedReceipt(ed.utils.randomPrivateKey());
    const entryPreimage = {
      previousHash: "0".repeat(64),
      timestamp: "2026-07-10T12:01:00.000Z",
      kind: "conformance-receipt",
      receipt,
    };
    const hash = digest({
      version: 2,
      domain: DIGEST_DOMAINS.entry,
      value: entryPreimage,
    });
    const logPath = join(ws.path, "receipt-proof-export.jsonl");
    writeFileSync(
      logPath,
      JSON.stringify({ ...entryPreimage, hash }) + "\n",
      "utf8",
    );
    const result = executeReceiptProofExport(
      { index: 0 },
      { ...minimalDeps(ws.path), receiptLogPath: logPath },
    );
    const details = result.details as {
      locallyCalculatedRoot?: string;
      trustedCheckpoint?: null;
      rootAuthoritative?: boolean;
      inclusionEvidence?: {
        entry: { receipt: unknown; hash: string };
        proof: { leaf: string };
      };
    };
    assert.deepEqual(details.inclusionEvidence?.entry.receipt, receipt);
    assert.equal(details.inclusionEvidence?.entry.hash, hash);
    assert.equal(details.inclusionEvidence?.proof.leaf, hash);
    assert.equal(details.locallyCalculatedRoot, hash);
    assert.equal(details.trustedCheckpoint, null);
    assert.equal(details.rootAuthoritative, false);
    assert.match(
      result.content[0]?.text ?? "",
      /locally calculated root.*not an independently trusted checkpoint/i,
    );
  });

  it("exports proofs and capsules for mixed signed/degraded receipt logs", () => {
    const logPath = join(ws.path, "mixed-receipt-capsule.jsonl");
    const unsigned = makeSignedReceipt(ed.utils.randomPrivateKey(), {
      signingStatus: "unsigned-degraded",
      trustElevating: false,
      signature: undefined,
      publicKey: undefined,
    });
    delete (unsigned as { signature?: string }).signature;
    delete (unsigned as { publicKey?: string }).publicKey;
    const first = {
      previousHash: "0".repeat(64),
      timestamp: "2026-07-10T12:01:00.000Z",
      kind: "conformance-receipt",
      receipt: unsigned,
    };
    const firstHash = digest({
      version: 2,
      domain: DIGEST_DOMAINS.entry,
      value: first,
    });
    const signed = makeSignedReceipt(ed.utils.randomPrivateKey());
    const second = {
      previousHash: firstHash,
      timestamp: "2026-07-10T12:02:00.000Z",
      kind: "conformance-receipt",
      receipt: signed,
    };
    const secondHash = digest({
      version: 2,
      domain: DIGEST_DOMAINS.entry,
      value: second,
    });
    writeFileSync(
      logPath,
      `${JSON.stringify({ ...first, hash: firstHash })}\n` +
        `${JSON.stringify({ ...second, hash: secondHash })}\n`,
      "utf8",
    );
    const deps = { ...minimalDeps(ws.path), receiptLogPath: logPath };

    const proof = executeReceiptProofExport({ index: 1 }, deps);
    assert.deepEqual(
      (proof.details as { inclusionEvidence?: { entry: { receipt: unknown } } })
        .inclusionEvidence?.entry.receipt,
      signed,
    );
    const capsule = executeCapsuleOffer(
      { audience: "peer:test", challenge: "fresh-challenge" },
      deps,
    );
    assert.ok(capsule.content[0]?.text);
  });
});

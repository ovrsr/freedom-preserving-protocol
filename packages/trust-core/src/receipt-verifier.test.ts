import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DIGEST_DOMAINS,
  KEY_ALGORITHM,
  canonicalizeV2,
  deriveAgentIdV2,
  digest,
  signMessage,
  publicKeyFromSeed,
} from "@ovrsr/fpp-protocol-core";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import {
  verifyReceiptEvidence,
  verifyReceiptSignatureLocal,
  getReceiptRoot,
  createTypedReceiptProof,
  createTypedReceiptInclusionEvidence,
  RECEIPT_LOG_KIND,
} from "./receipt-verifier.js";

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

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
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) delete base[key];
  }
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

function makeInclusionEvidence(
  receipt: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) {
  const entryPreimage = {
    previousHash: "0".repeat(64),
    timestamp: "2026-07-10T12:01:00.000Z",
    kind: RECEIPT_LOG_KIND,
    receipt,
  };
  const hash = digest({
    version: 2,
    domain: DIGEST_DOMAINS.entry,
    value: entryPreimage,
  });
  return {
    evidenceVersion: 1,
    logKind: RECEIPT_LOG_KIND,
    entry: { ...entryPreimage, hash },
    proof: {
      leaf: hash,
      index: 0,
      path: [],
      root: hash,
    },
    ...overrides,
  };
}

describe("receipt verifier", () => {
  const dir = mkdtempSync(join(tmpdir(), "fpp-rv-"));
  after(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it("accepts a valid signed receipt", () => {
    const seed = ed.utils.randomPrivateKey();
    const receipt = makeSignedReceipt(seed);
    const report = verifyReceiptEvidence({ receipt });
    assert.equal(report.valid, true);
    assert.equal(report.claimClass, "event");
    assert.ok(report.whatWasNotProven.some((x) => /behavioral/i.test(x)));
  });

  it("withholds the Event attestation from an unanchored self-signed receipt", () => {
    const receipt = makeSignedReceipt(ed.utils.randomPrivateKey(), {
      constitutionHash: "d".repeat(64),
    });
    const report = verifyReceiptEvidence({ receipt });

    assert.equal(report.valid, true);
    assert.equal(report.attestation, undefined);
    assert.equal(report.attestationEligibility.eligible, false);
    assert.deepEqual(report.attestationEligibility.requiredTrustedContext, [
      "constitutionHash",
      "policyId",
      "policyVersion",
    ]);
    assert.equal(
      report.trustedVerificationContext.constitutionHash.status,
      "unrequested",
    );
    assert.equal(report.trustedVerificationContext.policyId.status, "unrequested");
    assert.equal(
      report.trustedVerificationContext.policyVersion.status,
      "unrequested",
    );
    assert.equal(report.signerVerification.signatureValid, true);
    assert.equal(report.signerVerification.selfCertifiedKeyIdentifier, true);
    assert.equal(report.signerVerification.expectedIdentifier.status, "unrequested");
    assert.equal(report.signerVerification.trustedKeyProvenance, false);
    assert.equal(report.signerVerification.legalIdentityEstablished, false);
    assert.ok(
      report.whatWasVerified.some((item) =>
        /self-certified signer key\/identifier/i.test(item),
      ),
    );
    assert.ok(
      report.reasons.some((reason) =>
        /independent constitution.*policy id.*policy version/i.test(reason),
      ),
    );
    assert.ok(
      report.whatWasVerified.every(
        (item) => !/agent identity verified|agent identity$/i.test(item),
      ),
    );
  });

  it("requires independently matched constitution and policy context for the Event attestation", () => {
    const receipt = makeSignedReceipt(ed.utils.randomPrivateKey(), {
      constitutionHash: "d".repeat(64),
    });
    const anchored = verifyReceiptEvidence({
      receipt,
      expectedConstitutionHash: receipt.constitutionHash,
      expectedPolicyId: receipt.policyId,
      expectedPolicyVersion: receipt.policyVersion,
    });

    assert.equal(anchored.valid, true);
    assert.equal(anchored.attestationEligibility.eligible, true);
    assert.equal(anchored.trustedVerificationContext.anchored, true);
    assert.equal(
      anchored.trustedVerificationContext.constitutionHash.status,
      "matched",
    );
    assert.equal(anchored.trustedVerificationContext.policyId.status, "matched");
    assert.equal(
      anchored.trustedVerificationContext.policyVersion.status,
      "matched",
    );
    assert.ok(anchored.attestation);
    assert.equal(
      anchored.attestation.kind,
      "instrumented-boundary-disposition",
    );

    for (const omitted of [
      "expectedConstitutionHash",
      "expectedPolicyId",
      "expectedPolicyVersion",
    ] as const) {
      const input = {
        receipt,
        expectedConstitutionHash: receipt.constitutionHash,
        expectedPolicyId: receipt.policyId,
        expectedPolicyVersion: receipt.policyVersion,
      };
      delete input[omitted];
      const report = verifyReceiptEvidence(input);
      assert.equal(report.valid, true, omitted);
      assert.equal(report.attestationEligibility.eligible, false, omitted);
      assert.equal(report.attestation, undefined, omitted);
    }

    const missingConstitution = makeSignedReceipt(ed.utils.randomPrivateKey(), {
      constitutionHash: undefined,
    });
    const missing = verifyReceiptEvidence({
      receipt: missingConstitution,
      expectedConstitutionHash: "d".repeat(64),
      expectedPolicyId: missingConstitution.policyId,
      expectedPolicyVersion: missingConstitution.policyVersion,
    });
    assert.equal(
      missing.trustedVerificationContext.constitutionHash.status,
      "missing",
    );
    assert.equal(missing.valid, false);
    assert.equal(missing.attestation, undefined);

    const mismatched = verifyReceiptEvidence({
      receipt,
      expectedConstitutionHash: receipt.constitutionHash,
      expectedPolicyId: "other-policy",
      expectedPolicyVersion: receipt.policyVersion,
    });
    assert.equal(
      mismatched.trustedVerificationContext.policyId.status,
      "mismatched",
    );
    assert.equal(mismatched.valid, false);
    assert.equal(mismatched.attestation, undefined);
  });

  it("distinguishes expected signer identifier matching from trusted identity", () => {
    const receipt = makeSignedReceipt(ed.utils.randomPrivateKey(), {
      constitutionHash: "d".repeat(64),
    });
    const report = verifyReceiptEvidence({
      receipt,
      expectedAgentId: receipt.agentId,
      expectedConstitutionHash: receipt.constitutionHash,
      expectedPolicyId: receipt.policyId,
      expectedPolicyVersion: receipt.policyVersion,
    });

    assert.equal(report.signerVerification.expectedIdentifier.status, "matched");
    assert.equal(report.signerVerification.selfCertifiedKeyIdentifier, true);
    assert.equal(report.signerVerification.trustedKeyProvenance, false);
    assert.equal(report.signerVerification.legalIdentityEstablished, false);
    assert.ok(
      report.whatWasVerified.some((item) =>
        /supplied signer identifier matched/i.test(item),
      ),
    );
    assert.ok(
      report.whatWasVerified.every(
        (item) => !/agent identity verified|trusted identity/i.test(item),
      ),
    );
  });

  it("emits instrumented-boundary-disposition attestation for a valid signed receipt", () => {
    const seed = ed.utils.randomPrivateKey();
    const receipt = makeSignedReceipt(seed, {
      disposition: "deny",
      authorization: "policy-match",
      actionDigest: "d".repeat(64),
      policyId: "fpp-enforcement:deadbeef",
      policyVersion: "pol-1",
      constitutionHash: "e".repeat(64),
      classifierRulesetHash: "c".repeat(64),
      implementationVersion: "1.1.4",
    });
    const report = verifyReceiptEvidence({
      receipt,
      expectedConstitutionHash: receipt.constitutionHash,
      expectedPolicyId: receipt.policyId,
      expectedPolicyVersion: receipt.policyVersion,
    });
    assert.equal(report.valid, true);
    assert.ok(report.attestation, "expected positive attestation");
    assert.equal(report.attestation.kind, "instrumented-boundary-disposition");
    assert.equal(report.attestation.claimClass, "event");
    assert.equal(report.attestation.uncertaintyLabel, "proven_under_assumptions");
    assert.equal(report.attestation.actionDigest, "d".repeat(64));
    assert.equal(report.attestation.disposition, "deny");
    assert.equal(report.attestation.authorization, "policy-match");
    assert.equal(report.attestation.policyId, "fpp-enforcement:deadbeef");
    assert.equal(report.attestation.policyVersion, "pol-1");
    assert.equal(report.attestation.classifierRulesetHash, "c".repeat(64));
    assert.equal(report.attestation.signatureValid, true);
    assert.equal(report.attestation.inclusionVerified, false);
    assert.match(
      report.attestation.maximumConclusion,
      /recorded disposition deny and authorization policy-match against action digest/i,
    );
    assert.ok(report.attestation.assumptions.length > 0);
    assert.ok(report.attestation.limitations.length > 0);
    assert.ok(
      report.whatWasNotProven.some((x) => /downstream parameter equality/i.test(x)),
    );
    assert.ok(
      report.whatWasNotProven.some((x) => /uninstrumented|bypass/i.test(x)),
    );
    assert.ok(report.whatWasNotProven.some((x) => /completeness/i.test(x)));
    assert.ok(report.whatWasNotProven.some((x) => /uncompromised/i.test(x)));
    assert.ok(report.whatWasNotProven.some((x) => /behavioral/i.test(x)));
  });

  it("omits positive attestation for invalid signatures, unsigned, schema, policy, and inclusion failures", () => {
    const seed = ed.utils.randomPrivateKey();
    const valid = makeSignedReceipt(seed);

    const badSig = { ...valid, signature: "00".repeat(64) };
    const badSigReport = verifyReceiptEvidence({ receipt: badSig });
    assert.equal(badSigReport.valid, false);
    assert.equal(badSigReport.attestation, undefined);

    const unsigned = makeSignedReceipt(seed, {
      signingStatus: "unsigned-degraded",
      trustElevating: false,
      signature: undefined,
      publicKey: undefined,
    });
    // unsigned-degraded path: strip crypto fields and mark degraded
    delete (unsigned as { signature?: string }).signature;
    delete (unsigned as { publicKey?: string }).publicKey;
    (unsigned as { signingStatus: string }).signingStatus = "unsigned-degraded";
    (unsigned as { trustElevating: boolean }).trustElevating = false;
    const unsignedReport = verifyReceiptEvidence({ receipt: unsigned });
    assert.equal(unsignedReport.valid, false);
    assert.equal(unsignedReport.attestation, undefined);

    const schemaReport = verifyReceiptEvidence({
      receipt: { schemaVersion: 99, receiptClass: "conformance" },
    });
    assert.equal(schemaReport.valid, false);
    assert.equal(schemaReport.attestation, undefined);

    const policyReport = verifyReceiptEvidence({
      receipt: valid,
      expectedPolicyVersion: "other-policy",
    });
    assert.equal(policyReport.valid, false);
    assert.equal(policyReport.attestation, undefined);

    const inclusionReport = verifyReceiptEvidence({
      receipt: valid,
      inclusionProof: {
        leaf: "a".repeat(64),
        index: 0,
        path: [],
        root: "a".repeat(64),
        logKind: "heartbeat",
      },
    });
    assert.equal(inclusionReport.valid, false);
    assert.equal(inclusionReport.attestation, undefined);
  });

  it("distinguishes signed-only evidence from Merkle-included evidence without claiming completeness", () => {
    const seed = ed.utils.randomPrivateKey();
    const receipt = makeSignedReceipt(seed, {
      constitutionHash: "d".repeat(64),
    });
    const trustedContext = {
      expectedConstitutionHash: receipt.constitutionHash,
      expectedPolicyId: receipt.policyId,
      expectedPolicyVersion: receipt.policyVersion,
    };
    const signedOnly = verifyReceiptEvidence({ receipt, ...trustedContext });
    assert.equal(signedOnly.valid, true);
    assert.ok(signedOnly.attestation);
    assert.equal(signedOnly.attestation.inclusionVerified, false);
    assert.equal(signedOnly.verified.inclusion, false);

    const inclusionEvidence = makeInclusionEvidence(receipt);
    const withInclusion = verifyReceiptEvidence({
      receipt,
      inclusionEvidence,
      expectedRoot: inclusionEvidence.proof.root,
      ...trustedContext,
    });
    assert.equal(withInclusion.valid, true);
    assert.ok(withInclusion.attestation);
    assert.equal(withInclusion.attestation.inclusionVerified, true);
    assert.equal(withInclusion.verified.inclusion, true);
    assert.equal(
      withInclusion.attestation.uncertaintyLabel,
      "proven_under_assumptions",
    );
    assert.notEqual(
      withInclusion.attestation.uncertaintyLabel,
      "boundary_attested",
    );
    assert.ok(
      withInclusion.whatWasNotProven.some((x) => /completeness/i.test(x)),
    );
    assert.ok(
      withInclusion.attestation.limitations.some((x) => /completeness/i.test(x)),
    );
  });

  it("rejects wrong signer / agentId mismatch", () => {
    const seed = ed.utils.randomPrivateKey();
    const receipt = makeSignedReceipt(seed, {
      agentId: "fpp:ed25519:" + "b".repeat(64),
    });
    const sig = verifyReceiptSignatureLocal(receipt);
    assert.equal(sig.valid, false);
  });

  it("rejects wrong policy hash", () => {
    const seed = ed.utils.randomPrivateKey();
    const receipt = makeSignedReceipt(seed);
    const report = verifyReceiptEvidence({
      receipt,
      expectedPolicyVersion: "other-policy",
    });
    assert.equal(report.valid, false);
    assert.ok(report.reasons.some((r) => /policyVersion/i.test(r)));
  });

  it("gives signed but semantically invalid receipts zero confidence and no attestation", () => {
    const weakReceipt = makeSignedReceipt(ed.utils.randomPrivateKey(), {
      actionDigest: "not-a-digest",
      issuedAt: "not-a-date",
    });
    const report = verifyReceiptEvidence({ receipt: weakReceipt });
    assert.equal(report.verified.signature, true);
    assert.equal(report.verified.schema, false);
    assert.equal(report.valid, false);
    assert.equal(report.confidenceCeiling, 0);
    assert.equal(report.attestation, undefined);
  });

  it("reports every requested expected field independently", () => {
    const receipt = makeSignedReceipt(ed.utils.randomPrivateKey(), {
      constitutionHash: "d".repeat(64),
      classifierRulesetHash: "c".repeat(64),
      effectiveConfigHash: "e".repeat(64),
    });
    const report = verifyReceiptEvidence({
      receipt,
      expectedActionDigest: "f".repeat(64),
      expectedAgentId: receipt.agentId,
      expectedPolicyId: "other-policy",
      expectedPolicyVersion: receipt.policyVersion,
      expectedImplementationVersion: "other-implementation",
      expectedConstitutionHash: receipt.constitutionHash,
      expectedClassifierRulesetHash: "1".repeat(64),
      expectedEffectiveConfigHash: receipt.effectiveConfigHash,
    } as Parameters<typeof verifyReceiptEvidence>[0] & Record<string, unknown>);
    const comparisons = (
      report as typeof report & {
        expectedComparisons: Record<
          | "actionDigest"
          | "agentId"
          | "policyId"
          | "policyVersion"
          | "implementationVersion"
          | "constitutionHash"
          | "classifierRulesetHash"
          | "effectiveConfigHash",
          { expected: string; actual?: string; matched: boolean }
        >;
      }
    ).expectedComparisons;

    assert.equal(comparisons.actionDigest.matched, false);
    assert.equal(comparisons.agentId.matched, true);
    assert.equal(comparisons.policyId.matched, false);
    assert.equal(comparisons.policyVersion.matched, true);
    assert.equal(comparisons.implementationVersion.matched, false);
    assert.equal(comparisons.constitutionHash.matched, true);
    assert.equal(comparisons.classifierRulesetHash.matched, false);
    assert.equal(comparisons.effectiveConfigHash.matched, true);
    assert.equal(report.valid, false);
    assert.equal(report.confidenceCeiling, 0);
    assert.equal(report.attestation, undefined);
    assert.ok(report.reasons.some((reason) => /actionDigest mismatch/.test(reason)));
    assert.ok(report.reasons.some((reason) => /policyId mismatch/.test(reason)));
    assert.ok(
      report.reasons.some((reason) => /implementationVersion mismatch/.test(reason)),
    );
    assert.ok(
      report.reasons.some((reason) => /classifierRulesetHash mismatch/.test(reason)),
    );
  });

  it("names only anchored and present semantically valid metadata in conclusions", () => {
    const receipt = makeSignedReceipt(ed.utils.randomPrivateKey(), {
      classifierRulesetHash: undefined,
      constitutionHash: "d".repeat(64),
      effectiveConfigHash: undefined,
    });
    const report = verifyReceiptEvidence({
      receipt,
      expectedConstitutionHash: receipt.constitutionHash,
      expectedPolicyId: receipt.policyId,
      expectedPolicyVersion: receipt.policyVersion,
    });
    assert.equal(report.valid, true);
    assert.ok(report.attestation);
    assert.match(report.attestation.maximumConclusion, /policy/i);
    assert.match(report.attestation.maximumConclusion, /implementation/i);
    assert.doesNotMatch(
      report.attestation.maximumConclusion,
      /classifier|configuration/i,
    );
  });

  it("rejects unknown schema", () => {
    const report = verifyReceiptEvidence({
      receipt: { schemaVersion: 99, receiptClass: "conformance" },
    });
    assert.equal(report.valid, false);
  });

  it("rejects cross-log root confusion on inclusion proofs", () => {
    const seed = ed.utils.randomPrivateKey();
    const receipt = makeSignedReceipt(seed);
    const report = verifyReceiptEvidence({
      receipt,
      inclusionProof: {
        leaf: "a".repeat(64),
        index: 0,
        path: [],
        root: "a".repeat(64),
        logKind: "heartbeat",
      },
    });
    assert.equal(report.valid, false);
    assert.ok(report.reasons.some((r) => /logKind confusion/i.test(r)));
  });

  it("does not let a standalone proof for entry B attest receipt A", () => {
    const receiptA = makeSignedReceipt(ed.utils.randomPrivateKey(), {
      actionDigest: "a".repeat(64),
    });
    const unrelatedLeaf = "b".repeat(64);
    const report = verifyReceiptEvidence({
      receipt: receiptA,
      inclusionProof: {
        leaf: unrelatedLeaf,
        index: 0,
        path: [],
        root: unrelatedLeaf,
        logKind: RECEIPT_LOG_KIND,
      },
      expectedRoot: unrelatedLeaf,
    });
    assert.equal(report.valid, false);
    assert.equal(report.verified.inclusion, false);
    assert.equal(report.attestation, undefined);
  });

  it("binds versioned inclusion evidence to the exact receipt-log entry", () => {
    const receipt = makeSignedReceipt(ed.utils.randomPrivateKey(), {
      constitutionHash: "d".repeat(64),
    });
    const evidence = makeInclusionEvidence(receipt);
    const verify = (inclusionEvidence: unknown, expectedRoot = evidence.proof.root) =>
      verifyReceiptEvidence({
        receipt,
        inclusionEvidence,
        expectedRoot,
        expectedConstitutionHash: receipt.constitutionHash,
        expectedPolicyId: receipt.policyId,
        expectedPolicyVersion: receipt.policyVersion,
      } as Parameters<typeof verifyReceiptEvidence>[0] & {
        inclusionEvidence: unknown;
      });

    const valid = verify(evidence);
    assert.equal(valid.valid, true);
    assert.equal(valid.verified.inclusion, true);
    assert.ok(valid.attestation);
    assert.equal(valid.attestation.inclusionVerified, true);
    assert.ok(valid.whatWasNotProven.some((x) => /completeness/i.test(x)));

    const cases: Array<[string, unknown]> = [
      ["missing log kind", { ...evidence, logKind: undefined }],
      ["wrong log kind", { ...evidence, logKind: "enforcement" }],
      [
        "mismatched receipt",
        {
          ...evidence,
          entry: {
            ...evidence.entry,
            receipt: makeSignedReceipt(ed.utils.randomPrivateKey()),
          },
        },
      ],
      [
        "wrong entry hash",
        { ...evidence, entry: { ...evidence.entry, hash: "c".repeat(64) } },
      ],
      [
        "proof leaf differs from entry hash",
        { ...evidence, proof: { ...evidence.proof, leaf: "d".repeat(64) } },
      ],
      [
        "altered timestamp",
        {
          ...evidence,
          entry: {
            ...evidence.entry,
            timestamp: "2026-07-10T12:02:00.000Z",
          },
        },
      ],
      [
        "altered previous hash",
        {
          ...evidence,
          entry: { ...evidence.entry, previousHash: "e".repeat(64) },
        },
      ],
    ];

    for (const [name, invalidEvidence] of cases) {
      const report = verify(invalidEvidence);
      assert.equal(report.valid, false, name);
      assert.equal(report.verified.inclusion, false, name);
      assert.equal(report.attestation, undefined, name);
    }

    const wrongRoot = verify(evidence, "f".repeat(64));
    assert.equal(wrongRoot.valid, false);
    assert.equal(wrongRoot.verified.inclusion, false);
    assert.equal(wrongRoot.attestation, undefined);
  });

  it("separates exact-entry proof mathematics from independent root anchoring", () => {
    const receipt = makeSignedReceipt(ed.utils.randomPrivateKey(), {
      constitutionHash: "d".repeat(64),
    });
    const evidence = makeInclusionEvidence(receipt);
    const trustedContext = {
      expectedConstitutionHash: receipt.constitutionHash,
      expectedPolicyId: receipt.policyId,
      expectedPolicyVersion: receipt.policyVersion,
    };

    const attackerChosenRoot = verifyReceiptEvidence({
      receipt,
      inclusionEvidence: evidence,
      ...trustedContext,
    });
    assert.equal(attackerChosenRoot.inclusionVerification.exactEntryBound, true);
    assert.equal(
      attackerChosenRoot.inclusionVerification.proofValidUnderClaimedRoot,
      true,
    );
    assert.equal(attackerChosenRoot.inclusionVerification.rootAnchored, false);
    assert.equal(attackerChosenRoot.inclusionVerification.inclusionVerified, false);
    assert.equal(attackerChosenRoot.verified.inclusion, false);
    assert.equal(attackerChosenRoot.valid, false);
    assert.equal(attackerChosenRoot.confidenceCeiling, 0);
    assert.equal(attackerChosenRoot.attestation, undefined);
    assert.ok(
      attackerChosenRoot.reasons.some((reason) =>
        /independent expected receipt root|required for anchored inclusion/i.test(
          reason,
        ),
      ),
    );

    const anchored = verifyReceiptEvidence({
      receipt,
      inclusionEvidence: evidence,
      expectedRoot: evidence.proof.root,
      ...trustedContext,
    });
    assert.equal(anchored.inclusionVerification.proofValidUnderClaimedRoot, true);
    assert.equal(anchored.inclusionVerification.rootAnchored, true);
    assert.equal(anchored.inclusionVerification.inclusionVerified, true);
    assert.equal(anchored.verified.inclusion, true);
    assert.equal(anchored.valid, true);
    assert.ok(anchored.attestation);

    const mismatchedCheckpoint = verifyReceiptEvidence({
      receipt,
      inclusionEvidence: evidence,
      expectedRoot: "f".repeat(64),
      ...trustedContext,
    });
    assert.equal(
      mismatchedCheckpoint.inclusionVerification.proofValidUnderClaimedRoot,
      true,
    );
    assert.equal(mismatchedCheckpoint.inclusionVerification.rootAnchored, false);
    assert.equal(
      mismatchedCheckpoint.inclusionVerification.expectedRootStatus,
      "mismatched",
    );
    assert.equal(
      mismatchedCheckpoint.inclusionVerification.inclusionVerified,
      false,
    );
    assert.equal(mismatchedCheckpoint.valid, false);
    assert.equal(mismatchedCheckpoint.attestation, undefined);
  });

  it("fails closed instead of omitting non-receipt entries from typed roots", () => {
    const log = join(dir, "mixed.jsonl");
    writeFileSync(
      log,
      JSON.stringify({
        previousHash: "0".repeat(64),
        kind: "enforcement",
        hash: "e".repeat(64),
      }) +
        "\n" +
        JSON.stringify({
          previousHash: "0".repeat(64),
          kind: RECEIPT_LOG_KIND,
          hash: "r".repeat(64),
          receipt: {},
        }) +
        "\n",
    );
    assert.throws(
      () => getReceiptRoot(log),
      /line 1: unexpected log kind|line 1.*enforcement/i,
    );
    assert.throws(
      () => createTypedReceiptProof(log, 0),
      /line 1: unexpected log kind|line 1.*enforcement/i,
    );
  });

  it("retains allowed unsigned-degraded entries in typed receipt-log proofs", () => {
    const log = join(dir, "unsigned-degraded.jsonl");
    const unsigned = makeSignedReceipt(ed.utils.randomPrivateKey(), {
      signingStatus: "unsigned-degraded",
      trustElevating: false,
      signature: undefined,
      publicKey: undefined,
    });
    delete (unsigned as { signature?: string }).signature;
    delete (unsigned as { publicKey?: string }).publicKey;
    const unsignedEntry = {
      previousHash: "0".repeat(64),
      timestamp: "2026-07-10T12:01:00.000Z",
      kind: RECEIPT_LOG_KIND,
      receipt: unsigned,
    };
    const unsignedHash = digest({
      version: 2,
      domain: DIGEST_DOMAINS.entry,
      value: unsignedEntry,
    });
    const signed = makeSignedReceipt(ed.utils.randomPrivateKey());
    const signedEntry = {
      previousHash: unsignedHash,
      timestamp: "2026-07-10T12:02:00.000Z",
      kind: RECEIPT_LOG_KIND,
      receipt: signed,
    };
    const signedHash = digest({
      version: 2,
      domain: DIGEST_DOMAINS.entry,
      value: signedEntry,
    });
    writeFileSync(
      log,
      `${JSON.stringify({ ...unsignedEntry, hash: unsignedHash })}\n` +
        `${JSON.stringify({ ...signedEntry, hash: signedHash })}\n`,
    );

    assert.equal(getReceiptRoot(log).entryCount, 2);
    const evidence = createTypedReceiptInclusionEvidence(log, 1);
    assert.ok(evidence);
    assert.deepEqual(evidence.entry.receipt, signed);
  });
});

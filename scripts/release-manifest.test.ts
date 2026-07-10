import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  buildReleaseManifest,
  signReleaseManifest,
  verifyReleaseManifest,
  RELEASE_SIGNING_DOMAIN,
} from "./release-manifest.ts";

function keyPair() {
  return generateKeyPairSync("ed25519");
}

describe("release manifest", () => {
  const base = () =>
    buildReleaseManifest({
      sourceCommit: "abc123",
      constitutionHash: "a".repeat(64),
      packageName: "@ovrsr/openclaw-fpp-plugin",
      packageVersion: "1.1.4",
      packageHash: "p".repeat(64),
      lockfileHash: "l".repeat(64),
      testCorpusHash: "t".repeat(64),
      supportedRuntime: "node>=22.19",
      dependenciesHash: "d".repeat(64),
    });

  it("signs and verifies with the release domain", () => {
    const { privateKey } = keyPair();
    const signed = signReleaseManifest(
      base(),
      privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    );
    assert.equal(signed.signingDomain, RELEASE_SIGNING_DOMAIN);
    const report = verifyReleaseManifest(signed, {
      sourceCommit: "abc123",
      packageHash: "p".repeat(64),
      minNodeMajor: 22,
    });
    assert.equal(report.ok, true);
  });

  it("detects tampered package hash and wrong source commit", () => {
    const { privateKey } = keyPair();
    const signed = signReleaseManifest(
      base(),
      privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    );
    assert.equal(
      verifyReleaseManifest(signed, { packageHash: "x".repeat(64) }).ok,
      false,
    );
    assert.equal(
      verifyReleaseManifest(signed, { sourceCommit: "other" }).ok,
      false,
    );
  });

  it("detects stale lock hash, wrong corpus, unsupported runtime, wrong domain", () => {
    const { privateKey } = keyPair();
    const signed = signReleaseManifest(
      base(),
      privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    );
    assert.ok(
      verifyReleaseManifest(signed, { lockfileHash: "z".repeat(64) }).errors.some((e) =>
        /lockfile/i.test(e),
      ),
    );
    assert.ok(
      verifyReleaseManifest(signed, { testCorpusHash: "z".repeat(64) }).errors.some((e) =>
        /testCorpus/i.test(e),
      ),
    );
    assert.ok(
      verifyReleaseManifest(signed, { minNodeMajor: 24 }).errors.some((e) =>
        /runtime/i.test(e),
      ),
    );
    const wrongDomain = { ...signed, signingDomain: "fpp:v2:agent-identity" as typeof RELEASE_SIGNING_DOMAIN };
    assert.ok(verifyReleaseManifest(wrongDomain).errors.some((e) => /domain/i.test(e)));
  });
});

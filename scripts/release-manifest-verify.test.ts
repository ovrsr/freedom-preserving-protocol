import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildReleaseManifest,
  signReleaseManifest,
  writeReleaseManifest,
} from "./release-manifest.ts";
import { readReleaseManifest, verifyReleaseManifest } from "./release-manifest-verify.ts";

describe("release-manifest-verify", () => {
  const dir = mkdtempSync(join(tmpdir(), "fpp-rmv-"));
  after(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it("reads and verifies a signed manifest file", () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const signed = signReleaseManifest(
      buildReleaseManifest({
        sourceCommit: "deadbeef",
        constitutionHash: "a".repeat(64),
        packageName: "pkg",
        packageVersion: "1.0.0",
        packageHash: "p".repeat(64),
        lockfileHash: "l".repeat(64),
        testCorpusHash: "t".repeat(64),
        supportedRuntime: "node>=22.19",
        dependenciesHash: "d".repeat(64),
      }),
      privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    );
    const path = join(dir, "manifest.json");
    writeReleaseManifest(path, signed);
    const loaded = readReleaseManifest(path);
    assert.equal(verifyReleaseManifest(loaded).ok, true);
  });

  it("fails on unsigned file", () => {
    const path = join(dir, "bad.json");
    writeFileSync(
      path,
      JSON.stringify(
        buildReleaseManifest({
          sourceCommit: "x",
          constitutionHash: "a".repeat(64),
          packageName: "pkg",
          packageVersion: "1.0.0",
          packageHash: "p".repeat(64),
          lockfileHash: "l".repeat(64),
          testCorpusHash: "t".repeat(64),
          supportedRuntime: "node>=22.19",
          dependenciesHash: "d".repeat(64),
        }),
      ),
    );
    assert.equal(verifyReleaseManifest(readReleaseManifest(path)).ok, false);
  });
});

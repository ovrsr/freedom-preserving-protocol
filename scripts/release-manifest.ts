/**
 * Signed release manifest generation (Plan 6 Task 10).
 *
 * Signing domain: release — must not reuse constitution-root or agent-identity keys.
 */

import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DIGEST_DOMAINS, canonicalizeV2, digest } from "@ovrsr/fpp-protocol-core";

export const RELEASE_SIGNING_DOMAIN = "fpp:v2:release-manifest" as const;

export type ReleaseManifestV1 = {
  schemaVersion: 1;
  signingDomain: typeof RELEASE_SIGNING_DOMAIN;
  sourceCommit: string;
  constitutionHash: string;
  packageName: string;
  packageVersion: string;
  packageHash: string;
  lockfileHash: string;
  testCorpusHash: string;
  supportedRuntime: string;
  dependenciesHash: string;
  policyVersion?: string | undefined;
  issuedAt: string;
  publicKeyPem?: string | undefined;
  signature?: string | undefined;
};

export function sha256File(path: string): string {
  const buf = readFileSync(path);
  return createHash("sha256").update(buf).digest("hex");
}

export function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function buildReleaseManifest(input: {
  sourceCommit: string;
  constitutionHash: string;
  packageName: string;
  packageVersion: string;
  packageHash: string;
  lockfileHash: string;
  testCorpusHash: string;
  supportedRuntime: string;
  dependenciesHash: string;
  policyVersion?: string | undefined;
  issuedAt?: string | undefined;
}): ReleaseManifestV1 {
  return {
    schemaVersion: 1,
    signingDomain: RELEASE_SIGNING_DOMAIN,
    sourceCommit: input.sourceCommit,
    constitutionHash: input.constitutionHash,
    packageName: input.packageName,
    packageVersion: input.packageVersion,
    packageHash: input.packageHash,
    lockfileHash: input.lockfileHash,
    testCorpusHash: input.testCorpusHash,
    supportedRuntime: input.supportedRuntime,
    dependenciesHash: input.dependenciesHash,
    policyVersion: input.policyVersion,
    issuedAt: input.issuedAt ?? new Date().toISOString(),
  };
}

function unsignedFields(m: ReleaseManifestV1): Record<string, unknown> {
  const { signature: _s, publicKeyPem: _p, ...rest } = m;
  void _s;
  void _p;
  return rest;
}

export function signReleaseManifest(
  manifest: ReleaseManifestV1,
  privateKeyPem: string,
): ReleaseManifestV1 {
  if (manifest.signingDomain !== RELEASE_SIGNING_DOMAIN) {
    throw new Error("wrong signing domain for release manifest");
  }
  const key = createPrivateKey(privateKeyPem);
  const pub = createPublicKey(key).export({ type: "spki", format: "pem" }).toString();
  const payload = canonicalizeV2(unsignedFields(manifest));
  const signature = sign(null, Buffer.from(payload), key).toString("base64");
  return { ...manifest, publicKeyPem: pub, signature };
}

export type ReleaseVerifyResult = {
  ok: boolean;
  errors: string[];
};

export function verifyReleaseManifest(
  manifest: ReleaseManifestV1,
  expectations?: Partial<{
    sourceCommit: string;
    packageHash: string;
    lockfileHash: string;
    testCorpusHash: string;
    supportedRuntime: string;
    minNodeMajor: number;
  }>,
): ReleaseVerifyResult {
  const errors: string[] = [];
  if (manifest.signingDomain !== RELEASE_SIGNING_DOMAIN) {
    errors.push("wrong signing domain");
  }
  if (!manifest.signature || !manifest.publicKeyPem) {
    errors.push("missing signature or public key");
  } else {
    try {
      const key = createPublicKey(manifest.publicKeyPem);
      const payload = canonicalizeV2(unsignedFields(manifest));
      const ok = verify(
        null,
        Buffer.from(payload),
        key,
        Buffer.from(manifest.signature, "base64"),
      );
      if (!ok) errors.push("signature invalid");
    } catch (err) {
      errors.push(`signature check failed: ${(err as Error).message}`);
    }
  }

  if (expectations?.sourceCommit && expectations.sourceCommit !== manifest.sourceCommit) {
    errors.push("sourceCommit mismatch");
  }
  if (expectations?.packageHash && expectations.packageHash !== manifest.packageHash) {
    errors.push("packageHash mismatch (tamper)");
  }
  if (expectations?.lockfileHash && expectations.lockfileHash !== manifest.lockfileHash) {
    errors.push("lockfileHash stale/mismatch");
  }
  if (expectations?.testCorpusHash && expectations.testCorpusHash !== manifest.testCorpusHash) {
    errors.push("testCorpusHash mismatch");
  }
  if (
    expectations?.supportedRuntime &&
    expectations.supportedRuntime !== manifest.supportedRuntime
  ) {
    errors.push("unsupported runtime");
  }
  if (expectations?.minNodeMajor !== undefined) {
    const m = /node\s*>=?\s*(\d+)/i.exec(manifest.supportedRuntime);
    const major = m ? Number(m[1]) : NaN;
    if (!Number.isFinite(major) || major < expectations.minNodeMajor) {
      errors.push("unsupported runtime major");
    }
  }

  // Domain-separated digest available for external anchoring.
  void digest({
    version: 2,
    domain: DIGEST_DOMAINS.evidence,
    value: { kind: RELEASE_SIGNING_DOMAIN, body: unsignedFields(manifest) },
  });

  return { ok: errors.length === 0, errors };
}

export function writeReleaseManifest(path: string, manifest: ReleaseManifestV1): void {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(resolve(path), JSON.stringify(manifest, null, 2) + "\n");
}

export function readReleaseManifest(path: string): ReleaseManifestV1 {
  if (!existsSync(path)) throw new Error(`release manifest not found: ${path}`);
  return JSON.parse(readFileSync(path, "utf8")) as ReleaseManifestV1;
}

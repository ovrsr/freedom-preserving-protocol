import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DIGEST_DOMAINS,
  digest,
  hashEntryV1,
} from "./digest.js";

describe("hashEntryV1", () => {
  it("matches historical audit-entry digest (ignores hash field)", () => {
    const entry = {
      seq: 1,
      kind: "heartbeat",
      previousHash: "0".repeat(64),
      timestamp: "2026-01-01T00:00:00.000Z",
      data: { ok: true },
      hash: "SHOULD_BE_IGNORED",
    };
    assert.equal(
      hashEntryV1(entry),
      "9dff0cd17efa9154c37845750f5e4272adbcbd5c6c33e2beb008b8552364f46a",
    );
  });
});

describe("digest", () => {
  it("requires an explicit version", () => {
    // @ts-expect-error — version is mandatory
    assert.throws(() => digest({ value: { a: 1 } }));
  });

  it("v1 digests match hashEntryV1 for the same payload", () => {
    const value = { a: 1, b: 2 };
    assert.equal(
      digest({ version: 1, value }),
      hashEntryV1({ ...value, hash: "x" }),
    );
  });

  it("v2 digests require a domain and are domain-separated", () => {
    const value = { a: 1 };
    const claimDigest = digest({
      version: 2,
      domain: DIGEST_DOMAINS.claim,
      value,
    });
    const entryDigest = digest({
      version: 2,
      domain: DIGEST_DOMAINS.entry,
      value,
    });
    assert.notEqual(claimDigest, entryDigest);
    assert.match(claimDigest, /^[0-9a-f]{64}$/);
    assert.match(entryDigest, /^[0-9a-f]{64}$/);
  });

  it("rejects v2 digests without a domain", () => {
    assert.throws(
      () => digest({ version: 2, value: { a: 1 } } as never),
      /domain/i,
    );
  });

  it("rejects unknown versions", () => {
    assert.throws(
      () => digest({ version: 99 as never, value: { a: 1 } }),
      /version/i,
    );
  });
});

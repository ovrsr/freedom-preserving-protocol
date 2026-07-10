import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canonicalizeV1,
  canonicalizeV2,
} from "./canonical-json.js";

/** Golden vectors captured from the pre-migration v1 canonicalizer. */
const V1_VECTORS: Array<{
  name: string;
  input: unknown;
  canonical: string;
}> = [
  {
    name: "sorted-keys",
    input: { z: 1, a: 2, m: 3 },
    canonical: '{"a":2,"m":3,"z":1}',
  },
  {
    name: "nested",
    input: { b: { y: 2, x: 1 }, a: [] },
    canonical: '{"a":[],"b":{"x":1,"y":2}}',
  },
  {
    name: "array-order",
    input: { items: [3, 1, 2] },
    canonical: '{"items":[3,1,2]}',
  },
  {
    name: "primitives",
    input: { n: null, t: true, f: false, s: "hi", i: 0 },
    canonical: '{"f":false,"i":0,"n":null,"s":"hi","t":true}',
  },
  {
    name: "empty-obj",
    input: {},
    canonical: "{}",
  },
  {
    name: "empty-arr",
    input: [],
    canonical: "[]",
  },
  {
    name: "audit-entry",
    input: {
      seq: 1,
      kind: "heartbeat",
      previousHash: "0".repeat(64),
      timestamp: "2026-01-01T00:00:00.000Z",
      data: { ok: true },
    },
    canonical:
      '{"data":{"ok":true},"kind":"heartbeat","previousHash":"0000000000000000000000000000000000000000000000000000000000000000","seq":1,"timestamp":"2026-01-01T00:00:00.000Z"}',
  },
];

describe("canonicalizeV1", () => {
  for (const vector of V1_VECTORS) {
    it(`matches historical output: ${vector.name}`, () => {
      assert.equal(canonicalizeV1(vector.input), vector.canonical);
    });
  }
});

describe("canonicalizeV2 (RFC 8785-compatible)", () => {
  it("sorts object keys lexicographically", () => {
    assert.equal(canonicalizeV2({ z: 1, a: 2, m: 3 }), '{"a":2,"m":3,"z":1}');
  });

  it("preserves array order", () => {
    assert.equal(canonicalizeV2([3, 1, 2]), "[3,1,2]");
  });

  it("escapes control characters in strings", () => {
    assert.equal(canonicalizeV2({ s: "a\nb\tc" }), '{"s":"a\\nb\\tc"}');
  });

  it("serializes numbers without trailing .0", () => {
    assert.equal(canonicalizeV2({ n: 1.0 }), '{"n":1}');
  });

  it("handles unicode keys with code-point ordering", () => {
    // U+00E9 (é) sorts after ASCII 'z' by code point
    assert.equal(
      canonicalizeV2({ z: 1, "\u00e9": 2, a: 3 }),
      '{"a":3,"z":1,"\u00e9":2}',
    );
  });

  it("omits undefined object values (JSON-compatible)", () => {
    assert.equal(
      canonicalizeV2({ a: 1, b: undefined, c: 2 }),
      '{"a":1,"c":2}',
    );
  });

  it("represents undefined array elements as null", () => {
    assert.equal(canonicalizeV2([1, undefined, 3]), "[1,null,3]");
  });
});

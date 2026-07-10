import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildReplayKey,
  parseFreshnessEnvelope,
  validateFreshness,
  type FreshnessPolicy,
} from "./freshness.js";

const BASE = {
  audience: "fpp:peer:agent-b",
  challenge: "nonce-abc-123",
  issuedAt: "2026-07-10T12:00:00.000Z",
  expiresAt: "2026-07-10T12:05:00.000Z",
};

const POLICY: FreshnessPolicy = {
  maxLifetimeMs: 5 * 60 * 1000,
  allowedClockSkewMs: 30_000,
  nowMs: Date.parse("2026-07-10T12:02:00.000Z"),
};

describe("freshness contracts", () => {
  it("parses a valid freshness envelope", () => {
    const parsed = parseFreshnessEnvelope(BASE);
    assert.equal(parsed.ok, true);
  });

  it("rejects missing audience", () => {
    const { audience: _a, ...rest } = BASE;
    void _a;
    const parsed = parseFreshnessEnvelope(rest);
    assert.equal(parsed.ok, false);
  });

  it("rejects invalid issue/expiry ordering", () => {
    const parsed = parseFreshnessEnvelope({
      ...BASE,
      issuedAt: "2026-07-10T12:10:00.000Z",
      expiresAt: "2026-07-10T12:05:00.000Z",
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const result = validateFreshness(parsed.envelope, POLICY);
    assert.equal(result.valid, false);
    assert.match(result.reason, /expir/i);
  });

  it("rejects lifetimes exceeding verifier policy", () => {
    const parsed = parseFreshnessEnvelope({
      ...BASE,
      expiresAt: "2026-07-10T13:00:00.000Z",
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const result = validateFreshness(parsed.envelope, POLICY);
    assert.equal(result.valid, false);
    assert.match(result.reason, /lifetime|policy/i);
  });

  it("allows clock-skew boundaries", () => {
    const early = validateFreshness(
      {
        ...BASE,
        issuedAt: "2026-07-10T12:02:20.000Z",
        expiresAt: "2026-07-10T12:07:20.000Z",
      },
      POLICY,
    );
    assert.equal(early.valid, true);

    const tooEarly = validateFreshness(
      {
        ...BASE,
        issuedAt: "2026-07-10T12:03:00.000Z",
        expiresAt: "2026-07-10T12:08:00.000Z",
      },
      POLICY,
    );
    assert.equal(tooEarly.valid, false);
  });

  it("builds deterministic collision-resistant replay keys", () => {
    const a = buildReplayKey(BASE);
    const b = buildReplayKey(BASE);
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{64}$/);
    assert.notEqual(
      a,
      buildReplayKey({ ...BASE, challenge: "nonce-other" }),
    );
  });

  it("treats policy limits as verifier-controlled", () => {
    const parsed = parseFreshnessEnvelope(BASE);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const strict = validateFreshness(parsed.envelope, {
      ...POLICY,
      maxLifetimeMs: 60_000,
    });
    assert.equal(strict.valid, false);
  });
});

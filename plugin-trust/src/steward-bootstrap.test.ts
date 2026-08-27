import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LEGACY_TOFU_WARNING,
  assertLegacyTofuProfile,
  confirmationPhraseFromKeyRef,
  formatBootstrapReview,
  normalizeKeyRef,
  requireInteractiveFingerprintConfirmation,
} from "./steward-bootstrap.js";

describe("steward-bootstrap helpers", () => {
  const keyRef = `openpgp:${"ab".repeat(20)}`;

  it("derives a short confirmation phrase from the fingerprint suffix", () => {
    assert.equal(confirmationPhraseFromKeyRef(keyRef), "abababab");
    assert.equal(
      normalizeKeyRef(`OpenPGP:${"AB".repeat(20)}`),
      `openpgp:${"ab".repeat(20)}`,
    );
  });

  it("formats a review that includes steward, audience, policy, and fingerprint without secrets", () => {
    const text = formatBootstrapReview({
      stewardId: "fpp:steward:v1:aaaaaaaaaaaaaaaaaaaaaaaaaa",
      audience: "instance:local-1",
      expectedKeyRef: keyRef,
      policy: {
        maxStandingLifetimeMs: 86_400_000,
        maxStandingUses: 100,
        maxOneShotLifetimeMs: 3_600_000,
        allowedClockSkewMs: 300_000,
      },
    });
    assert.match(text, /fpp:steward:v1:/);
    assert.match(text, /instance:local-1/);
    assert.match(text, /standingUses=100/);
    assert.match(text, new RegExp(keyRef));
    assert.doesNotMatch(text, /PRIVATE KEY|BEGIN PGP SIGNATURE/i);
    assert.match(text, /attention control/i);
  });

  it("fails closed when non-interactive or confirmation mismatches", async () => {
    const nonTty = await requireInteractiveFingerprintConfirmation(keyRef, {
      isInteractive: () => false,
      confirm: async () => "abababab",
    });
    assert.equal(nonTty.ok, false);

    const wrong = await requireInteractiveFingerprintConfirmation(keyRef, {
      isInteractive: () => true,
      confirm: async () => "deadbeef",
      write: () => {},
    });
    assert.equal(wrong.ok, false);

    const declined = await requireInteractiveFingerprintConfirmation(keyRef, {
      isInteractive: () => true,
      confirm: async () => "decline",
      write: () => {},
    });
    assert.deepEqual(declined, {
      ok: false,
      reason: "operator declined secure bootstrap",
    });

    const ok = await requireInteractiveFingerprintConfirmation(keyRef, {
      isInteractive: () => true,
      confirm: async () => "abababab",
      write: () => {},
    });
    assert.equal(ok.ok, true);
  });

  it("requires explicit legacy-tofu profile acknowledgement", () => {
    assert.equal(assertLegacyTofuProfile(undefined).ok, false);
    assert.equal(assertLegacyTofuProfile("interactive-fingerprint").ok, false);
    assert.equal(assertLegacyTofuProfile("legacy-tofu").ok, true);
    assert.match(LEGACY_TOFU_WARNING, /insecure compatibility/i);
  });
});

/**
 * Evidence quality: coverage, source independence, recency, dispute status.
 * Confidence is not inflated by duplicate or correlated evidence counts.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assessEvidenceQuality,
  dedupeEvidence,
  type QualityEvidenceItem,
} from "./evidence-quality.js";

function item(
  partial: Partial<QualityEvidenceItem> & { id: string; sourceId: string },
): QualityEvidenceItem {
  return {
    observationType: "direct",
    independenceGroup: partial.sourceId,
    coverage: "partial",
    weight: 0.8,
    observedAtMs: 1_000_000,
    disputeStatus: "none",
    ...partial,
  };
}

describe("evidence-quality", () => {
  it("deduplicates by signed event/receipt id", () => {
    const items = [
      item({ id: "e1", sourceId: "a", weight: 0.9 }),
      item({ id: "e1", sourceId: "a", weight: 0.9 }),
      item({ id: "e2", sourceId: "b", weight: 0.7 }),
    ];
    const deduped = dedupeEvidence(items);
    assert.equal(deduped.length, 2);
  });

  it("does not inflate confidence from duplicate attestations", () => {
    const once = assessEvidenceQuality(
      [item({ id: "e1", sourceId: "a" })],
      1_000_000,
    );
    const dupes = assessEvidenceQuality(
      [
        item({ id: "e1", sourceId: "a" }),
        item({ id: "e1", sourceId: "a" }),
        item({ id: "e1", sourceId: "a" }),
      ],
      1_000_000,
    );
    assert.equal(dupes.confidence, once.confidence);
  });

  it("reduces confidence for correlated sources in the same independence group", () => {
    const independent = assessEvidenceQuality(
      [
        item({ id: "e1", sourceId: "a", independenceGroup: "g1" }),
        item({ id: "e2", sourceId: "b", independenceGroup: "g2" }),
      ],
      1_000_000,
    );
    const correlated = assessEvidenceQuality(
      [
        item({ id: "e1", sourceId: "a", independenceGroup: "g1" }),
        item({ id: "e2", sourceId: "b", independenceGroup: "g1" }),
      ],
      1_000_000,
    );
    assert.ok(independent.confidence > correlated.confidence);
    assert.ok(correlated.explanation.includes("independence"));
  });

  it("keeps unknown coverage explicit and caps propagated/self below direct", () => {
    const direct = assessEvidenceQuality(
      [item({ id: "d1", sourceId: "a", observationType: "direct", coverage: "full" })],
      1_000_000,
    );
    const propagated = assessEvidenceQuality(
      [
        item({
          id: "p1",
          sourceId: "a",
          observationType: "propagated",
          coverage: "unknown",
          weight: 0.9,
        }),
      ],
      1_000_000,
    );
    const selfAttested = assessEvidenceQuality(
      [
        item({
          id: "s1",
          sourceId: "self",
          observationType: "self",
          coverage: "unknown",
          weight: 0.9,
        }),
      ],
      1_000_000,
    );
    assert.equal(propagated.coverageLabel, "unknown");
    assert.ok(propagated.confidence < direct.confidence);
    assert.ok(selfAttested.confidence < direct.confidence);
    assert.ok(direct.explanation.length > 0);
  });
});

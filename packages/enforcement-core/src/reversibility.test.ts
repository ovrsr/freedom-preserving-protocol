import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isReversibleClassification } from "./reversibility.js";
import type { ClassificationId } from "./risk-classifier.js";

describe("isReversibleClassification", () => {
  it("treats workspace writes/deletes and benign reads as reversible", () => {
    const reversible: ClassificationId[] = [
      "fs.write.workspace",
      "fs.delete.workspace",
      "fs.read.benign",
      "http.read",
      "http.public-read",
      "internal.heartbeat",
      "internal.read",
      "gateway.inspect",
    ];
    for (const id of reversible) {
      assert.equal(isReversibleClassification(id), true, id);
    }
  });

  it("treats exec.benign as irreversible for staging (direct allow)", () => {
    assert.equal(isReversibleClassification("exec.benign"), false);
  });

  it("treats hard-floor and high-impact classes as irreversible", () => {
    const irreversible: ClassificationId[] = [
      "fs.delete.protected",
      "fs.write.protected",
      "exec.cred-exfil",
      "exec.benign",
      "gateway.restart",
      "credential.exposure",
      "pkg.install",
      "pkg.publish",
      "code.patch",
      "unknown.unclassified",
    ];
    for (const id of irreversible) {
      assert.equal(isReversibleClassification(id), false, id);
    }
  });
});

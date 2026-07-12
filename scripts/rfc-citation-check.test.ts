/**
 * Ensures RFC citation URLs/ids are listed and present in the RFC body.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CITATIONS,
  collectMissingInRfc,
  loadRfcBody,
} from "./rfc-citation-check.js";

describe("rfc-citation-check", () => {
  it("lists required arXiv and AOS-related citations", () => {
    const ids = CITATIONS.map((c) => c.id);
    assert.ok(ids.includes("arXiv:2603.11853"));
    assert.ok(ids.includes("arXiv:2603.16586"));
  });

  it("finds every citation id or URL fragment in the RFC body", () => {
    const body = loadRfcBody();
    const missing = collectMissingInRfc(body);
    assert.deepEqual(missing, [], `missing citations in RFC: ${missing.join(", ")}`);
  });
});

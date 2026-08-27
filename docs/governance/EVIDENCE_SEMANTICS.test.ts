/**
 * Structure lint for evidence semantics — positive receipt attestation vocabulary.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const SEMANTICS_PATH = join(DIR, "EVIDENCE_SEMANTICS.md");
const EXAMPLES_PATH = join(DIR, "examples", "evidence-claims.json");

describe("EVIDENCE_SEMANTICS instrumented-boundary-disposition", () => {
  it("defines the positive attestation under Event class with ceiling and non-claims", () => {
    const body = readFileSync(SEMANTICS_PATH, "utf8");
    const claimRow = body
      .split(/\r?\n/)
      .find(
        (line) =>
          line.trimStart().startsWith("|") &&
          line.includes("instrumented-boundary-disposition") &&
          /schema|signed receipt/i.test(line),
      );
    assert.ok(
      claimRow,
      "missing a single structured claim row for instrumented-boundary-disposition",
    );
    assert.match(claimRow, /\bevent\b/i);
    assert.match(claimRow, /schema/i);
    assert.match(claimRow, /signature/i);
    assert.match(claimRow, /expected/i);
    assert.match(claimRow, /independent/i);
    assert.match(claimRow, /constitution/i);
    assert.match(claimRow, /policy id/i);
    assert.match(claimRow, /policy version/i);
    assert.match(
      claimRow,
      /recorded disposition .+ authorization .+ action digest/i,
    );
    assert.match(claimRow, /proven_under_assumptions/);
    assert.match(claimRow, /downstream parameter/i);
    assert.match(claimRow, /bypass|uninstrumented/i);
    assert.match(claimRow, /completeness/i);
    assert.match(claimRow, /uncompromised runtime/i);
    assert.match(claimRow, /behavioral compliance/i);
    assert.match(claimRow, /self-presented|trusted boundary/i);
    assert.match(claimRow, /self-certified signer key\/identifier/i);
    assert.match(claimRow, /trusted key provenance|legal identity/i);
    assert.match(claimRow, /proof valid under (?:a |the )?claimed root/i);
    assert.match(claimRow, /independent.*root|root.*independent/i);
    assert.match(claimRow, /signature validity.*signer trust|signer trust.*signature validity/i);
    assert.doesNotMatch(
      body,
      /seventh claim class|new top-level claim class/i,
    );
  });

  it("includes an Event-class receipt example with required limitations", () => {
    const examples = JSON.parse(readFileSync(EXAMPLES_PATH, "utf8")) as {
      claims: Array<{
        class: string;
        attestationKind?: string;
        uncertaintyLabel?: string;
        maxConclusion?: string;
        doesNotProve?: string[];
        evidenceKinds?: string[];
        requiredEvidence?: string[];
      }>;
    };
    const receipt = examples.claims.find(
      (c) => c.attestationKind === "instrumented-boundary-disposition",
    );
    assert.ok(receipt, "missing instrumented-boundary-disposition example");
    assert.equal(receipt.class, "event");
    assert.equal(receipt.uncertaintyLabel, "proven_under_assumptions");
    assert.match(
      receipt.maxConclusion ?? "",
      /disposition .+ authorization .+ action digest/i,
    );
    assert.match(
      receipt.maxConclusion ?? "",
      /self-presented|signed receipt identifies/i,
    );
    assert.doesNotMatch(
      receipt.maxConclusion ?? "",
      /traversed the active boundary/i,
    );
    const requiredEvidence = receipt.requiredEvidence ?? [];
    for (const required of [
      "schema_valid",
      "signature_valid",
      "trusted_constitution_hash_matched",
      "trusted_policy_id_matched",
      "trusted_policy_version_matched",
    ]) {
      assert.ok(
        requiredEvidence.includes(required),
        `receipt example must list requiredEvidence: ${required}`,
      );
    }
    const missing = receipt.doesNotProve ?? [];
    for (const required of [
      "completeness",
      "downstream_parameter_equality",
      "uninstrumented_bypass",
      "behavioral_compliance",
    ]) {
      assert.ok(
        missing.includes(required),
        `receipt example must list doesNotProve: ${required}`,
      );
    }
    assert.ok(
      (receipt.evidenceKinds ?? []).includes("cryptographic") ||
        (receipt.evidenceKinds ?? []).includes("interception_boundary"),
      "receipt example should cite cryptographic or interception_boundary evidence",
    );
  });
});

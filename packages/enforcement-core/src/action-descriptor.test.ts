import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildActionDescriptor,
  extractApplyPatchTargets,
} from "./action-descriptor.js";

describe("extractApplyPatchTargets", () => {
  it("extracts add/update/delete/move headers", () => {
    const patch = [
      "*** Begin Patch",
      "*** Add File: src/new.ts",
      "+export const x = 1;",
      "*** Update File: src/old.ts",
      "@@",
      "-a",
      "+b",
      "*** Delete File: src/gone.ts",
      "*** Move to: src/renamed.ts",
      "*** End Patch",
    ].join("\n");
    const result = extractApplyPatchTargets(patch, "/ws");
    assert.equal(result.ambiguous, false);
    assert.deepEqual(result.paths, [
      "src/new.ts",
      "src/old.ts",
      "src/gone.ts",
      "src/renamed.ts",
    ]);
  });

  it("marks absolute, traversal, missing, and conflicting duplicates ambiguous", () => {
    assert.equal(
      extractApplyPatchTargets("*** Add File: /etc/passwd\n", "/ws").ambiguous,
      true,
    );
    assert.equal(
      extractApplyPatchTargets("*** Add File: ../secret.ts\n", "/ws").ambiguous,
      true,
    );
    assert.equal(extractApplyPatchTargets("", "/ws").ambiguous, true);
    assert.equal(
      extractApplyPatchTargets("not a patch body", "/ws").ambiguous,
      true,
    );
    assert.equal(
      extractApplyPatchTargets(
        "*** Add File: src/a.ts\n*** Update File: src/a.ts\n",
        "/ws",
      ).ambiguous,
      true,
    );
  });
});

describe("buildActionDescriptor", () => {
  it("normalizes bare and prefixed apply_patch and propagates classification", () => {
    const patch = "*** Add File: src/a.ts\n+hi\n";
    for (const toolName of ["apply_patch", "openclaw.apply_patch"]) {
      const desc = buildActionDescriptor(
        { toolName, params: { patch } },
        "code.patch",
        "/ws",
      );
      assert.equal(desc.toolName, "apply_patch");
      assert.equal(desc.classification, "code.patch");
      assert.deepEqual(desc.resourcePaths, ["src/a.ts"]);
      assert.equal(desc.targetsAmbiguous, false);
    }
  });

  it("marks missing patch text ambiguous for apply_patch", () => {
    const desc = buildActionDescriptor(
      { toolName: "apply_patch", params: {} },
      "code.patch",
      "/ws",
    );
    assert.equal(desc.targetsAmbiguous, true);
    assert.deepEqual(desc.resourcePaths, []);
  });

  it("leaves non-patch tools usable without resource paths", () => {
    const desc = buildActionDescriptor(
      { toolName: "exec", params: { command: "ls" } },
      "exec.system-modify",
      "/ws",
    );
    assert.equal(desc.toolName, "exec");
    assert.equal(desc.targetsAmbiguous, false);
    assert.deepEqual(desc.resourcePaths, []);
  });
});

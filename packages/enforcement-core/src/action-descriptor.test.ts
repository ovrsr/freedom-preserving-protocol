import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import {
  buildActionDescriptor,
  extractApplyPatchTargets,
} from "./action-descriptor.js";

const WS = path.resolve("/tmp/fpp-ws");
const INSIDE = path.join(WS, "src", "a.ts");
const PARENT = path.resolve(WS, "..", "secret.ts");
const SIBLING = path.resolve(WS, "..", `${path.basename(WS)}evil`, "a.ts");
const EXTERNAL = path.resolve(WS, "..", "openclaw.json");

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
    const result = extractApplyPatchTargets(patch, WS);
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
      extractApplyPatchTargets("*** Add File: /etc/passwd\n", WS).ambiguous,
      true,
    );
    assert.equal(
      extractApplyPatchTargets("*** Add File: ../secret.ts\n", WS).ambiguous,
      true,
    );
    assert.equal(extractApplyPatchTargets("", WS).ambiguous, true);
    assert.equal(
      extractApplyPatchTargets("not a patch body", WS).ambiguous,
      true,
    );
    assert.equal(
      extractApplyPatchTargets(
        "*** Add File: src/a.ts\n*** Update File: src/a.ts\n",
        WS,
      ).ambiguous,
      true,
    );
  });

  it("resolves absolute paths contained in workspaceRoot", () => {
    const patch = `*** Update File: ${INSIDE}\n@@\n-a\n+b\n`;
    const result = extractApplyPatchTargets(patch, WS);
    assert.equal(result.ambiguous, false);
    assert.deepEqual(result.paths, ["src/a.ts"]);
  });

  it("rejects parent escape, sibling-prefix collision, workspace-root equality, and NUL", () => {
    assert.deepEqual(extractApplyPatchTargets(`*** Add File: ${PARENT}\n`, WS), {
      paths: [],
      ambiguous: true,
    });
    assert.deepEqual(
      extractApplyPatchTargets(`*** Add File: ${SIBLING}\n`, WS),
      { paths: [], ambiguous: true },
    );
    assert.deepEqual(extractApplyPatchTargets(`*** Add File: ${WS}\n`, WS), {
      paths: [],
      ambiguous: true,
    });
    assert.deepEqual(
      extractApplyPatchTargets("*** Add File: src/a\0.ts\n", WS),
      { paths: [], ambiguous: true },
    );
  });

  it("rejects non-native drive absolute forms fail-closed", () => {
    if (process.platform === "win32") {
      // POSIX-only absolute with no leading slash after drive is already covered;
      // a bare UNC-style foreign form without native resolve support stays ambiguous.
      assert.deepEqual(
        extractApplyPatchTargets("*** Add File: //foreign/share/a.ts\n", WS),
        { paths: [], ambiguous: true },
      );
    } else {
      assert.deepEqual(
        extractApplyPatchTargets("*** Add File: C:/Windows/system32/a.ts\n", WS),
        { paths: [], ambiguous: true },
      );
    }
  });

  it("maps exact out-of-workspace absolute targets to aliases", () => {
    const patch = `*** Update File: ${EXTERNAL}\n@@\n-a\n+b\n`;
    const mapped = extractApplyPatchTargets(patch, WS, {
      [EXTERNAL]: "harness/openclaw.json",
    });
    assert.equal(mapped.ambiguous, false);
    assert.deepEqual(mapped.paths, ["harness/openclaw.json"]);

    assert.deepEqual(extractApplyPatchTargets(patch, WS, {}), {
      paths: [],
      ambiguous: true,
    });
    assert.deepEqual(
      extractApplyPatchTargets(patch, WS, {
        [EXTERNAL]: "../escape.json",
      }),
      { paths: [], ambiguous: true },
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
        WS,
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
      WS,
    );
    assert.equal(desc.targetsAmbiguous, true);
    assert.deepEqual(desc.resourcePaths, []);
  });

  it("leaves non-patch tools usable without resource paths", () => {
    const desc = buildActionDescriptor(
      { toolName: "exec", params: { command: "ls" } },
      "exec.system-modify",
      WS,
    );
    assert.equal(desc.toolName, "exec");
    assert.equal(desc.targetsAmbiguous, false);
    assert.deepEqual(desc.resourcePaths, []);
  });

  it("reads the live params.command V4A envelope with an absolute target", () => {
    const command = [
      "*** Begin Patch",
      `*** Update File: ${INSIDE}`,
      "@@",
      "-old",
      "+new",
      "*** End Patch",
      "",
    ].join("\n");
    const desc = buildActionDescriptor(
      { toolName: "apply_patch", params: { command } },
      "code.patch",
      WS,
    );
    assert.equal(desc.targetsAmbiguous, false);
    assert.deepEqual(desc.resourcePaths, ["src/a.ts"]);
  });

  it("retains legacy flat-key compatibility", () => {
    for (const key of ["patch", "input", "diff", "content", "text"] as const) {
      const desc = buildActionDescriptor(
        {
          toolName: "apply_patch",
          params: { [key]: "*** Add File: src/legacy.ts\n+x\n" },
        },
        "code.patch",
        WS,
      );
      assert.deepEqual(desc.resourcePaths, ["src/legacy.ts"]);
      assert.equal(desc.targetsAmbiguous, false);
    }
  });

  it("extracts structured params.changes and prefers them over flat text", () => {
    const desc = buildActionDescriptor(
      {
        toolName: "apply_patch",
        params: {
          changes: [
            { path: "src/one.ts", kind: "update", diff: "@@\n-a\n+b\n" },
            { path: "src/two.ts", kind: "add", diff: "+x\n" },
          ],
          command: "*** Add File: src/ignored.ts\n+nope\n",
        },
      },
      "code.patch",
      WS,
    );
    assert.equal(desc.targetsAmbiguous, false);
    assert.deepEqual(desc.resourcePaths, ["src/one.ts", "src/two.ts"]);
  });

  it("fails closed on empty, malformed, duplicate, and mixed structured changes", () => {
    const cases: unknown[] = [
      [],
      [{ kind: "update", diff: "@@\n" }],
      [
        { path: "src/a.ts", kind: "add", diff: "+x\n" },
        { path: "src/a.ts", kind: "update", diff: "@@\n" },
      ],
      [
        { path: "src/ok.ts", kind: "add", diff: "+x\n" },
        { path: "../escape.ts", kind: "add", diff: "+x\n" },
      ],
    ];
    for (const changes of cases) {
      const desc = buildActionDescriptor(
        { toolName: "apply_patch", params: { changes } },
        "code.patch",
        WS,
      );
      assert.equal(desc.targetsAmbiguous, true);
      assert.deepEqual(desc.resourcePaths, []);
    }
  });

  it("maps an external absolute command target through outOfWorkspacePaths", () => {
    const command = [
      "*** Begin Patch",
      `*** Update File: ${EXTERNAL}`,
      "@@",
      "-old",
      "+new",
      "*** End Patch",
      "",
    ].join("\n");
    const desc = buildActionDescriptor(
      { toolName: "apply_patch", params: { command } },
      "code.patch",
      WS,
      {
        outOfWorkspacePaths: {
          [EXTERNAL]: "harness/openclaw.json",
        },
      },
    );
    assert.equal(desc.targetsAmbiguous, false);
    assert.deepEqual(desc.resourcePaths, ["harness/openclaw.json"]);
  });
});

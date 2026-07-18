import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  matchesAuthorizationScope,
  type ActionDescriptor,
} from "./scope.js";

describe("matchesAuthorizationScope", () => {
  const baseAction: ActionDescriptor = {
    classification: "code.patch",
    toolName: "apply_patch",
    resourcePaths: ["src/a.ts"],
    targetsAmbiguous: false,
  };

  it("matches exact classification", () => {
    const result = matchesAuthorizationScope(
      { classifications: ["code.patch"] },
      baseAction,
    );
    assert.equal(result.matched, true);
  });

  it("requires conjunctive tool and path restrictions when present", () => {
    assert.equal(
      matchesAuthorizationScope(
        {
          classifications: ["code.patch"],
          toolNames: ["apply_patch"],
          resourcePaths: ["src/a.ts"],
        },
        baseAction,
      ).matched,
      true,
    );
    assert.equal(
      matchesAuthorizationScope(
        {
          classifications: ["code.patch"],
          toolNames: ["other_tool"],
        },
        baseAction,
      ).matched,
      false,
    );
    assert.equal(
      matchesAuthorizationScope(
        {
          classifications: ["code.patch"],
          resourcePaths: ["src/b.ts"],
        },
        baseAction,
      ).matched,
      false,
    );
  });

  it("requires all targets contained and rejects ambiguous/absolute/traversal", () => {
    assert.equal(
      matchesAuthorizationScope(
        {
          classifications: ["code.patch"],
          resourcePaths: ["src/a.ts", "src/b.ts"],
        },
        {
          ...baseAction,
          resourcePaths: ["src/a.ts", "src/b.ts"],
        },
      ).matched,
      true,
    );
    assert.equal(
      matchesAuthorizationScope(
        {
          classifications: ["code.patch"],
          resourcePaths: ["src/a.ts"],
        },
        { ...baseAction, targetsAmbiguous: true },
      ).reason,
      "target-ambiguous",
    );
    assert.equal(
      matchesAuthorizationScope(
        {
          classifications: ["code.patch"],
          resourcePaths: ["src/a.ts"],
        },
        { ...baseAction, resourcePaths: ["../etc/passwd"] },
      ).matched,
      false,
    );
  });
});

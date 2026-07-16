import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveWorkspaceRoot,
  workspaceFile,
  absolutizeWorkspacePath,
  DEFAULT_WORKSPACE_PROFILE,
} from "./workspace-profile.js";

describe("workspace profile resolution", () => {
  it("defaults to openclaw profile → absolute <homedir>/.openclaw/workspace", () => {
    assert.equal(DEFAULT_WORKSPACE_PROFILE, "openclaw");
    assert.equal(
      resolveWorkspaceRoot({
        profile: "openclaw",
        env: {},
        homedir: () => "/home/agent",
      }),
      "/home/agent/.openclaw/workspace",
    );
    assert.equal(
      resolveWorkspaceRoot({
        env: {},
        homedir: () => "/home/agent",
      }),
      "/home/agent/.openclaw/workspace",
    );
    // Relative .openclaw/workspace must no longer be returned when env is empty
    assert.notEqual(
      resolveWorkspaceRoot({
        profile: "openclaw",
        env: {},
        homedir: () => "/home/agent",
      }),
      ".openclaw/workspace",
    );
  });

  it("generic profile uses ~/.fpp when FPP_WORKSPACE is unset", () => {
    assert.equal(
      resolveWorkspaceRoot({
        profile: "generic",
        env: {},
        homedir: () => "/home/agent",
      }),
      "/home/agent/.fpp",
    );
  });

  it("FPP_WORKSPACE overrides any profile", () => {
    assert.equal(
      resolveWorkspaceRoot({
        profile: "openclaw",
        env: { FPP_WORKSPACE: "/var/fpp" },
      }),
      "/var/fpp",
    );
    assert.equal(
      resolveWorkspaceRoot({
        profile: "generic",
        env: { FPP_WORKSPACE: "C:/data/fpp" },
        homedir: () => "/unused",
      }),
      "C:/data/fpp",
    );
  });

  it("workspaceFile joins root and filename with forward slashes", () => {
    assert.equal(
      workspaceFile("fpp-plugin-audit.jsonl", {
        profile: "openclaw",
        env: {},
        homedir: () => "/home/agent",
      }),
      "/home/agent/.openclaw/workspace/fpp-plugin-audit.jsonl",
    );
    assert.equal(
      workspaceFile("fpp-receipts.jsonl", {
        profile: "generic",
        env: {},
        homedir: () => "/home/x",
      }),
      "/home/x/.fpp/fpp-receipts.jsonl",
    );
  });

  it("cursor / claude-code / codex profiles resolve under ~/.fpp/<profile>", () => {
    for (const profile of ["cursor", "claude-code", "codex"] as const) {
      assert.equal(
        resolveWorkspaceRoot({
          profile,
          env: {},
          homedir: () => "/home/agent",
        }),
        `/home/agent/.fpp/${profile}`,
      );
    }
  });

  it("absolutizeWorkspacePath maps relative .openclaw/workspace paths under home", () => {
    assert.equal(
      absolutizeWorkspacePath(".openclaw/workspace/fpp-trust-graph.json", {
        env: {},
        homedir: () => "/home/agent",
      }),
      "/home/agent/.openclaw/workspace/fpp-trust-graph.json",
    );
  });

  it("absolutizeWorkspacePath with FPP_WORKSPACE ignores CWD-relative layout", () => {
    assert.equal(
      absolutizeWorkspacePath(".openclaw/workspace/fpp-trust-graph.json", {
        env: { FPP_WORKSPACE: "/var/ws" },
        homedir: () => "/home/agent",
      }),
      "/var/ws/fpp-trust-graph.json",
    );
  });

  it("absolutizeWorkspacePath leaves already-absolute paths unchanged", () => {
    assert.equal(
      absolutizeWorkspacePath("/abs/fpp-trust-graph.json", {
        env: { FPP_WORKSPACE: "/var/ws" },
        homedir: () => "/home/agent",
      }),
      "/abs/fpp-trust-graph.json",
    );
  });
});

/**
 * absolutizeWorkspacePath — legacy relative OpenClaw paths must not resolve
 * against skill CWD; absolute inputs stay absolute.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  absolutizeWorkspacePath,
  resolveWorkspaceRoot,
  workspaceFile,
} from "./skill-lib/workspace.ts";

describe("absolutizeWorkspacePath", () => {
  it("absolutizes relative .openclaw/workspace/... under injectable homedir", () => {
    assert.equal(
      absolutizeWorkspacePath(".openclaw/workspace/constitution-audit.jsonl", {
        env: {},
        homedir: () => "/home/agent",
      }),
      "/home/agent/.openclaw/workspace/constitution-audit.jsonl",
    );
  });

  it("maps legacy .openclaw/workspace/... under FPP_WORKSPACE root", () => {
    assert.equal(
      absolutizeWorkspacePath(".openclaw/workspace/constitution-audit.jsonl", {
        env: { FPP_WORKSPACE: "/var/fpp" },
        homedir: () => "/unused",
      }),
      "/var/fpp/constitution-audit.jsonl",
    );
  });

  it("leaves absolute paths unchanged (normalized)", () => {
    assert.equal(
      absolutizeWorkspacePath("/abs/constitution-audit.jsonl", {
        env: {},
        homedir: () => "/home/agent",
      }),
      "/abs/constitution-audit.jsonl",
    );
  });

  it("uses detected openclawWorkspace when FPP_WORKSPACE unset", () => {
    assert.equal(
      absolutizeWorkspacePath(".openclaw/workspace/x.jsonl", {
        env: {},
        homedir: () => "/home/agent",
        openclawWorkspace: "/custom/oc/workspace",
      }),
      "/custom/oc/workspace/x.jsonl",
    );
  });
});

describe("skill-lib workspace profile sync", () => {
  it("openclaw root matches absolute protocol-core layout", () => {
    assert.equal(
      resolveWorkspaceRoot({
        profile: "openclaw",
        env: {},
        homedir: () => "/home/agent",
      }),
      "/home/agent/.openclaw/workspace",
    );
    assert.equal(
      workspaceFile("constitution-audit.jsonl", {
        profile: "openclaw",
        env: {},
        homedir: () => "/home/agent",
      }),
      "/home/agent/.openclaw/workspace/constitution-audit.jsonl",
    );
  });
});

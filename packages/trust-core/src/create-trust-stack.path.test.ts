/**
 * Relative trust path configs must absolutize (not resolve against gateway CWD).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeTrustConfig } from "./create-trust-stack.js";

describe("mergeTrustConfig path absolutization", () => {
  it("absolutizes relative .openclaw/workspace trustGraphPath", () => {
    const prev = process.env.FPP_WORKSPACE;
    delete process.env.FPP_WORKSPACE;
    try {
      const cfg = mergeTrustConfig({
        trustGraphPath: ".openclaw/workspace/fpp-trust-graph.json",
        replayCachePath: ".openclaw/workspace/fpp-replay-cache.json",
        strictModeStatePath: ".openclaw/workspace/fpp-strict-sessions.json",
        quorumStatePath: ".openclaw/workspace/fpp-quorum-sessions.json",
      });
      assert.match(
        cfg.trustGraphPath.replace(/\\/g, "/"),
        /\/\.openclaw\/workspace\/fpp-trust-graph\.json$/,
      );
      assert.ok(
        !cfg.trustGraphPath.startsWith(".openclaw"),
        `expected absolute path, got ${cfg.trustGraphPath}`,
      );
      assert.match(
        cfg.replayCachePath.replace(/\\/g, "/"),
        /\/\.openclaw\/workspace\/fpp-replay-cache\.json$/,
      );
      assert.match(
        cfg.strictModeStatePath.replace(/\\/g, "/"),
        /\/\.openclaw\/workspace\/fpp-strict-sessions\.json$/,
      );
      assert.match(
        cfg.quorumStatePath.replace(/\\/g, "/"),
        /\/\.openclaw\/workspace\/fpp-quorum-sessions\.json$/,
      );
    } finally {
      if (prev === undefined) delete process.env.FPP_WORKSPACE;
      else process.env.FPP_WORKSPACE = prev;
    }
  });

  it("FPP_WORKSPACE remaps relative openclaw prefix; CWD does not change result", () => {
    const prev = process.env.FPP_WORKSPACE;
    const prevCwd = process.cwd();
    process.env.FPP_WORKSPACE = "/tmp/fpp-ws-absolute";
    try {
      const a = mergeTrustConfig({
        trustGraphPath: ".openclaw/workspace/fpp-trust-graph.json",
      });
      process.chdir(prevCwd === "/" ? process.env.HOME || prevCwd : prevCwd);
      const b = mergeTrustConfig({
        trustGraphPath: ".openclaw/workspace/fpp-trust-graph.json",
      });
      assert.equal(
        a.trustGraphPath.replace(/\\/g, "/"),
        "/tmp/fpp-ws-absolute/fpp-trust-graph.json",
      );
      assert.equal(a.trustGraphPath, b.trustGraphPath);
    } finally {
      process.chdir(prevCwd);
      if (prev === undefined) delete process.env.FPP_WORKSPACE;
      else process.env.FPP_WORKSPACE = prev;
    }
  });
});

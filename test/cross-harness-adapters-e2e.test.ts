/**
 * Cross-harness adapter e2e — fake buses, no Cursor/Claude/Codex binaries.
 * Asserts unattended abstain and mandate allow behave identically across adapters.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import {
  MandateStore,
  type EnforcementRuntime,
} from "@ovrsr/fpp-enforcement-core";
import {
  canonicalizeV2,
  mandateSigningFields,
  signMessage,
  type StandingMandateV1,
} from "@ovrsr/fpp-protocol-core";
import { createCursorRuntime, handleCursorPreToolUse } from "../adapters/cursor/src/adapter.ts";
import {
  createClaudeCodeRuntime,
  handleClaudeCodePreToolUse,
} from "../adapters/claude-code/src/adapter.ts";
import { createCodexRuntime, handleCodexPreToolUse } from "../adapters/codex/src/adapter.ts";

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

function signMandate(
  mandate: Omit<StandingMandateV1, "signature" | "publicKey">,
  seed: Uint8Array,
): StandingMandateV1 {
  const publicKey = Buffer.from(ed.getPublicKey(seed)).toString("hex");
  const withKey = { ...mandate, publicKey } as StandingMandateV1;
  const message = Buffer.from(
    canonicalizeV2(mandateSigningFields(withKey)),
    "utf8",
  );
  const signature = Buffer.from(signMessage(message, seed)).toString("hex");
  return { ...withKey, signature };
}

type HarnessBus = {
  id: string;
  create: (config: unknown, workspaceRoot: string) => EnforcementRuntime;
  decide: (
    runtime: EnforcementRuntime,
    event: {
      tool_name: string;
      tool_input?: Record<string, unknown>;
      tool_call_id: string;
    },
  ) => Promise<"allow" | "deny">;
};

const BUSES: HarnessBus[] = [
  {
    id: "cursor",
    create: (config, workspaceRoot) =>
      createCursorRuntime(config, { workspaceRoot }),
    decide: async (runtime, event) => {
      const d = await handleCursorPreToolUse(runtime, event);
      return d.permissionDecision === "allow" ? "allow" : "deny";
    },
  },
  {
    id: "claude-code",
    create: (config, workspaceRoot) =>
      createClaudeCodeRuntime(config, { workspaceRoot }),
    decide: async (runtime, event) => {
      const d = await handleClaudeCodePreToolUse(runtime, event);
      return d.hookSpecificOutput.permissionDecision === "allow"
        ? "allow"
        : "deny";
    },
  },
  {
    id: "codex",
    create: (config, workspaceRoot) =>
      createCodexRuntime(config, { workspaceRoot }),
    decide: async (runtime, event) => {
      const d = await handleCodexPreToolUse(runtime, event);
      return d.permissionDecision === "allow" ? "allow" : "deny";
    },
  },
];

describe("cross-harness adapters e2e (fake buses)", () => {
  const root = mkdtempSync(join(tmpdir(), "fpp-xharness-"));
  after(() => rmSync(root, { recursive: true, force: true }));

  function baseConfig(ws: string, extra: Record<string, unknown> = {}) {
    return {
      auditLogPath: join(ws, "audit.jsonl"),
      receiptLogPath: join(ws, "receipts.jsonl"),
      identityKeyPath: join(ws, "agent.key"),
      mandateStorePath: join(ws, "mandates.json"),
      strictModeStatePath: join(ws, "strict.json"),
      dispositionMode: "unattended" as const,
      ...extra,
    };
  }

  it("unattended abstain denies the same hard-floor call on every adapter", async () => {
    const decisions: Record<string, string> = {};
    for (const bus of BUSES) {
      const ws = join(root, `abstain-${bus.id}`);
      const runtime = bus.create(baseConfig(ws), ws);
      decisions[bus.id] = await bus.decide(runtime, {
        tool_name: "Bash",
        tool_input: { command: "rm -rf ~/.ssh/id_ed25519" },
        tool_call_id: `${bus.id}-abstain`,
      });
    }
    assert.deepEqual(decisions, {
      cursor: "deny",
      "claude-code": "deny",
      codex: "deny",
    });
  });

  it("mandate allow behaves identically across adapters and debits once each", async () => {
    const seed = ed.utils.randomPrivateKey();
    const remainingAfter: Record<string, number | null> = {};

    for (const bus of BUSES) {
      const ws = join(root, `mandate-${bus.id}`);
      const mandatePath = join(ws, "mandates.json");
      const store = new MandateStore(mandatePath);
      store.put(
        signMandate(
          {
            schemaVersion: 1,
            mandateId: `m-${bus.id}`,
            issuerClass: "operator",
            issuerId: "operator:e2e",
            scope: { classifications: ["pkg.install"] },
            budgets: { maxActions: 2, remainingActions: 2 },
            validFrom: "2026-01-01T00:00:00.000Z",
            validTo: "2099-01-01T00:00:00.000Z",
            revocable: true,
            evidenceRef: "evidence:e2e",
          },
          seed,
        ),
      );

      const runtime = bus.create(
        baseConfig(ws, { mandateStorePath: mandatePath }),
        ws,
      );
      const decision = await bus.decide(runtime, {
        tool_name: "Bash",
        tool_input: { command: "npm install left-pad" },
        tool_call_id: `${bus.id}-mandate`,
      });
      assert.equal(decision, "allow", `${bus.id} should allow under mandate`);
      remainingAfter[bus.id] = new MandateStore(mandatePath).getRemaining(
        `m-${bus.id}`,
      );
    }

    assert.deepEqual(remainingAfter, {
      cursor: 1,
      "claude-code": 1,
      codex: 1,
    });
  });
});

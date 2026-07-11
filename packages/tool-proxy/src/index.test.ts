/**
 * Shared tool-proxy — deny/abstain must prevent downstream invoke; allow forwards;
 * mandate debit still applied on allow.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import {
  createEnforcementRuntime,
  MandateStore,
} from "@ovrsr/fpp-enforcement-core";
import {
  canonicalizeV2,
  signMessage,
  type StandingMandateV1,
} from "@ovrsr/fpp-protocol-core";
import { createToolProxy, ToolProxyDeniedError } from "./index.js";

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

function signMandate(
  mandate: Omit<StandingMandateV1, "signature" | "publicKey">,
  seed: Uint8Array,
): StandingMandateV1 {
  const publicKey = Buffer.from(ed.getPublicKey(seed)).toString("hex");
  const unsigned = { ...mandate, publicKey };
  const message = Buffer.from(canonicalizeV2(unsigned), "utf8");
  const signature = Buffer.from(signMessage(message, seed)).toString("hex");
  return { ...unsigned, signature };
}

describe("createToolProxy", () => {
  const wsPath = mkdtempSync(join(tmpdir(), "fpp-proxy-"));
  after(() => rmSync(wsPath, { recursive: true, force: true }));

  function runtime(extra: Record<string, unknown> = {}) {
    const adapter = {
      harnessId: "proxy-test",
      getWorkspacePaths: () => ({ workspaceRoot: wsPath }),
    };
    return createEnforcementRuntime(
      {
        auditLogPath: join(wsPath, "audit.jsonl"),
        receiptLogPath: join(wsPath, "receipts.jsonl"),
        identityKeyPath: join(wsPath, "agent.key"),
        mandateStorePath: join(wsPath, "mandates.json"),
        strictModeStatePath: join(wsPath, "strict.json"),
        dispositionMode: "unattended",
        ...extra,
      },
      adapter,
    );
  }

  it("deny/abstain prevents downstream tool invoke", async () => {
    let invoked = 0;
    const proxy = createToolProxy(runtime(), async () => {
      invoked += 1;
      return { ok: true };
    });
    await assert.rejects(
      () =>
        proxy.call(
          "Shell",
          { command: "rm -rf ~/.ssh/id_ed25519" },
          { toolCallId: "p1" },
        ),
      ToolProxyDeniedError,
    );
    assert.equal(invoked, 0);
  });

  it("allow forwards to downstream invoke", async () => {
    let invoked = 0;
    const proxy = createToolProxy(runtime(), async (toolName, params) => {
      invoked += 1;
      return { toolName, params };
    });
    const result = await proxy.call(
      "Shell",
      { command: "echo hello" },
      { toolCallId: "p2" },
    );
    assert.equal(invoked, 1);
    assert.deepEqual(result, {
      toolName: "Shell",
      params: { command: "echo hello" },
    });
  });

  it("mandate allow still debits the mandate store", async () => {
    const mandatePath = join(wsPath, "mandates-debit.json");
    const seed = ed.utils.randomPrivateKey();
    const store = new MandateStore(mandatePath);
    const mandate = signMandate(
      {
        schemaVersion: 1,
        mandateId: "m-proxy-debit",
        issuerClass: "operator",
        issuerId: "operator:test",
        scope: { classifications: ["pkg.install"] },
        budgets: { maxActions: 3, remainingActions: 3 },
        validFrom: "2026-01-01T00:00:00.000Z",
        validTo: "2099-01-01T00:00:00.000Z",
        revocable: true,
        evidenceRef: "evidence:proxy",
      },
      seed,
    );
    store.put(mandate);

    const proxy = createToolProxy(
      runtime({ mandateStorePath: mandatePath }),
      async () => ({ installed: true }),
    );
    await proxy.call(
      "Shell",
      { command: "npm install left-pad" },
      { toolCallId: "p3" },
    );

    const remaining = new MandateStore(mandatePath).getRemaining("m-proxy-debit");
    assert.equal(remaining, 2);
  });
});

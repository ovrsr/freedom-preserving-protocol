/**
 * Cross-package interoperability vectors for @ovrsr/fpp-protocol-core
 * and the harness-agnostic enforcement/trust cores.
 *
 * Produces digests/proofs/claims via core APIs and verifies them the same way
 * plugins and root scripts consume them. Also proves enforcement-core and
 * trust-core compose without an OpenClaw peer.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalizeV1,
  computeMerkleRoot,
  createMerkleProof,
  digest,
  hashEntryV1,
  parseClaim,
  verifyMerkleProof,
  DIGEST_DOMAINS,
} from "@ovrsr/fpp-protocol-core";
import {
  PACKAGE_NAME as ENFORCEMENT_PACKAGE_NAME,
  classifyToolCall,
  resolveDisposition,
  DEFAULT_CONFIG,
} from "@ovrsr/fpp-enforcement-core";
import {
  PACKAGE_NAME as TRUST_PACKAGE_NAME,
  createTrustStack,
} from "@ovrsr/fpp-trust-core";
import {
  mintStewardIdV1,
  parseStewardIdV1,
  isStewardIdV1,
} from "@ovrsr/fpp-protocol-core";
import { PACKAGE_NAME as STEWARD_PACKAGE_NAME } from "@ovrsr/fpp-steward-auth-core";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("protocol-core interoperability", () => {
  it("v1 audit entry digests match across hashEntryV1 and digest({version:1})", () => {
    const entry = {
      previousHash: "0".repeat(64),
      timestamp: "2026-07-10T00:00:00.000Z",
      kind: "heartbeat",
      constitutionHash: "71bf60ad917c5413cc17b0f65e83c7a29218e24a2740725a819058ed9c6b1993",
      notes: "interop",
      hash: "ignored",
    };
    const a = hashEntryV1(entry);
    const b = digest({ version: 1, value: entry });
    assert.equal(a, b);
    assert.equal(a.length, 64);
  });

  it("merkle proofs created by core verify with the same root scripts use", () => {
    const leaves = [
      hashEntryV1({ seq: 1, kind: "a", previousHash: "0".repeat(64) }),
      hashEntryV1({ seq: 2, kind: "b", previousHash: "1".repeat(64) }),
      hashEntryV1({ seq: 3, kind: "c", previousHash: "2".repeat(64) }),
    ];
    const root = computeMerkleRoot(leaves);
    const proof = createMerkleProof(leaves, 1);
    assert.ok(proof);
    assert.equal(proof.root, root);
    assert.equal(verifyMerkleProof(proof), true);
  });

  it("legacy v1 claims remain parseable as declaration-only", () => {
    const raw = {
      agentId: "fpp-abcdef0123456789",
      constitutionHash: "a".repeat(64),
      adoptedAt: "2026-01-01T00:00:00.000Z",
      auditMerkleRoot: "b".repeat(64),
      auditEntryCount: 1,
      chainIntact: true,
      recentLaws: [],
    };
    const result = parseClaim(raw);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.kind, "legacy-v1");
    assert.equal(result.assurance, "declaration-only");
  });

  it("v2 digests are domain-separated from v1 canonical strings", () => {
    const value = { hello: "world" };
    const v1 = digest({ version: 1, value });
    const v2 = digest({ version: 2, domain: DIGEST_DOMAINS.claim, value });
    assert.notEqual(v1, v2);
    assert.equal(canonicalizeV1(value), '{"hello":"world"}');
  });
});

describe("enforcement-core + trust-core interoperability", () => {
  it("cores declare package names and pin protocol-core without openclaw", () => {
    assert.equal(ENFORCEMENT_PACKAGE_NAME, "@ovrsr/fpp-enforcement-core");
    assert.equal(TRUST_PACKAGE_NAME, "@ovrsr/fpp-trust-core");
    assert.equal(STEWARD_PACKAGE_NAME, "@ovrsr/fpp-steward-auth-core");
    for (const rel of [
      "packages/enforcement-core/package.json",
      "packages/trust-core/package.json",
      "packages/steward-auth-core/package.json",
    ]) {
      const pkg = JSON.parse(
        readFileSync(join(REPO_ROOT, rel), "utf8"),
      ) as {
        dependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      };
      assert.equal(pkg.dependencies?.["@ovrsr/fpp-protocol-core"], "1.0.2");
      assert.equal(pkg.dependencies?.openclaw, undefined);
      assert.equal(pkg.peerDependencies?.openclaw, undefined);
    }
  });

  it("classify + resolveDisposition compose with DEFAULT_CONFIG", () => {
    const classification = classifyToolCall("filesystem_delete", {
      path: "/home/user/.ssh/id_ed25519",
    });
    assert.equal(classification.classification, "fs.delete.protected");
    const disposition = resolveDisposition({
      classification,
      config: DEFAULT_CONFIG,
    });
    assert.equal(disposition.disposition, "deny");
    assert.equal(disposition.authorization, "policy-block");
  });

  it("createTrustStack boots from trust-core using temp workspace paths", () => {
    const dir = mkdtempSync(join(tmpdir(), "fpp-interop-trust-"));
    try {
      const stack = createTrustStack({
        identityKeyPath: join(dir, "identity.key"),
        trustGraphPath: join(dir, "trust-graph.json"),
        auditLogPath: join(dir, "audit.jsonl"),
        fallbackAuditLogPath: null,
        receiptLogPath: join(dir, "receipts.jsonl"),
        strictModeStatePath: join(dir, "strict.json"),
        replayCachePath: join(dir, "replay.json"),
        mandateStorePath: join(dir, "mandates.json"),
        quorumStatePath: join(dir, "quorum.json"),
      });
      assert.ok(stack.identity.agentId);
      assert.ok(stack.trustGraph);
      assert.ok(stack.handshake);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("steward identity contracts remain consumable independently of OpenClaw", () => {
    assert.equal(STEWARD_PACKAGE_NAME, "@ovrsr/fpp-steward-auth-core");
    const id = mintStewardIdV1();
    assert.equal(isStewardIdV1(id), true);
    assert.equal(parseStewardIdV1(id).ok, true);
  });
});

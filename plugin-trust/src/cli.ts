/**
 * CLI surface for the FPP trust plugin.
 *
 * Registers `openclaw fpp-trust` with subcommands:
 *   list     — print the trust graph (nodes + edges)
 *   seed     — manually add a trusted seed agent
 *   export   — print this agent's attestation (signed claim + Merkle root)
 *   verify   — verify a peer claim file
 *   strict   — inspect / clear strict-mode sessions
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseClaim } from "@ovrsr/fpp-protocol-core";
import type { AgentIdentity } from "./identity.js";
import { signClaim, verifyClaim, type SignedClaim } from "./claims.js";
import type { ConstitutionalClaim } from "./handshake.js";
import { TrustGraphProtocol, TrustLevel } from "./trust-graph.js";
import type { MerkleBridge } from "./merkle-bridge.js";
import type { StrictModeManager } from "./strict-mode.js";

export interface CliDependencies {
  identity: AgentIdentity;
  trustGraph: TrustGraphProtocol;
  merkleBridge: MerkleBridge;
  strictMode: StrictModeManager;
  constitutionHash: string;
}

interface CliCommand {
  command(name: string): CliCommand;
  description(desc: string): CliCommand;
  argument(arg: string, desc: string): CliCommand;
  option(flags: string, desc: string): CliCommand;
  action(fn: (...args: unknown[]) => void | Promise<void>): CliCommand;
}

export function registerFppTrustCli(
  program: CliCommand,
  deps: CliDependencies,
): void {
  const { identity, trustGraph, merkleBridge, strictMode, constitutionHash } =
    deps;

  const fppTrust = program
    .command("fpp-trust")
    .description(
      "FPP Trust & Handshake — inspect graph, manage seeds, export attestations",
    );

  // --- list ---
  fppTrust
    .command("list")
    .description("Print the trust graph (nodes and edges)")
    .action(() => {
      const data = trustGraph.exportData();
      const stats = trustGraph.getStats();

      console.log(
        `\nFPP Trust Graph — ${stats.nodeCount} nodes, ${stats.edgeCount} edges`,
      );
      console.log(
        `Density: ${(stats.density * 100).toFixed(1)}%  Largest Component: ${stats.largestComponent}\n`,
      );

      if (data.nodes.length === 0) {
        console.log("  (empty graph — no agents registered yet)\n");
        return;
      }

      console.log("Agents:");
      for (const node of data.nodes) {
        const isLocal = node.id === identity.agentId ? " (local)" : "";
        console.log(
          `  ${node.id}${isLocal}  trust=${node.trustScore.toFixed(2)}  ` +
            `rep=${node.reputation.overall.toFixed(2)}  ` +
            `fidelity=${node.reputation.constitutionalFidelity.toFixed(2)}  ` +
            `interactions=${node.interactionCount}`,
        );
      }

      if (data.relationships.length > 0) {
        console.log("\nRelationships:");
        for (const rel of data.relationships) {
          const trustNames = ["UNK", "LOW", "MED", "HIGH", "MAX"];
          console.log(
            `  ${rel.agentA} <-> ${rel.agentB}  ` +
              `AB=${trustNames[rel.trustAB]} BA=${trustNames[rel.trustBA]}  ` +
              `conf=${rel.confidence.toFixed(2)}  evidence=${rel.evidence.length}`,
          );
        }
      }
      console.log();
    });

  // --- seed ---
  fppTrust
    .command("seed")
    .description("Manually add a trusted seed agent to the graph")
    .argument("<agentId>", "Agent identifier to seed")
    .argument("<publicKeyHex>", "Agent's Ed25519 public key (hex)")
    .argument(
      "<trustLevel>",
      "Trust level: LOW (1), MEDIUM (2), HIGH (3), MAXIMUM (4)",
    )
    .action((...args: unknown[]) => {
      const [agentId, publicKeyHex, trustLevelStr] = args as [
        string,
        string,
        string,
      ];
      const levelMap: Record<string, TrustLevel> = {
        LOW: TrustLevel.LOW,
        "1": TrustLevel.LOW,
        MEDIUM: TrustLevel.MEDIUM,
        "2": TrustLevel.MEDIUM,
        HIGH: TrustLevel.HIGH,
        "3": TrustLevel.HIGH,
        MAXIMUM: TrustLevel.MAXIMUM,
        "4": TrustLevel.MAXIMUM,
      };
      const level = levelMap[trustLevelStr.toUpperCase()];
      if (level === undefined) {
        console.error(
          `Invalid trust level: ${trustLevelStr}. Use LOW, MEDIUM, HIGH, or MAXIMUM.`,
        );
        process.exitCode = 2;
        return;
      }

      trustGraph.addAgent(agentId, constitutionHash);
      trustGraph.updateAgentPublicKey(agentId, publicKeyHex);
      trustGraph.addAgent(identity.agentId, constitutionHash);
      trustGraph.establishTrust(
        identity.agentId,
        agentId,
        level,
        level,
        [
          {
            type: "peer_attestation",
            data: { manual: true, seedCommand: true },
            weight: 0.9,
            timestamp: Date.now(),
            source: "cli-seed",
          },
        ],
      );

      const trustNames = ["UNKNOWN", "LOW", "MEDIUM", "HIGH", "MAXIMUM"];
      console.log(
        `Seeded ${agentId} at ${trustNames[level]} trust.\n` +
          `Public key: ${publicKeyHex}\n`,
      );
    });

  // --- export ---
  fppTrust
    .command("export")
    .description(
      "Print this agent's signed constitutional claim and Merkle root",
    )
    .action(() => {
      const { root, entryCount } = merkleBridge.getCurrentRoot();
      const claim: ConstitutionalClaim = {
        agentId: identity.agentId,
        constitutionHash,
        adoptedAt: new Date().toISOString(),
        auditMerkleRoot: root,
        auditEntryCount: entryCount,
        chainIntact: entryCount > 0,
        recentLaws: [],
      };
      const signed = signClaim(claim, identity);
      console.log(JSON.stringify(signed, null, 2));
    });

  // --- verify ---
  fppTrust
    .command("verify")
    .description(
      "Verify a peer's signed claim JSON file (no trust-graph side effects)",
    )
    .argument("<claimPath>", "Path to the JSON claim file")
    .action((...args: unknown[]) => {
      const claimPath = args[0] as string;
      let raw: string;
      try {
        raw = readFileSync(resolve(claimPath), "utf-8");
      } catch (err) {
        console.error(`Cannot read ${claimPath}: ${(err as Error).message}`);
        process.exitCode = 2;
        return;
      }

      let claim: SignedClaim;
      try {
        const parsed: unknown = JSON.parse(raw);
        const claimParse = parseClaim(parsed);
        if (!claimParse.ok) {
          console.error(`Invalid claim: ${claimParse.error}`);
          for (const d of claimParse.diagnostics) console.error(`  - ${d}`);
          process.exitCode = 2;
          return;
        }
        if (claimParse.assurance === "declaration-only") {
          console.error(
            "Note: legacy v1 claim accepted as declaration-only (not escalated to v2).",
          );
        }
        claim = parsed as SignedClaim;
      } catch {
        console.error("File does not contain valid JSON.");
        process.exitCode = 2;
        return;
      }

      const result = verifyClaim(claim);
      const hashMatch = claim.constitutionHash === constitutionHash;

      console.log(`Agent ID:         ${claim.agentId}`);
      console.log(`Public Key:       ${claim.publicKey ?? "(unsigned)"}`);
      console.log(
        `Constitution:     ${claim.constitutionHash}  ${hashMatch ? "MATCH" : "MISMATCH"}`,
      );
      console.log(
        `Signature:        ${result.valid ? "VALID" : "INVALID"} — ${result.reason}`,
      );
      console.log(`Audit Root:       ${claim.auditMerkleRoot}`);
      console.log(`Audit Entries:    ${claim.auditEntryCount}`);
      console.log(`Chain Intact:     ${claim.chainIntact}`);
      process.exitCode = result.valid && hashMatch ? 0 : 1;
    });

  // --- strict ---
  const strictCmd = fppTrust
    .command("strict")
    .description("Inspect or clear strict-mode sessions");

  strictCmd
    .command("list")
    .description("List active strict-mode sessions")
    .action(() => {
      const sessions = strictMode.getStrictSessions();
      const keys = Object.keys(sessions);
      if (keys.length === 0) {
        console.log("No active strict-mode sessions.\n");
        return;
      }
      console.log(`${keys.length} strict-mode session(s):\n`);
      for (const [key, entry] of Object.entries(sessions)) {
        console.log(`  ${key}`);
        console.log(`    reason:   ${entry.reason}`);
        console.log(`    added:    ${entry.addedAt}`);
        console.log(`    expires:  ${entry.expiresAt}`);
        console.log(`    approval: ${entry.addedApprovalOn.join(", ")}`);
      }
      console.log();
    });

  strictCmd
    .command("clear")
    .description("Clear a specific strict-mode session or all")
    .argument(
      "<sessionKey>",
      'Session key to clear, or "all" to clear everything',
    )
    .action((...args: unknown[]) => {
      const key = args[0] as string;
      if (key === "all") {
        strictMode.clearAll();
        console.log("All strict-mode sessions cleared.\n");
      } else {
        const removed = strictMode.exitStrict(key);
        if (removed) {
          console.log(`Strict mode cleared for session ${key}.\n`);
        } else {
          console.log(`No strict-mode session found for ${key}.\n`);
        }
      }
    });
}

export const FPP_TRUST_CLI_DESCRIPTORS = [
  {
    name: "fpp-trust",
    description:
      "FPP Trust & Handshake — inspect graph, manage seeds, export attestations, strict-mode",
    hasSubcommands: true,
  },
];

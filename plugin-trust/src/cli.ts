/**
 * CLI surface for the FPP trust plugin.
 *
 * Registers `openclaw fpp-trust` with subcommands:
 *   list      — print the trust graph (nodes + edges)
 *   seed      — manually add a trusted seed agent
 *   challenge — issue a one-time freshness challenge
 *   export    — print this agent's attestation (optionally challenge-bound)
 *   verify    — verify a peer claim file (signature + optional freshness)
 *   strict    — inspect / clear strict-mode sessions
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseClaim,
  publicKeyMatchesAgentId,
  deriveLegacyAlias,
  parseFreshnessEnvelope,
  validateFreshness,
  buildReplayKey,
  type FreshnessEnvelope,
} from "@ovrsr/fpp-protocol-core";
import type { AgentIdentity } from "./identity.js";
import { signClaim, verifyClaim, type SignedClaim } from "./claims.js";
import type { ConstitutionalClaim } from "./handshake.js";
import type { ConstitutionalHandshake } from "./handshake.js";
import { TrustGraphProtocol, TrustLevel } from "./trust-graph.js";
import { ScopedTrustStore } from "./trust-scope.js";
import type { MerkleBridge } from "./merkle-bridge.js";
import type { StrictModeManager } from "./strict-mode.js";
import type { ReplayCache } from "./replay-cache.js";
import type { QuorumSessionManager } from "./quorum-session.js";

export interface CliDependencies {
  identity: AgentIdentity;
  trustGraph: TrustGraphProtocol;
  merkleBridge: MerkleBridge;
  strictMode: StrictModeManager;
  constitutionHash: string;
  handshake?: ConstitutionalHandshake | undefined;
  replayCache?: ReplayCache | undefined;
  requireFreshness?: boolean | undefined;
  quorum?: QuorumSessionManager | undefined;
}

interface CliCommand {
  command(name: string): CliCommand;
  description(desc: string): CliCommand;
  argument(arg: string, desc: string): CliCommand;
  option(flags: string, desc: string, defaultValue?: string): CliCommand;
  requiredOption(flags: string, desc: string): CliCommand;
  action(fn: (...args: unknown[]) => void | Promise<void>): CliCommand;
}

export function registerFppTrustCli(
  program: CliCommand,
  deps: CliDependencies,
): void {
  const {
    identity,
    trustGraph,
    merkleBridge,
    strictMode,
    constitutionHash,
    handshake,
    replayCache,
    requireFreshness = false,
  } = deps;

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
      const scoped = trustGraph.getScopedStore().list();
      if (scoped.length > 0) {
        console.log("\nScoped assessments (directed):");
        for (const a of scoped) {
          const names = ["UNK", "LOW", "MED", "HIGH", "MAX"];
          console.log(
            `  ${a.from} → ${a.to}  ${names[a.level]}  ` +
              `scope=${ScopedTrustStore.formatScope(a.scope)}  ` +
              `source=${a.source}`,
          );
        }
      }
      console.log();
    });

  // --- steward-override (replaces unaudited seed) ---
  fppTrust
    .command("steward-override")
    .description(
      "Authorized, scoped, expiring steward override (operator assertion — not observed trust)",
    )
    .argument("<agentId>", "Agent identifier")
    .argument("<publicKeyHex>", "Agent's Ed25519 public key (hex)")
    .argument(
      "<trustLevel>",
      "Trust level: LOW (1), MEDIUM (2), HIGH (3). MAXIMUM is not allowed for overrides.",
    )
    .requiredOption("--reason <reason>", "Audit reason for the override")
    .requiredOption(
      "--capability <capability>",
      "Capability scope (e.g. handshake, file.read)",
    )
    .requiredOption(
      "--expires <iso>",
      "Expiry timestamp (ISO-8601); overrides must expire",
    )
    .option("--environment <env>", "Environment scope", "*")
    .action((...args: unknown[]) => {
      const [agentId, publicKeyHex, trustLevelStr, opts] = args as [
        string,
        string,
        string,
        {
          reason: string;
          capability: string;
          expires: string;
          environment?: string;
        },
      ];
      const levelMap: Record<string, TrustLevel> = {
        LOW: TrustLevel.LOW,
        "1": TrustLevel.LOW,
        MEDIUM: TrustLevel.MEDIUM,
        "2": TrustLevel.MEDIUM,
        HIGH: TrustLevel.HIGH,
        "3": TrustLevel.HIGH,
      };
      const level = levelMap[trustLevelStr.toUpperCase()];
      if (level === undefined) {
        console.error(
          `Invalid or uncapped trust level: ${trustLevelStr}. Overrides allow LOW, MEDIUM, or HIGH only.`,
        );
        process.exitCode = 2;
        return;
      }
      if (!opts.reason?.trim()) {
        console.error("Missing --reason");
        process.exitCode = 2;
        return;
      }
      const expiresMs = Date.parse(opts.expires);
      if (!Number.isFinite(expiresMs) || expiresMs <= Date.now()) {
        console.error("--expires must be a future ISO-8601 timestamp");
        process.exitCode = 2;
        return;
      }

      trustGraph.addAgent(agentId, constitutionHash);
      if (!publicKeyMatchesAgentId(agentId, publicKeyHex)) {
        console.error(
          `agentId does not match publicKey fingerprint. Expected key-bound v2 id.`,
        );
        process.exitCode = 2;
        return;
      }
      if (!trustGraph.updateAgentPublicKey(agentId, publicKeyHex)) {
        console.error(
          `Refused to replace existing public key for ${agentId} without rotation proof.`,
        );
        process.exitCode = 2;
        return;
      }
      trustGraph.addLegacyAlias(agentId, deriveLegacyAlias(publicKeyHex));
      trustGraph.addAgent(identity.agentId, constitutionHash);

      const now = Date.now();
      const scope = {
        capability: opts.capability,
        resource: "*",
        audience: "*",
        environment: opts.environment ?? "*",
      };
      trustGraph.recordScopedAssessment({
        from: identity.agentId,
        to: agentId,
        scope,
        level,
        confidence: 0.5,
        validFrom: now,
        validUntil: expiresMs,
        source: "steward-override",
        rationale: `operator assertion: ${opts.reason}`,
      });
      trustGraph.establishTrust(
        identity.agentId,
        agentId,
        level,
        TrustLevel.LOW,
        [
          {
            type: "peer_attestation",
            data: {
              stewardOverride: true,
              reason: opts.reason,
              actorId: identity.agentId,
              expires: opts.expires,
              capability: opts.capability,
            },
            weight: 0.5,
            timestamp: now,
            source: "cli-steward-override",
          },
        ],
        scope,
      );

      const trustNames = ["UNKNOWN", "LOW", "MEDIUM", "HIGH", "MAXIMUM"];
      console.log(
        `Steward override recorded for ${agentId} at ${trustNames[level]} (capped).\n` +
          `Source: steward-override (operator assertion — NOT observed trust)\n` +
          `Scope: capability=${scope.capability} env=${scope.environment}\n` +
          `Expires: ${opts.expires}\n` +
          `Reason: ${opts.reason}\n` +
          `Actor: ${identity.agentId}\n`,
      );
    });

  fppTrust
    .command("override-revoke")
    .description("Revoke a steward override for an agent/capability before expiry")
    .argument("<agentId>", "Target agent id")
    .requiredOption("--capability <capability>", "Capability scope to revoke")
    .requiredOption("--reason <reason>", "Audit reason")
    .action((...args: unknown[]) => {
      const [agentId, opts] = args as [
        string,
        { capability: string; reason: string },
      ];
      const now = Date.now();
      trustGraph.recordScopedAssessment({
        from: identity.agentId,
        to: agentId,
        scope: {
          capability: opts.capability,
          resource: "*",
          audience: "*",
          environment: "*",
        },
        level: TrustLevel.UNKNOWN,
        confidence: 0,
        validFrom: now,
        validUntil: now,
        source: "steward-override",
        rationale: `revoked: ${opts.reason}`,
      });
      console.log(
        `Override revoked for ${agentId} capability=${opts.capability}: ${opts.reason}`,
      );
    });

  fppTrust
    .command("override-review")
    .description("List steward-override assessments still on the graph")
    .action(() => {
      const overrides = trustGraph
        .getScopedStore()
        .list()
        .filter((a) => a.source === "steward-override");
      if (overrides.length === 0) {
        console.log("No steward overrides on record.");
        return;
      }
      for (const a of overrides) {
        console.log(
          `${a.from} → ${a.to} level=${a.level} ` +
            `cap=${a.scope.capability} until=${new Date(a.validUntil).toISOString()} ` +
            `rationale=${a.rationale ?? ""}`,
        );
      }
    });

  // deprecated alias
  fppTrust
    .command("seed")
    .description(
      "[deprecated] Use steward-override — unaudited permanent HIGH seed is removed",
    )
    .argument("<agentId>", "Agent identifier")
    .argument("<publicKeyHex>", "unused")
    .argument("<trustLevel>", "unused")
    .action(() => {
      console.error(
        "fpp-trust seed is removed. Use: openclaw fpp-trust steward-override " +
          "<agentId> <publicKeyHex> <LOW|MEDIUM|HIGH> --reason ... --capability ... --expires <ISO>",
      );
      process.exitCode = 2;
    });

  // --- challenge ---
  fppTrust
    .command("challenge")
    .description("Issue a one-time freshness challenge for a peer to answer")
    .action(() => {
      if (!handshake) {
        console.error("Challenge issuance unavailable (handshake not wired).");
        process.exitCode = 2;
        return;
      }
      const challenge = handshake.issueChallenge(identity.agentId);
      console.log(JSON.stringify(challenge, null, 2));
    });

  // --- export ---
  fppTrust
    .command("export")
    .description(
      "Print this agent's signed constitutional claim and Merkle root",
    )
    .option(
      "--challenge <path>",
      "Path to a peer challenge JSON to bind into the signed claim",
    )
    .action((...args: unknown[]) => {
      const opts = (args[0] ?? {}) as { challenge?: string };
      let freshness: FreshnessEnvelope | undefined;
      if (opts.challenge) {
        try {
          const raw = readFileSync(resolve(opts.challenge), "utf-8");
          const parsed = parseFreshnessEnvelope(JSON.parse(raw) as unknown);
          if (!parsed.ok) {
            console.error(`Invalid challenge: ${parsed.error}`);
            process.exitCode = 2;
            return;
          }
          freshness = parsed.envelope;
        } catch (err) {
          console.error(
            `Cannot read challenge ${opts.challenge}: ${(err as Error).message}`,
          );
          process.exitCode = 2;
          return;
        }
      }

      const { root, entryCount } = merkleBridge.getCurrentRoot();
      const claim: ConstitutionalClaim = {
        agentId: identity.agentId,
        constitutionHash,
        adoptedAt: new Date().toISOString(),
        auditMerkleRoot: root,
        auditEntryCount: entryCount,
        chainIntact: entryCount > 0,
        recentLaws: [],
        ...(freshness !== undefined ? { freshness } : {}),
      };
      const signed = signClaim(claim, identity);
      console.log(JSON.stringify(signed, null, 2));
    });

  // --- verify ---
  fppTrust
    .command("verify")
    .description(
      "Verify a peer's signed claim JSON file (signature + optional freshness/replay)",
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
      console.log(`Chain Intact:     ${claim.chainIntact} (self-asserted)`);

      let freshnessOk = true;
      const freshness = (claim as ConstitutionalClaim).freshness;
      if (requireFreshness || freshness) {
        if (!freshness) {
          console.log("Freshness:        MISSING (required)");
          freshnessOk = false;
        } else {
          const validation = validateFreshness(freshness, {
            maxLifetimeMs: 600_000,
            allowedClockSkewMs: 120_000,
            nowMs: Date.now(),
          });
          const audienceOk = freshness.audience === identity.agentId;
          let replayOk = true;
          if (validation.valid && audienceOk && replayCache) {
            const key = buildReplayKey(freshness);
            replayOk = replayCache.consume(
              key,
              Date.parse(freshness.expiresAt),
            );
          }
          freshnessOk = validation.valid && audienceOk && replayOk;
          console.log(
            `Freshness:        ${freshnessOk ? "VALID" : "INVALID"} — ` +
              (!audienceOk
                ? "audience mismatch"
                : !replayOk
                  ? "replay detected"
                  : validation.reason),
          );
        }
      }

      const identityVerified = result.valid;
      const configurationClaimVerified = hashMatch;
      const standing =
        identityVerified && configurationClaimVerified
          ? "identity-configuration"
          : "none";
      // Deprecated compatibility field — derived from standing only.
      const fppVerified = standing === "identity-configuration" && freshnessOk;

      console.log(
        `Standing:         ${standing} (identity/configuration; not behavioral compliance)`,
      );
      console.log(
        `Evidence level:   ${[
          identityVerified ? "identity" : null,
          configurationClaimVerified ? "configuration" : null,
          freshnessOk && freshness ? "freshness" : null,
        ]
          .filter(Boolean)
          .join("+") || "none"}`,
      );
      console.log(
        `fppVerified:      ${fppVerified} (deprecated; use standing)`,
      );

      process.exitCode =
        result.valid && hashMatch && freshnessOk ? 0 : 1;
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

  // --- quorum-status / quorum-revoke-mandate (Plan 9) ---
  // Distinct from steward-override: quorum mints StandingMandateV1;
  // steward-override only records scoped trust assessments.
  fppTrust
    .command("quorum-status")
    .description(
      "List open/finalized/expired quorum sessions (local policy — not ratification)",
    )
    .action(() => {
      if (!deps.quorum) {
        console.log("Quorum session manager not configured.\n");
        return;
      }
      const sessions = deps.quorum.listSessions();
      if (sessions.length === 0) {
        console.log("No quorum sessions on record.\n");
        return;
      }
      for (const s of sessions) {
        const ayes = s.ballots.filter((b) => b.vote === "aye").length;
        console.log(
          `${s.proposal.proposalId}\t${s.status}\t${s.proposal.quorumClass}\t` +
            `ayes=${ayes}\tmandate=${s.mandateId ?? "-"}\t` +
            `expires=${s.proposal.expiresAt}`,
        );
      }
      console.log("");
    });

  fppTrust
    .command("quorum-revoke-mandate")
    .description(
      "Revoke a quorum-issued StandingMandateV1 (does not mint peer-signed mandates)",
    )
    .argument("<mandateId>", "Mandate id (e.g. quorum:prop-001)")
    .requiredOption("--reason <text>", "Audit reason for revocation")
    .action((mandateIdArg: unknown, optsUnknown: unknown) => {
      const mandateId = String(mandateIdArg);
      const opts = optsUnknown as { reason: string };
      if (!deps.quorum) {
        console.error("Quorum session manager not configured.");
        return;
      }
      const result = deps.quorum.revokeMandate(mandateId, opts.reason);
      if (!result.ok) {
        console.error(`Revoke failed: ${result.error}`);
        return;
      }
      console.log(
        `Revoked quorum mandate ${result.mandateId}: ${result.reason}\n` +
          `Note: steward-override remains a separate audited trust path and ` +
          `does not mint peer-signed mandates.`,
      );
    });
}

export const FPP_TRUST_CLI_DESCRIPTORS = [
  {
    name: "fpp-trust",
    description:
      "FPP Trust & Handshake — inspect graph, manage seeds, export attestations, quorum, strict-mode",
    hasSubcommands: true,
  },
];

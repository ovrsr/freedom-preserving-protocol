/**
 * File-backed standing mandate store with budget debit and standing-allowlist
 * materialization. Signed mandates are verified; standing-allowlist coverage
 * is explicitly unsigned and never claims peer/quorum authorization.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import {
  canonicalizeV2,
  parseStandingMandate,
  validateMandateValidity,
  verifySignature,
  type AuthorizationClass,
  type MandateIssuerClass,
  type StandingMandateV1,
} from "@ovrsr/fpp-protocol-core";
import type { ClassificationId } from "./risk-classifier.js";
import type { LiveMandateCoverage } from "./disposition-engine.js";

export type MandateStoreFile = {
  schemaVersion: 1;
  mandates: StandingMandateV1[];
};

export type MandateStoreOptions = {
  standingAllowOn?: ClassificationId[] | undefined;
  mandateDefaultMaxActions?: number | undefined;
  basePath?: string | undefined;
};

export type FindCoverageOptions = {
  nowMs: number;
};

function authorizationForIssuer(
  issuerClass: MandateIssuerClass,
): AuthorizationClass {
  switch (issuerClass) {
    case "standing-allowlist":
      return "standing-allowlist";
    case "peer-quorum":
    case "steward-quorum":
      return "quorum-mandate";
    case "operator":
    default:
      return "mandate";
  }
}

function verifyMandateSignature(mandate: StandingMandateV1): void {
  if (mandate.issuerClass === "standing-allowlist") {
    return;
  }
  if (!mandate.publicKey || !mandate.signature) {
    throw new Error("signed mandate requires publicKey and signature");
  }
  const { signature: _s, ...unsigned } = mandate;
  void _s;
  const message = Buffer.from(canonicalizeV2(unsigned), "utf8");
  const sigBytes = Buffer.from(mandate.signature, "hex");
  const pubBytes = Buffer.from(mandate.publicKey, "hex");
  if (sigBytes.length !== 64 || pubBytes.length !== 32) {
    throw new Error("invalid mandate signature encoding");
  }
  if (!verifySignature(message, sigBytes, pubBytes)) {
    throw new Error("mandate signature verification failed");
  }
}

function hasBudget(mandate: StandingMandateV1): boolean {
  const remaining = mandate.budgets.remainingActions;
  if (remaining === undefined) return true;
  return remaining > 0;
}

export class MandateStore {
  readonly path: string;
  private mandates: StandingMandateV1[] = [];
  private readonly standingAllowOn: ClassificationId[];
  private readonly mandateDefaultMaxActions: number;

  constructor(storePath: string, options: MandateStoreOptions = {}) {
    this.path = resolve(options.basePath ?? process.cwd(), storePath);
    this.standingAllowOn = options.standingAllowOn ?? [];
    this.mandateDefaultMaxActions = options.mandateDefaultMaxActions ?? 10;
    this.reload();
  }

  reload(): void {
    if (!existsSync(this.path)) {
      this.mandates = [];
      return;
    }
    const raw = JSON.parse(readFileSync(this.path, "utf8")) as MandateStoreFile;
    if (raw.schemaVersion !== 1 || !Array.isArray(raw.mandates)) {
      throw new Error(`invalid mandate store at ${this.path}`);
    }
    this.mandates = raw.mandates;
  }

  private persist(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const file: MandateStoreFile = {
      schemaVersion: 1,
      mandates: this.mandates,
    };
    writeFileSync(this.path, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  }

  /** Insert or replace a mandate after schema + signature checks. */
  put(mandate: StandingMandateV1): void {
    const parsed = parseStandingMandate(mandate);
    if (!parsed.ok) {
      throw new Error(`invalid mandate: ${parsed.error}`);
    }
    verifyMandateSignature(parsed.mandate);
    const idx = this.mandates.findIndex(
      (m) => m.mandateId === parsed.mandate.mandateId,
    );
    if (idx >= 0) {
      this.mandates[idx] = parsed.mandate;
    } else {
      this.mandates.push(parsed.mandate);
    }
    this.persist();
  }

  getRemaining(mandateId: string): number | null {
    const m = this.mandates.find((x) => x.mandateId === mandateId);
    if (!m) return null;
    return m.budgets.remainingActions ?? null;
  }

  /**
   * Atomically debit one action from a mandate's remaining budget.
   * Returns false if missing, expired-window not checked here — caller
   * should have found coverage first — or if remaining is already 0.
   */
  debit(mandateId: string): boolean {
    this.reload();
    const idx = this.mandates.findIndex((m) => m.mandateId === mandateId);
    if (idx < 0) return false;
    const mandate = this.mandates[idx]!;
    const remaining = mandate.budgets.remainingActions;
    if (remaining !== undefined && remaining <= 0) return false;
    if (remaining !== undefined) {
      this.mandates[idx] = {
        ...mandate,
        budgets: {
          ...mandate.budgets,
          remainingActions: remaining - 1,
        },
      };
      this.persist();
    }
    return true;
  }

  findCoverage(
    classification: string,
    options: FindCoverageOptions,
  ): LiveMandateCoverage | null {
    this.reload();

    for (const mandate of this.mandates) {
      const parsed = parseStandingMandate(mandate);
      if (!parsed.ok) continue;
      try {
        verifyMandateSignature(parsed.mandate);
      } catch {
        continue;
      }
      const validity = validateMandateValidity(parsed.mandate, {
        nowMs: options.nowMs,
      });
      if (!validity.valid) continue;
      if (!hasBudget(parsed.mandate)) continue;
      const classes = parsed.mandate.scope.classifications ?? [];
      if (!classes.includes(classification)) continue;
      return {
        mandateId: parsed.mandate.mandateId,
        issuerClass: parsed.mandate.issuerClass,
        authorization: authorizationForIssuer(parsed.mandate.issuerClass),
      };
    }

    if (this.standingAllowOn.includes(classification as ClassificationId)) {
      return {
        mandateId: `standing:${classification}`,
        issuerClass: "standing-allowlist",
        authorization: "standing-allowlist",
      };
    }

    return null;
  }
}

/**
 * Per-agent Ed25519 identity for the FPP trust plugin.
 *
 * Generates a keypair on first call and persists the 32-byte seed to disk
 * (mode 0600). The public key is derived on load so only the seed is stored.
 *
 * On-disk format compatibility: the enforcement plugin's receipt signer
 * (`plugin/src/receipt-signer.ts`) reads/writes the same 32-byte seed file
 * so either plugin can create or reuse the shared agent identity key.
 *
 * `agentId` is the v2 full key fingerprint (`fpp:ed25519:<sha256>`).
 * `legacyAlias` retains the historical truncated form for migration/display.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import {
  deriveAgentIdV2,
  deriveLegacyAlias,
  verifySignature as verifySignatureCore,
} from "@ovrsr/fpp-protocol-core";

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

export interface AgentIdentity {
  /** V2 full fingerprint identifier. */
  agentId: string;
  /** Historical truncated alias — display/migration only. */
  legacyAlias: string;
  publicKeyHex: string;
  keyAlgorithm: "ed25519";
  sign: (message: Uint8Array) => Uint8Array;
}

export function loadOrCreateIdentity(
  keyPath: string,
  basePath: string = process.cwd(),
): AgentIdentity {
  const resolved = resolve(basePath, keyPath);
  let seed: Uint8Array;

  if (existsSync(resolved)) {
    const raw = readFileSync(resolved);
    if (raw.length !== 32) {
      throw new Error(
        `FPP identity key at ${resolved} is malformed (expected 32 bytes, got ${raw.length})`,
      );
    }
    seed = new Uint8Array(raw);
  } else {
    seed = ed.utils.randomPrivateKey();
    mkdirSync(dirname(resolved), { recursive: true });
    writeFileSync(resolved, Buffer.from(seed), { mode: 0o600 });
  }

  const publicKey = ed.getPublicKey(seed);
  const publicKeyHex = Buffer.from(publicKey).toString("hex");

  return {
    agentId: deriveAgentIdV2(publicKeyHex),
    legacyAlias: deriveLegacyAlias(publicKeyHex),
    publicKeyHex,
    keyAlgorithm: "ed25519",
    sign: (message: Uint8Array) => ed.sign(message, seed),
  };
}

export function verifySignature(
  message: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  return verifySignatureCore(message, signature, publicKey);
}

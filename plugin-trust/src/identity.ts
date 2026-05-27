/**
 * Per-agent Ed25519 identity for the FPP trust plugin.
 *
 * Generates a keypair on first call and persists the 32-byte seed to disk
 * (mode 0600). The public key is derived on load so only the seed is stored.
 * The agentId is a truncated SHA-256 of the public key for human readability.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";

// noble/ed25519 v2 requires setting sha512 synchronously
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

export interface AgentIdentity {
  agentId: string;
  publicKeyHex: string;
  sign: (message: Uint8Array) => Uint8Array;
}

function deriveAgentId(publicKeyHex: string): string {
  return (
    "fpp-" +
    createHash("sha256").update(publicKeyHex, "hex").digest("hex").slice(0, 16)
  );
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
  const agentId = deriveAgentId(publicKeyHex);

  return {
    agentId,
    publicKeyHex,
    sign: (message: Uint8Array) => ed.sign(message, seed),
  };
}

export function verifySignature(
  message: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  try {
    return ed.verify(signature, message, publicKey);
  } catch {
    return false;
  }
}

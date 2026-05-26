import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const constitutionPath = resolve(root, 'constitution.json');
const sigPath = resolve(root, 'signature.ed25519.txt');
const pubkeyPath = resolve(root, 'pubkey.ed25519.txt');

const constitutionBytes = readFileSync(constitutionPath);
const hash = sha256(constitutionBytes);

let privateKey: Uint8Array;

if (process.env.FPP_SIGNING_KEY) {
  privateKey = hexToBytes(process.env.FPP_SIGNING_KEY);
  console.log('Using private key from FPP_SIGNING_KEY environment variable.');
} else {
  privateKey = ed.utils.randomPrivateKey();
  console.log('Generated new Ed25519 keypair.');
  console.log(`Private key (save securely): ${bytesToHex(privateKey)}`);
}

const publicKey = ed.getPublicKey(privateKey);
const signature = ed.sign(hash, privateKey);

writeFileSync(sigPath, bytesToHex(signature));
writeFileSync(pubkeyPath, bytesToHex(publicKey));

const constitutionHash = bytesToHex(hash);
console.log(`\nConstitution SHA-256: ${constitutionHash}`);
console.log(`Public key written to: ${pubkeyPath}`);
console.log(`Signature written to:  ${sigPath}`);
console.log(`\nVerify with: npx tsx scripts/verify-constitution.ts`);

# Release Assurance

This document describes pre-release package checks for the Freedom Preserving Protocol skill and plugins. It does **not** claim signed release manifests — those arrive in Plan 6 (conformance receipts and handshake capsules).

## Canonical commands

| Command | Purpose |
|---------|---------|
| `npm run verify:all` | Constitution, fixtures, typecheck, tests, pack contents |
| `npm run assurance:packages` | Deterministic inventories + CycloneDX SBOMs (no publish) |
| `bash scripts/verify-pack.sh` | Confirms `dist/index.js` / `.d.ts` are in plugin packs |

## Package reproducibility

`scripts/package-reproducibility.ts` runs `npm pack --dry-run` (or a declared-files fallback), builds a sorted file inventory with SHA-256 checksums, and compares two inventories for added/removed/changed paths. Timestamps are not part of the inventory comparison.

```bash
npx tsx scripts/package-reproducibility.ts assurance-artifacts
```

Outputs (gitignored locally; retained as CI artifacts):

- `skill.inventory.json` / `plugin.inventory.json` / `plugin-trust.inventory.json`
- `skill.cdx.json` / `plugin.cdx.json` / `plugin-trust.cdx.json` (CycloneDX 1.5)

## SBOMs

SBOMs list the package itself plus runtime `dependencies`. Peer/optional tooling such as `openclaw` is not treated as a shipped runtime dependency of the tarball. DevDependencies are omitted from the distributable SBOM.

## Raising the bar later

Signed release manifests, attestation, and provenance binding are explicitly out of scope here. Do not read an SBOM or inventory as proof of behavioral compliance.

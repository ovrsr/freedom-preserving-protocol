# Release Assurance

This document describes pre-release package checks for the Freedom Preserving Protocol skill, shared protocol-core package, and plugins. It does **not** claim signed release manifests — those arrive in Plan 6 (conformance receipts and handshake capsules).

## Canonical commands

| Command | Purpose |
|---------|---------|
| `npm run verify:all` | Constitution, fixtures, typecheck, tests, pack contents |
| `npm run assurance:packages` | Deterministic inventories + CycloneDX SBOMs (no publish) |
| `bash scripts/verify-pack.sh` | Builds protocol-core first, confirms exact core pins, pack contents, and isolated `--ignore-scripts` installs |

## Release order

1. **Build / test / pack `@ovrsr/fpp-protocol-core`** — consumers must not pack against a missing `dist/`.
2. **Confirm exact core pins** in `plugin/package.json` and `plugin-trust/package.json` (no `^` / `~` ranges; version must equal the workspace core version).
3. **Pack / publish skill**, then **enforcement plugin**, then **trust plugin**.

`scripts/clawhub-publish.sh publish all` prints and enforces this core-before-consumers ordering.

### Rollback

- Roll back plugins only after the previous **exact** `@ovrsr/fpp-protocol-core` version is available again to installers.
- Do not publish a plugin that pins a core version that was never released (or was yanked) without first restoring that core artifact.
- Workspace development uses npm workspaces; published tarballs resolve core from the registry (or a local pack) at install time.

## Package reproducibility

`scripts/package-reproducibility.ts` runs `npm pack --dry-run` (or a declared-files fallback), builds a sorted file inventory with SHA-256 checksums, and compares two inventories for added/removed/changed paths. Timestamps are not part of the inventory comparison.

```bash
npx tsx scripts/package-reproducibility.ts assurance-artifacts
```

Outputs (gitignored locally; retained as CI artifacts):

- `skill.inventory.json` / `plugin.inventory.json` / `plugin-trust.inventory.json`
- `skill.cdx.json` / `plugin.cdx.json` / `plugin-trust.cdx.json` (CycloneDX 1.5)

## SBOMs

SBOMs list the package itself plus runtime `dependencies` (including the exact `@ovrsr/fpp-protocol-core` pin for plugins). Peer/optional tooling such as `openclaw` is not treated as a shipped runtime dependency of the tarball. DevDependencies are omitted from the distributable SBOM.

## Raising the bar later

Signed release manifests, attestation, and provenance binding are explicitly out of scope here. Do not read an SBOM or inventory as proof of behavioral compliance.

When those controls arrive, they must follow signing-domain separation in
`docs/governance/KEY_GOVERNANCE.md`: release keys are distinct from
constitution-root, agent-identity, runtime-attestation, and amendment keys;
publisher-key revocation remains distinct from adoption revocation.

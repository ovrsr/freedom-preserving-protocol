# Release Assurance

This document describes pre-release package checks for the Freedom Preserving Protocol skill, shared protocol-core package, and plugins.

## Signed release manifests (Plan 6)

Release manifests bind source commit, package hash, lockfile hash, test-corpus hash, constitution hash, dependencies, and supported runtime. They are signed in the **release** signing domain — distinct from constitution-root and agent-identity keys (`docs/governance/KEY_GOVERNANCE.md`).

```bash
npm run release:verify -- --manifest assurance-artifacts/release-manifest.json
```

Publish (`scripts/clawhub-publish.sh`) should refuse an invalid or missing signed manifest when one is required for the release channel. Offline root custody, rotation, and revocation prerequisites follow Plan 5 key governance; do not automate release signing until those controls are met.

## Canonical commands

| Command | Purpose |
|---------|---------|
| `npm run verify:all` | Constitution, fixtures, typecheck, tests, pack contents |
| `npm run assurance:packages` | Deterministic inventories + CycloneDX SBOMs (no publish) |
| `bash scripts/verify-pack.sh` | Builds cores first, confirms exact core pins, pack contents, and true isolated OpenClaw-flag installs of plugin tarballs alone (no side-loaded core tarballs; cores embedded via `bundledDependencies`) |
| `npm run release:verify` | Verify a signed release manifest |

## Release order

1. **Build / test `@ovrsr/fpp-*-core`** — consumers must not pack against a missing `dist/`.
2. **Confirm exact core pins** in plugin/adapter `package.json` (no `^` / `~`; must match workspace versions).
3. **Bundle cores into consumers** via `bundledDependencies` + `npm run bundle:deps` / `prepack` (`scripts/bundle-workspace-deps.ts`). Cores are **not** published to npm or ClawHub.
4. **Pack / publish skill**, then **enforcement plugin**, then **trust plugin** (tarballs must embed `node_modules/@ovrsr/fpp-*`).
5. **Smoke:** `bash scripts/smoke-plugin-install.sh` (OpenClaw-flag isolated install).

Order summary: **build cores → bundle into consumers → publish plugins**.

`scripts/clawhub-publish.sh` refuses to publish if the pack listing lacks bundled core paths.

### Rollback

- Roll back by republishing the previous **plugin** version (which embeds the previous exact core pins).
- Do not assume installers can fetch `@ovrsr/fpp-*-core` from npmjs.com — they cannot.
- Workspace development uses npm workspaces (hoisted); published tarballs embed cores via `bundledDependencies`. Public deps (`@noble/*`, `@sinclair/typebox`) still resolve from the registry.

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

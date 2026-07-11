# @ovrsr/fpp-protocol-core

Shared versioned schemas and cryptographic contracts for the Freedom Preserving Protocol.

Package version and protocol schema version are independent. This package (`1.0.0`) carries **schema version 2**.

## Install

```bash
npm install @ovrsr/fpp-protocol-core@1.0.0
```

Published plugins pin an **exact** core version to prevent silent protocol drift.

## Workspace profiles

Path defaults are resolved via `resolveWorkspaceRoot` / `workspaceFile`:

| Profile | Root |
|---------|------|
| `openclaw` (default) | `.openclaw/workspace` |
| `generic` | `$FPP_WORKSPACE` or `~/.fpp` |

`FPP_WORKSPACE` overrides the root for any profile when set.

This package is developed via npm workspaces from the repository root. Local consumers (`plugin/`, `plugin-trust/`) resolve the workspace package while published manifests keep the exact version pin.

```bash
npm run build -w @ovrsr/fpp-protocol-core
npm test -w @ovrsr/fpp-protocol-core
```

### Lockfile migration

Nested `plugin/package-lock.json` and `plugin-trust/package-lock.json` were removed when workspaces were introduced. The single root `package-lock.json` is the source of truth for local development. Published plugin tarballs still declare an exact `@ovrsr/fpp-protocol-core` version and resolve it from the registry (or a local pack) at install time.

## License

See [LICENSE](./LICENSE).

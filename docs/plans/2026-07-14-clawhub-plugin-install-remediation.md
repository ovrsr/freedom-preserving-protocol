# ClawHub Plugin Install Remediation (Bundled Cores)

**Status:** COMPLETE
**Created:** 2026-07-14
**Scope:**
- **In:** Bundle unpublished `@ovrsr/fpp-*-core` (and adapter-only `@ovrsr/fpp-tool-proxy`) into ClawHub plugin and harness adapter packages via npm `bundledDependencies` so OpenClaw/ClawHub installs resolve without a public npm registry for those packages; fix pack/verify gates to prove true isolated install; update release docs/runbooks.
- **Out:** Publishing any `@ovrsr/*` package to the public npm registry; changing ClawHub skill contents beyond install docs; gateway / Plan 12 work; changing seed constitution hash.

## Summary

Live ClawHub installs of `@ovrsr/openclaw-fpp-plugin` and `@ovrsr/openclaw-fpp-trust` fail because their manifests declare exact dependencies on `@ovrsr/fpp-protocol-core`, `@ovrsr/fpp-enforcement-core`, and `@ovrsr/fpp-trust-core`, which are **not** on npmjs.com. OpenClaw runs `npm install --omit=dev --omit=peer --legacy-peer-deps --ignore-scripts` at install time and cannot fetch those packages.

**Chosen remediation (no npm org access):** ship the unpublished workspace packages inside consumer tarballs using npm `bundledDependencies`, staged at pack time from local `npm pack` of workspace cores. Public deps (`@noble/*`, `@sinclair/typebox`) stay normal registry dependencies.

**Hard gate:** a packed plugin (and adapter) tarball must install alone under OpenClaw-style flags with **no** side-loaded core tarballs, and must be able to `import()` the bundled cores.

## Architecture Notes

```
packages/protocol-core          ──┐
packages/enforcement-core       ──┼── staged into plugin/node_modules at prepack
packages/trust-core             ──┘   listed in bundledDependencies

plugin/                         → ClawHub code-plugin (bundles protocol + enforcement)
plugin-trust/                   → ClawHub code-plugin (bundles protocol + trust)

packages/tool-proxy             ──┐
packages/protocol-core          ──┼── staged into adapters/*/node_modules at prepack
packages/enforcement-core       ──┘   listed in bundledDependencies
adapters/{cursor,claude-code,codex}/  (private; packable standalone)
```

**Why not ClawHub library packages?** `clawhub package publish` only accepts `code-plugin|bundle-plugin`. Cores cannot be published as ClawHub libraries for npm resolution.

**Why not esbuild single-file?** Kept `bundledDependencies` so source maps, exact package identity (`PACKAGE_NAME`), and SBOM/inventory continue to see real package boundaries; matches OpenClaw’s documented pattern for embedding runtime deps.

**Workspace vs pack:** Local monorepo development keeps npm workspaces (hoisted). Bundle staging runs only in `prepack` / explicit `bundle:deps` so day-to-day `tsc` is unchanged.

**Exact pins preserved:** plugins/adapters continue to declare exact versions (no `^`/`~`). Bundle script must refuse to stage a mismatched workspace version.

## Feature Inventory

| Current broken / incomplete path | Remediation task |
|----------------------------------|------------------|
| ClawHub plugin install cannot resolve `@ovrsr/fpp-*-core` from npm | Tasks 2–3, 8 |
| `scripts/verify-pack.sh` “isolated install” side-loads only `protocol-core` tarball (false green) | Task 4 |
| Adapters `private: true` + unpublished cores/`tool-proxy` — standalone pack unusable outside workspace | Task 5 |
| `clawhub-publish.sh` builds cores but does not embed them in plugin tarballs | Task 6 |
| Docs claim “resolve core from the registry” without a registry | Task 7 |
| No automated proof that OpenClaw-style install works from packed artifact alone | Task 4, 8 |

## Progress Tracking

- [x] Task 1: Shared workspace-deps bundle helper + tests
- [x] Task 2: Enforcement plugin `bundledDependencies` + prepack wiring
- [x] Task 3: Trust plugin `bundledDependencies` + prepack wiring
- [x] Task 4: Fix `verify-pack.sh` for true isolated installs
- [x] Task 5: Bundle cores + tool-proxy into harness adapters
- [x] Task 6: Publish script / package scripts enforce bundle-before-publish
- [x] Task 7: Docs and runbook remediation (no npm registry assumption)
- [x] Task 8: OpenClaw-style consumer smoke + version bump readiness
- [x] Task 9: Update ClawHub publishing skill / TROUBLESHOOTING recovery

**Total Tasks:** 9 | **Completed:** 9 | **Remaining:** 0

## Implementation Tasks

### Task 1: Shared workspace-deps bundle helper + tests

**Objective:** Provide a reusable script that packs exact-pin workspace packages and installs them into a consumer package’s local `node_modules` so `npm pack` embeds them via `bundledDependencies`.

**Files:**
- Create: `scripts/bundle-workspace-deps.ts`
- Create: `scripts/bundle-workspace-deps.test.ts`
- Modify: `package.json` (root script e.g. `bundle:deps`)

**Steps:**
1. Write failing tests for: (a) stages declared packages into `<consumer>/node_modules/@ovrsr/...`; (b) refuses version mismatch vs consumer `dependencies` pin; (c) refuses missing workspace package; (d) is a no-op / clear error when pins are ranges.
2. Implement minimal CLI: `tsx scripts/bundle-workspace-deps.ts --package <plugin|plugin-trust|adapters/…> [--deps name@version…]` (default: read consumer `bundledDependencies` + exact pins from its `package.json`).
3. Run the test and confirm pass.
4. Run typecheck on the new script/tests.
5. Document usage in script header comment only (full docs in Task 7).

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 2: Enforcement plugin `bundledDependencies` + prepack wiring

**Objective:** Make `@ovrsr/openclaw-fpp-plugin` pack with `@ovrsr/fpp-protocol-core` and `@ovrsr/fpp-enforcement-core` embedded so a lone tarball installs without registry cores.

**Files:**
- Modify: `plugin/package.json` (`bundledDependencies`, `scripts.prepack` / `bundle:deps`)
- Create: `plugin/src/pack-bundle.test.ts` (or `plugin/pack-bundle.test.ts` if pack tests should not ship in `files`)
- Modify: `plugin/package.json` `files` only if needed to exclude pack tests from publish

**Steps:**
1. RED: test that after `npm pack`, the tarball lists `package/node_modules/@ovrsr/fpp-protocol-core/` and `.../fpp-enforcement-core/`, and a temp `npm install --omit=dev --omit=peer --legacy-peer-deps --ignore-scripts <tgz>` succeeds **without** providing core tarballs; `import('@ovrsr/fpp-enforcement-core')` works from the install root.
2. GREEN: add `bundledDependencies`, wire `prepack` to build → `bundle-workspace-deps` → existing build/`tsc` as needed; keep exact pins; leave `@noble/*` as normal deps.
3. Run the pack/install test and confirm pass.
4. Run `npm run typecheck -w @ovrsr/openclaw-fpp-plugin` and plugin tests.
5. Confirm `npm pack --dry-run` still includes `dist/index.js`.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 3: Trust plugin `bundledDependencies` + prepack wiring

**Objective:** Same as Task 2 for `@ovrsr/openclaw-fpp-trust` bundling `protocol-core` + `trust-core`.

**Files:**
- Modify: `plugin-trust/package.json`
- Create: `plugin-trust/src/pack-bundle.test.ts` (or non-published pack test path)

**Steps:**
1. RED/GREEN analogous to Task 2; assert `@sinclair/typebox` still resolves from registry (not required in bundle).
2. Isolated install must `import('@ovrsr/fpp-trust-core')` successfully.
3. Run trust plugin typecheck + tests.
4. Confirm pack includes `dist/index.js` and both bundled cores.

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 4: Fix `verify-pack.sh` for true isolated installs

**Objective:** Replace the false-green isolated install (side-loading only `protocol-core.tgz`) with proof that each consumer tarball installs alone under OpenClaw-style npm flags.

**Files:**
- Modify: `scripts/verify-pack.sh`
- Modify: `docs/RELEASE_ASSURANCE.md` (cross-link; full wording in Task 7)

**Steps:**
1. RED expectation: current script would fail the new criterion (plugin tarball alone without `CORE_TGZ`) — capture that as the gate we fix.
2. Change isolated loop to: pack consumer → `npm install --omit=dev --omit=peer --legacy-peer-deps --ignore-scripts <consumer.tgz>` only → import the expected core package(s).
3. Keep building/packing cores for inventory/SBOM, but do **not** pass core tarballs into the plugin/adapter isolated install.
4. Optionally add adapter packs to the same isolated loop (or defer to Task 5’s script invocation).
5. Run `bash scripts/verify-pack.sh` and paste pass output.

**Definition of Done:**
- [ ] Target tests pass (`verify-pack.sh` exit 0)
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 5: Bundle cores + tool-proxy into harness adapters

**Objective:** Make `adapters/{cursor,claude-code,codex}` packable/installable outside the monorepo without resolving unpublished `@ovrsr/*` from npm (still `private: true`; distribution remains git/pack, not ClawHub).

**Files:**
- Modify: `adapters/cursor/package.json`
- Modify: `adapters/claude-code/package.json`
- Modify: `adapters/codex/package.json`
- Modify: `packages/tool-proxy/package.json` (bundle `protocol-core` + `enforcement-core` so tool-proxy itself packs cleanly when staged)
- Create: `scripts/verify-adapter-pack.sh` **or** extend `verify-pack.sh` to cover adapters
- Create: `adapters/pack-bundle.test.ts` (root-level or per-adapter — prefer one shared test driven by package list)

**Steps:**
1. RED: isolated install of each adapter tarball fails today without workspace cores — write the failing gate.
2. GREEN: declare `bundledDependencies` for `@ovrsr/fpp-protocol-core`, `@ovrsr/fpp-enforcement-core`, `@ovrsr/fpp-tool-proxy`; wire prepack/`bundle:deps`; ensure tool-proxy embeds its own cores when packed as a transitive bundled dep (or stage all three into the adapter).
3. Prove `import` of enforcement-core from isolated adapter install.
4. Typecheck/test adapters.
5. Update adapter runbooks install section in Task 7 (pointer only here).

**Definition of Done:**
- [ ] Target tests pass
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 6: Publish script / package scripts enforce bundle-before-publish

**Objective:** `scripts/clawhub-publish.sh` and root npm publish scripts must fail if the plugin tarball would ship without bundled cores.

**Files:**
- Modify: `scripts/clawhub-publish.sh`
- Modify: `package.json` (scripts if needed)
- Modify: `scripts/clawhub-publish.sh` dry-run messaging for release order

**Steps:**
1. After existing core build/pin checks, run consumer `npm pack --dry-run` (or unpack list) and assert bundled core paths appear for plugin and trust targets.
2. Ensure `prepack` path is exercised on Windows tarball workaround (`needs_tarball_publish` / `npm pack`) so ClawHub upload includes `node_modules/@ovrsr/...`.
3. Update release-order comments: build cores → **bundle into consumers** → skill → plugins (cores still not ClawHub-published).
4. Dry-run: `bash scripts/clawhub-publish.sh publish plugin --dry-run --changelog "bundle cores"` should print bundle verification success.

**Definition of Done:**
- [ ] Target checks pass (dry-run / pack list assertions)
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 7: Docs and runbook remediation (no npm registry assumption)

**Objective:** Align documentation with bundled distribution; remove “resolve core from the registry” as the primary install story.

**Files:**
- Modify: `docs/RELEASE_ASSURANCE.md`
- Modify: `docs/COMPATIBILITY.md`
- Modify: `docs/TROUBLESHOOTING.md`
- Modify: `docs/runbooks/dev-build-and-deploy.md` (if committed; else note local-only)
- Modify: `docs/runbooks/cursor.md`, `docs/runbooks/claude-code.md`, `docs/runbooks/codex.md`
- Modify: `README.md` (install caveats only if needed)
- Modify: `.claude/skills/learned-clawhub-publishing/SKILL.md`

**Steps:**
1. Document: cores are **not** on npm; ClawHub plugins embed exact cores via `bundledDependencies`; public deps still come from npm.
2. Document adapter path: clone/workspace **or** `npm pack` after `bundle:deps` / prepack; standalone install uses packed tarball.
3. Add troubleshooting entry matching the live failure (“missing `@ovrsr/fpp-*-core`”) → fix = upgrade to bundled plugin version / rebuild from this plan.
4. Update release order and rollback notes for bundled artifacts (rollback = republish previous plugin version that embeds previous core pins).
5. No production code in this task.

**Definition of Done:**
- [ ] Docs accurately describe bundled install
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Dependent docs updated (if applicable)

### Task 8: OpenClaw-style consumer smoke + version bump readiness

**Objective:** Add a maintainer smoke that simulates OpenClaw’s managed install from a local pack, and bump plugin versions so a ClawHub republish can replace broken artifacts.

**Files:**
- Create: `scripts/smoke-plugin-install.sh` (or `.ts`)
- Modify: `plugin/package.json` version (patch+)
- Modify: `plugin-trust/package.json` version (patch+)
- Modify: lockfiles if required by workspace convention

**Steps:**
1. Script: pack plugin → temp dir → `npm install --omit=dev --omit=peer --legacy-peer-deps --ignore-scripts <tgz>` → load `dist/index.js` / import cores → exit non-zero on failure.
2. Wire into `verify:all` **or** document as required pre-publish gate in publish script (prefer invoke from `clawhub-publish.sh` preflight).
3. Bump enforcement + trust plugin patch versions (current published: plugin `1.1.5`, trust `1.2.3` — next must not collide).
4. Do **not** run live `clawhub package publish` in `/implement` unless explicitly requested; leave publish as post-plan maintainer step.
5. Record expected post-publish smoke: `openclaw plugins install clawhub:ovrsr/openclaw-fpp-plugin` (and trust) without building cores from GitHub.

**Definition of Done:**
- [ ] Smoke script exit 0 on packed artifacts
- [ ] No new type errors
- [ ] No new linter errors
- [ ] Versions bumped and documented for republish

### Task 9: Update ClawHub publishing skill / TROUBLESHOOTING recovery

**Objective:** Capture the new pack/bundle prerequisites in the learned publishing skill and operator recovery steps so future publishes cannot regress to unbundled manifests.

**Files:**
- Modify: `.claude/skills/learned-clawhub-publishing/SKILL.md`
- Modify: `docs/TROUBLESHOOTING.md` (if anything left from Task 7)
- Modify: `PRAXISCODE_LEARNINGS.md` only if Praxiscode auto-manages — do **not** hand-edit if marked auto-managed; instead put durable notes in the skill + TROUBLESHOOTING

**Steps:**
1. Add checklist: run `bundle:deps` / prepack proof; `verify-pack` isolated install without core tarballs; smoke script; then publish.
2. Explicitly state: never publish plugins that list `@ovrsr/fpp-*-core` in `dependencies` unless those names are also in `bundledDependencies` and present in the tarball.
3. Recovery for existing broken installs: uninstall → install new ClawHub version (or local `npm-pack:` of rebuilt tarball).
4. No behavioral production code.

**Definition of Done:**
- [ ] Publishing skill checklist updated
- [ ] Recovery path documented
- [ ] No new type errors
- [ ] No new linter errors

## Testing Strategy

| Layer | What | Command / proof |
|-------|------|-----------------|
| Unit | Bundle helper pin matching, staging, refusal cases | `npx tsx --test scripts/bundle-workspace-deps.test.ts` |
| Pack contract | Tarball contains `node_modules/@ovrsr/fpp-…` | plugin/trust pack-bundle tests + `npm pack --dry-run` |
| Isolated install | OpenClaw-flag `npm install` of consumer tarball alone | `bash scripts/verify-pack.sh` (rewritten) |
| Adapter pack | Same for three adapters | verify-pack extension or `verify-adapter-pack.sh` |
| Pre-publish smoke | Pack → install → import | `scripts/smoke-plugin-install.sh` |
| Regression | Existing workspace tests still green | `npm test`, `npm run typecheck`, `npm run verify:all` |
| Live (post-publish, maintainer) | ClawHub install without GitHub core builds | `openclaw plugins install clawhub:ovrsr/openclaw-fpp-plugin` |

TDD applies to Tasks 1–5 and the smoke gate in Task 8. Tasks 6–7 and 9 are scripts/docs with executable assertions where possible (no skip of pack proofs).

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Workspace hoisting leaves cores only at repo root `node_modules`, so `npm pack` omits them | Bundle helper must install packed core tarballs into **package-local** `node_modules` before pack |
| Windows `clawhub` npm spawn issues skip `prepack` | Existing publish script already `npm pack`s locally; ensure that path runs `prepack` (npm pack does) |
| Tarball size growth | Only bundle unpublished `@ovrsr/*` packages; leave `@noble/*` / typebox on registry |
| Nested core→core deps (enforcement → protocol) | Bundle **both** into enforcement plugin; verify nested import in isolated install |
| Adapters stay private — users may still clone | Document pack path; workspace clone remains valid; gate is standalone pack install |
| Republish required to fix already-broken ClawHub versions | Task 8 bumps versions; maintainer publishes after `/verify` |
| SBOM/inventory may grow with bundled paths | Accept; inventories should list embedded packages honestly |

## Maintainer follow-up (after VERIFIED)

```bash
# After /implement + /verify
npm run publish:plugin -- --changelog "Embed fpp-*-core via bundledDependencies for ClawHub install"
npm run publish:trust  -- --changelog "Embed fpp-*-core via bundledDependencies for ClawHub install"

# Consumer proof on a clean OpenClaw host
openclaw plugins install clawhub:ovrsr/openclaw-fpp-plugin
openclaw plugins install clawhub:ovrsr/openclaw-fpp-trust
```

# Autonomy and Harness-Agnostic Program Index

**Status:** INDEX (not an implementable plan)
**Created:** 2026-07-10

Sequenced follow-on to Plans 1–7. Seed constitution hash `71bf60ad…` is unchanged across this program.

| Plan | File | Focus | Depends on |
|------|------|--------|------------|
| 8 | `docs/plans/2026-07-10-8-unattended-disposition-and-mandates.md` | Disposition engine, mandates, standing allowlists, operator-present mode | 3–7 |
| 9 | `docs/plans/2026-07-10-9-peer-steward-quorum-mandates.md` | Peer/steward quorum → signed mandates | 8 |
| 10 | `docs/plans/2026-07-10-10-harness-agnostic-core-extraction.md` | enforcement-core, trust-core, adapters interface, workspace profiles | 8–9 |
| 11 | `docs/plans/2026-07-10-11-cross-harness-adapters.md` | Cursor, Claude Code, Codex adapters + tool-proxy | 10 |
| 12 | `docs/plans/2026-07-10-12-gateway-constitutional-layer-rfc.md` | Gateway RFC draft + submission package | 8–11 |
| 13 | `docs/plans/2026-07-10-13-graded-harness-adoption-claims.md` | Graded harness adoption claims; local `accepted` vs peer-advertisable disclosure | 8, 11 |

**Implement order:** `/implement` Plan 8 first after approval; do not start Plan 11 before Plan 10 cores exist. Plan 13 should follow Plan 11 probes (schema/ledger may start earlier against fixtures).

**Design choices locked (2026-07-10):**
1. Split program across several plans (not one mega-plan).
2. Unattended disposition flow: hard-floor → mandate → staged → quorum-mandate → emergency → abstain.
3. Mandates: signed artifacts + human standing allowlists; quorum mints signed mandates.
4. `requireApproval` retained only in `operator-present` mode.
5. Extract both enforcement-core and trust-core.
6. Fold mandate/disposition/quorum schemas into `@ovrsr/fpp-protocol-core`.
7. No items from the portability/autonomy list left unplanned (adapters + gateway RFC included).
8. Plan 13: keep state `accepted`; add overlays + harness grade; dual-path local vs peer-advertisable; prompt-only peer ads are `declaration-only`.

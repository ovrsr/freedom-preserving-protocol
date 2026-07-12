# AOS Phase 2 coordination note

**Status:** Coordination guidance only — not an AOS commitment and not an FPP
claim that AOS Phase 2 has shipped.

## Context

`genesalvatore/aos-openclaw-constitutional` and related AOS work explore
constitutional amendments, signing, and (planned) Phase 2 dispatcher/gateway
gating. FPP’s Five Laws are **substantively different** normative content; FPP
already ships plugin + harness-adapter enforcement and positions gateway binding
as a **voluntary** upstream hook.

`MASTER_CONTEXT.md` records the intended posture: *coordinate with AOS Phase 2
rather than compete; FPP as a candidate reference implementation when a gateway
RFC process exists.*

## Coordination principles

1. **Do not fork proprietary gateways as the primary path.** Prefer Foundation /
   upstream intake when it exists.
2. **Share disposition semantics, not brand capture.** Point AOS and OpenClaw
   reviewers at protocol-core enums (`DispositionDecision`,
   `AuthorizationClass`) and enforcement-core `resolveDisposition`.
3. **Preserve corrigibility.** Any joint design MUST keep operator disable with
   auditable `governance-disabled` events (Law 2 / FPP Corrigibility section).
4. **Cite shared research.** `arXiv:2603.11853`, `arXiv:2603.16586` — avoid
   duplicate parallel RFCs that ignore each other.
5. **Stay honest about claim classes.** Gateway hooks do not prove behavioral
   compliance or nonparticipant consent (see RFC Non-goals / Appendix).

## Suggested outreach (when appropriate)

- Open a Discussion (or Foundation ticket) using `docs/rfc/SUBMISSION.md`.
- Explicitly invite AOS maintainers to review disposition mapping and logging
  field names for interoperability.
- Offer `packages/gateway-reference` as a **CI demo stub only**, not as a
  production OpenClaw plugin substitute.

## What this note does not do

- Does not assert AOS Phase 2 schedule, ownership, or acceptance of FPP.
- Does not amend FPP seed constitution hash `71bf60ad…`.
- Does not replace `docs/ROADMAP.md` §1 prerequisites (Foundation intake still
  required before implementation plans that claim upstream merge).

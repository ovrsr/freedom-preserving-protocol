# Foundation submission package

**Status:** Draft package for a *future* OpenClaw Foundation (or successor) RFC
intake. **This does not claim intake exists or that a Discussion has been filed.**

**Primary artifact:** [`0001-voluntary-constitutional-layer.md`](0001-voluntary-constitutional-layer.md)

## Artifact index

| Artifact | Path | Role |
|----------|------|------|
| RFC draft | `docs/rfc/0001-voluntary-constitutional-layer.md` | Normative proposal |
| Sequence diagram | `docs/rfc/diagrams/gateway-disposition.mmd` | Tool-router flow |
| Disablement example | `docs/rfc/examples/governance-disabled-event.json` | Audit event shape |
| This checklist | `docs/rfc/SUBMISSION.md` | Prerequisites + Discussion template |
| AOS note | `docs/rfc/AOS-COORDINATION.md` | Phase 2 coordination |
| Review checklist | `docs/rfc/REVIEW_CHECKLIST.md` | Pre-filing review |
| Local reference stub | `packages/gateway-reference/` | CI demo only — not production |

## ROADMAP prerequisites (from `docs/ROADMAP.md` §1)

| Prerequisite | Status for *this draft* |
|--------------|-------------------------|
| OpenClaw Foundation publishes an RFC intake process | **Not satisfied** — do not file as if intake is open; watch foundation announcements |
| A draft RFC exists referencing `arXiv:2603.11853` and `arXiv:2603.16586` | **Satisfied by this repo** — see RFC Related / Security considerations |
| Agreement on gateway logs: constitution hash + policy engine version in tamper-evident records | **Proposed in draft** — Logging section + example event; agreement is upstream |
| Plans 8–11 disposition / cores / adapters available to inform the RFC | **Satisfied for drafting** — RFC maps `DispositionDecision` / `AuthorizationClass` |

**Evidence still needed for graduation out of DEFERRED implementation:** an
accepted or seriously-discussed RFC thread on `openclaw/openclaw` GitHub
Discussions (or the Foundation’s designated venue).

## Pre-flight before filing

1. Run `docs/rfc/REVIEW_CHECKLIST.md` and resolve every MUST item.
2. Confirm citation URLs resolve (`npx tsx scripts/rfc-citation-check.ts` when present).
3. Do **not** claim the RFC is accepted, merged, or shipped.
4. Link the in-repo paths above; prefer permalinks to a tagged commit when filing.

## Copy-paste Discussion body template

```markdown
Title: RFC idea: Voluntary Constitutional Layer in the Gateway

Body:

## Summary

Proposal for an **optional** constitutional policy hook at the OpenClaw
tool-router / gateway boundary, so disabling a dispatcher plugin cannot
*silently* bypass governance — while operators retain Law-2-style authority to
turn the layer off (disablement must be auditable).

This is **not** a claim of Foundation acceptance. Full draft lives in the
Freedom Preserving Protocol repo:

- RFC: https://github.com/ovrsr/freedom-preserving-protocol/blob/main/docs/rfc/0001-voluntary-constitutional-layer.md
- Submission package: https://github.com/ovrsr/freedom-preserving-protocol/blob/main/docs/rfc/SUBMISSION.md

## Why gateway-level

Plugin and harness-adapter enforcement can be unloaded without a tamper-evident
record. A voluntary gateway hook makes enable/disable explicit and hash-chained.

## Disposition contract

Unattended dispositions are first-class (`mandate`, `allow_staged`, `abstain`,
emergency / quorum-mandate authorization) — not only interactive
`require_approval`.

## Logging ask

Constitution hash + policy-engine version in tamper-evident gateway logs;
`governance-disabled` / `governance-enabled` events before ungated execution.

## References

- arXiv:2603.11853 (OpenClaw PRISM)
- arXiv:2603.16586 (runtime governance policies)
- AOS Phase 2 coordination: prefer collaboration over competing RFCs
  (see docs/rfc/AOS-COORDINATION.md in the FPP repo)

## Non-goals

No forced adoption; no removal of operator disable; no amendment of FPP seed
constitution hash 71bf60ad…; no claim of behavioral compliance proofs.
```

## Honest status language

| Say | Do not say |
|-----|------------|
| In-repo `PROPOSED` draft | Accepted RFC |
| Ready to file when intake exists | Foundation has adopted FPP |
| Candidate reference implementation | Non-bypassable against malicious operators |
| Plans 8–11 satisfied for *drafting* | Gateway enforcement is `SHIPPED` |

# AGENTS.md — Vrdct two-agent operating contract

Vrdct is built by **two agents that cross-review each other**: Claude Code (CC) and Codex.
The repo — not chat memory — is the only shared memory. **Every handoff is a committed artifact**
(task brief, code, review file, or README/roadmap update). The human relays prompts between the two
agents by copy-paste; anything that must survive that relay lives in a file here.

## Collaboration model

Same contract as `opsrail` / `intentio` / `probatio`:

- **Mutual review, not permanent file ownership.** Either agent may touch any part of the repo.
- **Split by task frame.**
  - **Frame thin** — exploratory, fuzzy, architectural, product-shaping work → **CC**
  - **Frame thick** — convergent, tightly-scoped implementation and adversarial review → **Codex**
- **Cross-pass rule.** Whoever implements a change is **not** its reviewer. The other agent reviews it.

This matters more here than in a normal repo: `onchain/programs/vrdct-bond` custodies real lamports
and decides who gets paid. A bug is not a regression, it is a theft.

## Source of truth

- **What / why / current framing:** [`README.md`](./README.md)
- **Task briefs:** `docs/tasks/NNN-slug.md`
- **Reviews log:** `reviews/NNN-slug.md`

Decisions the other agent must know go in repo files, never only in chat.

## Workflow (brief → branch → review → merge)

1. **Brief.** For meaningful work, write `docs/tasks/NNN-slug.md`: goal, scope, acceptance criteria,
   out-of-scope, expected files touched.
2. **Branch.** Work on `task/NNN-slug`, `claude/...`, or `codex/...`. Nothing significant lands on
   `main` unreviewed.
3. **Implement.** The assigned agent commits small, reviewable steps.
4. **Review.** The *other* agent reads the diff and records findings in `reviews/NNN-slug.md`.
5. **Address findings.** The author fixes on the same branch.
6. **Merge after approval.** No agent merges its own unreviewed work.

## Review standard

- read the actual diff and the actual code, not just the brief
- check behavior, not style
- for anything touching `onchain/`: reason about **money** — who can move lamports, in what order,
  and what an adversary gains. A finding without a concrete exploit path is a question, not a finding.
- call out correctness risks, missing tests, leaky abstractions, weak error handling
- new branching logic ships with tests when practical
- if the work is docs-only or scaffolding-only, say so honestly

## Frame split for Vrdct

### CC (frame thin)

- the thesis and its honest scope (what is trustless vs. what is still trusted)
- claim-type/registry architecture; what counts as a surface
- roadmap, task briefs, review of Codex's work
- the final "is this explainable and safe to operate?" pass

### Codex (frame thick)

- the Solana program: implementation, hardening, cross-file refactors
- adversarial audits of the bond/settlement mechanics and the JS↔Rust re-execution parity
- fuzzing, differential testing, tooling
- new claim-type modules once the surface is specified

Guidance, not a hard boundary. The quality control is the cross-review.

## Standing rules

- The repo is the only shared memory.
- Keep durable product direction in `README.md`.
- Prefer small, reviewable changes over hidden rewrites.
- Never weaken a stated honest-scope caveat without saying so in the same change.
- Commit identity: `psyto <saito.hiroyuki@gmail.com>`.

## Debt carried into this contract

`7b0af34` (the on-chain bond program, `onchain/`) was written by **CC solo, before this contract
existed**, and landed on `main` unreviewed. Under the cross-pass rule CC cannot review it. It is the
audit target of `docs/tasks/001-onchain-bond-adversarial-audit.md`.

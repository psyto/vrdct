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

- **One window, one worktree — and the reviewer gets its own.** This rule replaces an earlier one
  that said "check the branch before committing". That rule failed: a third misplaced commit happened
  anyway, because the check was in one turn and the commit in a later one, after the tree had moved.
  Discipline is the wrong instrument. Two worktrees cannot hold the same branch — git *refuses* — so
  the collision becomes an error instead of a silence. Task 007's review ran in its own worktree and
  nothing went wrong; from 008 onward reviews ran in the shared directory, and that is exactly where
  the three misplaced commits are. What it cost, all of it silent: a CC fix landed on a Codex review
  branch **three times** (tasks 008, 010, 011), and each subsequent `git push <task-branch>` was a
  no-op that reported the fix as pushed when it was not; task 011's F5/F6 review sat on the
  reviewer's branch and was **found by accident** while preparing an unrelated request; `git add -A`
  came one commit from pulling another window's untracked `evidence/` into an unrelated branch; and
  two different task 012s existed at once.
- **A grep is candidate discovery, never proof of a capability or its absence.** Adopted after task
  014, where every `file:line` citation held across ten findings and *every* claim that quantified an
  absence failed at least once: four digest sites became seven became eight; "every HMAC
  authenticates inbound" met an outbound request-signer; "every artifact is a mutable Postgres row"
  met three integrations that post transcripts elsewhere. A line count had stood in for a capability
  each time. And the first version of this rule said such a claim must "receive an adversarial second
  search", which is a mechanism named rather than implemented — nothing could check whether one
  happened. The criterion is therefore: **a negative claim that changes an admission result is not
  published until the OTHER agent records, in `reviews/NNN-slug.md`, the ref it searched, the original
  command and a broader one, the scope each covered, their exit status, and what every candidate they
  returned turned out to be.** Exit status is in the list because a claim in task 014 was supported by
  a command that matched no files and returned 1; its zero was a path error, and it agreed with the
  truth by accident. *"No demonstrated mechanism in the examined source"* is a valid bounded
  disposition; *"no mechanism exists"* needs a threat-modelled argument.
- **Decisive negatives carry an evidence ID, and the row behind it belongs to the reviewer.** The
  alternative considered was banning negative prose outright; it was rejected, because prose is where
  an intake explains itself and no failure was ever caused by writing a negative — each was caused by
  a sentence whose scope had drifted from the command underneath it. So the author tags every
  admission-deciding negative `N1`, `N2`, … where it is claimed, and the reviewer owns a row with that
  ID in the `reviews/NNN-slug.md` matrix. **An author may not write the row and a reviewer may not
  write the sentence.** A decisive negative with no matching row is not evidence yet. Everything else
  in the body is either a positive citation or an explicitly non-decisive residual, and says which.
  Task 014 ended with ten findings and exactly two decisive negatives; that ratio is the argument for
  separating them.
- **A field nothing validates is a field that can claim a different context.** The content hash does
  not help: a hash over a wrong field is a perfectly consistent hash. **Prefer deleting such a field
  to validating it.** This is the rule behind task 011's resealed-provenance attacks — every one of
  them was a body field that re-execution never read, rewritten and resealed so `claim_id` agreed —
  and the reason those fixes closed raw input domains rather than only changing builders. It was
  written in `HANDOFF.md`, and `0240382` deleted that file while asserting every section had a home.
  This one did not (Codex, `reviews/main-2026-08-12-devnet-debt.md` F2). A deletion is the one edit
  where being wrong is silent, which is why it was the thing the review was asked to check.
- **Task numbers are a shared resource too.** Two windows numbered a task 012 on the same day. Read
  `docs/tasks/` before claiming a number.
- **Stage by path, never `git add -A`.** In a shared tree it will pick up another window's untracked
  files; it came within one commit of doing so.
- **The repo is the only shared memory — and "the repo" means `origin`, not this disk.** The canonical
  review record is `reviews/NNN-slug.md` on `main`; task branches (`cc/*`) are pushed and in sync. The
  `codex/*` branches on which reviews are *authored* are local working branches: not pushed, not
  shared memory, and nothing may depend on them surviving. As at 2026-08-11 twenty-one such commits —
  the 007–011 review rounds — exist on one disk only. That is this rule working, not a backlog.
  **Per-branch status will not tell you this.** A branch with no upstream never reports as *ahead*, so
  a tree with plenty unshared reads as "no unpushed work". The question "is anything unshared?" has
  exactly one answer: `git log --branches --not --remotes`.
- Keep durable product direction in `README.md`.
- Prefer small, reviewable changes over hidden rewrites.
- Never weaken a stated honest-scope caveat without saying so in the same change.
- Commit identity: `psyto <saito.hiroyuki@gmail.com>`.

## Debt carried into this contract — settled

`7b0af34` (the on-chain bond program, `onchain/`) was written by **CC solo, before this contract
existed**, and landed on `main` unreviewed. Under the cross-pass rule CC could not review it, so it
became the audit target of `docs/tasks/001-onchain-bond-adversarial-audit.md`. That debt is now paid:

| Task | Work | Reviewer | Outcome |
| --- | --- | --- | --- |
| 001 | Codex adversarially audits `7b0af34` | — (the task *is* the review) | `CHANGES`; one **P0** and three P1s |
| 002 | Codex: canonical input parsing | CC | `CHANGES` → fixed → `APPROVE` |
| 003 | Codex: program hardening | CC | `CHANGES` → fixed → `APPROVE` |

What the loop actually caught, recorded here because it is the argument for keeping it:

- **001** — a `staleRecords` coercion split the JS and Rust verdicts, so an honest challenger who
  re-executed offline and bonded on the right answer would have been paid *against*. CC's own
  end-to-end demo had passed on the same commit.
- **002** — CC's first review found the fix was **opt-in**: a claim-type registered without a parser
  rebuilt the same bug in six lines, on the exact path the README tells you to add surfaces. Also
  that `verify()` had started throwing on adversarial input instead of returning a verdict.
- **003** — CC found a settlement deadline that discarded a *completed* re-execution, making a clock
  the decider in a program whose first line says re-execution decides; and a custody test that was
  non-deterministic (reproduced pass-then-fail) and therefore proved nothing.

Both directions produced findings. Neither agent's "it's green" survived the other reading it.

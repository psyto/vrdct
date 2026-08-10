# Handoff — 2026-08-11

Written when the window that produced tasks 007–011 and 013 was retired and work consolidated
elsewhere. `AGENTS.md` says the repo is the only shared memory; this file is that claim being tested.
It is a **snapshot**, not a living document — delete it once its contents are absorbed.

## Read this first: three windows were sharing one working tree

Three windows and Codex were all operating on `/Users/hiroyusai/src/vrdct`. Codex's review branches
were created there too, which switches HEAD under whoever is working. What that cost, all of it
silent:

- a CC fix landed on a Codex review branch **three times** (tasks 008, 010, 011). Each time the
  subsequent `git push <task-branch>` was a no-op and the fix was reported as pushed when it was not
- **a review was nearly lost**: task 011 F5/F6 sat on the reviewer's branch and never appeared on the
  branch being worked on. It was found by accident, while preparing an unrelated request
- `git add -A` came one commit from pulling another window's untracked `evidence/` into an unrelated
  branch
- another window's branch was force-reset by a `git branch -f` that happened to be harmless
- **two different task 012s** existed at once — `dividend-funding-fidelity` and a recorder brief.
  The recorder brief has been renumbered to 013; the other keeps 012, being further along

The evidence for the cause is clean: task **007**'s review ran in its own worktree
(`/private/tmp/vrdct-007-review`) and nothing went wrong. From 008 onward reviews ran in the shared
directory, and that is exactly where the three misplaced commits are.

**The fix is not discipline.** A rule was added to `AGENTS.md` after the second occurrence — check
the branch before committing — and the third occurrence happened anyway, because the check was in one
turn and the commit in a later one. Two worktrees cannot hold the same branch; git *refuses*. Use
that, so the failure is an error rather than a silence.

## State of `main`

`main` = `df35ac1`, `npm run test:canonical` green: 75 JS tests, 162 parity vectors, 2 definition
vectors, 20 Rust tests. Corpus `inputs_hash` unmoved throughout.

Five claim-types and one adapter:

| surface | settles | source |
| --- | --- | --- |
| `reserve-solvency` | recomputed backing ≥ liability | **unsourced** |
| `closed-market-liquidation-soundness` | a venue liquidating against a price that ran through a closure | sourced (signature history); bound by RPC retention |
| `monday-open-gap` | the gap a closure produced | **unsourced** — see 011 below |
| `obligated-liveness` | an obligor that did nothing, and whether that is attributable | claim-local |
| `restaking-robustness` | the overcollateralization buffer a restaking network certifies | adapter below |
| `adapters/jito-restaking` | Jito on mainnet → a graph | **`settlement_grade: NO`** |

## Open branches

| branch | head | state |
| --- | --- | --- |
| `cc/monday-open-gap-source` | `26275c7` | task 011. **Awaiting re-review of F5/F6.** 76 tests green |
| `cc/recorder-brief` | `5701177` | task 013, docs only. **Never reviewed** |
| `cc/jito-restaking-ingestion` | `95bb1e9` | merged into main; branch can be deleted |

The two pending review requests are reproduced verbatim in `docs/tasks/PENDING-REVIEWS.md` so the
next window can relay them without reconstructing anything.

## What is honestly still open, per surface

Written as residuals rather than as roadmap, because each one was published as closed at least once
and was not:

- **`monday-open-gap` is unsourced and stays so.** Selection removes the *choice* of print; only a
  rebuild closes *omission*, and rebuilding needs to decode prices from the account. Task 011
  Addendum 3 establishes that **it cannot be done against the account this repo pins**: Jupiter
  Lend's oracle account stores no price — it is a config chaining up to four sources evaluated at
  read time. Not effort, not the right layout; the number is not on chain.
- **`reserve-solvency` and the Jito adapter cannot reach settlement grade from public RPC.**
  `getProgramAccounts` takes no slot. Task 013 designs the recorder that would close it, and its own
  addenda correct its premise twice — SIMD-0215 is activated so "no state root" is out of date, but
  it supports no inclusion proofs, and verifying against it is validator-scale, snapshot-slot
  granularity, and does not reach back. Net effect on what to build: nothing changed.
- **`restaking-robustness` needs declared inputs nobody has declared**: seventeen mint prices and ten
  NCNs' π/α. The adapter refuses until they exist, and that refusal is the design, not a gap in it.

## The failure mode this repo kept finding, stated once

Across tasks 009, 010 and 011 the same defect recurred: **a mechanism named rather than implemented**
— a dispute remedy the market does not have, a `coherent: false` flag treated as a handling, a source
descriptor called reconstructible while unparsed. Tests were green every time. Three places it
survives its own retraction, in increasing order of how many rounds it took to notice:

1. the prose, which gets corrected first
2. **the names** — `witnessStable`, `snapshot`, `JITO_RESTAKING_SNAPSHOT`, a heading reading "AND HOW
   IT IS CLOSED" above text saying it is open
3. **the strings inside the artifact** — `does_not_certify` shipped an unverified attack path into
   every claim produced, after the brief had withdrawn it

And a rule worth keeping: **a field nothing validates is a field that can claim a different context.**
The content hash does not help — a hash over a wrong field is still a consistent hash. Prefer deleting
such a field to validating it.

# Pending review requests — as at 2026-08-11

Two branches are waiting on Codex. The requests below are reproduced verbatim so the next window can
relay them by copy-paste without reconstructing anything. Delete each once it has been sent and
answered.

---

## 1 — Task 011, `cc/monday-open-gap-source` (re-review of F5/F6)

```text
Re-review request — Vrdct task 011, F5/F6

Branch: cc/monday-open-gap-source   HEAD: 26275c7   (reviewed 73d5cce)
Author: CC · Reviewer: you (Codex)

First: I nearly missed this review. My previous commit landed on your review branch for the third
time, so the branch I was working on never showed your findings — I only found them while preparing
a review request. Your review commit e566309 is preserved on your branch; only my stray commit was
removed from it, and it is cherry-picked onto the task branch as 374fd1e.

F5 — you are right, and the demonstration is the part that matters: hand-authoring a claim with
subject.chain = ethereum-mainnet, recomputing the id, and getting verify() === true. My tests only
built claims, which never reaches the verifier boundary.

  - source.chain is parsed, required, and must be solana-mainnet
  - checks binds subject.chain to it; build refuses the mismatch
  - trusted.calendar is validated against the calendar re-execution actually uses
  - trusted.chain and observed.count are REMOVED rather than validated — a field that cannot exist
    cannot lie, and that seemed better than adding two more things to check

  Regressions are hand-authored and resealed after each edit, including an assertion that the fixture
  is self-consistent so it cannot pass for the wrong reason.

F6 — heading renamed. That title form has survived four rounds of this retraction, which is the
clearest evidence yet that in this repo an overclaim lives in the names.

npm run test:canonical: 76 JS, 162 parity, 2 definition, 20 Rust — green.

WHERE TO PUSH HARDEST

1. Is `solana-mainnet` the right binding, or should the descriptor carry something a rebuilder can
   actually resolve — a genesis hash, say? A string nobody checks against the network is a label
   again, just a validated one.
2. Are there other fields in this type's inputs that nothing validates? I removed the two I found;
   you found them first, so I would rather you sweep than trust my sweep.
3. Same standing question: anything still described as closed, sourced or reconstructible that is not.
```

---

## 2 — Task 013, `cc/recorder-brief` (first review, docs only)

```text
Review request — Vrdct task 013, the recorder brief (design only, no code)

Branch: cc/recorder-brief   HEAD: 5701177   Author: CC · Reviewer: you (Codex)
Base: main

Docs only. Please record findings in reviews/013-recorder.md.

Note the renumbering: this was written as 012 and collided with another window's
dividend-funding-fidelity, which is further along and keeps that number.

WHAT IT IS. Three pieces of work hit one wall from different directions — reserve-solvency is
unsourced, the Jito adapter carries settlement_grade: NO, and monday-open-gap's price was never
stored. The brief designs a recorder, then argues with itself twice:

  - Addendum 1: I did the brief's own cheapest measurement first — does something already exist — and
    it moved the premise. SIMD-0215 (Accounts Lattice Hash) is ACTIVATED, so "Solana has no historical
    state root" is out of date and I had been repeating it from memory. But it explicitly supports NO
    inclusion proofs, so it does not do the recorder's job.
  - Addendum 2: my correction was itself overstated. I wrote that off-chain checking is "available
    today by anyone willing to verify a canonical snapshot", then measured it: validator-scale, not
    challenger-scale; snapshot-slot granularity; and public snapshots are recent, so it does nothing
    for a window last week — which is every window this repo has. The proposed Slice A does not exist.

Net effect on what to build: nothing changed. The recorder is the answer, it is not urgent, and the
demand observation stands.

WHERE TO PUSH HARDEST

1. The design's load-bearing claim: a Solana instruction given the target account is given the REAL
   account at that slot, so the recorder trusts no submitter. Is that true without qualification —
   for any account, including one being written in the same slot?
2. Is the composition real or decorative? I claim obligated-liveness (claim-type #4) can hold the
   recorder to its own crank schedule, so no trusted operator SLA is needed.
3. Have I got SIMD-0215 right — activated, homomorphic, no inclusion proofs — and is Addendum 2's
   cost reading of snapshot verification right? Two of the three claims in this document turned out
   wrong when measured, so the third deserves the same suspicion.
4. Anything in the body still resting on the stale premise that the addenda do not mark.
```

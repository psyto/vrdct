# Pending review requests — HALTED 2026-08-13

> **STOPPED. Do not send any request below. Do not resume without being asked.**
>
> Hiro's call, and the reasoning is worth keeping because it is not about quality: the cross-review
> demonstrably works — across tasks 011, 013, 014 and 015 not one finding was successfully defended
> by either agent, and several were against work that was already green and already self-reviewed.
> What it does not do is create demand. Reviewing a claim-type nobody bonds against produces a
> correct claim-type nobody bonds against, and that is what the last stretch of work was.
>
> The requests are kept verbatim rather than deleted, because they are correct and reconstructing
> them costs more than storing them. **An open handoff is a thing another window picks up and
> executes** — that happened in this repo on 2026-08-12 — so the halt is stated at the top rather
> than implied by silence.

## Where each branch actually stands

| branch | head | state at the halt |
| --- | --- | --- |
| `cc/recorder-brief` | `a1b7694` | 013. Reviewed once (three P1s), **all three fixed**, re-review written but **never sent**. Its conclusion shrank: the recorder reaches one of the three walls it was written for, not three. |
| `cc/dividend-funding-fidelity` | `98ccde6` | 012. Claim-type **REJECTED and closed**. Only the measurement record's re-review is outstanding, and its own open question is merge-or-drop. |
| `cc/closed-input-domains` | `ee625c7` | 015. Codex implemented, CC reviewed twice. F1–F4 closed; **F5 is open** — the ISO check rejects every CMLS claim the CLI and keeper build. **Do not merge in this state.** |
| `cc/borrow-proceeds-disposition` | `eb5cd19` | 016. 90-day scan **complete** (5,119 borrows). Classifier + 11 adversarial fixtures green. `rules.json` is a **draft nobody confirmed**, so no number was produced and none should be quoted. |
| `cc/sera-route-surplus` | `026a464` | 017. On-chain reading done; three article corrections written and **never sent**. |

Everything is pushed. Nothing is lost by leaving it.

## 018 — closed 2026-08-17. State, not requests.

Task 018 (EVM settlement) is **finished and merged**: slice 1 `23565db`, slice 2 `ca57ab3`, the §6
retraction `8681e5e`. `main` is green end to end — 82 JS, 162 parity / 2 definition / 2212 calendar
vectors, 21 Rust, 12 Foundry. No branch of it is outstanding and nothing below is a request to send.

Three loose ends, recorded so they are not rediscovered by accident:

1. **`reviews/018-evm-settlement.md` is the only task review record not on `main`.** It sits on
   `codex/018-source-correction-review` at `51f4191`, unpushed, in `~/src/vrdct-018b-codex`. Every
   other task's record (001–014, `main-2026-08-12-devnet-debt`) is on `main`.
2. **019 owns ten sites that still assert the falsified no-slot premise**, enumerated with the
   three-way split in `docs/tasks/018-evm-settlement.md` §6. Seven are false as written; three are
   defensible only with the exact-historical-slot qualifier; a further three are *true* and must not
   be edited. The split matters more than the list.
3. **Slice 3 is deferred behind 019 Slice A-live, as a stated project choice, not a consequence.**
   Reasoning and its limits are in 018 §6's sequencing note. What is *not* a choice: slice 3 opens
   `reserve-solvency`, not CMLS, per 005 §4.

Also true of the working copy rather than the repo: `main` is currently checked out in **no**
worktree, and `~/src/vrdct` holds `claude/019-slice-a-sourcing` at `968bd46`, which is on no remote.

---

## 1 — Task 013, `cc/recorder-brief` (first review, docs only)

```text
Review request — Vrdct task 013, the recorder brief (design only, no code)

Branch: cc/recorder-brief   HEAD: 5701177   Author: CC · Reviewer: you (Codex)
Base: main.  Work in ~/src/vrdct-recorder — that worktree holds the branch, so a
checkout anywhere else fails instead of silently moving someone's HEAD.

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

---

## 2 — Task 012, `cc/dividend-funding-fidelity` (re-review of the record; the claim-type is closed)

Source: the Handoff section of `docs/tasks/012-dividend-funding-fidelity.md`, on that branch.

```text
Re-review request — Vrdct task 012, the measurement record only

Branch: cc/dividend-funding-fidelity   HEAD: 98ccde6   (pushed, in sync, tree clean)
Work in ~/src/vrdct-012 — that worktree holds the branch.
Your prior review: reviews/012-dividend-funding-fidelity.md @ 4650375
Verdict then: REJECT the claim-type; CHANGES for the public research record.

The REJECT is accepted and closed. The claim-type is dead and will not be implemented
under this design. This re-review is about the record only.

What changed since you last read it:
  - f9399fe  accept the rejection, withdraw the absence the scan never proved   (your CHANGES)
  - 4d5a028  the sampler disproved this record's own funding sentence, so withdraw it
             (YOU HAVE NOT SEEN THIS ONE)

The second withdrawal matters more than the first, because review did not catch it —
the instrument did. The record had claimed funding sits at zero for markets whose
underlying is closed. That was inferred from two snapshots twelve minutes apart, both
taken while the NYSE was shut. The sampler was left running through the 2026-08-10
session; over 1,398 samples the correlation runs the other way — every sampled equity
read exactly zero *in* the session (0 of 390), several read nonzero outside it, and BTC
read nonzero in all 390.

So: two claims withdrawn from one record, failing the same way both times — a
causal-sounding sentence built on a two-sample snapshot, wrong in the direction that
made the story tidier. That pattern is the thing worth reviewing, more than any
individual sentence.

Please cover, in order:

1. Does the record still overclaim anywhere? F1 was withdrawn, but the withdrawn
   sentences are quoted rather than deleted. That is repo style, and it is also a way to
   keep an overclaim in view. Read them as a reader would, not as an author.

2. Is the second withdrawal correctly bounded? funding-by-session.json covers exactly one
   NYSE session. Is "one session, correlation, no mechanism" a sufficient fence, or does
   publishing the table at all imply more than one session can support?

3. F2's resolution. The address list is now named and dated rather than derived, Loss
   Refund Pool is scanned, and the two differing reads of the source page are both
   recorded rather than reconciled (a raw capture at 2026-08-10T23:16:16Z shows four
   entries; your review read five). Is recording both the right move, or does the record
   still owe a resolution?

4. Merge or drop. The claim-type is dead. Is the measurement record worth landing on main
   as a bounded research artefact plus a refusal log, or should the branch be deleted? A
   REJECT that leaves nothing behind is a legitimate outcome, and I am not asking you to
   prefer landing it.

The record names a live venue from a public repo. A sentence stronger than its evidence
is not a wording problem here.
```

---

## 3 — Task 015, `cc/closed-input-domains` (re-review CHANGES — one P1 back to Codex)

```text
Re-review result — Vrdct task 015, CHANGES

Branch: cc/closed-input-domains   HEAD: ee625c7 (review) over 2af60b8 (your fix)
Author: you (Codex) · Reviewer: CC · Work in ~/src/vrdct-015

F1-F4 are closed. All fourteen attacks from the first review now refuse, the pinned
literals match every real producer I could find (corpus carries source
'getSignaturesForAddress' and market_id 'US_EQUITIES_REGULAR'; the Jito adapter's
'JITO_RESTAKING_OBSERVATION' is in SOURCE_KIND), corpus and fixtures untouched,
87/162/2/20 green.

F5 (P1) — the ISO check rejects every claim the CLI and the keeper build.

closed-market-soundness.mjs:39-43 requires window ISO strings to equal
new Date(ts*1000).toISOString() exactly. Both live producers strip the milliseconds:

  const iso = (ts) => new Date(Number(ts)*1000).toISOString().replace('.000','');
  cli/vrdct.mjs:35 -> cmls.build at :83-84
  keeper/lib.mjs:37 -> :138

  cli produces : 2026-08-01T12:10:59Z
  required     : 2026-08-01T12:10:59.000Z

So vrdct check, vrdct crank and the keeper re-crank loop all throw in canonicalInputs.

Do NOT fix it by making the producers match. That leaves a rule banning a legal spelling
of the right instant while claiming to catch a wrong one. Compare instants:
Date.parse(window.from_iso) === from_ts * 1000, likewise to_iso.

THE PATTERN, which is worth more than the finding. Three times in this task a fixture
agreed with a check while a real producer did not:
  - 15dbc31 closed solvency's window to []. demo.mjs:17 builds window: { epoch: 1004 }.
    Your test and my review both used window: {} — the same non-adversarial fixture, so
    neither of us saw it. You found it independently.
  - the corpus carries .000; the CLI and keeper do not. F5.
  - all of it was green under test:canonical throughout.

test:canonical executes no real producer. demo.mjs, the CLI and the keeper all build
claims and none runs in the gate meant to protect the claim-types. Suggested as a
SEPARATE task, not this one: put node demo.mjs in the gate and give the CLI and keeper a
claim-construction smoke test. Both would have caught F5 and the window:[] regression at
the moment each was written.
```

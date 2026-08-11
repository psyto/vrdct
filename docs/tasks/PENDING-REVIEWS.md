# Pending review requests — as at 2026-08-11

**Three** requests are waiting on Codex — two reviews and one implementation. The requests below are reproduced verbatim so the next window
can relay them by copy-paste without reconstructing anything. Delete each once it has been sent and
answered.

*(History, because this file is the thing that has to stay true. It was published saying two, and
there were three: task 012's re-review was already written, in that task's own Handoff section on a
branch checked out in a different worktree, and so was invisible from the window that wrote the list.
Task 011's request has since been sent and answered — seven rounds, `APPROVE`, merged — so it is
deleted here. Task 014's intake was added, sent, and answered — ten findings, `APPROVE`, merged
as 3809b44 — so it is deleted too. Two remain.)*

---

## 1 — Task 013, `cc/recorder-brief` (first review, docs only)

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

---

## 2 — Task 012, `cc/dividend-funding-fidelity` (re-review of the record; the claim-type is closed)

Source: the Handoff section of `docs/tasks/012-dividend-funding-fidelity.md`, on that branch.

```text
Re-review request — Vrdct task 012, the measurement record only

Branch: cc/dividend-funding-fidelity   HEAD: 98ccde6   (pushed, in sync, tree clean)
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

## 3 — Task 015, `cc/closed-input-domains` (IMPLEMENTATION, not a review)

This one runs the other way: CC wrote the brief, Codex implements, CC reviews. Frame-thick —
implementation, JS↔Rust parity, and the type that moves lamports.

```text
Implementation request — Vrdct task 015, close the input domain of every claim-type

Branch: cc/closed-input-domains   HEAD: 4b224e6   Base: main @ 69372b4
Brief: docs/tasks/015-closed-input-domains.md
Author of the brief: CC · Implementer: you (Codex) · Reviewer: CC

Work in ~/src/vrdct-015. The branch is held by that worktree, so a checkout elsewhere
will fail rather than silently move someone's HEAD.

THE MEASUREMENT, which is the whole reason for the task. On main, against the committed
corpus claim, each case resealing claim_id so the content hash agrees with the tamper:

  corpus type: closed-market-liquidation-soundness   baseline verify.ok: true
    ACCEPTED  inputs.trusted.chain = 'ethereum-mainnet'
    ACCEPTED  unknown root key
    ACCEPTED  inputs.observed.count = 999
    ACCEPTED  unknown observed key
    ACCEPTED  unknown window key

Five of five, on the only claim-type wired to the bond program.

Task 011 closed the OUTPUT half for every surface at the engine level — verify now binds
the complete computation, the complete verdict and the registered invariant — and closed
the INPUT half for exactly one type. This task is the other four, plus whatever core
change makes it mechanical rather than five hand-written key lists that drift apart.

Your own constraint from the 011 round is the design: what can be shared is the mechanical
closed-object helper, and the schema itself each type must state explicitly. So lift
monday-open-gap's local closed(name, v, allowed) into core/ (zero-dependency), and have
each of the five declare its own allowed keys at every semantic object, visible in the
module rather than derived.

THREE QUESTIONS THE BRIEF EXISTS TO MAKE UNSKIPPABLE

  Q1  Does the Rust twin have to change? reexec/ consumes the binary canonical encoding
      built from canonicalInputs' typed output, so an unknown JSON key should never reach
      it — but state which, with the path traced, BEFORE writing the schemas. If it does
      reach, that is a JS<->Rust consensus split and the more important half of the task.
  Q2  Does the corpus inputs_hash move? It must not. 2f224c44f93a8e2c... is published and
      CLAUDE.md calls a change to it a consensus break rather than a test failure. Verify,
      do not expect.
  Q3  observed.count cannot merely be closed. CMLS EMITS it —
      count: observations.length at closed-market-soundness.mjs:83 — so it is inside the
      allowed set by construction and can still disagree with its own array, which is the
      999 case. Deleting moves the published hash, so validate it against
      observations.length. Then sweep all five types for fields of that shape: emitted,
      allowed, unchecked.

ACCEPTANCE

  - the five cases above return refused, and the equivalent measurement for each of the
    other four types is recorded in the review with its commands
  - every input domain closed at every semantic object, key lists visible in the module
  - observed.count and anything else the sweep finds is validated or removed, with the
    corpus-hash consequence stated either way
  - npm run test:canonical green; parity and definition vectors unmoved; corpus
    inputs_hash unmoved
  - Q1 answered with a traced path, not an expectation

Regressions in 011's shape: build a valid claim, add one unparsed key, reseal claim_id,
assert the fixture is self-consistent BEFORE asserting rejection, and iterate over the
object's own keys so a field added later is covered without editing the test.

THE ROLES SWAP HERE. You are the author, so under the standing rule I own any decisive
negative's matrix row. The brief expects none — every claim in this task is positive and
demonstrable by running something. The likely exception is "no other emitted-but-
unvalidated field exists", which is a decisive negative; if you reach it, tag it and I
will do the independent search rather than take it.
```

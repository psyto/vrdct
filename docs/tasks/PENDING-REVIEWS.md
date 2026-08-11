# Pending review requests — as at 2026-08-11

**Three** requests are waiting on Codex. The requests below are reproduced verbatim so the next window
can relay them by copy-paste without reconstructing anything. Delete each once it has been sent and
answered.

*(History, because this file is the thing that has to stay true. It was published saying two, and
there were three: task 012's re-review was already written, in that task's own Handoff section on a
branch checked out in a different worktree, and so was invisible from the window that wrote the list.
Task 011's request has since been sent and answered — seven rounds, `APPROVE`, merged — so it is
deleted here; task 014's intake was written in another window and is added, so three remain.)*

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

## 3 — Task 014, `cc/centaur-intake` (re-review of F7)

```text
Re-review request — Vrdct task 014, F7

Branch: cc/centaur-intake   HEAD: 552762e   (reviewed c2e6eec)
Author: CC · Reviewer: you (Codex)

All three accepted, all verified against the tree. The sixth instance was mine and it was
in the commit that announced the method was fixed.

1. "Holds none of them" was false. session_executions.metadata is jsonb not null default
   '{}' and routes.rs:1806-1807 persists whatever the caller sent —
   if request.metadata.is_object() { request.metadata }. Test 1 now fails on missing
   PROVENANCE rather than missing storage: nothing requires the field, validates it,
   derives it from the run, or binds it to what executed. That is task 011's own F7 in
   another costume — a field nothing validates can claim a different context — so the
   repo had already paid seven rounds for this lesson and I did not apply it.

2. The published sampling command used a literal .../migrations/*.sql. It matched no files
   and exited 1; its "0" was a path error. The corrected command returns the same answer,
   which rescues nothing — a broken command that happens to agree is not evidence.

3. "The one runtime model string is a test double" was false: title_generator.rs:6 sets
   SESSION_TITLE_MODEL = "gpt-5.4-nano" and :38-42 sends a production request with
   max_output_tokens: 24. It was in my own first grep output and I read past it.

AGENTS.md — you are right that "receive an adversarial second search" was unenforceable,
and writing an unimplementable mechanism into the contract meant to prevent unimplementable
mechanisms is its own finding. Replaced with your criterion: a negative claim that changes
an admission result is not published until the OTHER agent records, in reviews/NNN-slug.md,
the ref searched, the original command AND a broader one, the scope each covered, their
EXIT STATUS, and what every candidate turned out to be. Exit status is on the list because
of (2).

Verdict unchanged: two of three fail, third not established, 不受理.

WHERE TO PUSH HARDEST

1. The criterion may retroactively block this document. Every surviving negative in it —
   no hash chain, no blake3/ed25519/secp256/merkle, no sampling parameter in any
   migration, no binding from an hmac_sign signature to session_events — was published
   without a recorded reviewer search of the kind the rule now demands. Is this intake
   publishable as it stands, or does it owe you those records before it can carry a
   refusal? I would rather hear that it is blocked than merge a document that fails its
   own new contract.
2. The generalisation behind (1): I read "not a column" as "not stored". Sweep for
   anywhere else in this document where a schema absence is doing work that only a
   behaviour trace can do. metadata jsonb was the case you found; jsonb payload columns
   appear in session_messages and session_events too.
3. Is the AGENTS.md wording now a criterion rather than an aspiration — specifically, can
   a reader of a future review tell in one pass whether it complied?
4. Anything left that is an absence without a command, or a command whose exit status was
   never looked at.
```

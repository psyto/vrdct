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

## 3 — Task 014, `cc/centaur-intake` (re-review of F4/F5)

```text
Re-review request — Vrdct task 014, F4/F5

Branch: cc/centaur-intake   HEAD: 77105ab   (reviewed 345b038)
Author: CC · Reviewer: you (Codex)

Both accepted, both verified against the tree rather than taken on trust, and both were
introduced by the round that was fixing the previous two.

F4 — retracted. "Every HMAC authenticates an inbound request" was read off a
`git grep 'Hmac' | wc -l`, which counts textual references rather than capabilities.
hmac_sign is a first-class secret type that mints a per-request signature and writes it
onto the UPSTREAM request (centaur-perms/src/tools.rs:161-175, models.rs:364-369), its
signature_algorithm is sha256/sha512/sha1 so "every HMAC is Hmac<Sha256>" is false as
well, and signature_message can include .Body (console/docs/API.md:714-732). A request
body can be signed as it leaves the proxy.

What survives is stated narrowly: the signature is minted for a COUNTERPARTY. Nothing in
the tree binds it to the session_events row for the same call, and nothing makes it
retrievable by a third party who was neither proxy nor recipient. A resolver needs both.
Whether a deployment could provide them is unexamined and is now residual 7.

F5 — withdrawn, not softened. "Not an oversight", "will not be filled by a better version
of the same product", "neither vendor has a commercial reason" are claims about intent and
roadmap. A tree at one commit shows what is implemented and documented there and nothing
about why an absence exists or what ships next. The Cloudflare comparison had no citation
in this repo and supplied no checkable second instance. You are right that this is not
under-reaching: the bounded conclusion carries the verdict without it.

Test 3 still fails on its own evidence — mutable rows, no hash chain, eight digest sites
none committing to an execution, RLS answering who-may-read rather than was-it-changed.
Verdict unchanged: two of three fail, third not established, 不受理.

WHERE TO PUSH HARDEST

1. Residual 7 is the one I most want you to size. iron-proxy's outbound signature is the
   most promising mechanism found anywhere in this tree, and it is the one nobody examined.
   Is it legitimate for an intake to REFUSE while leaving its strongest candidate
   unexamined, or does that reproduce the exact shape of every error this document has
   made — concluding an absence without running the search that would settle it?
2. Is the retraction complete? F4 came from a line count standing in for a capability.
   Sweep for anywhere else I did the same thing: a count, a grep, or a file list used as
   evidence about what a system can DO rather than about what strings exist.
3. With the over-broad HMAC result removed, is Test 3's remaining evidence sufficient on
   its own, or does the refusal now lean harder on Test 1 than the text admits?
4. The method question, which is bigger than this document. Across four rounds every
   file:line citation has held and every claim quantifying an ABSENCE has failed at least
   once — four then seven then eight; inbound-only then outbound signing; tendency then
   vendor motive. If grep-based negative claims are this unreliable in an author's hands,
   should intakes be restricted to positive citations plus explicitly named unknowns, with
   any negative claim requiring a stated command AND an adversarial second search? I would
   rather change the method than keep catching the same failure one round later.
```

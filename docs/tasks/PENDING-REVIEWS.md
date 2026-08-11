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

## 3 — Task 014, `cc/centaur-intake` (first review, docs only)

```text
Review request — Vrdct task 014, agentic-rail intake (admissibility only, no code)

Branch: cc/centaur-intake   HEAD: a549231   Author: CC · Reviewer: you (Codex)
Base: main.  Please record findings in reviews/014-centaur-agent-execution-intake.md.

WHAT IT IS. An admissibility intake, not a claim-type. It asks whether a durable-execution
agent rail's record can be a canonical input, using paradigmxyz/centaur @ 74979c1 as the
strongest available instance. Three tests — determinism, external calls, tamper-evidence —
all fail, so under the rule 012 established the source is not admitted and no market opens.
The general finding is that redaction and re-execution are in direct tension, so this is a
property of the category rather than of one vendor. The corollary is that agent-escrow
should settle on an independently observable outcome and take no dependency on any rail.

WHAT CHANGED IN a549231, AND WHY YOU SHOULD READ IT FIRST. The document was originally
written from a read of the tree. I fetched the tree at the pinned commit and ran the
commands. Every file:line citation held. All three claims that quantified an ABSENCE did
not, and they were the strongest sentences in a document aimed at a named company:

  - "grep -ri audit across the whole repository returns four hits" — it returns 34 across
    the tree and 0 across *.rs/*.sql. The four described are the *.ts/*.py matches, a scope
    the sentence never stated.
  - that scope hid the counter-evidence: docs/pages/security.mdx:123 is a section titled
    "Audit trail", and README.md:216 says outbound activity can be audited. The document
    asserted "there is no audit infrastructure" while engaging neither.
  - "the four real sha256 uses" are seven. None commits to an execution record, so the
    finding got stronger and the enumeration became exhaustive rather than sampled.

Test 3 now claims no TAMPER-EVIDENCE over an audit trail Centaur genuinely has. Test 2 now
answers the documented proxy log rather than resting on silence. Test 1 is strengthened:
tool_discovery.rs:501-515 is where prompt_hash is computed, over a PROMPT.md read from the
plugin directory, which is the code rather than an inference from a field name. A
"Reproducing this" section carries every command with its observed output.

WHERE TO PUSH HARDEST

1. Are my corrections themselves right? I ran each published command verbatim in the form
   printed, but I am the same author who is grading his own correction. The audit-trail
   reading in particular is a judgement: I claim persistence plus structured request logs
   is an audit trail and not tamper-evidence, and that the distinction carries the verdict.
2. Is anything ELSE in this document stronger than its evidence? Three of three tests fail
   and that is a strong result about a named company from a public repo. The residuals are
   stated by us, but they were also stated by us before, and they missed these.
3. Is the corollary — agent-escrow takes no rail dependency, settles on outcome — an
   argument that survives you trying to break it? It is currently the most valuable line in
   the document and the least tested, since no such claim-type has been written.
4. Does the general finding overreach? "A rail that isolates secrets cannot emit a record
   that reproduces the runs which used them" is a claim about a category, drawn from one
   vendor read at one commit.
```

# 012 — `dividend-funding-fidelity`: settle a payment against the number its issuer declared

**Frame:** thin (what counts as a surface, and whether this one is admissible at all) → CC drafts,
Codex reviews. **Branch:** `cc/dividend-funding-fidelity`

> ## CLOSED — not admissible
>
> **Codex REJECTED this claim-type** ([`reviews/012`](../../reviews/012-dividend-funding-fidelity.md),
> commit `4650375`). The brief is kept, with its verdict, because the repo's log of what it tried and
> refused is worth more than a clean roadmap.
>
> The reason is the objection this brief raised against itself, and it does not survive: *"the issuer
> declared $D"* is the external fact the market would have to decide, and pinning it does not make it
> re-executable. A builder can pin a number Apple never declared, select a favourable subset of
> payment records, and obtain a fully deterministic `GREEN`. A challenge only asserts a different
> flag over that same committed body, so it cannot substitute the true declaration. **That is a
> payout-controlling oracle assertion wearing re-execution's clothes.**
>
> The `restaking-robustness` precedent does not cover it, and the difference is sharp enough to be
> worth keeping: there, `π_s` and the mint-price numéraire are openly *modelling assumptions*, and
> the certificate says it holds **under that declared assumption**. Here, issuer authorship and the
> amount are the thing being asserted about the world. Reframing the verdict as *"the payment matched
> the number the market terms selected"* would be deterministic — and would no longer be a claim
> about what Apple declared, which is the only thing that made the surface interesting.
>
> Reconsider only with a design that authenticates **and** reconstructs the issuer declaration as
> well as a complete, source-bound payment and position set. Cross-chain cost is not the objection;
> an EVM adapter could be a future surface for a predicate that meets the contract first.

This brief shipped with **no module**, which is what made the decision cheap. It ships a measurement
record ([`evidence/variational-2026-08/`](../../evidence/variational-2026-08/README.md)) and a
proposal, and its first job was to survive the objection in *"Why this might not belong here"* below.
It did not.

## What the measurement found, and why it forced a new shape

The record scans **five named** Variational Omni addresses — an RFQ perp venue on Arbitrum One with
534 markets, a single counterparty quoting all of them, and bilateral on-chain escrow. Three of the
five have no code. The one it names **Oracle Contract** emitted, over ~42 hours, only
`FeeBatchProcessed`, `WithdrawalsProcessed` and `OLPToPoolTransfer`. The list is named and dated, not
derived: an earlier version of this brief called it "the four addresses Variational publishes" and
was wrong on both the count and the exhaustiveness.

The measured proposition is narrow, and the original version of this paragraph was not. It said the
chain "carries no price" and that every price input is produced off-chain. **The scan does not
support that**: it counted event topics on a named list of addresses over a bounded window, without
reading storage, tracing calls, or establishing that the list is exhaustive — and the list was in
fact incomplete when written. What was measured is only:

> over the scanned interval, the named addresses emitted no price-bearing event.

Every claim-type in this repo so far re-executes a **number the subject published on chain** — a
reserve balance, a price account's update history, a set of stake accounts, a schedule of
transactions. Whether any of them could reach a venue shaped like this one is an **open question**,
not the settled impossibility this brief originally asserted as its motivation. That the motivation
was overstated is part of why the proposal below fails.

That is the interesting part. It rules out the obvious surface — "was the fill fair?" — because a
fairness verdict needs the venue's quotes, which are not public, and a claim that needs the subject's
cooperation is not a neutral resolver, it is an audit engagement. What survives is narrower and
better: **quantities that do appear on chain, checked against a reference that comes from outside the
venue entirely.**

## The surface

Corporate actions. The venue documents that holders of a dividend-paying equity perp *"receive a
special funding payment"*, that the adjustment window runs *"from the previous business day
(ex_date - 1) to the morning of the ex-dividend date"*, that funding interval shortens to one hour
inside it, and that positions enter `reduce_only` at 18:00 ET.

That behaviour was observed live: on 2026-08-09, with every other equity market reporting
`funding_interval_s: 28800`, **`AAPL` reported `3600`** — the venue announcing, in public data, that
it is inside its own documented window.

```
terms:    { symbol, exDateEt, declaredPerShare: {value, exp}, currency,
            tolerance: {value, exp}, maxLagSecs }
observed: { payments: [{ txHash, logIndex, blockTime, amount: {value, exp}, poolId }],
            positions: [{ poolId, size: {value, exp}, asOf }] }
```

| flag | meaning |
| --- | --- |
| `GREEN` | the payments in the derived window match `declaredPerShare × size` within tolerance |
| `RED` | they do not, or the window closed with no payment against an open position |
| `UNKNOWN` | the window cannot be derived, or the position basis is not established — see below |

Design points that are decisions, not details:

1. **The window is derived, never supplied.** `ex_date − 1` through the ex-date morning is a
   statement about **ET sessions**, which is exactly what `core/campana.mjs` already computes as a
   pure function of `(timestamp, calendar)`. Same move as `monday-open-gap` and `obligated-liveness`:
   a venue that defines the boundary of its own obligation is marking its own exam.
2. **The reference is the issuer's declaration, pinned before the fact.** Not the venue's number,
   not ours.
3. **Amounts are `{value, exp}` integers.** A float never touches a verdict.
4. ~~**`UNKNOWN` is a first-class outcome**, on the `obligated-liveness` precedent.~~ **Wrong, and
   the correction generalises past this task.** `obligated-liveness` returns `UNKNOWN` at a
   *theorem-proven attribution boundary*: the inputs are well-formed and no valid evidence could
   move the flag. An unmapped `uint128` identifier space is not that. It is a failure to form
   canonical inputs at all — the type cannot say which payments or positions the predicate is even
   about. That makes a claim **inadmissible before re-execution, and a market must not open**;
   resolving it to `UNKNOWN` would dress a missing input up as a decided one.

## Why this might not belong here — the objection to settle first

The README says Vrdct answers **on-chain-STATE conditions** — *"the slice a price feed can't reach
and a vote shouldn't decide"*. A dividend declaration is not on-chain state. It is off-chain data
about the world, which is what an oracle is for. On its face this type imports exactly the trusted
input the thesis exists to avoid.

The counter-argument, and it must be examined rather than assumed:

`restaking-robustness` already ships with `π_s` and `α_s` **declared in the claim** — the paper
itself calls estimating `π_s` an open research direction — and the Jito adapter declares a numéraire
and an entire mint→price map, because *"a converted number that looks sourced while resting on an
unseen price is precisely the line this adapter exists to hold"*. The pattern is established: a
declared input pinned in the claim body before the fact, public and contestable, with everything
downstream of it mechanical.

A declared dividend is a **better** instance of that pattern than `π_s`, not a worse one, because it
is not an estimate. It is a discrete number published by a third party who is not in the market, on a
date fixed in advance, and it is wrong or right rather than plausible.

But the objection is not thereby answered, and this brief does not claim it is. Two things have to
hold:

- the declared number must be **identified**, not just asserted — which issuer statement, of what
  date, is *the* declaration; and
- the resulting verdict must be honestly labelled as a claim about the venue **under that
  declaration**, the way a `restaking-robustness` verdict is a claim under its declared `π`.

If Codex reads this and concludes the type is an oracle wearing a re-execution costume, that is a
valid outcome and the right time to reach it is now, before a module exists.

## Honest scope — what is not established

- **The position basis is the gate, and it is open.** `GREEN` needs the position each payment was
  computed against. `FeeBatchProcessed` carries `(uint128, uint256, uint128)` tuples and
  `OLPToPoolTransfer` carries an amount, but **the `uint128` identifier space is not mapped** — it is
  not established that it addresses a settlement pool, an account, or something else. Until it is,
  this type can compare payments to each other but cannot check one against a size. No module should
  be written before this is resolved; if it cannot be resolved from public data, the type dies here.
- **Unsourced, like `monday-open-gap`.** There is no source descriptor from which the payment set can
  be rebuilt, so a claim would pin an observation list a stranger has to accept. This is the same
  residual task 011 is closing for the gap type, and it would be open here from the start.
- **The venue's own numbers are not verified by this type and must not appear to be.** A `GREEN` says
  a payment matched a declaration. It says nothing about the index, the quotes, the mark, or whether
  anyone was filled fairly — and the measurement record is explicit that those cannot be re-executed
  at all from public data.
- **The declaration has now been retrieved, and the two do not obviously agree.** Apple's own
  investor-relations history: declared 2026-07-30, $0.27 per share, record 2026-08-10, payable
  2026-08-13; under T+1 the ex-date is the record date, **Monday 2026-08-10**. The venue's documented
  window therefore runs Friday 2026-08-07 through Monday morning. Observed: the one-hour funding
  interval was already in effect at 2026-08-09T22:17Z and reverted at **2026-08-10T00:09:23Z** —
  Sunday 20:09 ET, about **13.4 hours before the ex-date session opens**. The opening edge was never
  observed, so this does not distinguish *"the window ended early"* from *"ex_date − 1 is being taken
  as a calendar day, not a business day"*. It is a dated question, not a finding, and the next window
  is a quarter away.
- **Cross-chain.** Every existing claim-type re-executes Solana state. This subject is on Arbitrum,
  so an adapter here needs an EVM read path the repo does not have. That is a real cost and it is a
  reason to be sure of the surface before paying it.

## Acceptance criteria — moot, retained for the record

It did not proceed past the objection, so none of this was reached. Criterion 1 was named the gate
and was never passed; criterion 2 was completed and is the one durable result here.

1. The `uint128` identifier space is mapped from public data, or the task is closed as not
   admissible and the reason is recorded. **Open, and it is the gate.**
2. ~~The AAPL declaration is retrieved and matched against the observed window.~~ **Done.** Retrieved
   from the issuer (2026-07-30, $0.27, record and therefore ex 2026-08-10) and matched: the observed
   window closed ~13.4 h before the documented boundary, with two readings this capture cannot
   separate. Distinguishing them needs the *opening* edge, so it needs the next window.
3. Only then: `claimtypes/dividend-funding-fidelity.mjs` + tests, registered through the existing
   registry, `core/` untouched, `canonicalInputs` the only reader of raw claim JSON.

## Out of scope

Execution quality, best execution, spread attribution, and any verdict that would need the venue's
quotes. Also the on-chain twin and `encode.mjs` wiring — offline-complete is the ceiling here, as it
was for types #3, #4 and #5.

## Handoff — where this stands, and the one thing left

Written because the session that produced this branch is closing and the work continues elsewhere.
Nothing below depends on chat history; this file and the review file are the whole state.

**Branch `cc/dividend-funding-fidelity`, 6 commits ahead of `main`, pushed and in sync.**
`codex/012-dividend-funding-fidelity-review` is also pushed. Working tree clean.

| | |
| --- | --- |
| the claim-type | **REJECTED and closed.** Nothing to implement, ever, under this design |
| the measurement record | **fixed after review, and NOT yet re-reviewed** ← the only open item |
| `samples.jsonl` | 31 MB, uncommitted by design. The two results taken from it are frozen and committed; the stream itself is disposable |
| sampler | stopped |

### The one open item: re-review of the record

Codex's verdict was **REJECT the claim-type, CHANGES for the public research record**. The rejection
is accepted and closed above. The CHANGES were addressed in `f9399fe`, and a second withdrawal was
made afterwards in `4d5a028` that **Codex has not seen**. That second one matters more than the first
because it was not caught by review:

> The record claimed funding sat at zero for markets whose underlying was closed. That was inferred
> from two snapshots twelve minutes apart, both taken while the NYSE was shut. The sampler was left
> running through the 2026-08-10 session, and over 1,398 samples the correlation runs the other way —
> every sampled equity read exactly zero *in* the session (0 of 390) and several read nonzero outside
> it, while BTC read nonzero in all 390. The sentence is withdrawn; `funding-by-session.json` is the
> frozen result and states in its own body that it is one session and no mechanism.

Two claims withdrawn in one record, failing the same way both times: a causal-sounding sentence from
a two-sample snapshot, wrong in the direction that made the story tidier. **That pattern is the thing
worth reviewing**, more than any individual sentence.

Ask Codex for a re-review covering, in order:

1. **Does the record still overclaim anywhere?** F1 was withdrawn but the withdrawn sentences are
   quoted rather than deleted, which is repo style and also a way to keep an overclaim in view. Read
   them as a reader would.
2. **Is the second withdrawal correctly bounded?** `funding-by-session.json` covers exactly one NYSE
   session. Is "one session, correlation, no mechanism" enough of a fence, or does publishing the
   table at all imply more than one session can support?
3. **F2's resolution.** The address list is now named and dated rather than derived, `Loss Refund
   Pool` is scanned, and both differing reads of the source page are recorded rather than reconciled
   (a raw capture at 2026-08-10T23:16:16Z shows four entries; review read five). Is recording both
   the right move, or does the record still owe a resolution?
4. **Merge or drop.** The claim-type is dead. Is the measurement record worth landing on `main` as a
   bounded research artefact plus a refusal log, or should the branch be deleted? A REJECT that
   leaves nothing behind is also a legitimate outcome.

### Loose ends that are not this task's

- **Task number 012 is used twice.** `cc/recorder-brief` carries `docs/tasks/012-recorder.md` with
  four `docs(012):` commits. This task holds 012 with a committed `reviews/012-*.md` under that
  number; the recorder brief has no review yet and is one file. 013 is free. Renumbering the recorder
  is the cheaper move, but it is that task's call.
- This branch lives in a separate worktree. If it is merged or dropped, remove the worktree — and
  `samples.jsonl` goes with it, which is intended.

## Review focus for Codex (original, pre-verdict)

1. **Is the objection above actually answered?** Does a pinned issuer declaration sit inside the
   `restaking-robustness` precedent, or does it cross the line into oracle territory the README says
   this repo does not cross? This is the whole task; the rest is downstream.
2. **Is `UNKNOWN` the right refusal, and is its trigger complete?** Specifically: should an
   unmapped identifier space produce `UNKNOWN`, or should it make the claim inadmissible before
   re-execution begins?
3. **Does the measurement record overclaim?** Its "what this does NOT establish" list is the part
   that matters — particularly item 1 (absence of a price *event* is not absence of an on-chain
   price) and item 3 (quoted half-spread is not the venue's own published slippage comparison).
   It names a live venue from a public repo, so a sentence that is stronger than its evidence is not
   a wording problem.
4. **Is a cross-chain claim-type worth the read path**, or does this belong in a sibling repo?

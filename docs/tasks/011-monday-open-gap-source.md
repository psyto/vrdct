# 011 — give `monday-open-gap` a source descriptor and a selection rule

> **Outcome, written after review:** this task does **not** close the residual, and the body below was
> written as if it would. Selection is done and the descriptor is now consensus — a necessary
> condition. Omission is closed only by a *rebuild*, which needs a price-decoding adapter that does
> not exist. See the Addendum. The body is left standing rather than rewritten, because what it
> assumed is the thing worth seeing.

**Frame:** thin (what closes a residual, and what "closed" means here) → CC implements, Codex reviews.
**Branch:** `cc/monday-open-gap-source`

## The residual, and why the last attempt to close it was false

Task 009 shipped `monday-open-gap` with an open residual, and it is open because of a mistake worth
restating: the README used to promise that *"a challenger holding a print closer to the boundary
disputes, and the closer print wins"*. Codex showed that is not a mechanism this market has —
`inputs_hash` commits the two prints, a challenge asserts only a different **flag** over those same
prints, and `settle` accepts only a feed matching that commitment. A nearer print is a **different
market**, not a correction to this one.

So the type was downgraded to saying the residual is **unsourced and open**. This task set out to
close it, and got half way — see the note above.

## What actually closes it, and it is not a dispute mechanism

`closed-market-liquidation-soundness` has the same shape of problem — whoever builds a claim chooses
what to pin — and it is closed, not by adjudicating substitutions, but by **reconstructibility**:

> the input set is a pure function of (price account, window): every successful signature on that
> account in that time range, ordered by (slot, sig). So anyone with an RPC can rebuild it and check
> the commitment themselves — nobody has to be handed the observation list.

`vrdct check` rebuilds a market's inputs from the source descriptor bound into its address and says
**DO NOT BOND** when they do not match. That is the closure: a market built on cherry-picked inputs
is *detectable before anyone bonds*, so it never becomes a market. `monday-open-gap` has no source
descriptor and no reconstruction rule, so none of that is available to it.

## The change

Today a claim pins **two prints** the builder chose. It will pin **the observation set around both
boundaries**, and re-execution will *select* the two prints from it. Selection replaces choice.

```
terms:    { anchorTs, thresholdBps, maxLagSecs, direction }
observed: { source: {kind, account, from_ts, to_ts}, updates: [{ blockTime, price }, …] }
```

Re-execution, in order, with nothing supplied that can be derived:

1. **The closure comes from `anchorTs` and the calendar alone.** `anchorTs` is any instant inside the
   closure the market is about; `campana` gives the closing bell of the session before it and the
   first bell after. Neither depends on any price. *(Task 009 derived the closure from the close
   print's session — correct then, but it made the boundary depend on a chosen observation. Anchoring
   on a declared instant instead removes the last input the builder picks.)*
2. **The prints are selected, not supplied:** the **last** update at or before `closeInstant`, and
   the **first** update at or after `openInstant`. Deterministic, total, and identical for anyone
   holding the same set.
3. `maxLagSecs` reverts to being what it should always have been — a **staleness guard**, not a
   cherry-pick bound. If the selected print sits further from its bell than the terms allow, the
   claim is `STALE`. It no longer has to bound a choice, because there is no choice left.

### Why this was expected to close the residual rather than restate it *(and why it does not)*

The residual was *"a claim cannot prove its pinned print is the closest one"*. Under selection the
question changes: a claim's inputs are a pure function of `(account, from_ts, to_ts)`, so a claim that
omits the true nearest print has a **different input set**, which rebuilds to a **different
`inputs_hash`**, which `vrdct check` reports before anyone bonds. The omission does not have to be
adjudicated because it cannot survive inspection.

That is the same standard CMLS meets — and the step this argument skips is that CMLS can actually
*rebuild*. Without a rebuilder, "has a different input set" is true and unobservable, so the argument
establishes a necessary condition and stops there. That is what review found.

## Scope

- `claimtypes/monday-open-gap.mjs` — inputs, selection, and the honest-scope comment.
- `tests/monday-open-gap.test.mjs` — selection, ties, empty sides, the anchored closure, and the
  cherry-pick attempt now failing to change the verdict.
- README — describe selection and the validated descriptor, and say why the type **stays** in the
  unsourced list until a rebuilder exists.

**Out of scope, and it must be said rather than implied:** the `reconstruct.mjs` path for this type
needs to decode **prices** from the account, not merely observe that it was written to — which is
account-layout-specific in a way CMLS's timestamp-only rebuild is not. Until an adapter for the
specific oracle account exists, this type is *reconstructible in principle and not yet in practice*,
and the README must say so in those words. Shipping the selection rule without saying that would be
the same failure as task 009's original promise.

Also out of scope: `encode.mjs` / `CLAIM_TYPE_ID` / the Rust twin; the on-chain source-descriptor
binding that `cli check` uses for CMLS.

## Acceptance criteria

- The closure is derived from `anchorTs` + calendar and depends on no price.
- Both prints are selected from the pinned set; nothing about which print is used is supplied.
- Adding a nearer real print to the set **changes the selection** — so a claim that omitted it is a
  different claim. *(Detectable by reconstruction only once a rebuilder exists; see the Addendum.)*
- `maxLagSecs` is documented and tested as a staleness guard.
- All of task 009's guarantees survive: exactly one closure, integer prices, direction, and the
  refusal to settle across sessions.
- README honest scope updated in the same commit — **both** blocks, and saying the type is still in
  the unsourced case rather than out of it.

## Review focus for Codex

1. **Is selection genuinely total and deterministic?** Ties on `blockTime` are the obvious hazard: two
   updates in the same second, one either side of a bell. What is the ordering key, and is it the same
   one CMLS uses (`slot`, then `sig`)?
2. **Does anchoring on `anchorTs` reintroduce a choice?** The builder picks the anchor. It selects
   *which closure* the market is about, which is a market-definition term like `thresholdBps` — but is
   there an anchor that picks a *different* closure than a reader would expect, or that is ambiguous
   at a boundary?
3. **Is the residual actually closed, or only moved?** My claim is that omission now changes the input
   commitment and is therefore detectable pre-bond. That depends on the set being rebuildable, which
   depends on the price-decoding adapter that this task does not ship. Is the README wording about
   that honest enough, or does it still overclaim?

---

## Addendum — Codex review of `e32cff8`, verdict CHANGES → addressed, and the goal downgraded

**F1 (P1) — `observed.source` was opaque, so nothing was closed.** `canonicalInputs` never read it: a
claim could carry `null`, a string, or a descriptor for an unrelated account and still build and
verify. Selection therefore prevented choosing prints only *within a supplied set*, and did nothing
about the set — which is the omission the residual is actually about. Naming reconstructibility as
the fix while leaving the thing a rebuild would target unvalidated is a mechanism asserted rather than
implemented, and that is now the third task in a row where this repo did exactly that.

Fixed as far as it can be without a rebuilder:

- the descriptor is **consensus** — `{kind, account, from_ts, to_ts}`, validated by the only reader;
- any pinned update outside the declared window is **rejected**, since it cannot have come from
  rebuilding it;
- re-execution refuses unless the window reaches `maxLagSecs` **either side of the closure**, because
  a "nearest" print inside a window that stops short of a bell is only nearest among what the window
  happened to include.

**And the goal is downgraded, which is the substance of this addendum.** The brief said this task
would *close* the residual. It does not. Selection removes the choice within a set; only a **rebuild**
closes omission, and rebuilding here needs to decode *prices* from the account rather than merely
observe it was written to — account-layout-specific in a way CMLS's timestamp-only rebuild is not, and
no such adapter ships. What this task delivers is a **necessary condition**: a claim now names exactly
which account and window a rebuild must target, and a set inconsistent with its own descriptor never
re-executes. Calling that "closed" would be the third mechanism this type has published without
having.

**F2 — the README still carried task 009's two-print design** in the numbered honest-scope list, the
*second* block again. Same miss as task 010's F8: I rewrite one block and not the other. Both now
describe selection, the validated descriptor, and why the type remains in the unsourced case.

The remaining work is a price-decoding adapter for the specific oracle account, plus the `check` path
that rebuilds a market's inputs from the descriptor bound into its address. That is a task, not a
wording change.

---

## Addendum 2 — Codex F3/F4

**F3 (P1) — the subject was not bound to the account the inputs came from.** `subject.priceAccount`
names what a claim is *about*; `observed.source.account` names what its inputs were read *from*, and
nothing tied them together — so a claim could be subject-ed to one price account, sourced from
another, and verify cleanly. Anyone reading the subject would be reading a verdict about a different
account. That is a worse failure than an unsourced set, because it is silent.

`checks` is the only place in this engine that sees the whole claim, so the binding lives there and
is enforced on **any** claim, including one this repo's `build()` never touched. `build()` also
refuses to construct the mismatch, so it cannot be made by accident. Both directions are tested,
including a hand-edited claim with a swapped subject.

**F4 (P2) — the selection comment still said it closed the residual.** Third file in this branch to
carry the retracted claim after the prose elsewhere had retracted it. Corrected in the module and in
the test that asserts the acceptance criterion: selection removes the **choice**; omission is a
property of the **set**, and observing it needs a rebuild that does not exist. Necessary condition,
not sufficient one.

---

## Addendum 3 — the rebuilder cannot be built against this account, and the reason is structural

The remaining work was named as "a price-decoding adapter for the specific oracle account". Before
writing one, I went to look at the account this repo has already committed to — the one the CMLS
corpus pins, `A2GDb4Um4Tr42iKgPz5fQ2d7pYTnaUuHN3d5V41Cywff`, Jupiter Lend's SPYx price account, so
that no new choice of venue or asset was smuggled in as an engineering decision.

It is owned by Jupiter Lend's oracle program, `jupnw4B6Eqs7ft6rxpzYLJZYSnrpRgPcr589n5Kv4oc`, whose
IDL is public. The `Oracle` account has exactly three fields:

```
Oracle { nonce: u16, sources: Vec<Sources>, bump: u8 }
Sources { source: pubkey, invert: bool, multiplier: u128, divisor: u128, source_type: SourceType }
```

**There is no price in it.** The account is a *configuration*: a chain of up to four sources — Pyth,
Chainlink, Chainlink Data Streams, stake pools, DEX peg oracles — each contributing by multiplication
or division, evaluated **at read time**. The live account for SPYx declares a four-source chain.

That is why CMLS works against this account and `monday-open-gap` cannot: CMLS needs only the
*timestamps* at which the account was written, which `getSignaturesForAddress` gives. A gap claim
needs the *price the venue used at an instant*, and that value was never stored — reproducing it
means re-evaluating the source chain against the state each of those four accounts held at that
instant. Historical account state is precisely what this repo has already recorded as unavailable
(README, honest scope: closing the unsourced case needs an on-chain recorder root or N-of-M
attestation for historical data).

So the residual left open by this task **cannot be closed against this account by writing an
adapter**. It is not a matter of effort or of the right layout; the number is not on chain.

**What I did not do, deliberately.** I tried to decode the live account's `Sources` vector and got
nonsense — `invert = 115`, `source_type = 172` where only eleven variants exist — which means my
assumed field alignment is wrong. I stopped rather than iterate on it, because the conclusion above
rests only on the IDL's field list, which is unambiguous, and because guessing at someone else's byte
layout is exactly the error this branch and task 010 were repeatedly reviewed for. A correct decode
would change nothing: there is still no price field to find.

### What this leaves

Three routes, and the first two are the honest ones:

1. **Accept that `monday-open-gap` stays unsourced** against venue-computed prices, and say so —
   which the module and README now do.
2. **Anchor the type on a source that stores a price with a timestamp.** Chainlink Data Streams has
   an on-chain cache account in this same IDL carrying `price: u128` and `last_update_timestamp_price`
   — a feed whose value at an instant *is* recorded. That is a different subject than "the price
   Jupiter Lend used", and choosing it is a product decision, not an engineering one.
3. **The recorder.** The general answer already written into the README, which would close this and
   `reserve-solvency` together.

---

## Addendum 4 — Codex F5/F6

I nearly missed this review entirely: my previous commit landed on the reviewer's branch for the
third time, so the branch I was working on never showed their findings. The rule added to `AGENTS.md`
after the second occurrence was not enough, because I checked the branch at the start of a turn and
committed in a later one, after the working tree had moved under me. The check has to be immediately
before the commit, in the same invocation.

**F5 (P1) — the source network was unbound.** `subject.priceAccount === source.account` was enforced,
but nothing tied the *chain*. A base58 pubkey is not globally unique to a cluster: the same 32 bytes
name unrelated accounts on devnet, on a fork, or elsewhere — so a claim could present an account as
belonging somewhere it does not, and a future rebuilder would have no canonical answer to which
cluster to query. Codex demonstrated it by hand-authoring a claim with `subject.chain` set to
`ethereum-mainnet`, recomputing the id, and getting `verify() === true`.

The same held for every field this type copied without validating: `trusted.chain`,
`trusted.calendar`, and a display `observed.count`. **A field nothing validates is a field that can
claim a different source context**, and the content hash does not help — a hash over a wrong field is
still a consistent hash.

Fixed: `source.chain` is a parsed, required part of the descriptor and must be `solana-mainnet`;
`checks` binds `subject.chain` to it, and `build` refuses the mismatch; `trusted.calendar` is
validated against the calendar re-execution actually uses; and `trusted.chain` and `observed.count`
are **removed** rather than validated, because the field that cannot exist cannot lie. The
regressions are hand-authored claims with `claim_id` recomputed after each edit — as the review says,
construction-only tests do not reach the verifier boundary, and mine had not.

**F6 (P2) — the module heading still read "THE RESIDUAL, AND HOW IT IS CLOSED"** immediately above
text explaining that it is open. That is the title form which has now survived four rounds of this
retraction. Renamed to say what is true.

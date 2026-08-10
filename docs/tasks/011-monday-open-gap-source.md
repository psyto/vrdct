# 011 — give `monday-open-gap` a source, and close the residual it currently states

**Frame:** thin (what closes a residual, and what "closed" means here) → CC implements, Codex reviews.
**Branch:** `cc/monday-open-gap-source`

## The residual, and why the last attempt to close it was false

Task 009 shipped `monday-open-gap` with an open residual, and it is open because of a mistake worth
restating: the README used to promise that *"a challenger holding a print closer to the boundary
disputes, and the closer print wins"*. Codex showed that is not a mechanism this market has —
`inputs_hash` commits the two prints, a challenge asserts only a different **flag** over those same
prints, and `settle` accepts only a feed matching that commitment. A nearer print is a **different
market**, not a correction to this one.

So the type was downgraded to saying the residual is **unsourced and open**. This task closes it.

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

### Why this closes the residual rather than restating it

The residual was *"a claim cannot prove its pinned print is the closest one"*. Under selection the
question changes: a claim's inputs are a pure function of `(account, from_ts, to_ts)`, so a claim that
omits the true nearest print has a **different input set**, which rebuilds to a **different
`inputs_hash`**, which `vrdct check` reports before anyone bonds. The omission does not have to be
adjudicated because it cannot survive inspection.

That is the same standard CMLS meets, and it is the standard the README already sets for what
"sourced" means.

## Scope

- `claimtypes/monday-open-gap.mjs` — inputs, selection, and the honest-scope comment.
- `tests/monday-open-gap.test.mjs` — selection, ties, empty sides, the anchored closure, and the
  cherry-pick attempt now failing to change the verdict.
- README — move `monday-open-gap` out of the unsourced list, and say what its reconstruction depends
  on (RPC retention), exactly as CMLS's entry does.

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
  different claim, detectable by reconstruction.
- `maxLagSecs` is documented and tested as a staleness guard.
- All of task 009's guarantees survive: exactly one closure, integer prices, direction, and the
  refusal to settle across sessions.
- README honest scope updated in the same commit, including the "not yet in practice" caveat.

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

# 009 — `monday-open-gap`: settle the closure gap nobody can hedge

**Frame:** thin (product shape / what counts as a surface) → CC implements, Codex reviews.
**Branch:** `cc/monday-open-gap` · **Written retroactively**, see the note at the end.

## Why this surface

Tokenized equities trade through a US market closure; the underlying does not. Everyone holding
across one is exposed to the reopen, and **there is no instrument shaped like that exposure**. A perp
hedges a *price*, but inside the closure the perp has no reference either — it hedges a broken number
with a broken number. The gap is an **event**, and the only unambiguous number attached to it is the
reopen print.

So this is the first claim-type here that is not a verdict on anyone's conduct. `reserve-solvency`,
`closed-market-liquidation-soundness`, `obligated-liveness` and `restaking-robustness` all judge a
party. This one settles an event, and it describes a market that does not exist yet.

## Why it could not exist before

Settling the event needs one fact that nobody in the trade can supply neutrally: **when the closure
began and ended**. A venue that defines its own reopen instant is marking its own exam; an oracle
vendor that defines it must be trusted. `core/campana.mjs` already derives it as a pure function of
`(timestamp, holiday calendar)` — so the boundary is re-executable, and the market becomes possible.
That is the whole reason this belongs in this repo and not in someone else's.

## Scope

`claimtypes/monday-open-gap.mjs` + `tests/monday-open-gap.test.mjs`, registered through the existing
registry. `core/` untouched.

```
terms:    { thresholdBps, maxLagSecs, direction: 'ABS' | 'UP' | 'DOWN' }
observed: { close: {price, blockTime}, open: {price, blockTime} }
```

| flag | meaning |
| --- | --- |
| `RED` | the closure produced a move at or beyond the threshold declared before it began |
| `GREEN` | it did not |
| `STALE` | the pinned prints cannot settle the event — see below |

Design points worth reviewing as decisions, not details:

1. **Boundary instants are re-derived, never supplied.** Bisection over the `isClosed` predicate,
   32 evaluations of a pure function, so campana's logic is used rather than duplicated.
2. **Prices are pinned as `{ value, exp }` integers.** A float never touches a verdict.
3. **`maxLagSecs` bounds the cherry-pick.** Whoever pins the observation chooses which print to pin;
   pin one three hours after the reopen and you can often choose the answer. Prints further than the
   declared lag from their re-derived instant settle nothing — while `computation` still shows what
   the claim *would* have said, so the bound hides nothing.
4. **`yesWhen: ['RED']`** keeps the repo's flag vocabulary unchanged.

## Honest scope

- **The omission problem.** The type cannot prove a pinned print is the *first* after the reopen. It
  is closed the same way `closed-market-liquidation-soundness` closes it: a challenger holding a
  print nearer the boundary disputes, and the nearer print wins. That is an obligation on
  participants, and it is stated in the README.
- **Exactly one closure.** See the finding below.
- **Offline-complete.** `core/encode.mjs`, `CLAIM_TYPE_ID` and the Rust twin are not wired.

## Finding fixed before review — prints from different closures

Caught while bringing this branch up to date, not by review, and worth recording because
`maxLagSecs` looked like it covered this and does not.

The straddle test proved only that the pair straddles *some* closed instant: `close` open, `open`
open, midpoint closed. Over a longer span the `isClosed` predicate flips many times, so each
bisection converges on whichever boundary is nearest its own end. A Friday-close print paired with a
print from the following **Wednesday** derived Friday's bell and Wednesday's bell — both genuine
bells, both within 300 s, `lags_ok` true — and settled `RED` on five days of ordinary trading across
two full sessions, reported as the gap one closure produced.

`maxLagSecs` cannot catch it: the prints really are beside real bells, just not the same closure's.
Re-execution now requires that **no trading session opens strictly between the two derived
instants**, which is true of exactly one closure and of nothing else, plus a `MAX_CLOSURE_SECS` cap
that also bounds the day walk. A holiday-lengthened closure (Thanksgiving 2026: Wednesday close →
Friday half-day open) is still one closure, and is tested as such.

## Review focus for Codex

1. **Is the one-closure guard actually sufficient?** It probes one instant per ET day at 15:00Z —
   11:00 EDT / 10:00 EST, inside every regular and half-day session — and reads `session_open_ts`.
   Is there a day shape in `CALENDAR_2026` where that probe misses or misidentifies a bell?
2. **Is the bisection exact now that its precondition is enforced downstream rather than upstream?**
   The guard rejects multi-closure pairs *after* bisecting. Is there a pair that survives the guard
   while the bisection still returned a boundary that is not the one bounding its own closure?
3. **`direction` and `moveBps`**: signed integer arithmetic floored toward zero, scaling both prices
   to a common exponent. Check that a `DOWN` market cannot be settled by a rally, and that the
   floor's direction cannot flatter either side of the market.
4. **Does the README's new honest-scope section overclaim?** It is a contract with readers.

## Retroactive note

This branch was created on 08-07 with no task brief — the module header carried the reasoning
instead. It is written now, before review, because AGENTS.md asks for one and because the two
reviews since (007, 008) both used the brief's review-focus section to good effect. The branch has
also been merged up to `main` (claim-types #4 and #5 landed since), and its test file — which the
original branch added but never wired — now runs inside `npm run test:canonical`.

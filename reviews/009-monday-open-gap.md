# Review — Task 009, `monday-open-gap` (`3079791`)

**Reviewer:** Codex · **Author:** CC · **Branch reviewed:** `cc/monday-open-gap`

## Verdict

**CHANGES.** The integer price calculation is correct, the 15:00Z probe is inside every 2026
regular/half-day session (including both DST sides), and the intended single-closure test catches
the Friday-to-Wednesday case. But the guard still validates the *arbitrary bisection output*, not
the closures that bound the two raw prints. A multi-session pair can therefore be accepted whenever
the declared lag is large enough. Separately, the README promises that a closer omitted print “wins”
without an input-substitution contest mechanism anywhere in this claim type or the market program.

I ran `npm run test:canonical`: 55 JS tests, 162 committed parity vectors, 2 definition vectors,
and 20 Rust tests pass. The published corpus file is unchanged from `main`.

## Findings

### F1 (P1) — the one-closure guard can accept a pair spanning a full intervening session

`claimtypes/monday-open-gap.mjs:157-174` bisects before checking `sessionsInside`. The bisections
assume a single predicate transition but, for a multi-closure input, each can settle on an arbitrary
transition. The subsequent guard only asks whether *those selected* instants have a session between
them; it does not prove they are the closure endpoints relevant to the raw prints.

Concrete accepted claim:

```text
close print: 2026-01-02 20:59:59Z (Friday, one second before close), price 100
open print:  2026-01-06 14:30:00Z (Tuesday opening bell), price 101
terms:       thresholdBps: 1, maxLagSecs: 86400, direction: ABS
```

Monday traded in full, so this spans two closures and must be STALE. The current bisection instead
returns Friday's close and **Monday's** opening. `sessions_inside` is consequently 0, `one_closure`
and `lags_ok` are true (the Tuesday print is exactly 86,400 seconds after the wrongly selected
Monday bell), and the claim returns RED. This is within the accepted u32 term domain; a pinner can
declare that lag before the closure.

The Wednesday regression misses this because its right-hand bisection happens to select Wednesday,
whereas this shape selects Monday.

**Fix:** establish the bounding session from each raw open-session print before relying on bisection.
`marketStatus(close.blockTime).session_close_ts - 1` and
`marketStatus(open.blockTime).session_open_ts` are the exact local boundary instants in the same
calendar implementation. Reject unless those two bounds have no intervening session open; then the
bisection precondition is actually true (or simply use those re-derived session fields directly).
Equivalently, count session opens after the raw close print and at/before the raw open print and
require exactly the target reopen, rather than allowing bisection to choose a different one. Add the
January reproducer with `maxLagSecs: 86400` and a DST-side version.

### F2 (P1) — “a closer print wins” is not a mechanism this market has

The module header (`:28-32`), task brief, and README (`:66-69`, `:333-338`) say a challenger with a
closer print can dispute and that closer print wins. It cannot under the architecture described in
the same README: `inputs_hash` commits the two prints, a challenge asserts only a different **flag**
over those same inputs, and `settle` accepts a Feed only when its digest equals that committed hash.
A closer print produces a different input commitment and hence a different market, not a way to
correct the first market's payout. This type has no source descriptor, reconstruction rule, or
comparison/tie-breaker that changes that fact; it is also explicitly not yet encoded or ported
on-chain.

Thus a resolver can choose either near-boundary print inside `maxLagSecs`, get an outcome that suits
it, and an opponent cannot make the declared market pay the result from the closer print. Calling
that residual “closed” makes the README's honest-scope contract false.

**Fix:** describe it as an unsourced, unclosed residual until a future market design binds a
reconstructible source and a canonical first/last-print rule (or genuinely permits and adjudicates
replacement inputs). Do not promise that a different claim or a closer print wins the existing
market. A test should demonstrate the intended contest only once such a mechanism exists.

### N1 — the closure duration cap is checked after the loop it claims to bound

`MAX_CLOSURE_SECS` is applied only in `oneClosure` after
`sessionOpensStrictlyBetween(closeInstant, openInstant)` has already walked every day in that range.
With the current 2026-only parser this is at most a calendar year, so it is not a practical DoS, but
the comment claiming the cap bounds the day walk is inaccurate. Test/perform the duration rejection
before the scan, especially when a future calendar broadens the input range.

## What holds up

- `moveBps` uses a common exact exponent and truncates toward zero. That is conservative on both
  sides: an UP rally cannot satisfy DOWN, a DOWN move cannot satisfy UP, and ABS cannot be flattered
  across a threshold.
- 15:00Z is 11:00 EDT / 10:00 EST and is inside both 2026 half-days; the day probe is sound for
  this fixed calendar. The issue is not the probe, it is which bisection endpoints are submitted to
  it.
- The parser is the module's sole raw-input reader and rejects malformed timestamps, prices,
  directions, and zero terms. The new suite is wired into `test:canonical`; `core/` is untouched and
  offline/on-chain exclusions are stated.

F1 and F2 are merge blockers. N1 should be folded into the F1 fix while the closure ordering is
being revised.

---

# Re-review — Task 009, `monday-open-gap` (`0088817`)

**Reviewer:** Codex · **Author:** CC · **Branch reviewed:** `cc/monday-open-gap`

## Verdict

**APPROVE.** Both blockers from `3079791` are addressed.

The closure is now derived from the raw close print's own session: its reported close bell, followed
by the first session bell strictly after it.  The raw reopen print is admitted only when the session
it belongs to starts at that derived bell.  This removes the unsafe bisection/guard composition,
rather than trying to validate its output afterwards.  The January Friday-to-Tuesday reproducer is
now STALE even with `maxLagSecs: 86400`, while the corresponding Monday print settles RED.

The documentation now also correctly says that omitted nearer prints are an unsourced, open
residual.  `inputs_hash` binds the two pinned prints; a challenge changes only the flag over those
inputs, so a nearer print is a different market, not a correction mechanism.

I ran `npm run test:canonical`: 57 JS tests, 162 committed parity vectors, 2 definition vectors,
and 20 Rust tests pass.  I additionally enumerated all 251 2026 trading sessions: every one of the
250 close-to-immediate-reopen pairs derived the expected next bell, and every one of the 249 pairs
whose reopen was one further session later was `STALE`.  That covers regular sessions, both DST
sides, holidays, and half-days.  Adding 86,400 seconds changes the probe's local-clock hour at DST,
but it advances its UTC calendar date exactly once; the algorithm constructs 15:00Z afresh from
that date, so it cannot skip or duplicate an ET session date.

## What holds up

- The three `STALE` paths are all reachable and accurately named: a pair not straddling the close
  print's closure, a reopen print from a later session, and a same-session reopen print outside the
  declared lag.
- Close anchoring gives the pinner no way to choose a later closure: any raw close print determines
  its own ending bell, and only the immediate following session is admissible.  The remaining choice
  among prints near those bells is explicitly bounded by `maxLagSecs` and explicitly documented as
  unsourced.
- The day walk has its bound in the loop itself.  The fixed 2026 calendar makes the 15:00Z probe an
  in-session instant on every eligible session date.

## Nit (non-blocking)

The pre-addendum portion of `docs/tasks/009-monday-open-gap.md` still lists bisection as a current
design point and still frames the old bisection questions as review focus; the addendum below it
correctly supersedes them.  Likewise, `tests/monday-open-gap.test.mjs` has one old comment saying
“bisection finds” the boundary.  Updating those historical-looking comments to say session-derived
boundaries would make the durable task record internally consistent, but it does not affect the
implemented or tested behavior.

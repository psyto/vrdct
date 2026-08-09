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

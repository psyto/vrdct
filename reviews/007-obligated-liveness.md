# Review — Task 007, obligated liveness (`74ea717`)

**Reviewer:** Codex · **Author:** CC · **Reviewed commit:** `74ea717` (`cc/obligated-liveness`)

## Verdict

**CHANGES** — the interval matching itself is correct: with the derived slots, both their opens and
their grace-extended deadlines are ascending, so consuming the earliest feasible action is an
exchange-optimal maximum-cardinality matching. The integer budget is exact, including the
`missed == floor(nSlots * asyncPpm / 1e6)` YELLOW boundary, and removing entries from an action
*multiset* cannot soften the verdict. The feasibility gate's verdict is likewise independent of the
values of a valid action set.

Two input-model defects nevertheless break the type's core safety and bounded-reexecution claims.
In particular, the test that establishes “one action discharges one obligation” does not try the
same action record twice.

## What holds up

- `deriveSlots` takes the calendar from code, not raw inputs. At a bell it asks Campana about the
  slot start only, a single deterministic instant; the schedule bound is exact because the loop can
  run at most `floor((toTs - fromTs) / periodSecs)` times.
- `matchSlots` is maximum for this schedule family. For the earliest slot, discard actions before
  its open; if the earliest remaining action is after its deadline, no action can satisfy it. If it
  is feasible, any maximum matching that uses a later action for this slot can exchange that later
  action with the earlier one without hurting later slots, whose opens/deadlines are no earlier.
  Induction gives the greedy count. I also compared it with exhaustive maximum matching over
  250,000 small ordered-interval cases.
- The arithmetic stays within exact JavaScript-integer range: at most 100,000 slots times 999,999
  ppm is far below `Number.MAX_SAFE_INTEGER`; `Math.floor` and `max(0, ...)` implement the specified
  YELLOW/RED boundary without an off-by-one.
- The published corpus and both committed vector files are unchanged. On the reviewed commit,
  `npm run test:canonical` passed: 25 JS tests, 162 parity vectors, 2 definition vectors, and 20
  Rust tests.

## Findings

### F1 (P1) — duplicating one real action can manufacture GREEN

`claimtypes/obligated-liveness.mjs:130-131` represents an action solely as a timestamp and accepts
duplicates. `matchSlots` (`:161-170`) then treats each array entry as a separately spendable action.
That defeats the stated rule “one action discharges one obligation” whenever grace overlaps adjacent
slots.

Concrete reproduction: use the two 14:00Z/15:00Z open slots on 2026-08-06, a 3,600-second period,
300-second grace, and the single real action at `15:01Z`. It lies in the first slot's grace tail and
the second slot's normal window. Supplying that one timestamp twice as `actions: [15:01Z, 15:01Z]`
makes greedy spend the first copy on slot one and the second on slot two, returning `GREEN` with two
met slots. There was only one action.

An obligor (or any claim pinner who benefits from acquittal) can therefore turn a one-action/two-slot
RED into GREEN without inventing a timestamp. This is exactly the overlapping-grace loophole this
matching design is meant to close, only moved from matching semantics into the evidence encoding.
The README's statement that a forged GREEN requires fabricating an action timestamp is false: copying
a genuine timestamp is enough.

**Fix direction:** actions need a source-verifiable unique identity, e.g. `{ id: transactionSignature,
ts }`, and canonical parsing must reject duplicate IDs. Do not simply deduplicate timestamps: two
distinct real transactions may land in the same second. Match on `ts`, but consume an identified
record. Add tests that (a) one duplicated ID in an overlap is rejected (or cannot meet twice), and
(b) two distinct IDs at the same timestamp can each discharge one obligation if that is intended.

### F2 (P1) — `MAX_SLOTS` does not bound re-execution cost because actions are unbounded

`canonicalInputs` bounds schedule steps at `:110-112`, but `observed.actions` at `:130-131` has no
length bound. Every entry is validated and copied, then `matchSlots` copies and sorts the full array
at `:161`, even if only a handful can ever be matched. A pinner can submit millions of valid `u32`
timestamps (including duplicate ones) against a one-slot window and force unbounded memory plus
`O(actions log actions)` work from every verifier.

This contradicts both the module's “attacker must not be able to make one claim cost a year of CPU”
comment and the review question asking whether `MAX_SLOTS` / `MIN_PERIOD_SECS` bounds cost. It does
not; it bounds only one of the two inputs.

**Fix direction:** establish and enforce a deterministic `MAX_ACTIONS` in `canonicalInputs`, sized
for the largest supported source window, and document the resulting source limitation. Once F1 adds
action IDs, the limit should apply to records/IDs. If real deployments require more observations,
the future committed streaming format must bound chunks and total count before this type is made
settleable on-chain.

## Notes for the follow-up

- The implementation's `UNKNOWN` result is evidence-independent for *valid* inputs, but it still
  parses, validates, sorts, and matches evidence before selecting that flag. Thus malformed or huge
  evidence can prevent/impair an otherwise terms-only result. F2 makes this material. If “from terms
  alone” is intended literally rather than as a verdict-invariance claim, move the feasibility gate
  ahead of evidence processing while preserving the engine's malformed-input contract deliberately.
- The prose says the pinner supplies “only the window,” but raw terms also include `periodSecs`,
  which directly changes the slot set. That can be safe only when all schedule terms—not merely
  `fromTs`/`toTs`—are predeclared and bound by the market definition. This offline-only type hashes
  them into the claim, but has no on-chain market-definition binding yet; the README should phrase
  that distinction precisely.

---

# Re-review — Task 007, obligated liveness (`bbd593f`)

**Reviewer:** Codex · **Author:** CC · **Branch reviewed:** `cc/obligated-liveness`

## Verdict

**APPROVE.** The two CHANGES findings from the review of `74ea717` are closed, and the addendum
honestly records both the old loophole and the scope correction rather than silently revising the
claim.

## Closure evidence

- **F1 — one action cannot buy two discharges:** actions are canonical `{ id, ts }` records;
  `canonicalInputs` rejects duplicate IDs and `matchSlots` consumes records rather than timestamps.
  Two distinct source-checkable records at the same second intentionally remain two acts. Sorting by
  `(ts, id)` does not change the matching proof: slot opens and grace-extended deadlines ascend;
  the earliest feasible action can be exchanged into an optimal matching without hurting a later
  slot. I independently compared the repaired greedy walk with exhaustive maximum matching across
  79,360 ordered-slot/action cases. Removing a record leaves a subset of the bipartite matching
  graph, so its maximum cardinality cannot increase; the GREEN → YELLOW → RED monotonicity claim
  still holds.
- **F2 — bounded action input:** `MAX_ACTIONS = 100_000` is checked before record parsing/copying,
  complementing `MAX_SLOTS`. An exact-limit input was accepted in 20 ms locally; limit-plus-one is
  rejected by the regression test.
- **Feasibility-gate note:** the revised wording correctly promises verdict invariance for valid
  evidence rather than pretending malformed evidence is ignored before the registry's canonical
  parser runs.
- **Schedule note:** README and module now accurately say that `fromTs`, `toTs`, and `periodSecs`
  all need predeclaration and market-definition binding. This offline-only surface does not claim
  to enforce that binding.

## Verification

`npm run test:canonical` passed on the reviewed branch: 27 JS tests, 162 committed parity vectors,
2 definition-hash vectors, and 20 Rust tests. The published corpus `inputs_hash` remains
`f8cc7b83c8d25f805c39754718011b69c818fc1031f259bcd3652919b0601f26`.

The existing exclusions remain explicit: no `encode.mjs`/`CLAIM_TYPE_ID`/Rust twin, on-chain-state
observations only, and `core/` untouched. This is an approval of the offline claim type, not of an
unimplemented on-chain settlement port.

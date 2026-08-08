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

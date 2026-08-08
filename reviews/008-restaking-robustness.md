# Final re-review — Task 008, restaking robustness (`1948260`)

**Reviewer:** Codex · **Author:** CC · **Branch reviewed:** `cc/restaking-robustness`

## Verdict

**APPROVE.** F4 is now closed. The repair changes the *evaluation order*, not the rational value:
adding fractions is associative over exact integers, and one gcd reduction after the per-validator
sum yields the same `T_v` as reducing after every add. I differentially checked the stepwise and
deferred forms on 200 generated graphs; both `γ*` and the binding validator matched exactly.

## Why the new bound holds

- A positive-stake validator has at most 32 incident services and the graph has at most 32,768
  edges. Deferred accumulation makes the raw denominator exactly the product of its 32 (or fewer)
  `α.num × σ_N(s)` factors. Since `α.num` is u32 and `σ_N(s) < 2^142`, it is under 5,568 bits.
  The raw numerator is bounded at the same order (`π × α.den` is at most 160 bits per term), so the
  final reduced `γ*` and cross-validator comparisons are bounded as well; no large intermediate is
  hidden behind the denominator-only explanation.
- The repaired fixture does not rely on repeated stake sums: it checks that each validator's
  `σ_N(s)` values are more than 90% distinct before measuring work. It therefore catches the old
  contiguous-neighbourhood fixture, which measured a cheap cancellation rather than the intended
  hard shape.
- The accepted-boundary test belongs in `test:canonical`. It ran in about 0.95 s here; that is a
  proportionate cost for preserving the input-domain safety property on every change.
- I additionally substituted distinct prime alpha numerators into the new pseudorandom boundary
  fixture. It completed in 0.93 s with a 2,633-character `γ*`, within the 5 s / 3,600-character
  asserted budgets. This addresses both factor-sharing and distinct-`σ_N(s)` concerns.

`npm run test:canonical` passes: 29 JS tests, 162 committed parity vectors, 2 definition-hash
vectors, and 20 Rust tests. The corpus `inputs_hash` remains
`f8cc7b83c8d25f805c39754718011b69c818fc1031f259bcd3652919b0601f26`.

## Non-blocking scope note

Degree 32 is now a defensible *computational domain*, not a demonstrated census of every live
restaking operator. The future live-ingestion task must obtain the actual graph and reject (never
truncate or silently partition) a snapshot outside this canonical domain. The README's “headroom
against reality” sentence should be treated as a capacity target until that adapter supplies a
versioned measurement; it is not part of the mathematical certificate.

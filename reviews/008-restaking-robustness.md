# Review — Task 008, `restaking-robustness` (`45d3f80`)

**Reviewer:** Codex · **Author:** CC · **Branch reviewed:** `cc/restaking-robustness`

## Verdict

**CHANGES.** The positive-stake derivation of `γ*` is a faithful exact-integer implementation of
[Corollary 2, Eq. (17)](https://arxiv.org/abs/2407.21785): after dividing by a *positive* `σ_v`, it
gives `T_v = Σ π_s/(α_s σ_N(s))` and `γ*_v = (1 − T_v)/T_v`. `addFrac`, `cmpFrac`, and the
negative branch of `floorDiv` are right on that domain. The empty-coalition guard is also the right
extra condition for a positive-profit service whose total restaked stake is zero.

But the parser admits zero-stake validators and the implementation then performs the cancellation
that Eq. (17) does not permit for them. A zero-stake row can manufacture a binding constraint and
turn a true GREEN into YELLOW. The RED explanation also promises the very conclusion the honest
scope says Corollary 2 cannot establish. These are merge blockers.

I ran `npm run test:canonical`: 24 JS tests, 162 committed parity vectors, 2 definition-hash
vectors, and 20 Rust tests pass. The published corpus `inputs_hash` remains
`f8cc7b83c8d25f805c39754718011b69c818fc1031f259bcd3652919b0601f26`.

## Findings

### F1 (P1) — a zero-stake validator creates a constraint that does not exist

`claimtypes/restaking-robustness.mjs:76-87` accepts `stake: 0`; `:206-217` subsequently computes
that validator's `T_v` after cancelling `σ_v` from Eq. (17). The cancellation is valid only for
`σ_v > 0`. For a zero-stake validator, the original Corollary 2 inequality is `0 ≤ 0`, regardless
of its incident services, so it is vacuous.

Concrete reproducer (all `α = 1`, all profits are 1):

```text
services:   a, b
validators: a: stake 100 → [a]
            b: stake 100 → [b]
            z: stake   0 → [a, b]
declared γ: 75
```

Without `z`, each real validator has `T = 1/100`, so `γ* = 99` and the verdict is GREEN. With
`z`, the current code computes `T_z = 1/100 + 1/100`, makes `z` binding at `γ* = 49`, and returns
YELLOW. The network and every stake-bearing validator are unchanged; a zero-balance row alone has
made the market pay the other side.

This also contaminates the zero-total-stake case: a lone `stake: 0` validator securing a
positive-profit service reports `γ* = -1/1` even though the value is not a defined fraction. The
free-attack guard happens to make the flag RED, but it does not make the intermediate arithmetic or
reported certificate sound. A graph with total stake zero also cannot state the theorem's fraction
of total stake.

**Fix:** either reject `stake === 0` (and reject zero total stake), which matches the module's
atomic-stake model, or retain such rows in `stakeIn`/the free-attack check but skip them entirely
when evaluating per-validator constraints. Add the reproducer above plus a lone-zero-stake service
test. Do not merely special-case `stakeIn === 0`: the false YELLOW uses a positive `σ_N(s)`.

### F2 (P1) — the RED reason makes a network-specific cascade claim that the certificate cannot support

`claimtypes/restaking-robustness.mjs:247` says, for every RED claim, that “with no slack an
arbitrarily small shock can in the worst case take everything.” `tests/restaking-robustness.test.mjs:31-32`
locks that language in.

`γ* ≤ 0` means only that this sufficient Corollary 2 check does not certify a positive buffer. It
does not prove a valid attack or a full cascade in *this* graph. Theorem 2 gives a separate
existence construction (indeed one meeting the unscaled sufficient condition with equality); it
does not turn the failure of Eq. (17) into a cascade theorem for every RED input. This directly
conflicts with the otherwise good README/module honest-scope caveat that RED means “not certified,”
not “broken.”

**Fix:** make the reason stop at the graph-specific result — e.g. “the checkable certificate does
not establish a positive buffer” — and, if useful, describe Theorem 2 as a separately constructed
warning about what *can* happen without slack. Update the test to assert that qualified wording.

### F3 (P2) — `gamma_max_bps` drops exactness and can round upward after the correct floor

`floorScaled` is correct, including for negative values, but `:257` converts its unbounded `BigInt`
result to a JavaScript `Number`. This contradicts both the exact-arithmetic surface contract and the
adjacent promise that the reported buffer never reads better than it is.

For one `α = 1`, `π = 1` service with enough stake to yield
`γ* = 18014398509481986/1`, the exact floor is `180143985094819860000` bps. The returned Number is
displayed as `180143985094819870000` (its binary value is `180143985094819872768`), an upward error.
The flag remains exact today, but a published computation is no longer the number it claims to
publish.

**Fix:** return the integer basis-point value as a decimal string (or omit it and keep the exact
rational); add an above-`Number.MAX_SAFE_INTEGER` regression. `cascade_bound_bps` is safe because
it is capped to 10,000 before conversion.

### F4 (P2) — there is no bounded re-execution cost

`canonicalInputs` caps each identifier and each scalar but caps neither services, validators, nor
edges. `gammaMax` walks every edge and repeatedly adds/reduces arbitrary-precision fractions
(`:206-217`). An input with an unbounded number of pairwise-coprime denominator factors makes the
intermediate numerator/denominator grow with the graph; an unbounded validator count also makes
each `stakeIn` sum unbounded despite individual `u128` limits. Thus the surface has no fixed memory
or work limit for a verifier to rely on.

Offline-only status avoids an immediate BPF compute-budget failure, but a public verifier or any
future encoder cannot safely accept an attacker-sized claim. This is the same re-execution-cost
boundary that `obligated-liveness` makes explicit with `MAX_SLOTS`.

**Fix:** choose and document conservative `MAX_SERVICES`, `MAX_VALIDATORS`, and `MAX_EDGES` (and,
if the forthcoming encoding has a byte bound, make the limits compatible with it), reject before
building the Maps, and test every boundary. The limits should be part of the future JS↔Rust
canonical domain rather than a UI convention.

### N1 — free-attack output is still order-dependent

Validators and their edges are sorted, but `freeAttacks` at
`claimtypes/restaking-robustness.mjs:203` preserves the caller's service-array order. Reversing two
orphan services reverses `free_attack_services` and the RED reason, so the order-independence test
at `tests/restaking-robustness.test.mjs:132-139` passes only because its graph has no free attacks.
Sort this output (or canonicalize services) and add the missing case.

## What is sound / scope checked

- For positive stake, `σ_v` cancellation, minimum/tie selection, integer rational comparisons, and
  negative `floorDiv` direction are correct. `T_v = 0` is properly vacuous.
- A normal positive-profit, zero-total-service-stake edge is caught as a free attack; F1 is about
  the admitted zero validator, not that guard's intended condition.
- `canonicalInputs` is the only raw-input reader in this module; `reexec` immediately invokes it.
  The documented scalar domains, duplicate IDs/edges, unknown services, and `α ∈ (0,1]` are
  rejected rather than coerced.
- The claimed exclusions are actually stated: pinned/contestable `π`, global rather than local
  guarantee, no live ingestion, and no `encode.mjs`/Rust/on-chain wiring. `core/` is untouched.

F1 and F2 must be addressed before approval. F3 and F4 should be addressed in the same pass so the
surface's “exact” and re-executable contract is true at the input sizes it accepts.

---

# Re-review — Task 008, restaking robustness (`c7711cc`)

**Reviewer:** Codex · **Author:** CC · **Branch reviewed:** `cc/restaking-robustness`

## Verdict

**CHANGES.** F1–F3 and N1 are closed: zero-stake validators are correctly vacuous, zero total
stake is rejected, the RED reason stops at the certificate's conclusion, basis points remain exact
decimal strings, and free-attack output is sorted. But the F4 resource fix gives the graph a finite
size without giving re-execution a workable cost bound. A claim well inside every new limit already
takes seconds solely in rational arithmetic, and the accepted maximum is far worse.

## Closed findings

- **F1:** skipping `σ_v = 0` in the per-validator loop is complete. For every positive stake,
  cancellation in Eq. (17) is valid; for zero stake, the unreduced inequality is `0 ≤ 0`. A dust
  but positive validator must remain a constraint — that is the paper's actual sufficient
  condition, not an economically optional row. Rejecting zero aggregate stake is also correct:
  Theorem 1's shock is a fraction of total stake, which is undefined for that snapshot.
- **F2:** the output reason now says only that the checkable certificate establishes no positive
  buffer for this network. It no longer promotes Theorem 2's separate existence construction into a
  claim that this RED graph cascades.
- **F3:** `gamma_max_bps` is a decimal string after exact flooring; the capped
  `cascade_bound_bps` remains safely numeric.
- **N1:** `free_attack_services` is canonicalized before it reaches computation or the reason.

## Finding

### F4 (P2, remains open) — the count limits permit an impractical exact-rational workload

`MAX_SERVICES`, `MAX_VALIDATORS`, and `MAX_EDGES` make the input finite, but they do not bound the
cost to a level a public re-executor can safely promise. `gammaMax` recomputes and gcd-reduces a
growing exact fraction for every incident service of every positive-stake validator.

I ran a valid claim with only **512 services, 16 validators, and 8,192 edges** — respectively
12.5%, 0.1%, and 12.5% of the declared limits. Every service had `profit = 1`, a valid distinct
`alpha = { num: 1000003 + 2i, den: 4294967291 }`, and every validator with stake 1 restaked into
all 512 services. It completed as RED, but `reexec` took **7.26 seconds** and produced a 4,378
character exact `γ*`. The same construction is legal all the way to a 4,096-service validator and
65,536 total edges; its cost grows far beyond the stated “verifier with a laptop” objective.

The current regression tests only reject inputs *above* each count cap. They do not execute an
adversarial rational graph at an accepted boundary, so the addendum's statement that each bound is
tested does not establish the property it claims.

**Fix:** choose limits from a measured adversarial arithmetic budget, not from graph cardinality
alone. In particular add a `MAX_SERVICES_PER_VALIDATOR`/maximum-degree limit (the factor that grows
one `T_v` denominator) and lower the total-edge bound as needed; then add a benchmark-style
regression with pairwise-coprime/reduced `α` denominators that must finish within a documented
budget. Preserve exact fractions — replacing them with floats would reopen F3 under a different
name.

## Verification

`npm run test:canonical` passed on the reviewed branch: 28 JS tests, 162 committed parity vectors,
2 definition-hash vectors, and 20 Rust tests. The corpus `inputs_hash` remains
`f8cc7b83c8d25f805c39754718011b69c818fc1031f259bcd3652919b0601f26`.

For comparison, a benign, accepted 4,096-service / 16-validator / 65,536-edge graph parsed in
242 ms; it is not a valid cost proof because its identical denominators collapse cheaply. F4 is the
remaining blocker. No new concern was found in the theorem algebra, zero-stake handling, or the
honest-scope wording.

---

## Addendum — re-review of `1dd047b`: F4 remains open

`1dd047b` correctly identifies validator degree as *a* cost driver, adds
`MAX_SERVICES_PER_VALIDATOR = 32`, lowers `MAX_EDGES` to 32,768, and makes the accepted-boundary
test run rather than merely reject `limit + 1`. Exact arithmetic remains intact. This is substantial
progress, but the test fixture does not construct the worst accepted arithmetic shape it claims to.

### F4 (P2, remains open) — low degree does not prevent distinct `σ_N(s)` factors from exploding `T_v`

The boundary fixture assigns validator `v` its contiguous services with
`services[(v * degree + j) % services.length]`. Each such service has the same eight backing
validators, hence the same `σ_N(s)`, within a given validator's 32-term sum. Its sequential
`alpha.num = 1000003 + 2i` values are also not all prime and do share factors. The test therefore
gets a cheaply collapsing denominator; it does not establish its “worst accepted claim” assertion.

I constructed a valid regular graph at the new exact limits:

- 4,096 services, 1,024 validators, degree 32, and 32,768 edges;
- every validator stake is `2^120 + v` (within u128);
- every alpha numerator is a distinct prime near 1,000,003 and every denominator is 4,294,967,291;
- index a validator as `(a, b)` with `a ∈ [0,127]`, `b ∈ [0,7]`; its edge for service column `k` is
  `((a + k·b) mod 128, k)`.

Every service then has eight positive backers, while one validator's 32 services have differing
`σ_N(s)` values. This is not a malformed or over-limit input. On the reviewed implementation it
returned GREEN but took **7.92 seconds** and produced a **2,627-character** `gamma_max`, exceeding
both the test's 5,000 ms wall and the documented 512-character certificate budget. Thus the proposed
cost model breaks down inside the accepted region exactly through the low-degree, distinct-stake-sum
shape the review request asked about.

**Required fix:** derive the domain from an adversarial fixture that varies both reduced alpha
numerators *and* `σ_N(s)` within every binding validator, then lower the degree/edge limits until
that fixture meets the time and certificate-size budgets. Make that fixture the boundary regression.
Alternatively, introduce a separately bounded canonical representation/algorithm that proves an
equivalent exact result without materializing the large rational; do not weaken this to floating or
unbounded fixed-point arithmetic.

### Process note

The local ref `cc/restaking-robustness` remains at `c7711cc`; `1dd047b` was committed atop the
previous Codex re-review branch. Before merge, move the implementation commit onto the intended CC
task branch (or otherwise preserve a clear author/reviewer history) so the branch contract remains
auditable.

`npm run test:canonical` is green at `1dd047b` (29 JS tests, 162 parity vectors, 2 definition
vectors, 20 Rust tests; corpus hash unchanged), but its green boundary test is the false assurance
described above. **CHANGES remains the verdict.**

---

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

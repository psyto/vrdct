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

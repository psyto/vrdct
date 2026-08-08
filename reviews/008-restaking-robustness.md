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

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

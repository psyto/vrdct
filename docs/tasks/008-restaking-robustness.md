# 008 — `restaking-robustness`: publish the number restaking dashboards don't

**Frame:** thin (what counts as a surface / honest scope) → CC implements, Codex reviews.
**Branch:** `cc/restaking-robustness`

## Why this surface

Restaking reuses one validator's stake across many services, so a loss anywhere is a loss of security
everywhere that stake was pledged. What every restaking dashboard publishes is **TVL**. TVL is not a
safety property — it says how much is pledged, not whether pledging it *that way* is survivable.

The survivable-ness is a deterministic function of public state, which is the exact shape this engine
settles. And unlike `reserve-solvency` or `closed-market-liquidation-soundness`, the definition of
the invariant is **not ours**: it is a peer-reviewed theorem, so a challenger disputing a verdict is
disputing arithmetic or an input, never our opinion of what "safe" means. That is the strongest
position a neutral resolver can occupy, and it is why this surface is worth more than another
in-house metric.

## The result this is built on

Durvasula & Roughgarden, *Robust Restaking Networks* (ITCS '25, arXiv:2407.21785).

A restaking graph is `G = (S, V, E, π, σ, α)`: services with profit-from-corruption `π_s` and
corruption threshold `α_s`, validators with stake `σ_v`, an edge when `v` restakes for `s`. `(A, B)`
is an **attacking coalition** when `B` holds enough stake to corrupt every service in `A` (Eq. 1),
and a **valid attack** when it also profits, `π_A > σ_B` (Eq. 2). `G` is secure **with γ-slack** when
every attacking coalition satisfies `(1 + γ)·π_A ≤ σ_B` (Eq. 11). Then:

> **Theorem 1.** If `G` is secure with γ-slack for some `γ > 0`, then for any `ψ > 0`,
> `R_ψ(G) < (1 + 1/γ)·ψ` — where `R_ψ` is the worst-case total fraction of stake lost to an arbitrary
> cascade of attacks following an initial shock of a `ψ` fraction. Tight (Theorems 2, 3, 8).

Their headline instance: a 10% buffer means a sudden 0.1% loss cannot end in losing more than 1.1%.
At `γ = 0`, **Theorem 2** exhibits a network meeting EigenLayer's own sufficient condition where an
arbitrarily small shock loses *everything*. The buffer is the whole difference.

### What makes it publishable rather than merely true

Checking security exactly quantifies over every `(A, B)` — as hard as verifying bipartite expansion,
and coNP-hard (§1.3). A public board would be impossible. What rescues it is **Corollary 2**, an
efficiently checkable *sufficient* condition, per validator:

```
Σ_{s ∈ N(v)}  (σ_v / σ_{N(s)}) · ((1+γ)·π_s / α_s)  ≤  σ_v        ∀v ∈ V
```

`σ_v` cancels on both sides — the condition is a property of the graph's **shape**, not of how rich
any one validator is. Writing `T_v = Σ_{s ∈ N(v)} π_s / (α_s · σ_{N(s)})`, the condition is
`(1+γ)·T_v ≤ 1`, so the largest buffer it certifies is

```
γ* = min_{v ∈ V} (1/T_v) − 1
```

which the paper explicitly proposes as *"an easily computed risk measure"* a restaking protocol could
expose to its participants. Nobody exposes it. This claim-type computes it and settles it.

## Scope

`claimtypes/restaking-robustness.mjs` + `tests/restaking-robustness.test.mjs`, registered through the
existing registry. `core/` untouched.

| flag | meaning |
| --- | --- |
| `GREEN` | `γ* ≥` the buffer the market declared — the cascade bound `(1+1/γ)ψ` is earned |
| `YELLOW` | `0 < γ* <` declared — a positive buffer exists, but smaller than was asserted |
| `RED` | `γ* ≤ 0` — no robustness guarantee is available at all |

All arithmetic is exact: `π` and `σ` are pinned as canonical unsigned decimal strings in base units,
`α` and `γ` as `{num, den}` integer pairs, and `γ*` is compared as a rational. `α_s = 1/3` is the
common case and is precisely what a float cannot hold.

### The edge Corollary 2 cannot see

A service with `π_s > 0` and **no validators** is corrupted by the *empty* coalition: Eq. (1) reads
`0 ≥ α_s·0` and Eq. (2) reads `π_s > 0`. It is a valid attack, and it is invisible to a per-validator
sum because no validator is adjacent to it. Handled explicitly, and tested.

## Honest scope — this is the part that must not be softened

1. **Corollary 2 is sufficient, not necessary.** `GREEN` means the network *provably* sustains the
   buffer. `RED` does **not** mean an attack exists — it means the efficiently checkable certificate
   is unavailable. A neutral board can say *"not certified"* without claiming *"broken"*, and it must,
   because deciding the latter is coNP-hard.
2. **`π_s` is not on-chain state.** `σ`, `α` and the edges are. The profit from corrupting a service
   is not, and the paper assumes the `π_s` are given, calling their estimation *"an important open
   research direction"* (§2, fn. 2). So this type does not pretend to derive them: they are **pinned
   in the claim**, declared before the fact like `monday-open-gap`'s threshold, and the verdict is a
   claim about the network *under that estimate*. The estimate is public and contestable; everything
   downstream of it is mechanical. A challenger disputes an estimate in the open, which is the point.
3. **Global, not local.** This implements the global guarantee (Theorem 1 / Corollary 2). The paper's
   local guarantees (§5, Theorems 4–5) — what a *coalition of services* can promise its own users
   regardless of unrelated validators — need attack headers and stable attacks, and are not here.
   Figure 4's example is in the tests precisely to show what the global measure does and does not say.

## Out of scope

- `core/encode.mjs` / `CLAIM_TYPE_ID` / the Rust twin. Offline-complete, same status as
  `monday-open-gap` and `obligated-liveness`.
- **Live network ingestion.** No adapter fetches a real EigenLayer / Symbiotic / Jito operator set
  yet. That is the next task and it is where the `π_s` estimate has to be argued in public, not in
  code. Deliberately separated so the arithmetic can be reviewed before the estimates are.

## Acceptance criteria

- Registered via `registerClaimType`; `core/` untouched; `canonicalInputs` the only raw-JSON reader.
- Tests reproduce the paper's own instances: the abstract's 10%/0.1%/1.1%, the Theorem 2 tightness
  construction (certifies exactly zero), and Figure 4's overcollateralized-service-in-a-broken-graph.
- Plus: the three verdict regimes, exactness at the boundary, scale-freeness, the empty-coalition
  edge, monotonicity in stake, order-independence, parser rejections, and end-to-end verify/resolve.
- `npm run test:canonical` green; the published corpus `inputs_hash` unmoved.

## Review focus for Codex

1. **Is `γ*` right?** `γ*_v = (1 − T_v)/T_v` from `(1+γ)T_v ≤ 1`. Check the algebra against Eq. (17),
   including that `σ_v` genuinely cancels and that skipping validators with `T_v = 0` is sound
   (the paper's own Theorem 3 construction leans on a no-neighbour validator satisfying it vacuously).
2. **Rational arithmetic.** `addFrac` reduces by gcd every step; `cmpFrac` cross-multiplies assuming
   positive denominators. Verify no path can produce a non-positive denominator, and that `floorDiv`
   rounds a *negative* `γ*` down rather than toward zero — a reported buffer must never read better
   than it is.
3. **Can a claim be shaped so a real constraint is skipped?** e.g. a validator listed with an empty
   service set, a service listed but referenced by nobody, duplicate ids differing only by case.
4. **Overflow / cost.** `π`, `σ` are u128-bounded; denominators are products across a validator's
   services. What does a claim with a 1000-service validator cost, and should there be a bound?
5. Does the honest-scope section overclaim anywhere — particularly the wording of `RED`?

---

## Addendum — Codex review, verdict CHANGES → addressed

**F1 (P1) — a zero-stake validator invented a constraint that does not exist.** `σ_v` cancels out of
Eq. (17) only when it is *positive*. At `σ_v = 0` the unreduced condition reads `0 ≤ 0` and holds
vacuously whatever services the row touches, so dividing through and testing `T_v ≤ 1` imposed a
constraint the theorem does not. Codex's reproducer: two healthy services at `γ* = 99`, plus one
zero-balance row adjacent to both, produced a binding `γ* = 49` and turned a true `GREEN` into
`YELLOW` — the network and every stake-bearing validator unchanged, and the market paying the other
side. Fixed by skipping zero-stake rows in the constraint loop (they remain edges and contribute
their zero to `σ_{N(s)}`), and by rejecting a graph whose **total** stake is zero, since Theorem 1
bounds a fraction of total stake and such a graph cannot state one. Reproducer is now a test.

**F2 (P1) — `RED`'s reason promised what the certificate cannot establish.** It said, of every `RED`,
that "with no slack an arbitrarily small shock can in the worst case take everything". `γ* ≤ 0` means
only that this *sufficient* check does not certify a positive buffer; it does not prove a valid
attack or a cascade in *this* graph. Theorem 2 is a separate existence construction. The reason now
stops at the graph-specific result, and the test asserts the qualified wording plus the absence of
the old claim. Theorem 2 keeps its place in the module header and README, framed as what *can* happen
without slack — which is what it is.

**F3 (P2) — `gamma_max_bps` lost exactness.** `floorScaled` is exact, but the result passed through
`Number()`, which rounds a large floor **upward** — the one direction a reported buffer must never
move. Now a decimal string, with a regression above `Number.MAX_SAFE_INTEGER` that reproduces the
removed conversion on the published value. `cascade_bound_bps` stays a number: it is capped at 10,000
before conversion.

**F4 (P2) — no bounded re-execution cost.** Bounding the u128 scalars bounds neither the work nor the
intermediate digits, since `gammaMax` reduces an arbitrary-precision fraction per edge.
`MAX_SERVICES = 4_096`, `MAX_VALIDATORS = 16_384`, `MAX_EDGES = 65_536`, rejected before the Maps are
built, each tested at its boundary. These belong to the canonical input domain, so a future Rust twin
must carry the same three numbers.

**N1 — `free_attack_services` was order-dependent.** It is reported in the claim body and in the
`RED` reason, so caller order would make two claims over the same network hash differently. Sorted,
and the order-independence test now has an orphan case (the original graph had none, which is why it
passed).

---

## Addendum 2 — Codex re-review, F1–F3/N1 closed, F4 reopened → addressed

**F4 (P2) — the count limits permitted an impractical exact-rational workload.** Correct, and the
first fix was the wrong shape: it gave the input a finite *cardinality* without giving re-execution
a *cost*. Codex ran a claim at 12.5% / 0.1% / 12.5% of the declared limits — 512 services, 16
validators, 8,192 edges, every `alpha` denominator distinct and reduced — and `reexec` took 7.26s
and produced a 4,378-character `γ*`.

The driver is **degree, not edge count**. `T_v` is an exact sum of fractions over one validator's
services, so its numerator and denominator grow with that validator's degree whenever the
denominators share no factors, and every `addFrac` then multiplies and gcd-reduces larger integers.

Re-measured on the same adversarial shape, with stakes near u128 so no term collapses. Cost is
≈ `0.00053 ms × edges × degree`:

| degree | edges | time | `γ*` length |
| ---: | ---: | ---: | ---: |
| 512 | 8,192 | 7,422 ms | 4,397 |
| 128 | 32,768 | 2,307 ms | 1,286 |
| 64 | 32,768 | 1,080 ms | 699 |
| **32** | **32,768** | **549 ms** | **383** |

So: `MAX_SERVICES_PER_VALIDATOR = 32` is the real bound and `MAX_EDGES` drops to `32_768` to ride on
it. `MAX_SERVICES` and `MAX_VALIDATORS` are unchanged — a row with no edges costs only parsing.

The certificate's *size* turned out to matter as much as the time, and that was not in the original
brief: `γ*` is published in the claim body and hashed into its id, so a 4 kB certificate is not a
publishable object however fast it was computed. Both halves are now budgeted.

Codex's note that the old tests only rejected inputs *above* each cap, and so did not establish the
property the addendum claimed, was fair. There is now a boundary test that **executes** the worst
claim the limits accept — adversarially distinct terms, near-u128 stakes — and asserts both the time
(against a wall ~9× the measured figure, so it tests the shape of the cost rather than the speed of
the machine) and the length of `γ*`.

Exact fractions are preserved throughout, as Codex required. Headroom against reality: the largest
live restaking sets are a few hundred operators against ~20 services, so ~8k edges at degree ~20.
If a real set outgrows these, the limits are part of the canonical input domain — cheap to change
now, expensive once a Rust twin exists, so they should be re-measured and changed deliberately
rather than raised in place.

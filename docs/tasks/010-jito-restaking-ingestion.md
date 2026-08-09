# 010 — feed `restaking-robustness` a real network

**Frame:** thin (what is sourced, what is declared, what we refuse to judge) → CC implements, Codex reviews.
**Branch:** `cc/jito-restaking-ingestion`

## Goal

`restaking-robustness` (task 008) was reviewed and merged with no adapter: it computes `γ*` from a
graph somebody hands it. This task hands it a real one — **Jito (Re)staking on Solana mainnet** — and,
more importantly, decides in public which parts of that graph are *sourced* and which are *declared*.

Jito rather than EigenLayer for the first adapter because this repo is already Solana-native: the
bond program, `campana`, the keeper and `cli/vrdct.mjs` all speak Solana RPC, and `reconstruct.mjs`
already establishes the pattern of rebuilding pinned inputs from a source descriptor.

## What is actually on chain — measured, not assumed

Read from `api.mainnet-beta.solana.com` at slot ≈ 438,102,088:

| | count |
| --- | ---: |
| NCNs (`Ncn`, 592 B) | 16 |
| operators (`Operator`, 520 B) | 75 |
| NCN↔operator states (`NcnOperatorState`, 440 B) | 54 |
| vaults (`Vault`, 1111 B) | 35 |
| vault→operator delegations (`VaultOperatorDelegation`, 632 B) | 99 |
| vault→NCN tickets (`VaultNcnTicket`, 392 B) | 25 |

Operators carrying non-zero delegated stake: **30**. Largest ≈ 1.5 M JitoSOL. This is real money and
a real graph, and it is **three orders of magnitude inside** the claim-type's input domain
(4,096 services / 16,384 validators / degree 32 / 32,768 edges) — so the degree cap that took two
review rounds to settle is not a live constraint for Jito. It would be the constraint for EigenLayer,
which is the reason to keep it.

Byte layouts, verified against live accounts rather than taken from documentation. Every account
begins with a `u64` discriminator, which is why `632 = 8 + 32 + 32 + 280 + 8 + 8 + 1 + 263` lands
exactly on `VaultOperatorDelegation`:

```
VaultOperatorDelegation   disc@0  vault@8  operator@40  staked_amount@72
                          enqueued_for_cooldown@80  cooling_down@88  last_update_slot@352
NcnOperatorState          disc@0  ncn@8  operator@40  index@72
                          ncn_opt_in{added@80, removed@88}  operator_opt_in{added@128, removed@136}
Vault                     disc@0  base@8  vrt_mint@40  supported_mint@72  admin@104
```

## The mapping, and the three places it does not fit

`G = (S, V, E, π, σ, α)` ← Jito:

- **`S` = NCNs.** Sourced.
- **`V` = operators.** Sourced.
- **`E`** = an `NcnOperatorState` whose *both* opt-in toggles are active at the snapshot slot
  (`slot_added > slot_removed` on each side). Sourced.
- **`σ_v`** — see below. Sourced, with a stated reduction.
- **`π_s`, `α_s`** — **not on chain, and not derivable.** Declared.

### 1. `π_s` and `α_s` are declared, not read

Task 008 already established that `π_s` (profit from corrupting a service) is not chain state and
that the paper itself calls estimating it an open research direction. Ingestion adds a second one:
**`α_s`, the fraction of stake required to corrupt an NCN, is a property of that NCN's consensus
protocol, and Jito's registry does not record it.** So both must be pinned in the claim's terms and
argued in the open. The adapter **refuses to invent either** — no defaults, no heuristics. A snapshot
without a terms file for every NCN it contains is an error, not a claim with assumptions.

This is the honest half of the whole exercise: the adapter's job is to make the sourced part
mechanical so the declared part is the only thing left to argue about.

### 2. Stake is denominated per vault, and the model wants one number

Each `Vault` has a `supported_mint`; `staked_amount` is in that mint's base units. Summing across
mints would silently introduce a price — an off-chain input smuggled in as arithmetic. So the
adapter **rejects a snapshot whose contributing vaults do not share one mint** rather than converting.
(Every vault sampled so far holds JitoSOL, so this is likely to hold in practice today; it is
enforced anyway, because "likely" is not a property.)

### 3. Jito's stake is per (vault, operator, NCN); the paper's is per validator

This is the real modelling gap and it must not be papered over. In the paper each validator has one
`σ_v` that backs **every** service it restakes for — that reuse is precisely the risk being studied.
In Jito, stake reaches NCN `s` through operator `v` only from vaults that are delegated to `v` *and*
opted into `s`, so an operator's stake is not uniformly available to all of its NCNs.

The adapter takes the **conservative** reduction: `σ_v` is the *minimum*, over the NCNs `v` is
connected to, of the stake reachable to that NCN. Under-stating `σ_v` under-states `σ_{N(s)}`, which
raises `T_v`, which lowers `γ*` — and it under-states the attack cost `σ_B` too. Both directions are
safe: the certificate can only come out weaker than the truth, never stronger. Stated in the claim,
not just here.

## Scope

```
adapters/jito-restaking.mjs        fetch → decode → graph → claim, zero-dependency
adapters/jito-ncn-terms.json       the declared π_s / α_s per NCN, with its reasoning
tests/jito-restaking.test.mjs      decoding and reduction against pinned fixtures, offline
```

`core/` untouched; `claimtypes/restaking-robustness.mjs` untouched. The adapter is a *producer* of
claims, not a second reader of them — `canonicalInputs` stays the only reader.

## What this task does NOT close

**Reconstruction.** `getProgramAccounts` has no slot parameter: a third party cannot ask an RPC for
the program's accounts *as of* the pinned slot, only as of now. So a Jito snapshot is reproducible
while it is current and not afterwards — the same position `reserve-solvency` is already in, and the
README already says what closing it needs (an on-chain recorder root, or N-of-M attestation for
historical data). The adapter therefore pins, per account, its pubkey, its decoded values and its own
`last_update_slot` / toggle slots, so a verifier reading the same accounts later can at least tell
whether they moved. **A claim from this adapter is not a historical claim.** That belongs in the
README's honest scope, in the same commit.

Also out of scope: EigenLayer / Symbiotic adapters; the `encode.mjs` and Rust twin port; any market
being opened on a Jito verdict.

## Acceptance criteria

- Runs against mainnet and produces a claim that `verify()` accepts, from real accounts.
- Refuses, with a distinct error rather than a verdict, on: a missing `π_s`/`α_s` for any NCN in the
  snapshot; more than one `supported_mint` among contributing vaults; a graph outside the claim-type's
  input domain (**reject, never truncate** — the requirement carried forward from the 008 approval).
- Decoding is tested against committed fixtures so the byte offsets are a regression, not a comment.
- The conservative `σ_v` reduction is tested with a case where per-NCN reachability differs.
- README honest scope updated in the same commit.

## Review focus for Codex

1. **Are the byte offsets right, and are they right for the reason stated?** They were derived from
   the struct definitions and then checked against live accounts (`supported_mint@72` reads
   `J1toso…` on every sampled vault; `632` decomposes exactly). A wrong offset here is a wrong
   verdict about somebody's network.
2. **Is the edge predicate right?** `slot_added > slot_removed` on *both* toggles. What does a
   freshly-created state look like, and can a toggle be re-activated in a way that makes this read
   backwards?
3. **Is the `min`-over-NCNs reduction actually conservative in both roles** — as `σ_{N(s)}` in the
   denominator and as attack cost `σ_B`? I argue it is; it is the load-bearing modelling decision.
4. **Does the adapter smuggle any declared value in as if it were sourced?** That is the failure this
   task exists to avoid, and it would be invisible in the output.

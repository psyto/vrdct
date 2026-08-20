# Decision — CMLS as a product: `KILLED`

**Gate:** [`docs/GATE.md`](../GATE.md) · **Scope:** the `closed-market-liquidation-soundness` claim-type only.
**Evidence:** [`../cmls/GATE-EVIDENCE.md`](../cmls/GATE-EVIDENCE.md) (Claude) ·
[`../../reviews/020-cmls-gate-evidence.md`](../../reviews/020-cmls-gate-evidence.md) (Codex, independent).
**Supersedes the item attribution in** [`2026-08-20-V3-state-rebuild.md`](./2026-08-20-V3-state-rebuild.md).

This record exists because the first verdict was right about the outcome and wrong about the reason.
An independent recomputation moved the failure from V3 to V1/V2, and a founder challenge — *if demand
can be created, this is not a kill* — moved the deciding constraint again, to a fact about the program.

## Verdict

## `KILLED`

## The gate, re-attributed after independent review

| # | item | first pass (Claude) | after independent recomputation (Codex) |
| --- | --- | --- | --- |
| V1 | price reconstruction | PROVEN | **FAIL** — the reconstructed price-input set is empty. `claimtypes/closed-market-soundness.mjs:22-38` canonicalizes only `blockTimes`; `oracle_inputs: []`; `reexec/cmls.rs:20-31` folds a u32 timestamp. An empty set shows CMLS makes no price claim; it cannot show price reconstruction. |
| V2 | time window | PROVEN for reconstruction | **FAIL** — the gate requires *a re-derivation that lands on the same window*. Reading a stored descriptor is not a derivation, and the only supplied derivation lands elsewhere: descriptor `1785586259/1785888421`, `tradingWindow(to_ts)` `1785787200/1785873600`. |
| V3 | state rebuild | `KILLED` | **PASS as capability, shipped tool defective** — two independently written implementations reached 3,789/3,789 and byte-identical `2f224c44f93a8e2c…`. `reconstruct.mjs:55-75` compares the rebuilt commitment to the pinned one and exits 1 on mismatch, so it fails closed at the command boundary. |
| V4 | same verdict | PROVEN | **PASS**, conditional on V3 — `RED`, 683 open / 3,106 closed / max gap 242 s, reached independently. |

Both labels Claude got wrong ran the same way: **towards the project.** So did the one numeric error
found — reported retention margin 11.48 h before `from_ts`, independently measured at **6.60 h**.
`docs/GATE.md` predicted the direction; the prediction held.

## Why this is `KILLED`, after the demand challenge

The founder's objection was correct as a principle: demand for a genuinely new instrument is created,
not found, and "nobody wants it yet" is not a kill. It was tested against each finding, and one
finding does not move.

**`open_market` pins `inputs_hash` and `n_records` before any money moves**
(`onchain/programs/vrdct-bond/src/lib.rs`). The input set is the successful signatures on a price
account over `[from_ts, to_ts]`, so **the window is already in the past when the market opens.** The
answer is a deterministic function of public chain state that has already happened, and anyone with an
RPC can compute it before bonding — that is what `vrdct check` is for, and `reconstruct.mjs`
demonstrates it against mainnet.

To an informed participant the probability is therefore **0 or 1, not a price.** A two-sided market
cannot be created on a fact both sides can compute for free beforehand: the only available
counterparty is one who did not check. That is not an underserved market — it is a revenue model made
of counterparty ignorance, and no amount of demand creation reaches it.

The strongest surviving version of the product — 020 §0's *bonded, re-executable assertion with a
falsification bounty*, sold as attestation rather than risk transfer — has creatable demand in
principle and **no inventory**: `T-10` measures four reachable subjects, all printing `RED`, with the
remaining known subjects unnameable without an off-chain registry, and naming an asset beside a bonded
`RED` on a guess is what `005 §2` calls a libel machine.

**A rejected rescue, recorded.** Re-measuring `T-10 §4d` (stale since 2026-08-07, explicitly *"not
re-measured"*) was proposed and then withdrawn by its author: it tests inventory, while the binding
constraint is market structure. Its best case changes the reason recorded, not the verdict.

## What would have changed the verdict

Not one fix — three, and together they describe a different instrument:

1. a predicate that reads prices, so the surface measures what its name promises (V1);
2. a window neither chosen nor supplied by the opener (V2);
3. a market that can open **before** its answer exists, so a price is possible at all (020 §0).

Per `docs/GATE.md`, that is *"a different gate and it starts over"* — not a new scope for this one.

## What the KILL does not say

**The engine is not implicated, and today it got stronger.** Two implementations written independently
— Codex used neither `core/rpc.mjs` nor the author's scratchpad, and wrote its own hash — reached a
byte-identical commitment from a public RPC on a 19-day-old window, and the same verdict. *Re-execution
decides the payout* is now measured rather than asserted, and it is the strongest evidence in this
repo. `core/` is claim-type-agnostic by construction; what died is one registered surface.

Recording that is not a rescue and does not authorise a successor. Which claim-type, if any, earns a
new gate is the founder's call.

## Reproduce

```bash
node reconstruct.mjs corpus/jupiter-spyx-cmls.claim.json   # exit 1 — fails closed on commitment mismatch
npm run test:canonical                                     # exit 0
tools/relay-codex.sh 1 --dry-run                           # the review request, unsent
```

Codex's independent run: `reviews/020-cmls-gate-evidence.md`, session `01a01f2d-5f76-74d3-8607-8614baf76289`.

## Review

Claude produced the evidence and adjudicated it; **Codex recomputed it independently and dissented on
three of four items.** The dissent is adopted above rather than argued with. No model reviewed its own
output.

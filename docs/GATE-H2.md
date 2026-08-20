# Kill Gate — H2

**Status:** OPEN, no evidence. **Opened:** 2026-08-20 by the founder, after H1 was killed.
**Binding for H2 only.** H1's gate is [`GATE.md`](./GATE.md) and its verdict stands unedited:
[`decisions/2026-08-20-cmls-product.md`](./decisions/2026-08-20-cmls-product.md).

Every rule in [`GATE.md`](./GATE.md) carries over unchanged — a verdict is a number or a reproducible
experiment; not-proven is a KILL; adding a hypothesis to stay alive is forbidden; at most two agents
with one Codex role at a time; the run stops at the verdict. This document adds only what is specific
to H2. **This is a new gate that starts over from zero. H1's PASSes are not credits.**

## What H1 bought, stated once so it is not re-litigated

| from H1 | carried into H2 as |
| --- | --- |
| **PROVEN.** Two independently written implementations rebuilt 3,789/3,789 observations from a public RPC on a 19-day-old window and landed on a byte-identical `inputs_hash`. | evidence that *re-execution from public signature history* is a real capability. It is **not** evidence for H2's own reconstruction requirement (B5), which is about a different data shape and must be measured again. |
| **KILLED.** `open_market` pins `inputs_hash`/`n_records` before money moves, so the answer precedes the market. | **B4.** H2 dies unless the outcome is undetermined at participation. |
| **FAIL (V1).** The predicate read zero prices while being named for liquidation soundness. | **B3.** The predicate must read the quantity the loss is made of. |
| **FAIL (V2).** The opener supplied the window. | **B4b.** The window must be fixed by rule before the opener acts. |
| **T-10.** Four reachable subjects, all printing the same verdict, the rest unnameable. | **B6.** A market needs a counterparty who can rationally disagree. |

---

## The hypothesis, fixed before any evidence

> **H2.** There is a named on-chain invariant whose violation inflicts a **measurable financial loss**
> on a **countable, reachable** population; a payout can be made to fire **when and only when** that
> loss occurs; the outcome is **undetermined** when the buyer pays; the window is fixed **by rule**,
> not by a participant; and a third party can **reconstruct the verdict from public data**.

**Fixed instance under test — one, not a family.** Per `GATE.md`, swapping the instance to stay alive
is forbidden. If this instance fails, H2 fails; a different instance is H3 and starts over.

| | fixed value |
| --- | --- |
| **1. buyer** | the **borrower liquidated against a stale price feed** on a named Solana lending venue — an address that held a position, was liquidated, and whose liquidation executed against a feed that had not updated within the venue's own stated tolerance. |
| **2. the loss they bear** | the liquidation penalty plus the difference between the price they were closed at and the price a fresh feed would have given, in USD, per event, on-chain and after the fact. |
| **3. loss ↔ payout** | the payout fires on *the same event that caused the loss*: a liquidation executed against a feed staler than the threshold. Not a correlated proxy, not a portfolio average. |
| **4. undetermined at participation** | the window is **in the future** when the buyer pays. Nobody, including the seller, can compute the answer at that moment. |
| **5. reconstructable** | both halves — the liquidation events and the feed's update history — rebuilt from public data to a commitment two independent parties reach byte-identically. |
| **6. KILL condition** | numeric, per item, stated in the gate below **before** the run. |

**The named risk in this instance, stated by its author.** H1 was gesturing at exactly this and never
read a price or a liquidation. H2 is therefore the shape most likely to be a rescue of a killed project
wearing new labels. The defence is structural, not a promise: **B1 and B2 kill H2 on buyer numbers
alone, before any Vrdct machinery is examined, and they are run first.** If H2 survives them and dies
at B4, that is a clean death and the technology is not the reason.

---

## Non-goals — out of scope until the gate returns `GO`

- **No code.** No claim-type, no adapter, no program change, no test, no tooling. H2's evidence is
  measurement of public data and reading of existing source, not building.
- **No program redesign.** B4 asks *whether* a forward-window design exists that preserves
  re-execution-decides. It does not authorise writing one.
- **No reviving CMLS.** `closed-market-liquidation-soundness` is killed. It is not a fallback, not a
  v2, not a subset of H2.
- **No other claim-type.** `reserve-solvency`, `obligated-liveness`, `restaking-robustness`,
  `monday-open-gap` are out of scope. Reaching for one when this instance fails is the forbidden move.
- **No UI, no deploy, no mainnet, no devnet, no real funds, no force push, no secrets.**
- **No generalisation.** "This would also work for X" is not evidence and does not belong in H2's
  record.
- **T-12 stays closed as a blocker.** `2.50859` SOL stranded per run
  (`reviews/main-2026-08-12-devnet-debt.md` F1). No value moves regardless of H2's verdict.

---

## The gate

Run **in order.** B1 and B2 are first because they can kill H2 without touching this repo's code.

| # | item | verdict must come from | KILL if |
| --- | --- | --- | --- |
| **B1** | **The buyer exists and is countable.** How many distinct addresses were liquidated against a feed staler than the venue's own stated tolerance, on named Solana lending venues, in the last 12 months? | a count, from public chain data, per venue and per month | **fewer than 50 distinct addresses**, or the events cluster into **fewer than 3 distinct incidents** — a market on an annual tail event has no recurring buyer |
| **B2** | **The loss is material to that buyer.** What did they lose, in USD? | median, p90 and total across the B1 events | **median loss < 10× the round-trip cost of participating** (bond + fees + gas). Below that a rational buyer self-insures and there is no premium to collect |
| **B3** | **Loss and payout coincide.** Applied to the B1 events, how often would the proposed predicate have fired when someone lost, and how often when nobody did? | a confusion matrix over the B1 events | **true-positive rate < 0.90** or **false-positive rate > 0.10**. Outside that band the instrument pays the wrong people and is a lottery, not cover |
| **B4** | **The outcome is undetermined at participation.** Can a market be opened whose input set does not yet exist? | reading `open_market` and stating what a forward-window design would require | **no design exists that keeps re-execution as the deciding mechanism** while the window is future. Today the answer is no: `open_market(… n_records, inputs_hash …)` with `require!(n_records > 0)` requires the set to exist at open |
| **B4b** | **The window is fixed by rule.** Who chooses `[from, to]`? | the rule, written, and a re-derivation landing on the same bounds from the rule alone | **any participant can influence the bounds**, or the rule and the descriptor disagree — H1 died partly here |
| **B5** | **A third party reconstructs it.** Can both the liquidation events and the feed history be rebuilt from public data to a byte-identical commitment? | two independent rebuilds compared | **either half is unsourced.** This repo already reports `settlement_grade: NO` for `getProgramAccounts`-shaped sources (`adapters/jito-restaking.mjs:426`) and `reserve-solvency` as genuinely unsourced. Liquidation events are the untested half |
| **B6** | **A counterparty exists.** Who rationally takes the other side, and why is it not the accused venue? | naming them, and the reason they disagree at open | **the only rational counterparty is the venue being accused** — that is a fine, not a market — or the answer is knowable at open, which is B4 again |

### KILLED if

**Any single item fails.** They are conjunctive: a buyer with no counterparty is not a market, a
market with no reconstruction is an oracle, and a reconstruction of an already-settled fact is H1.

### The thresholds are the founder's to change — before the run, not after

`50 addresses`, `3 incidents`, `10×`, `0.90/0.10` are proposed by Claude and are the most arguable
part of this document. Changing them **before** B1 runs is legitimate gate design. Changing them
**after** seeing a number is the failure `GATE.md` exists to prevent, and the record must show which
happened.

---

## Verification plan — reproducible, not yet run

Written to the level where a third party can execute it. **Nothing here has been run.**

### B1 — count the buyers

1. **Fix the venue set, in writing, before querying.** Named Solana lending venues with (a) a public
   liquidation instruction, (b) a published price-staleness tolerance, (c) a nameable feed account
   per market. Record the tolerance and its source URL per venue. A venue with no *stated* tolerance
   is excluded — inventing one is the V1 error in a new place.
2. For each venue, enumerate successful liquidation instructions over the last 12 months by walking
   signature history on the program account. **Page-budget discipline:** H1's kill defect was a fixed
   20-page cap that truncated silently (`core/rpc.mjs:19`). This walk must record pages consumed and
   the oldest timestamp reached, and **refuse rather than return** on exhaustion.
3. For each liquidation, resolve the feed account it priced against and find the last feed update at
   or before that slot. Compute staleness = `liquidation_blockTime − last_update_blockTime`.
4. Report: distinct liquidated addresses with `staleness > tolerance`, grouped into incidents by
   ≥ 24 h gaps, per venue, per month.

**Output:** a table and the raw event list, committed. **KILL check:** < 50 addresses or < 3 incidents.

### B2 — price the loss

For each B1 event: liquidation penalty (from the venue's published parameter) + `|price_used −
price_at_fresh_feed|` × position size, in USD at the event's timestamp. Report median, p90, total.
Round-trip participation cost measured, not assumed: bond floor + priority fees + gas at current
mainnet rates. **KILL check:** median < 10× that cost.

### B3 — measure basis risk

State the predicate in one sentence **before** running it. Apply it to the full liquidation set from
B1 step 2 — *including* the events where staleness was within tolerance. Report the confusion matrix
against "did this address actually lose money". **KILL check:** TPR < 0.90 or FPR > 0.10.

### B4 — is a forward window expressible at all

No code. Read `onchain/programs/vrdct-bond/src/lib.rs::open_market` and
`state::Market`, and answer in writing: what would a market whose input set does not yet exist have to
commit at open instead of `inputs_hash`, and does any such commitment keep re-execution — not an
attestor, not a committee — as the thing that decides? If the answer requires a trusted party to
report the future set, **that is a KILL**, because it reintroduces the oracle Vrdct exists to remove.

### B4b — derive the window

Write the rule. Re-derive the bounds from the rule alone, with no descriptor in hand, and compare.
**KILL check:** any participant-supplied input to the bounds.

### B5 — rebuild it twice

Two independently written implementations — different authors, neither importing the other's code nor
`core/rpc.mjs` — rebuild the B1 event set and the feed history for one named incident and compare
commitments. This is the method H1 proved; here it is applied to a data shape it has not been applied
to. **KILL check:** the two disagree, or either half cannot be addressed at a slot.

### B6 — name the counterparty

Write down who sells this and why they believe the answer differs at open. **KILL check:** the only
name is the accused venue.

---

## Roles for H2

Unchanged from `GATE.md`. Claude: spec, evidence, task progression. Codex: implementation **or**
independent review, one at a time, never reviewing its own output. The lock is `codex_role:` in
[`cmls/LEDGER.md`](./cmls/LEDGER.md) and currently reads `none`.

**B1–B3 decide this gate and Claude will produce them, so an independent recomputation is required
before any `GO`** — the relay is `tools/relay-codex.sh`. H1's record shows why: both of Claude's wrong
labels and its one numeric error ran towards the project, and the cross-pass is what caught all three.

## On reaching the gate: stop

`GO` ends H2. It does not start implementation. The founder picks what happens next.

# 012 — `dividend-funding-fidelity`: settle a payment against the number its issuer declared

**Frame:** thin (what counts as a surface, and whether this one is admissible at all) → CC drafts,
Codex reviews. **Branch:** `cc/dividend-funding-fidelity`

This brief ships with **no module**. It ships a measurement record
([`evidence/variational-2026-08/`](../../evidence/variational-2026-08/README.md)) and a proposal, and
its first job is to survive the objection in *"Why this might not belong here"* below. Nothing should
be implemented until that is settled.

## What the measurement found, and why it forced a new shape

The record surveys Variational Omni — an RFQ perp venue on Arbitrum One with 534 markets, a single
counterparty quoting all of them, and bilateral on-chain escrow. It publishes four mainnet addresses.
Two have no code. The one it names **Oracle Contract** emitted, over 42 hours, only
`FeeBatchProcessed`, `WithdrawalsProcessed` and `OLPToPoolTransfer`.

So: the on-chain record covers **custody and money movement**, and carries **no price**. Quoted,
index and mark price, the funding rate and the liquidation trigger are all produced off-chain by the
party that is also the counterparty to every trade.

Every claim-type in this repo so far re-executes a **number the subject published on chain** —
a reserve balance, a price account's update history, a set of stake accounts, a schedule of
transactions. Against a venue shaped like this one, all of them are simply inapplicable. There is
nothing to pin.

That is the interesting part. It rules out the obvious surface — "was the fill fair?" — because a
fairness verdict needs the venue's quotes, which are not public, and a claim that needs the subject's
cooperation is not a neutral resolver, it is an audit engagement. What survives is narrower and
better: **quantities that do appear on chain, checked against a reference that comes from outside the
venue entirely.**

## The surface

Corporate actions. The venue documents that holders of a dividend-paying equity perp *"receive a
special funding payment"*, that the adjustment window runs *"from the previous business day
(ex_date - 1) to the morning of the ex-dividend date"*, that funding interval shortens to one hour
inside it, and that positions enter `reduce_only` at 18:00 ET.

That behaviour was observed live: on 2026-08-09, with every other equity market reporting
`funding_interval_s: 28800`, **`AAPL` reported `3600`** — the venue announcing, in public data, that
it is inside its own documented window.

```
terms:    { symbol, exDateEt, declaredPerShare: {value, exp}, currency,
            tolerance: {value, exp}, maxLagSecs }
observed: { payments: [{ txHash, logIndex, blockTime, amount: {value, exp}, poolId }],
            positions: [{ poolId, size: {value, exp}, asOf }] }
```

| flag | meaning |
| --- | --- |
| `GREEN` | the payments in the derived window match `declaredPerShare × size` within tolerance |
| `RED` | they do not, or the window closed with no payment against an open position |
| `UNKNOWN` | the window cannot be derived, or the position basis is not established — see below |

Design points that are decisions, not details:

1. **The window is derived, never supplied.** `ex_date − 1` through the ex-date morning is a
   statement about **ET sessions**, which is exactly what `core/campana.mjs` already computes as a
   pure function of `(timestamp, calendar)`. Same move as `monday-open-gap` and `obligated-liveness`:
   a venue that defines the boundary of its own obligation is marking its own exam.
2. **The reference is the issuer's declaration, pinned before the fact.** Not the venue's number,
   not ours.
3. **Amounts are `{value, exp}` integers.** A float never touches a verdict.
4. **`UNKNOWN` is a first-class outcome**, on the `obligated-liveness` precedent: when the terms or
   the available evidence cannot support a judgement, the type refuses to produce one rather than
   defaulting to the party holding the funds.

## Why this might not belong here — the objection to settle first

The README says Vrdct answers **on-chain-STATE conditions** — *"the slice a price feed can't reach
and a vote shouldn't decide"*. A dividend declaration is not on-chain state. It is off-chain data
about the world, which is what an oracle is for. On its face this type imports exactly the trusted
input the thesis exists to avoid.

The counter-argument, and it must be examined rather than assumed:

`restaking-robustness` already ships with `π_s` and `α_s` **declared in the claim** — the paper
itself calls estimating `π_s` an open research direction — and the Jito adapter declares a numéraire
and an entire mint→price map, because *"a converted number that looks sourced while resting on an
unseen price is precisely the line this adapter exists to hold"*. The pattern is established: a
declared input pinned in the claim body before the fact, public and contestable, with everything
downstream of it mechanical.

A declared dividend is a **better** instance of that pattern than `π_s`, not a worse one, because it
is not an estimate. It is a discrete number published by a third party who is not in the market, on a
date fixed in advance, and it is wrong or right rather than plausible.

But the objection is not thereby answered, and this brief does not claim it is. Two things have to
hold:

- the declared number must be **identified**, not just asserted — which issuer statement, of what
  date, is *the* declaration; and
- the resulting verdict must be honestly labelled as a claim about the venue **under that
  declaration**, the way a `restaking-robustness` verdict is a claim under its declared `π`.

If Codex reads this and concludes the type is an oracle wearing a re-execution costume, that is a
valid outcome and the right time to reach it is now, before a module exists.

## Honest scope — what is not established

- **The position basis is the gate, and it is open.** `GREEN` needs the position each payment was
  computed against. `FeeBatchProcessed` carries `(uint128, uint256, uint128)` tuples and
  `OLPToPoolTransfer` carries an amount, but **the `uint128` identifier space is not mapped** — it is
  not established that it addresses a settlement pool, an account, or something else. Until it is,
  this type can compare payments to each other but cannot check one against a size. No module should
  be written before this is resolved; if it cannot be resolved from public data, the type dies here.
- **Unsourced, like `monday-open-gap`.** There is no source descriptor from which the payment set can
  be rebuilt, so a claim would pin an observation list a stranger has to accept. This is the same
  residual task 011 is closing for the gap type, and it would be open here from the start.
- **The venue's own numbers are not verified by this type and must not appear to be.** A `GREEN` says
  a payment matched a declaration. It says nothing about the index, the quotes, the mark, or whether
  anyone was filled fairly — and the measurement record is explicit that those cannot be re-executed
  at all from public data.
- **The ex-date window observed on 2026-08-09 is not confirmed against an issuer declaration.** The
  `funding_interval_s: 3600` reading is the venue's own signal. The corresponding declaration has not
  been retrieved, and that check is step 1, not a formality: if the venue's window and the issuer's
  ex-date disagree, that is either the first real finding or a fault in this brief's premise.
- **Cross-chain.** Every existing claim-type re-executes Solana state. This subject is on Arbitrum,
  so an adapter here needs an EVM read path the repo does not have. That is a real cost and it is a
  reason to be sure of the surface before paying it.

## Acceptance criteria (if it proceeds past the objection)

1. The `uint128` identifier space is mapped from public data, or the task is closed as not
   admissible and the reason is recorded.
2. The AAPL declaration is retrieved and matched against the observed window.
3. Only then: `claimtypes/dividend-funding-fidelity.mjs` + tests, registered through the existing
   registry, `core/` untouched, `canonicalInputs` the only reader of raw claim JSON.

## Out of scope

Execution quality, best execution, spread attribution, and any verdict that would need the venue's
quotes. Also the on-chain twin and `encode.mjs` wiring — offline-complete is the ceiling here, as it
was for types #3, #4 and #5.

## Review focus for Codex

1. **Is the objection above actually answered?** Does a pinned issuer declaration sit inside the
   `restaking-robustness` precedent, or does it cross the line into oracle territory the README says
   this repo does not cross? This is the whole task; the rest is downstream.
2. **Is `UNKNOWN` the right refusal, and is its trigger complete?** Specifically: should an
   unmapped identifier space produce `UNKNOWN`, or should it make the claim inadmissible before
   re-execution begins?
3. **Does the measurement record overclaim?** Its "what this does NOT establish" list is the part
   that matters — particularly item 1 (absence of a price *event* is not absence of an on-chain
   price) and item 3 (quoted half-spread is not the venue's own published slippage comparison).
   It names a live venue from a public repo, so a sentence that is stronger than its evidence is not
   a wording problem.
4. **Is a cross-chain claim-type worth the read path**, or does this belong in a sibling repo?

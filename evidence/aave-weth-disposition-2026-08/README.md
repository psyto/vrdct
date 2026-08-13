# Aave v3 mainnet — what a WETH borrow does in its own transaction

**Status: FROZEN 2026-08-13. No number was produced and none should be quoted.**

The 90-day scan completed — 5,119 WETH borrows over 648,000 blocks — and the classifier passes eleven
adversarial fixtures. What does not exist is a confirmed `rules.json`: the survey proposed one and
nobody pinned it, and the same chain data returns different verdicts under different lists. So the
9.3% `left-eth` figure in the survey output is **not a result**. It is what a deliberately wrong rule
set produces, and the survey exists to show it is wrong: 42 of the tokens it counted as "left ETH"
are ETH assets re-deposited into Aave, Spark or Euler, against 6 that genuinely left.

Frozen because the work had no identified buyer, not because it failed. Resuming means confirming
`rules.json` — see `rules.md` for what each of the three decisions commits the signer to — and
re-running the survey over all 5,119 rather than the 300-borrow sample the draft was drawn from.

## Why this exists

Stani (Aave) argued publicly that a zero-yielding ETH becomes a *funding leg*: borrowed to be sold
into a productive asset, and therefore a source of structural sell pressure. It is an empirical claim
and nobody measures it. On-chain it is measurable, which makes it a candidate Vrdct surface — the
inputs are chain state only, so it survives the bar that rejected task 012's oracle-driven type.

This directory is the step before any of that: **look at what actually happens, before inventing the
categories.** Task 014 spent ten findings learning that a claim written ahead of its evidence gets
the evidence forced into it.

## Data path, measured rather than assumed

`eth_getLogs` over the Aave v3 `Pool` (`0x8787…4E2`), filtered to `Borrow` with `topic1 = WETH`.

| endpoint | historical logs |
| --- | --- |
| `ethereum-rpc.publicnode.com` | **no** — "Archive requests require a personal token", even 100 blocks back |
| `rpc.ankr.com/eth` | no — API key required |
| `eth.llamarpc.com`, `cloudflare-eth.com`, `eth.merkle.io`, `blastapi`, `blxrbdn` | no |
| **`eth.drpc.org`** | **yes, no key** — depth verified to ~125 days; **2000 blocks per call** ok, 10000 times out on the free plan |

The `Borrow` event was identified from its shape rather than from memory:
`0xb3d08482…dce0`, 4 topics and 4 data words = 3 indexed (`reserve`, `onBehalfOf`, `referralCode`)
plus `user`, `amount`, `interestRateMode`, `borrowRate`.

## What the first window shows, and the hypothesis it kills

Window `25733557..25735557` (2000 blocks), 12 WETH borrows. Tokens the **borrower received** in the
same transaction:

```
  7x  0xea51d785…
  4x  0xc02aaa39…, 0xea51d785…
  1x  0xa0b86991…, 0xc02aaa39…, 0xea51d785…
```

- `0xea51d785…` is in **12 of 12** — Aave's `variableDebtWETH`, minted to every borrower by
  construction. It carries no information about disposition.
- `0xc02aaa39…` is WETH itself: the borrow arriving, not the borrow being used.
- `0xa0b86991…` is USDC, in one transaction.

**So "what did the borrower receive" is not a disposition signal.** The debt token dominates it, and
the one disposition that would matter most — unwrapping WETH to ETH — emits `Withdrawal`, not
`Transfer`, so it is invisible to this view entirely.

The signal has to be the other direction: WETH leaving the borrower, where it lands, and what returns.
That is the next probe, not a classifier.

## Probe 2 killed a second hypothesis, and the contradiction was the bug

Following WETH out of `onBehalfOf` (the `Borrow` event's `topics[2]`) reported **12 of 12 "WETH never
left the borrower"** — which contradicts probe 1, where only 5 of 12 borrowers received WETH at all.
Both cannot be true. The contradiction was the finding:

> `Borrow(reserve indexed, user, onBehalfOf indexed, amount, rateMode, rate, referral indexed)` —
> **the funds go to `user`, which is data word 0.** `onBehalfOf` is only whose debt it is.

So probe 2's first run followed the wrong address. Recorded rather than quietly fixed, because it is
the second hypothesis this directory has killed with its own data and that is what the directory is
for.

The same run confirmed the unwrap exists, from shape rather than from memory. WETH-contract log
shapes over 12 borrow transactions:

```
   44x  0xddf252ad1be2c89b…  topics=3 words=1     Transfer
   17x  0x8c5be1e5ebec7d5b…  topics=3 words=1     Approval
    7x  0x7fcf532c15f0a6db…  topics=2 words=1     Withdrawal — the WETH -> ETH unwrap
```

Seven unwraps in twelve borrow transactions. Any classifier that reads only `Transfer` misses them,
which is what probe 1 predicted and probe 2 confirmed.

## The two events that would have inverted everything, identified without a recalled constant

WETH emits two log shapes that arity cannot tell apart — both `topics=2, words=1`, one indexed party
and one value. One is the wrap, one is the unwrap. **Getting them backwards inverts every disposition
verdict**, so neither was taken from memory. `identify-events.mjs` decides it from behaviour: the WETH
contract's own ETH balance rises by exactly what is wrapped and falls by exactly what is unwrapped, so
for every block

```
balance(block) - balance(block-1)  ==  sum(Deposit) - sum(Withdrawal)
```

Run over blocks where the two sums differ, only one assignment reproduces the delta. **10 of 10
blocks agree**, including blocks moving 12+ ETH where a coincidence is not available:

| topic0 | is |
| --- | --- |
| `0xe1fffcc4…9109c` | **Deposit** — ETH → WETH, the wrap |
| `0x7fcf532c…81b65` | **Withdrawal** — WETH → ETH, the unwrap |

WETH9 emits no `Transfer` on either, which is why the first attempt at this — pairing them with a
mint/burn `Transfer` to `0x0` — found nothing and proved nothing.

## The wall: the keyless path probes, it does not measure

`eth.drpc.org` served ~40 calls and then began refusing — first
`Request timeout on the free plan`, then `Can't route your request to suitable provider` on queries
it had served minutes earlier. Retry with backoff does not clear it.

**A 90-day run needs an RPC key.** Alchemy, Infura and drpc all have free tiers whose archive
allowance is far beyond what this needs; the constraint is having one at all, not paying. This is the
only thing blocking a number, and it is not something the engine can work around: an endpoint that
refuses is not evidence about the chain, and a measurement that quietly proceeds on partial data
would be exactly the defect this repo keeps finding.

## Rate

~12 borrows per 2000 blocks ≈ **43/day**, so a 90-day window is ~3,900 borrows and ~3,900 receipt
calls. Feasible on the free tier with pacing; worth stating before anyone promises a window length.

## What this does NOT establish

Nothing about intent. A borrow whose proceeds reach a non-ETH asset may be a short, a hedge, or a
payment. Same-transaction tracing also sees only the transaction: borrow now, sell an hour later is
invisible to it, so any same-tx share is a **lower bound**, and must be published as one.

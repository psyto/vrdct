# Aave v3 mainnet — what a WETH borrow does in its own transaction

**Status:** probe only. No claim-type, no classifier, no number to cite yet.

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

## Rate

~12 borrows per 2000 blocks ≈ **43/day**, so a 90-day window is ~3,900 borrows and ~3,900 receipt
calls. Feasible on the free tier with pacing; worth stating before anyone promises a window length.

## What this does NOT establish

Nothing about intent. A borrow whose proceeds reach a non-ETH asset may be a short, a hedge, or a
payment. Same-transaction tracing also sees only the transaction: borrow now, sell an hour later is
invisible to it, so any same-tx share is a **lower bound**, and must be published as one.

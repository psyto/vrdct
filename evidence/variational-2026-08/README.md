# What a venue publishes, and what its chain state carries — Variational Omni, 2026-08-09

A measurement record, not a verdict. It exists because it answers a question this repo's whole
premise depends on and usually assumes away:

> `settle` pays out only if the streamed digest equals the commitment — but a claim can only commit
> to inputs that **exist somewhere reproducible**. So before asking whether a venue behaves, ask
> what a stranger can re-execute about it at all.

Variational Omni is a good subject for that question precisely because it is not evasive about its
architecture. It is an RFQ venue on Arbitrum One where a single counterparty (the Omni Liquidity
Provider) quotes every market, trades settle into bilateral on-chain escrow pools, and the company
publishes its mainnet addresses. Everything below is public data.

Measured **2026-08-09T22:17Z – 23:53Z UTC**, chain head **block 492898231**
(`ts 1786319625`, `2026-08-09T23:53:45Z`), block rate 0.2519 s/block sampled over 100,000 blocks.

## The four addresses the venue publishes

From `docs.variational.io/technical-documentation/mainnet-contracts`, under the heading
**Mainnet Contracts**, with the names that page gives them:

| published name | address | code | nonce | USDC |
| --- | --- | --- | --- | --- |
| Protocol Treasury | `0x5e91b40467fb8902c46a7b6cb90482363188d645` | **0 B** | 731,092 | 5,753,972 |
| Core OLP Vault | `0x74bbbb0e7f0bad6938509dd4b556a39a4db1f2cd` | **0 B** | 745,999 | 14,080,143 |
| Settlement Pool Factory | `0x0F820B9afC270d658a9fD7D16B1Bdc45b70f074C` | 4,695 B | 176,604 | 0 |
| Oracle Contract | `0x84BE56470d45b7f6629A66A219a38681F6BA6172` | 18,917 B | 1 | 0 |

Two of the four have no code. They are externally-owned accounts holding, between them, about
$19.8M of USDC — the OLP's capital and the treasury are each a key, not a contract. This is
consistent with what the venue's own documentation says happens to that capital (only OLP's own
funds hedge on external venues; trader margin stays in settlement pools), and it is not a claim that
anything is missing. It is the difference between *custody enforced by a program* and *custody
enforced by an operator*, stated in the one place where the difference is checkable.

## Every event the two contracts emitted, over 600,000 blocks (~42.0 h)

Signatures resolved via `api.openchain.xyz/signature-database`, each with `hasVerifiedContract: true`.

```
Settlement Pool Factory   302 logs, 1 topic
    302  PoolCreated(address,address[],uint128,address,uint128,uint128,address,uint256)

Oracle Contract          7618 logs, 3 topics
   4470  FeeBatchProcessed((uint128,uint256,uint128)[],(uint128,string)[])
   2905  WithdrawalsProcessed(address,uint128[],(uint128,string)[])
    243  OLPToPoolTransfer(address,address,uint128,uint256,uint128,uint128)
```

The address the venue publishes as its **Oracle Contract** emitted, over 42 hours, fee batching,
withdrawal processing, and OLP-to-pool transfers. No event carries a price.

## What the venue's own documentation says the prices are

- *"The index price represents the real-time price of an underlying asset, and is sourced from the
  Variational Oracle."*
- Quoted price is *"the price at which the Omni Liquidity Provider (OLP) is willing to execute a
  trade."*
- Funding: `premium = impact_price_difference / index_price`, from RFQ bid/ask at a $7,500 notional,
  computed every 60 s and averaged over a 1–8 h window.
- For equity RWA perps: *"Fixed Mode is applied on Equity-based RWA Perps. No recalculation occurs,
  the Price Index remains fixed at the last available value."* Commodity RWA perps instead use an
  "Orderbook EWMA Mode".
- OLP is team-seeded today — *"Initially, the Variational team has provided seed capital for OLP"* —
  with user deposits via a community vault described as future work. 20% of spreads paid to OLP go
  to the treasury, a share the docs call *"still being tested and is subject to change"*.

## The public endpoint, sampled while the NYSE was closed

`GET https://omni-client-api.prod.ap-northeast-1.variational.io/metadata/stats` is unauthenticated
and returns `mark_price`, `funding_rate`, `funding_interval_s`, quoted bid/ask at several notional
sizes, and 24 h aggregates. It does **not** return an index price.

At 22:17:32Z and 22:29:40Z on 2026-08-09 — NYSE closed until Monday 13:30 UTC, CME Globex reopened
at 22:00 UTC, crypto continuously open — 534 markets, $439.3M 24 h volume, $145.8M TVL, $1.449B open
interest, and `loss_refund` at `pool_size: 0`, `refunded_24h: 0`.

Three things in that data are worth recording:

**Funding is at zero for the markets whose underlying is closed, and nonzero everywhere else.**
Every US single name and ETF sampled reported `funding_rate` `0.0000` (SOXL, `-0.0139`, is the
exception). The pre-IPO markets, which have no underlying session to be closed, carried `0.0548`/8h.
Crypto carried `0.0856`–`0.1095`/8h and reopened commodities `0.0885`–`0.8146`/4h. That is coherent
with Fixed Mode: a premium measured against a frozen denominator is not a premium.

**Marks kept moving anyway.** Over the 12 minutes between samples, with the NYSE shut, SOXL moved
−47.4 bp, MSTR −15.9 bp, QQQ +11.9 bp, and quotes refreshed roughly every 30 s.

**Quoted half-spread at the $100k tier spans two orders of magnitude.** BTC 0.73 bp, QQQ 2.31 bp,
XAU 1.74 bp, CL 2.00 bp — against TSM 35.33 bp, EWJ 45.50 bp, QCOM 108.88 bp, ANTHROPIC 139.94 bp,
IWM 166.71 bp, OPENAI 171.53 bp.

And one anomaly that became task 012: **`AAPL` reported `funding_interval_s: 3600` while every other
equity reported `28800`** — the venue's own documented dividend-adjustment behaviour, visible in
public data, on a specific named market, in a window that closes and does not return for a quarter.

## The window closing, captured

The sampler was started for that anomaly and caught its other edge. `AAPL`'s
`funding_interval_s` returned from `3600` to `28800` at **2026-08-10T00:09:23Z**, at 60 s
resolution, while every other equity market sampled reported `28800` throughout.

`aapl-window-close.json` is the frozen slice — 107 samples across the transition, with the source,
the observed boundary, and its own `sha256` over the body
(`7fb7a6994339f790d16873520a8c4c2350a33fd366a30a59b01d7f5912206e3e`). It is committed because
`samples.jsonl` is not: a growing stream is not evidence, a pinned slice is.

**The capture has a hole** — 2,481 s between `23:11:04Z` and `23:52:25Z`, almost certainly a machine
suspend. It appears in the slice as a `capture_gaps` entry rather than as an absence the reader has
to notice, which is the whole reason each record carries its own fetch time.

### Reconciled against the issuer

From Apple's own investor relations dividend history — the issuer statement, not an aggregator:

> **declared 2026-07-30, $0.27 per share, record date 2026-08-10, payable 2026-08-13.**

US settlement is T+1, so the ex-date is the record date: **Monday 2026-08-10**. The venue's
documented window is *"from the previous business day (ex_date - 1) to the morning of the
ex-dividend date"* — Friday 2026-08-07 through Monday morning — with a one-hour funding interval
inside it and `reduce_only` at 18:00 ET.

Against that, what was observed:

| | |
| --- | --- |
| `funding_interval_s: 3600` already in effect | 2026-08-09T22:17Z — Sunday 18:17 ET |
| reverted to `28800` | 2026-08-10T00:09:23Z — Sunday 20:09 ET |
| ex-date session opens | 2026-08-10T13:30Z — Monday 09:30 ET |

**The shortened-funding phase ended about 13.4 hours before the morning of the ex-dividend date.**

That is a specific, dated question rather than a finding, and two readings are open because **the
opening edge was never observed** — the first sample already showed `3600`:

1. the window ran from Friday as documented and ended early, or
2. the venue used ex_date − 1 as a **calendar** day (Sunday) rather than a business day, starting at
   18:00 ET Sunday — in which case the whole window was about two hours and the documented sentence
   describes something else.

Nothing here distinguishes them, and **the special funding payment itself was not observed at all** —
that requires decoding the identifier space in `FeeBatchProcessed`, which is exactly the gate task
012 says it must pass before a module is written. The next window is a quarter away.

## What this establishes

Among the addresses Variational publishes, **the on-chain record covers custody and money movement —
escrow pools, fee batches, withdrawals, OLP transfers — and does not carry the prices that decide how
much money moves.** Quoted price, index price, mark price, funding rate and the liquidation trigger
are all produced off-chain by the venue, which is also the sole counterparty to every trade.

That is not an accusation and not a vulnerability; nothing here enables an attack, and the OLP holds
no third-party depositor capital today. It is a statement about **what a stranger can re-execute**.
A settlement layer can be trust-minimised about custody and, at the same time, carry no public record
of valuation — and the second half is the half that decides the payout.

For this repo it is a boundary condition. A claim-type over this venue cannot re-execute its prices,
because there is no public price record to pin. It can only re-execute quantities that appear on
chain, against a reference that comes from outside the venue entirely. Task
[`012`](../../docs/tasks/012-dividend-funding-fidelity.md) is the attempt to find one.

## What this does NOT establish

1. **Absence of a price event is not absence of an on-chain price.** A contract can write storage
   without emitting, and an address the venue does not publish could carry one. The bounded claim is:
   *among the four addresses Variational publishes, none emitted a price over the scanned 42 hours.*
   Nothing here searched the rest of the chain.
2. **The freeze itself was not measured.** Fixed Mode is quoted from the venue's documentation. The
   public endpoint exposes `mark_price` only, so this record shows funding at zero and marks moving —
   both consistent with a frozen index, neither a measurement of one.
3. **The spread figures are quoted half-spreads at a quoted size, not realised slippage**, and the
   $100k tier is not the $1M size used in the venue's own published comparison against another
   platform. They do not restate that comparison and must not be quoted as if they did.
4. **Nothing here is settlement-grade.** The endpoint is the operator's own, unsigned, and addresses
   no block; the RPC reads address `latest` rather than a pinned block. This is an observation log in
   the same sense as `adapters/jito-restaking.mjs` — and for a stricter reason, since a REST response
   cannot even be re-fetched as of a past instant.
5. **No conclusion about solvency, conduct, or the venue's obligations to anyone.** The measurements
   are what they are.

## Reproduce

```bash
node probe.mjs                 # every on-chain number above; ARB_RPC to override the endpoint
node probe.mjs --blocks 20000  # a shorter scan
node sampler.mjs               # append 60s samples of the public stats endpoint to samples.jsonl
```

`probe-output.txt` is the captured run this file quotes. `samples.jsonl` and `sampler.log` are not
committed — the sample log is a live, growing capture, and a claim built from it should commit a
frozen, content-addressed slice rather than the stream.

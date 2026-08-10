# A bounded scan of five named Variational addresses — 2026-08-09 / 2026-08-10

> **Outcome: the claim-type this record was gathered to motivate was REJECTED.** See
> [`reviews/012-dividend-funding-fidelity.md`](../../reviews/012-dividend-funding-fidelity.md).
> The measurement stays as explicitly bounded research; the conclusions it originally carried did
> not survive review and have been narrowed to what was actually measured.

Variational Omni is an RFQ perp venue on Arbitrum One: 534 markets, a single counterparty (the Omni
Liquidity Provider) quoting all of them, trades settled into bilateral on-chain escrow pools. It
publishes mainnet addresses and documents its own pricing and funding mechanics. Everything below is
public data.

Measured **2026-08-09T22:17Z – 2026-08-10T23:33Z UTC**. The `probe-output.txt` run this file quotes
has chain head **block 493235649** (`ts 1786404358`, `2026-08-10T23:25:58Z`), block rate 0.2510
s/block sampled over 100,000 blocks.

## The addresses scanned, and why the list is named rather than derived

These five are **an explicitly named list**, not "everything Variational publishes":

| name | address | code | nonce | USDC |
| --- | --- | --- | --- | --- |
| Protocol Treasury | `0x5e91b40467fb8902c46a7b6cb90482363188d645` | **0 B** | 734,328 | 5,799,383 |
| Core OLP Vault | `0x74bbbb0e7f0bad6938509dd4b556a39a4db1f2cd` | **0 B** | 745,999 | 13,872,367 |
| Settlement Pool Factory | `0x0F820B9afC270d658a9fD7D16B1Bdc45b70f074C` | 4,695 B | 176,845 | 0 |
| Oracle Contract | `0x84BE56470d45b7f6629A66A219a38681F6BA6172` | 18,917 B | 1 | 0 |
| Loss Refund Pool | `0xc47756133753280c37b227c24782984e021c4544` | **0 B** | 766,341 | 16,292 |

The names are the venue's own, from its Mainnet Contracts page. **That page is a moving target and
this record does not depend on it.** An earlier version of this file called the first four "the four
addresses Variational publishes" and treated them as the complete public set. That was wrong:
review of this branch read the same page listing `Loss Refund Pool` as a fifth entry, while
`mainnet-contracts.captured.md` here — fetched as raw markdown at **2026-08-10T23:16:16Z**, SHA-256
`a5248decfbc03fe231e382b9dd7eb80e8292ce23c3535b698c0e47622337a8a2` — shows four. Both readings are
recorded rather than reconciled; the fifth address is real, live, and is scanned below on its own
merits. Any statement here about *the venue's published set* would rest on whichever moment the page
was read, so no statement here makes one.

Three of the five have no code. They are externally-owned accounts holding, between them, about
$19.7M of USDC, with transaction counts in the 730k–770k band — operational hot wallets, not
programs. That is consistent with what the venue documents (only OLP's own capital hedges on
external venues; trader margin stays in settlement pools) and is not a claim that anything is
missing. It is the difference between custody enforced by a program and custody enforced by an
operator, recorded where the difference is checkable.

## Every event those addresses emitted, over 600,000 blocks (~41.8 h)

Signatures resolved via `api.openchain.xyz/signature-database`, each with `hasVerifiedContract: true`.

```
Settlement Pool Factory   412 logs, 1 topic
    412  PoolCreated(address,address[],uint128,address,uint128,uint128,address,uint256)

Oracle Contract          9169 logs, 3 topics
   5148  FeeBatchProcessed((uint128,uint256,uint128)[],(uint128,string)[])
   3681  WithdrawalsProcessed(address,uint128[],(uint128,string)[])
    340  OLPToPoolTransfer(address,address,uint128,uint256,uint128,uint128)

Protocol Treasury / Core OLP Vault / Loss Refund Pool
    no code, so no events by construction
```

The address the venue names **Oracle Contract** emitted, over ~42 hours, fee batching, withdrawal
processing and OLP-to-pool transfers. **None of the topics it emitted carries a price.**

## What the venue documents about its prices

- *"The index price represents the real-time price of an underlying asset, and is sourced from the
  Variational Oracle."*
- Quoted price is *"the price at which the Omni Liquidity Provider (OLP) is willing to execute a
  trade."*
- Funding: `premium = impact_price_difference / index_price`, from RFQ bid/ask at a $7,500 notional,
  computed every 60 s and averaged over a 1–8 h window.
- Equity RWA perps: *"Fixed Mode is applied on Equity-based RWA Perps. No recalculation occurs, the
  Price Index remains fixed at the last available value."* Commodity RWA perps use an "Orderbook
  EWMA Mode".
- OLP is team-seeded today — *"Initially, the Variational team has provided seed capital for OLP"* —
  with user deposits via a community vault described as future work. 20% of spreads paid to OLP go
  to the treasury, a share the docs call *"still being tested and is subject to change"*.

## The public endpoint, sampled while the NYSE was closed

`GET https://omni-client-api.prod.ap-northeast-1.variational.io/metadata/stats` is unauthenticated
and returns `mark_price`, `funding_rate`, `funding_interval_s`, quoted bid/ask at several notional
sizes, and 24 h aggregates. It does **not** return an index price.

At 22:17:32Z and 22:29:40Z on 2026-08-09 — NYSE closed until Monday 13:30 UTC, CME Globex reopened
at 22:00 UTC, crypto continuously open — 534 markets, $439.3M 24 h volume, $145.8M TVL, $1.449B open
interest, `loss_refund` at `pool_size: 0`, `refunded_24h: 0`.

~~**Funding sat at zero for the markets whose underlying was closed, and nonzero everywhere else.**~~
**That sentence was wrong, and the sampler that was left running is what disproved it.** It was
inferred from those two snapshots, both taken while the NYSE was shut: every US single name and ETF
read `0.0000` and it looked like a consequence of the closure.

Over the full capture — 1,398 successful samples, 2026-08-09T22:52Z to 2026-08-10T23:33Z, spanning
the entire 2026-08-10 NYSE regular session — the correlation runs the **other way**:

| | in-session (390 samples) | outside (1,008 samples) |
| --- | --- | --- |
| every equity/ETF sampled | nonzero funding in **0** | SOXL 338, US500 150, MU 101, QQQ 91, … |
| BTC | nonzero in **390** | — |

So funding at zero does not track "underlying closed". Every sampled equity read exactly zero
*inside* the open session, and several read nonzero *outside* it. `funding-by-session.json` is the
frozen result, with its session rule written out, and it says in its own body that it shows a
correlation over **one** session and no mechanism.

Pre-IPO markets carried `0.0548`/8h at the snapshot, crypto `0.0856`–`0.1095`/8h, reopened
commodities `0.0885`–`0.8146`/4h.

This is the second claim in this record to be withdrawn, and it failed the same way as the first:
a sentence that sounds causal, inferred from two samples, in the direction that made the story
tidier.

**Marks kept moving anyway.** Over those 12 minutes, with the NYSE shut, SOXL moved −47.4 bp, MSTR
−15.9 bp, QQQ +11.9 bp, and quotes refreshed roughly every 30 s.

**Quoted half-spread at the $100k tier spanned two orders of magnitude.** BTC 0.73 bp, QQQ 2.31 bp,
XAU 1.74 bp, CL 2.00 bp — against TSM 35.33 bp, EWJ 45.50 bp, QCOM 108.88 bp, ANTHROPIC 139.94 bp,
IWM 166.71 bp, OPENAI 171.53 bp. These are **quoted half-spreads at a quoted size**, not realised
slippage, and not the $1M size used in the venue's own published comparison against another
platform. They do not restate that comparison.

## The dividend window, and what the issuer says

`AAPL` reported `funding_interval_s: 3600` while every other equity reported `28800` — the venue's
documented dividend-adjustment behaviour, visible in public data. The sampler was started for it and
caught the far edge: the value returned to `28800` between the last `3600` sample at
**2026-08-10T00:08:23.270Z** and the first `28800` sample at **2026-08-10T00:09:23.272Z**. The
transition is bracketed to that 60 s interval; no exact instant is claimed.

`aapl-window-close.json` is the frozen slice — 107 samples across the transition, with its source and
the bracketing boundary. Verify it as a file, not as a body:

```bash
shasum -a 256 aapl-window-close.json
# 18d1fc39768f23430b085eda955d1c28a49f6da716795763eea4ba712212d991
```

An earlier version of this file advertised a different digest computed over an unspecified
serialisation, with no way to check it. That was not a content address, and the string is gone.

**The capture has holes** — four gaps over 90 s (2,481 s, 2,295 s, 368 s, 202 s), almost certainly
machine suspends. They appear in the frozen artefacts as `capture_gaps` entries rather than as
absences the reader has to notice, which is why every record carries its own fetch time.

From Apple's investor-relations dividend history — the issuer, not an aggregator: **declared
2026-07-30, $0.27 per share, record date 2026-08-10, payable 2026-08-13.** US settlement is T+1, so
the ex-date is the record date, **Monday 2026-08-10**. The venue documents its window as *"from the
previous business day (ex_date - 1) to the morning of the ex-dividend date"* — Friday 2026-08-07
through Monday morning — with a one-hour funding interval inside it and `reduce_only` at 18:00 ET.

The observed close therefore falls roughly **13.4 hours before the morning of the ex-dividend date**.
That is a dated question and not a finding: the **opening edge was never observed**, so nothing here
distinguishes *"the window ended early"* from *"ex_date − 1 is being read as a calendar day rather
than a business day"*, which would make the window about two hours. The special funding payment
itself was not observed at all. It is insufficient as evidence of anything about the venue's conduct.

## What this establishes

Exactly this, and it is worth stating in one sentence because a bigger version of it did not survive
review:

> **Over the scanned interval, the five named addresses emitted no price-bearing event.**

That is a fact about *events*, from *those addresses*, over *that window*. It is a reason to be
curious, not a description of where the venue's prices live.

## What this does NOT establish

1. **It does not establish that the venue's prices are off-chain.** The scan counted event topics.
   It did not read contract storage, trace calls, or inspect any address outside the named list. A
   price in any of those places makes a broader conclusion false. An earlier version of this record
   said the chain "carries no price", that there is "no public record of valuation", and that no
   claim-type here could re-execute the venue's prices. Those sentences asserted the exact absence
   this section says cannot be proven, and they were the premise offered for admitting a new
   claim-type. They are withdrawn rather than deleted, because a reader who saw them should learn
   they were wrong.
2. **It does not survey what the venue publishes.** The address list is named and dated, and the
   source page was read differently at two times. See above.
3. **The Fixed Mode freeze was not measured.** It is quoted from documentation. The endpoint exposes
   `mark_price` only, so this record shows funding at zero and marks moving — both consistent with a
   frozen index, neither a measurement of one.
4. **Nothing here is settlement-grade.** The endpoint is the operator's own, unsigned, and addresses
   no block; the RPC reads address `latest` rather than a pinned block. A REST response cannot be
   re-fetched as of a past instant at all.
5. **No conclusion about solvency, conduct, or the venue's obligations to anyone.**

## Reproduce

```bash
node probe.mjs                 # every on-chain number above; ARB_RPC to override the endpoint
node probe.mjs --blocks 20000  # a shorter scan
node sampler.mjs               # append 60s samples of the public stats endpoint to samples.jsonl

shasum -a 256 aapl-window-close.json funding-by-session.json mainnet-contracts.captured.md probe-output.txt
# 18d1fc39768f23430b085eda955d1c28a49f6da716795763eea4ba712212d991  aapl-window-close.json
# 05349f7595dd8b298eaf4e52e2be546f7edc52345c0258685771cb8f1105a24e  funding-by-session.json
# a5248decfbc03fe231e382b9dd7eb80e8292ce23c3535b698c0e47622337a8a2  mainnet-contracts.captured.md
# 1887be7f2e757d1b4f7f920e35de4b8c97a22251f69b922ebfaaa3165b7d3143  probe-output.txt
```

`samples.jsonl` and `sampler.log` are not committed: a growing stream is not evidence, a pinned
slice is. A full scan rate-limits the public RPC, so `probe.mjs` retries with backoff rather than
ending early — an under-counted scan would err in the direction that flatters this record.

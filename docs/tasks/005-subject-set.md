# Task 005 addendum — the subject set (review finding F8)

**Author:** CC (frame-thin: which venues get named) · **Consumer:** Codex · **Branch:** `codex/005-standing-board`
**Companion:** [`reviews/005-standing-board.md`](../../reviews/005-standing-board.md)

The 005 review left F8 open with a promise: I supply the subject set, Codex wires F1–F3/F5, then one
run produces a board with real rows. This is that subject set — **measured, not asserted**. Every
number below came from `api.mainnet-beta.solana.com` on 2026-08-07 and every one of them is
reproducible by the reader with the command given.

It also reports the thing I did not expect to find: **the sound row the brief requires is not
sourceable yet, and CMLS as implemented may not be able to carry it at all.** That is a claim-type
finding, not a keeper finding, and it is the most important paragraph in this file.

## 1. What I measured

Starting from the one account the published corpus already names
(`A2GDb4Um…` — Jupiter Lend, SPYx), I enumerated its siblings: `getProgramAccounts` on its owner
`jupnw4B6Eqs7ft6rxpzYLJZYSnrpRgPcr589n5Kv4oc`, `dataSize` 393, returns exactly **four** accounts.
All four, over the closed weekend 2026-08-01 → 2026-08-03:

| price account | idx | signal | n | open | closed | max gap | flag |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `A2GDb4Um4Tr42iKgPz5fQ2d7pYTnaUuHN3d5V41Cywff` | 3 | LIVE_THROUGH_CLOSURE | 2053 | 0 | 2053 | 4 min | **RED** |
| `A4RuZpjfbdzo1fQTqu1ng7kNya1knC2fHSSG5Sv4G4EH` | 2 | LIVE_THROUGH_CLOSURE | 1908 | 0 | 1908 | 4 min | **RED** |
| `BJWkdfRiH2Yroomx27VS1TxGxPWcfQoXHMmafBY7apZo` | 1 | LIVE_THROUGH_CLOSURE | 1939 | 0 | 1939 | 4 min | **RED** |
| `DLuv79r7JPgdF2C266h1kuX8DPhg2amDtaTqz9Zm25w1` | 4 | LIVE_THROUGH_CLOSURE | 1870 | 0 | 1870 | 4 min | **RED** |

And on a normal trading day (2026-08-05, the window shape a daily keeper actually opens):

| price account | n | open | closed | max gap | flag |
| --- | --- | --- | --- | --- | --- |
| `A2GDb4Um…` | 1069 | 285 | 784 | 4 min | **RED** |

The corpus row reproduces exactly (RED, max gap 4 min), so the measurement path is the same one a
challenger walks.

Reproduce any row:

```bash
node -e "
import('./core/rpc.mjs').then(async ({fetchObservations}) => {
  const { classifyUpdateTimes } = await import('./claimtypes/closed-market-soundness.mjs');
  const obs = await fetchObservations('https://api.mainnet-beta.solana.com',
    'A2GDb4Um4Tr42iKgPz5fQ2d7pYTnaUuHN3d5V41Cywff',
    { from: 1785542400, to: 1785715200 });
  console.log(classifyUpdateTimes(obs.map(o => o.blockTime)));
});"
```

### What the venue is actually doing

I pulled one update transaction. The instruction is
**`RefreshPriceFeedWithChainlink`**, CPI-ing into `Gt9S41PtjR58CbG9JhJ3J6vxesqrNAswbWYbLNTMZA3c`
(Chainlink Data Streams verifier), and each oracle account stores its 32-byte Data Streams feed id
at bytes 16–46 (prefixed `0x0002`):

| price account | Chainlink Data Streams feed id |
| --- | --- |
| `A2GDb4Um…` | `0x0002c6ba1b453a15c1fe9dcd82265ca47bcd04e7b3667de1623617c45cef2a77` |
| `A4RuZpjf…` | `0x000237a55df2ef907d8fa06af6632bc16da58a62b68be2e1994efaa037a0918a` |
| `BJWkdfRi…` | `0x000280c655069b61d168b887d5e7f4231fe288c6ccb84b1854c9ccead20f3398` |
| `DLuv79r7…` | `0x00021db22e3e1aa657d910dc90e1f0dbe693d345b7b0b04fd9efc8eb17aef267` |

This matters for how the row is *worded*. The refresh loop runs on a wall clock — every ~4 minutes,
straight through the weekend. Whether the Data Streams report itself carries a market-status field
is the next thing to establish; if it does, the row's claim sharpens from "this feed updates while
the market is closed" to "the status was on the wire and the refresh published anyway", which is a
statement about a *choice* rather than about an oracle's quality. Do not put the stronger wording on
the board until someone has decoded a report and can show it.

## 2. Naming discipline — three of the four accounts stay off the board

Only `A2GDb4Um…` gets a venue and an asset, because that is the only one the published corpus
already stands behind. For the other three I can prove, from chain data alone:

- they are owned by the same Jupiter oracle program, and
- they are refreshed from Chainlink Data Streams feed ids I can print.

I **cannot** prove which asset each one prices. Mapping a Data Streams feed id to a ticker needs
Chainlink's feed registry, which is off-chain. Naming a venue and an asset next to a bonded RED
verdict on a guess is the single worst failure mode this project has — it converts a resolver into
a libel machine, and re-execution would not save us, because re-execution proves the *timestamps*,
never the *label*.

**So:** ship one named subject now. The other three become one-line additions the moment someone
resolves the feed ids against Chainlink's registry — a five-minute task for whoever has it open.

## 3. The set, as configuration

```jsonc
"subjects": [
  {
    "venue": "Jupiter Lend",
    "question": "Does Jupiter Lend's SPYx price feed stop updating while the US equity market is closed, so that liquidations cannot run against a price the regulated market never printed?",
    "priceAccount": "A2GDb4Um4Tr42iKgPz5fQ2d7pYTnaUuHN3d5V41Cywff",
    "windowSecs": 86400,
    "yesWhen": ["GREEN", "YELLOW"]
  }
]
```

Three deliberate departures from `keeper/config.example.json`:

- **`yesWhen` is `["GREEN","YELLOW"]`, not `["GREEN"]`.** See §4 — CMLS cannot emit GREEN, so the
  example config's market has a YES side that is unreachable by construction. YELLOW
  (`FROZEN_THROUGH_CLOSURE`) is the reachable sound verdict. UNKNOWN is deliberately excluded: "we
  could not tell" must not read as "the venue is fine".
- **The question is worded as the *sound* proposition**, so YES = the venue is fine. The example
  config's phrasing ("Does … avoid liquidating …") is fine too; what matters is that the wording and
  the mask agree on which direction is good news. A board where YES sometimes means "bad" is
  unreadable.
- **`windowSecs` is 86400 and must not go lower.** See §4.

## 4. The sound row: why it is not here, and what stands in its way

The brief calls this a requirement, not a nicety: *"a board that only ever prints RED is a hit piece
and will be read as one."* I agree, and I could not satisfy it. Four separate obstacles, in
increasing order of how much they should worry us:

### 4a. GREEN is unreachable — the best available "sound" verdict is YELLOW

`claimtypes/closed-market-soundness.mjs:56-58`:

```js
const guardFromSignal = (s) => s === 'LIVE_THROUGH_CLOSURE' ? 'NONE' : s === 'FROZEN_THROUGH_CLOSURE' ? 'STALENESS_ONLY' : 'UNKNOWN';
// liveness establishes the RED side; GREEN (a program-side price band) is a separate policy claim-type.
const flagFromGuard = (g) => g === 'NONE' ? 'RED' : g === 'STALENESS_ONLY' ? 'YELLOW' : 'UNKNOWN';
```

`reexec::cmls::verdict` in Rust is the same three-way. GREEN is documented as out of scope for this
surface. This is not a defect — it is an honest boundary — but it means the brief's "re-executes to
a sound verdict" has to mean **YELLOW**, and it means `yesWhen: ["GREEN"]` anywhere is dead.

### 4b. A genuinely sound feed is *silent* on weekends — and a silent window cannot be a market

This is the one that changes the design, not just the config.

A market-hours-guarded feed publishes during the session and stops. On a trading-day window that
gives `closedUpdates === 0` → `FROZEN_THROUGH_CLOSURE` → YELLOW. Good — that is the row we want.

But the keeper's window is `[floor(now/86400)*86400 - 86400, …]` — the previous **UTC calendar** day.
Run it on a Sunday or a Monday and the window is Saturday or Sunday. A sound feed emitted **nothing**
in that window, so:

1. `reconstruct` throws `returned no observations` (`keeper/lib.mjs:141`) — and per review **F1**
   that unhandled throw takes down the crank loop, the remaining subjects, and the board write. The
   most valuable row on the board would break the keeper **twice every week, on schedule**.
2. Even with F1 fixed, the market cannot be opened at all: `open_market` enforces
   `require!(n_records > 0, VrdctError::NoRecords)` (`onchain/…/lib.rs:158`). **CMLS cannot express
   its own strongest sound case** — "this feed said nothing for 48 hours while the market was
   closed" is the most convincing evidence of a guard that exists, and it encodes as the empty input
   set, which the program rejects.

Consequences, and they are Codex's to wire:

- **Window selection must be trading-day aware, not UTC-calendar aware.** `core/campana.mjs` already
  has the calendar; the window should span a session and its surrounding closure (so both
  `openUpdates > 0` and closed time are inside it), and the keeper should simply not open a market
  for a subject on a day that has no session.
- Until that exists, a sound subject configured with `windowSecs: 86400` is a scheduled outage.

### 4c. Half-day sessions are counted as CLOSED — a sound feed gets a false RED on 2026-11-27

`marketStatus` returns `HALF_DAY` for the shortened session, and the classifier's split is
`st.status === STATUS.OPEN` — so a half-day session lands on the **closed** side. The Rust twin says
so out loud (`reexec/campana.rs:8`: *"a HALF_DAY session is NOT `OPEN` — the JS classifier counts it
on the CLOSED side"*), so this is deliberate and twinned, not an accident.

Deliberate or not, work it through for the row we most want to publish. `CALENDAR_2026.halfDays` is
`['2026-11-27', '2026-12-24']`. On 2026-11-27 a perfectly guarded feed publishes 09:30–13:00 ET —
the session — and is silent the rest of the day. Every one of those in-session updates is counted as
closed; consecutive gaps are ~4 minutes, so `closedUpdates > 0 && maxGap < 30min` →
`LIVE_THROUGH_CLOSURE` → **RED**, with the reason string *"The price account updated N× while the US
market was CLOSED"* — about a window in which the market was open.

That is a false public accusation against the one venue on the board that did the right thing, on a
date already in the committed calendar, reachable by a keeper that just keeps running. It is worse
than being wrong in our own favour.

Two ways out, and this is a decision, not a cleanup:

- treat `HALF_DAY` as open in both twins (a consensus change: parity vectors must be regenerated
  deliberately and the corpus verdict re-checked — its window is 2026-08-01→05, no half days, so
  `inputs_hash` and the published verdict are unaffected), **or**
- have the keeper refuse to open any market whose window overlaps a half day, and say so on the
  board.

I prefer the first: the second leaves the claim-type able to state something false, and only papers
over the path that happens to reach it.

### 4d. I could not source a market-hours-guarded Solana equity feed today

What I tried: sample the Chainlink Data Streams verifier's consumers during a closed window and
during a session, and diff — a consumer present only during sessions is a sound candidate. It
stalled on plain throughput: the verifier is busy enough that paging back four days exceeds
`getSignaturesForAddress`'s practical depth on a public endpoint, and I hit
`Too many requests for a specific RPC call` twice just measuring four accounts back to back.

This is a real constraint, not an excuse, and it belongs on the board's face: **a weekend window on
one of these accounts is ~2,000 observations, i.e. 3+ RPC pages, and `api.mainnet-beta.solana.com`
will rate-limit the stranger we are inviting to falsify the row.** Either the board names an
endpoint that can serve the check, or it says plainly that a public endpoint will not.

Finding the sound feed needs an indexer-grade RPC. It is a bounded search once one is available, and
I will run it — but it is not something I can hand over as measured fact today, and I would rather
hand over nothing than a venue name I did not verify.

## 5. Blockers this exposed in the keeper (new; also filed in the review addendum)

- **One `rpc` serves both the market cluster and the source** (`keeper/lib.mjs:310` and `:173`), and
  `cli/vrdct.mjs` has the same single `RPC` env. Every subject here is a **mainnet** account; the
  bonds are meant to be **devnet**. As built, a devnet board about mainnet sources is impossible —
  and worse, `vrdct check` pointed at devnet would find zero signatures and print **DO NOT BOND** on
  a row that is fine. Needs a `sourceRpc` / `SOURCE_RPC` split, carried into the falsifier line the
  board prints.
- **`normalizeConfig` accepts `windowSecs >= 60`.** A window entirely inside a session has
  `closedUpdates === 0` → YELLOW → a spurious *sound* verdict, on a venue that might not be. The
  floor should be a full day, or better, §4b's trading-day selection.
- **`yesWhen: ["GREEN"]` in `config.example.json` is unreachable.** It does not misroute payouts —
  `settle` pays on `resolver_flag == truth`, and `yes_when` only derives the YES/NO readout — but the
  market's stated question can then only ever answer NO.

## 6. What I am asking for

1. Codex: review F1–F3 and F5 fixes as filed, plus the `sourceRpc` split and trading-day window
   selection from §4b/§5.
2. A decision on §4c (half-day) — mine is "make `HALF_DAY` open in both twins", but it is a
   consensus change and Hiro should sign off before parity vectors move.
3. The board ships with **one** named RED row and a header that says, in words, that it has no sound
   row yet and why. A board that is honest about being incomplete is still an instrument. A board
   that pads itself with three unverified venue names to look balanced is the hit piece we were
   trying not to write.

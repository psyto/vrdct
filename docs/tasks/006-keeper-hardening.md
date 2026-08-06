# Task 006 — What 005 needs before it merges

**Assignee:** Codex (frame-thick) · **Reviewer:** CC · **Branch:** `codex/005-standing-board` (same branch; 005 is not merged)

**Inputs:** [`reviews/005-standing-board.md`](../../reviews/005-standing-board.md) (F1–F13) and
[`005-subject-set.md`](./005-subject-set.md) (the measured subject set and why there is no sound row).
Read both; this file is the work order, not the argument.

---

## Why there is a 006 at all

Most of this is "address the findings on the same branch" per `AGENTS.md`. Two items are not fixes,
they are design changes the review uncovered — trading-day window selection (§B1) and the source/
cluster RPC split (§B2) — and one is a consensus change to the claim-type (§C). Those deserve a
brief rather than a bullet in a review reply.

The ordering below is the ordering I want: **A before B before C.** A is money that leaks with the
code exactly as committed. B is what makes a real run possible at all. C is what stops the board
telling a lie in November.

---

## A. Custody and liveness — the keeper currently hands money away

### A1 (F1) — isolate per market and per subject

`lib.mjs:315-319`. Both loops are bare `await`s and nothing is caught, so one failure ends the run.
Reproduced: a two-subject config where the second subject's source is quiet bonded 0.1 SOL on the
first subject and then wrote **zero** board files.

The crank case is the one that costs: if `crankMarket(A)` throws, market B is never cranked and
`expire_challenged` pays B's challenger the whole pot on a market the keeper was right about. An
adversary who challenges two positions only needs to make *one* unreconstructible.

- every market's crank and every subject's open runs independently; a failure records and continues
- the board write runs even when everything before it failed
- failures are part of `runKeeper`'s result and appear **on the board** — "this subject did not open
  this window, because X" is a row a reader can act on, and hiding it is how a board starts lying by
  omission

### A2 (F2) — feed from the bytes we committed, not from whatever RPC still serves

`lib.mjs:230-232` refuses to feed unless it can re-fetch the window and reproduce `inputs_hash`.
`settle` (`lib.rs:354-358`) accepts a Feed only when `feed.count == n_records` **and
`feed.digest == inputs_hash`** — the program itself proves the bytes are the committed ones. So
completing the Feed from bytes cached at open time cannot settle anything other than the committed
input set, and refusing to feed buys no integrity while handing the challenger 100% of the pot.

`core/rpc.mjs:19` caps at 20 pages × 1000 signatures from the current head, so a window drifts out of
reach as signatures accumulate — and an adversary can *cause* that: challenge, spam the source
account past the pagination depth before `settle_by`, collect at expiry without ever rebuilding
anything.

- persist `commitment.chunks` (and `nRecords`, `inputsHash`) alongside each opened market
- crank feeds from the cache; the RPC rebuild becomes a **warning surfaced on the row**, never a
  refusal
- keep the refusal on the *open* path, where "this descriptor does not rebuild" genuinely means
  do not bond

### A3 (F3) — a row that cannot rebuild is skipped, not fatal

`lib.mjs:296-301` throws inside `writeBoard`, so the first market whose window ages out of RPC
retention freezes the board permanently. `keeper/README.md` already describes the intended
behaviour ("a missing row is preferable to a row that cannot be independently falsified") — make the
code match it, and print why the row is absent.

### A4 (F5) — custody is not a function of the current config file

`lib.mjs:257-266` only cranks markets matching a *currently configured* subject by
`marketId(question)` and `priceAccount`. Copy-editing a question silently drops every live position
under the old wording out of the crank loop, and they expire against us.

- crank **every** market where `resolver == keeper`, regardless of config
- keep the config filter for opening only

### A5 (F4) — reclaim what we win

`claim_uncontested` (`lib.rs:449`) is permissionless and returns the resolver's bond after
`challenge_until`; the keeper never calls it, so every uncontested position — the common path —
leaves its bond parked. Add it.

Do **not** add `close_market` in the same pass without handling the interaction: closing frees the
PDA, and the PDA is the idempotency key, so a claim-and-close inside a still-open window re-opens and
re-bonds the same definition on the next run. Claim now; close only once the window has rolled.

---

## B. Make a real run possible

### B1 (F11, F10) — windows must be trading-day anchored, not `floor(now/windowSecs)`

This is the design change. A market-hours-guarded feed — the sound row the brief requires — emits
**nothing** on Saturday and Sunday, so the current previous-UTC-day window is empty for exactly the
subject we most want. That is not a corner case, it is twice a week on a schedule, and even with A1
fixed the market still cannot be opened: `open_market` requires `n_records > 0` (`lib.rs:158`).
CMLS cannot currently express its own strongest sound case.

Symmetrically, `normalizeConfig` accepts `windowSecs >= 60`, and a window sitting entirely inside a
session has `closedUpdates === 0` → YELLOW → a *sound* verdict manufactured by a window with no
closure in it.

**Design I want (open to a better one, argue it in the PR):** the window is
**close-to-close** — from the previous trading day's session close to the most recent completed
session close, both derived from `core/campana.mjs` (`marketStatus().last_close_ts` already gives
the second one; the first needs a small "previous trading day" helper).

- every such window contains a full session **and** its surrounding closure, so `openUpdates` and
  `closedUpdates` are both meaningful and RED and YELLOW are both reachable
- Friday-close → Monday-close naturally spans the whole weekend, which is where RED is most damning
- it is a pure function of chain time bucketed to the trading day, so the PDA stays the idempotency
  key and re-running inside a bucket still dedupes
- half-day closes (13:00 ET) fall out of `closeMinFor` for free
- `windowSecs` stops being a subject field, or is kept only as a floor with a full-day minimum

### B2 (F9) — split the source RPC from the cluster RPC

`lib.mjs:310` and `lib.mjs:173` share one `config.rpc`; `cli/vrdct.mjs:15,126` shares one `RPC` env.
Every nameable subject is a **mainnet** account; the bonds are meant to be **devnet**. As built those
cannot both hold, so task 005 has no cluster it can actually run on.

It also fails deceptively: a devnet market with a mainnet descriptor, checked with `RPC=devnet`,
finds zero signatures and prints **DO NOT BOND** on a sound row — the loudest safety message in the
CLI firing on a config error.

- `sourceRpc` in keeper config and `SOURCE_RPC` in the CLI, both defaulting to the cluster RPC so
  same-cluster use is unchanged
- the board's falsifier command must carry it; a row is only falsifiable if it says where its source
  lives

### B3 (F12) — say what the falsifier needs

A weekend window on a configured account is ~2,000 observations, 3+ `getSignaturesForAddress` pages.
`api.mainnet-beta.solana.com` rate-limited me twice while measuring four accounts back to back. Name
an endpoint on the board that can serve the check, or state plainly in the header that a public one
will not. Same root cause as A2: RPC reachability is a money variable here, not a convenience.

---

## C. The half-day decision (F13) — **decided: `HALF_DAY` becomes open**

Hiro approved this on 2026-08-07. Recording it here because it is a consensus change and the repo is
the only shared memory.

Today `marketStatus` returns `HALF_DAY` and both classifiers split on `=== STATUS.OPEN`, so a
shortened session lands on the **closed** side — deliberate and twinned
(`reexec/campana.rs:8` says so). The consequence: on `2026-11-27` or `2026-12-24` a correctly
guarded feed publishes 09:30–13:00 ET and is silent otherwise; those in-session updates count as
closed with ~4-minute gaps → `LIVE_THROUGH_CLOSURE` → **RED**, with the reason string *"updated N×
while the US market was CLOSED"* about a window in which the market was open. That is a false public
accusation against the best-behaved venue on the board, on a date already in the committed calendar.

**Change:** a `HALF_DAY` session counts as open in the classifier, in **both** twins.

Obligations that travel with it — none of these are optional:

- `claimtypes/closed-market-soundness.mjs` and `onchain/…/reexec/cmls.rs` change **together**; the
  stale comment at `reexec/campana.rs:8` is part of the change
- regenerate `onchain/tests/parity-vectors.txt` **deliberately**, with the reason in the commit
  message, and add vectors that actually cover a half-day session on both sides of the boundary
- the corpus is expected to be untouched (window 2026-08-01→05, no half days): prove it — run
  `node reconstruct.mjs corpus/jupiter-spyx-cmls.claim.json`, `npm run test:canonical`, and state in
  the commit that the published `inputs_hash` `2f224c44f93a8e2c…` is unmoved. If it moves, stop.
- `README.md` "Honest scope" gains a sentence: what a CMLS verdict counts as open. It changes what a
  verdict means, and that section is a contract with readers.

---

## D. Tests

New branching logic ships with tests. Specifically:

- **A1:** a two-subject config where one subject's source is quiet — the other subject still opens
  and the board is still written; and a two-market crank where one is unreconstructible — the other
  still settles. Both are the actual money paths.
- **A2:** crank succeeds from cache when the source no longer rebuilds; the settled market shows
  `by_reexecution == 1`.
- **A3:** an unpublishable row is skipped and the board still writes, with the skip visible.
- **A4:** a market opened under an old question string is still cranked after the config is edited.
- **A5:** an uncontested position is claimed and the bond returns to the keeper.
- **B1:** window selection over a Friday/Saturday/Sunday/Monday sequence and across a half day —
  pure, no validator needed, so it belongs in `npm run test:canonical`.
- **C:** parity vectors covering a half-day session, JS and Rust agreeing.
- **F6:** fix the existing E2E's boundary race — open the minute *first*, then write the source
  records inside it (or derive the window from the first observation's `blockTime`). I hit the
  failure it allows on my first repro attempt.
- **F7:** replace the tautological determinism assertion — `renderBoard` ignores `chainNow`, so the
  current one cannot fail. Assert on two `writeBoard` outputs over unchanged chain state.
- **`normalizeConfig`** gets unit tests in `npm run test:canonical`. It is the largest new branching
  block in 005 and the E2E bypasses it entirely.

---

## E. Acceptance criteria

- [ ] No single subject, market, or RPC failure can prevent another market's crank or the board write.
- [ ] A challenged position is defended from cached bytes with the source unavailable.
- [ ] Uncontested bonds are reclaimed.
- [ ] Windows are trading-day anchored; a guarded feed produces an openable market on a weekend-spanning window.
- [ ] Source RPC and cluster RPC are separable, and the board's falsifier line carries both.
- [ ] `HALF_DAY` counts as open in both twins, parity vectors regenerated deliberately, corpus `inputs_hash` unmoved and *shown* to be.
- [ ] `README.md` "Honest scope" updated in the same commit as C.
- [ ] The board ships with the one named RED row from `005-subject-set.md`, and a header that says in
      words that it has no sound row yet and why.

## F. Out of scope

- Mainnet and any real SOL. Still Hiro's call, still on top of a running system.
- Naming the three unidentified Jupiter oracle accounts. They stay off the board until someone maps
  their Chainlink Data Streams feed ids to tickers against Chainlink's registry — see
  `005-subject-set.md` §2. Re-execution proves timestamps, never labels.
- Finding a market-hours-guarded feed to serve as the sound row. That needs an indexer-grade RPC and
  it is mine, not Codex's.
- Any outreach or distribution.

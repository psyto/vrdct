# Review — Task 005, a standing board (`061bd85`)

**Reviewer:** CC · **Author:** Codex · **Branch:** `codex/005-standing-board`

## Verdict

**CHANGES** — the machinery is right where it touches the chain: the encoders, account orders, and
byte offsets are exact, the keeper asserts only the flag it re-executed, and the crank path settles
by re-execution. I ran the committed E2E on my own validator and it passes.

But the keeper's error handling is a single unguarded `await` chain from the first market to the
last, so **one dud subject takes down the crank loop, the remaining subjects, and the board** — I
reproduced a run that bonded 0.1 SOL and then wrote no board at all. And the crank refuses to
defend a position whenever RPC history has moved under it, which is the one failure mode the brief
named as the reason a keeper exists ("a keeper that opens positions it will not defend is worse
than no keeper"). Both are money paths, both are fixable without touching the program.

Separately: the board has **zero rows**. Acceptance criteria 2 and 3 are not met. That part I do
not think is entirely Codex's to fix — see F8.

## What holds up

Verified by reading the Rust next to the JS, and by running things:

- **`decodeMarket` is byte-exact.** I recomputed every offset against `state.rs` independently:
  bump 8, definition_hash 9–41, market_id 41–73, claim_type 73, calendar_version 74, n_records 78,
  inputs_hash 82–114, source 114–163, yes_when 163, resolver 164–196, resolver_flag 196,
  resolver_bond 197, challenger 205–237, challenger_flag 237, challenge_bond 238, rent_payer
  246–278, opened_ts 278, challenge_until 286, settle_by 294, settled_ts 302, state 310,
  settled_flag 311, resolved 312, by_reexecution 313 — total 314, matching `MARKET_SIZE`.
  `decodeFeed`'s digest 73–105 / count 105 is right too.
- **All four instruction encodings match the Anchor structs**, argument order and account order:
  `open_market` (12 args, in `lib.rs:138` order), `open_feed`, `feed` (feeder is a non-mut signer —
  correctly `ro(signer, true)`), `close_feed`, and `settle`'s six accounts including the duplicate
  keeper appearing as both `cranker` and `feed_feeder`.
- **`rewardFor`'s `cut` is a faithful port of `cut_of`** (`lib.rs:108`), including the
  `amount/10_000*BPS + amount%10_000*BPS/10_000` overflow shape.
- **The keeper cannot assert against itself.** `openSubject` builds the flag from the same
  `cmls.build` output it commits, and then re-reads the account and asserts
  `resolverFlag === FLAG_ID[claim.verdict.flag]` (`lib.mjs:197`). The test checks this against
  chain state, so a keeper that inverted its own verdict would fail the suite. That was the brief's
  sharpest requirement and it is honestly met.
- **Windows come from chain time only.** `chainTime()` reads `getBlockTime(getSlot('finalized'))`;
  `Date` appears only to *format* a chain-derived number. No `Date.now()` anywhere in the keeper or
  its test.
- **Idempotency is structural, not a lookup table.** The definition hash is the PDA seed, so the
  same window resolves the same address. Confirmed on chain: second run returns `deduped` with the
  same market.
- **The crank is honest in the losing case** — it feeds and settles even when its own re-execution
  says the challenger was right. It does not selectively defend.
- `npm run test:keeper` on a fresh `solana-test-validator -r`: green
  (`idempotent open, RED assertion, challenged crank/settle, feeder reward, and falsifiable board
  verified`). `npm run test:canonical`: green, corpus `inputs_hash` untouched.
- The board header does state the devnet caveat in the header, not a footnote, and
  `renderBoard`'s "an uncontested row is uncontested, **not proven**" is the right sentence.

## Findings

### F1 (P1) — one bad subject aborts the whole run: cranks, opens, and the board

`lib.mjs:315-319`. Both loops are bare `await`s:

```js
for (const { pubkey, market } of await keeperMarkets(...)) {
  if (market.state === 1) cranked.push(await crankMarket(...));   // throws → nothing after runs
}
for (const subject of config.subjects) opened.push(await openSubject(...));
```

Nothing in `crankMarket`, `openSubject`, or `writeBoard` is caught. `reconstruct` throws on an empty
window (`lib.mjs:141`), `openSubject` throws if an equivalent definition was opened by anyone else
(`lib.mjs:187`), `simulateAndSend` throws on any RPC hiccup.

Concrete exploit path, all three variants of the same defect:

1. **Undefended custody.** The keeper holds challenged markets A and B. A's window is old enough
   that the RPC no longer serves it, so `crankMarket(A)` throws on `lib.mjs:232`. **B is never
   cranked**, and `expire_challenged` pays B's challenger the entire pot — README Honest scope #3,
   on a market the keeper was right about. An adversary who challenges two positions only needs to
   make *one* of them unreconstructible.
2. **Griefing the open path.** The definition is derived entirely from public data. Anyone can open
   the keeper's next market first, taking the same side; `lib.mjs:187` then throws forever for that
   subject and takes every later subject with it. Cost to the attacker: one bond they will most
   likely win back.
3. **A bonded position that appears nowhere.** Reproduced against a local validator — two subjects,
   the second with a quiet source:

   ```
   run ABORTED: source 5yYUuKLw…  window 1785982080-1785982140 returned no observations
   markets opened+bonded by this keeper: 1
   board files written: []
   ```

   0.1 SOL is committed on chain and the board — the artifact this task exists to produce — is not
   written at all. A venue with no activity in one window is not an error condition, it is Tuesday.

**Fix:** isolate per market and per subject. Collect failures into the result, keep going, and
surface them (they belong on the board too — "this subject did not open this window, because X" is
a row a reader can act on). Crank failures in particular must never be able to prevent a *different*
market's crank.

### F2 (P1) — the crank refuses to defend whenever RPC history moves, and it does not need to

`lib.mjs:230-232`: crank rebuilds from RPC and refuses to feed unless the rebuild reproduces
`inputs_hash`.

The Feed does not need the RPC. `settle` (`lib.rs:354-358`) accepts a Feed only if
`feed.count == n_records` **and `feed.digest == inputs_hash`** — the program itself proves the bytes
are exactly the ones the market committed to. So the keeper can complete its Feed from bytes it
cached at open time (`commitment.chunks` is already in hand at `lib.mjs:173`), and it is
cryptographically impossible for that to settle anything other than the committed input set.

Re-fetching is the right gate for a *challenger* deciding whether to bond — that is Honest scope
#1's "stop signal", and `cli/vrdct.mjs check` is correct to keep it. It is the wrong gate for a
resolver defending a bond it already posted: there, refusing to feed buys no integrity and hands
the challenger 100% of the pot.

This is not hypothetical. `core/rpc.mjs:19` caps `fetchObservations` at 20 pages × 1000 signatures
scanning backwards from the current head. For a busy account, a window drifts out of reach as new
signatures accumulate — and an adversary can *cause* it: challenge a keeper position, spam the
source account past the pagination depth before `settle_by`, then take the pot at expiry. The
challenger never needs to rebuild anything; expiry does not ask them to.

**Fix:** persist the canonical `chunks`/`bytes` next to each opened market and feed from them, with
the RPC rebuild demoted to a warning on the board row ("this window no longer rebuilds from public
RPC" is itself worth publishing). Keep the refusal on the *open* path, where it belongs.

### F3 (P1) — the board stops regenerating forever the first time any row ages out

`lib.mjs:296-301`. `writeBoard` calls `reconstruct` per market and `requireValue(…equals…)`, both of
which **throw**. `keeper/README.md` says the opposite of what the code does — "Only a configured
CMLS market whose source rebuilds to its committed hash is published" and "a missing row is
preferable to a row that cannot be independently falsified" both describe *skipping*. The code
aborts the entire board.

Since `keeperMarkets` returns every market the keeper ever opened, including settled ones, this is a
certainty rather than a risk: the day the oldest market's window leaves RPC retention, the board
freezes at its last-good content and every subsequent run dies. Skip the row, and say in the row's
place why it was skipped.

### F4 (P2) — the keeper never reclaims its own bonds

`claim_uncontested` (`lib.rs:449`) is permissionless and returns the resolver's bond after
`challenge_until`; `close_market` returns rent to `rent_payer`, which the program sets to the
resolver (`lib.rs:207`). The keeper calls neither. Every uncontested position leaves the bond parked
in the market PDA indefinitely.

On devnet this is invisible. The brief's standard is "moving devnet → mainnet must be a config
change, not a code change" — by that standard this is a code gap, and it is the one that costs
capital first, because the uncontested path is the *common* path.

One caveat when adding it: `close_market` frees the PDA, and the PDA is the idempotency key. A
keeper that claims-and-closes inside a still-open window (`challengeWindowSecs` 3600 vs
`windowSecs` 86400 in the example config — 23 hours of exposure) will re-open and re-bond the same
definition on its next run. Claim, but do not close, until the window has rolled.

### F5 (P2) — defense is silently scoped to the current config

`keeperMarkets` (`lib.mjs:257-266`) only returns markets matching a *currently configured* subject
by `marketId(question)` **and** `priceAccount`. Editing a subject's question text — a copy-edit,
which is exactly the kind of change a worded question invites — changes `marketId` and silently
drops every live position under the old wording out of the crank loop. They then expire against the
keeper. Nothing warns.

**Fix:** crank every market where `resolver == keeper`, regardless of config; keep the config filter
for *opening* only. Custody is not a function of the current config file.

### F6 (P2) — the E2E races the minute boundary

`tests/standing-board.local.mjs:72-73`: the source records are written, and *then* the window is
derived from a chain time read afterwards. If a minute boundary falls between the last transfer's
`blockTime` and the `latestChainTime()` call, `nextCompletedMinute` closes the *following* minute
and the keeper's window contains no records — `returned no observations`, run throws, test fails.

I hit exactly this failure mode on my first repro attempt, which used the same ordering:

```
run ABORTED: source 2RDbySzV…  window 1785981900-1785981960 returned no observations
```

Roughly a 1-in-60 flake, but the class matters more than the rate — the 003 review already caught a
custody test that "reproduced pass-then-fail and therefore proved nothing". **Fix:** open the minute
first, then write the source records inside it (my second repro does this and is stable), or derive
the window from the first observation's `blockTime` rather than from wall-position.

### F7 (P2) — the determinism assertion is a tautology

`tests/standing-board.local.mjs:125` asserts
`renderBoard({chainNow: 1, rows}) === renderBoard({chainNow: 2, rows})`. But `renderBoard`
(`lib.mjs:268`) destructures `chainNow` and never reads it — the assertion cannot fail for any
input. It tests that an unused parameter is unused.

The brief asked for "deterministic given the same chain state", which is a statement about *two
keeper runs*, not about one pure function called twice. Either assert on two `writeBoard` outputs
over unchanged chain state, or drop the parameter. Related: because `chainNow` is dropped, the board
carries **no generation time at all** — only the dated filename does, and `board/README.md` on its
own cannot tell a reader how stale it is. A chain-derived "as of" line is worth more than the
byte-identity property being protected here.

### F8 (P2) — the board is empty; acceptance criteria 2 and 3 are not met

`board/README.md` is hand-written prose, not `renderBoard` output, and will be overwritten wholesale
by the first real run. There are no rows, no named venue, and no GREEN row. Criterion 3 — "at least
one configured subject re-executes to a sound verdict, and the board shows it" — was flagged in the
brief as a requirement rather than a nicety, because a board that only ever prints RED is a hit
piece.

The commit is honest about this, which counts for something, and I do not think the whole gap is
Codex's: *which venues get named* is frame-thin product work, i.e. mine under `AGENTS.md`. The
part that is Codex's is that nothing prevented shipping the machinery against a devnet keypair the
keeper generates and airdrops to itself — no external input was actually required to produce a
first real row.

**Proposal, so this does not sit blocked:** I supply the subject set (venues, worded questions,
price accounts, including at least one expected to come out sound, drawn from the corpus and the
Vesper lineage) as a follow-up commit on this branch; Codex wires F1–F3 and F5; then we do one
devnet run and commit the resulting board with real rows. Criterion 3 is met by that run, not by
this diff.

### Nits

- **`normalizeConfig` is untested.** It is the largest new branching block in the diff (`lib.mjs:52`)
  and the E2E bypasses it entirely by hand-building a normalized object with a `BigInt` bond and a
  `PublicKey`. It is pure and needs no validator — it belongs in `npm run test:canonical`, where it
  would run on every commit rather than only when someone starts a validator.
- **The falsifier command is not runnable from a clean clone.** Rows print
  `node cli/vrdct.mjs check <addr>`, but `@solana/web3.js` lives in `cli/node_modules`; a stranger
  gets `ERR_MODULE_NOT_FOUND`. For a row whose entire purpose is being falsifiable by the person
  reading it, include the `cd cli && npm install` step (or a `--prefix` form that works from root).
- **`rewardLamports` understates the both-sides-wrong case.** `rewardFor` (`lib.mjs:201`) returns
  `cut(pot)`, but in that branch `settle` (`lib.rs:379-386`) makes the feeder the *winner* too, so
  the keeper receives the whole pot. The CLI prints it as "feeder reward", which will read as a loss
  when it was the opposite.
- **`keeperMarkets` calls `getProgramAccounts` with no `dataSize`/`memcmp` filter** and decodes every
  account in a try/catch. Fine now; add the filters before this points at a public RPC that rate-limits.
- `package.json`'s `test:keeper` does `cd keeper && npm run test:local`, which needs `keeper/npm
  install` to have happened; worth one line in the root README next to the other commands.

## Summary

| | |
| --- | --- |
| Program-facing correctness (offsets, encodings, parity) | verified exact |
| Money-losing defects | **F1, F2, F3** — all three lose bonds without any program bug |
| Custody scoping | **F4, F5** |
| Test integrity | **F6, F7** |
| Brief satisfied | **no** — criteria 2 and 3 open (F8) |

F1–F3 and F5 are the merge blockers. F4 can land with mainnet. F8 needs a subject set from me.

## Addendum — findings from building the subject set (F8)

The subject set is now filed at [`docs/tasks/005-subject-set.md`](../docs/tasks/005-subject-set.md),
with measured verdicts for four mainnet price accounts. Building it surfaced four more defects and
one claim-type decision. Read that file for the measurements; these are the code consequences.

### F9 (P1) — one `rpc` serves both the market cluster and the source, so a devnet board about mainnet venues is impossible

`lib.mjs:310` builds the `Connection` from `config.rpc`, and `lib.mjs:173` passes the *same*
`config.rpc` to `reconstruct`. `cli/vrdct.mjs:15,126` has the identical single-`RPC` shape.

Every subject worth naming is a **mainnet** account — tokenized equities do not exist on devnet.
Every bond in this task is meant to be **devnet**. Those cannot both be true today, so the whole
task-005 plan ("open devnet positions about named venues") does not currently have a cluster it can
run on.

Worse than "does not run": it fails *deceptively*. A market opened on devnet against a mainnet
descriptor, checked with `RPC=devnet`, returns zero signatures — and `check` prints **DO NOT BOND**
on a row that is perfectly sound. The loudest safety message in the CLI would be firing on a
configuration error.

**Fix:** split `sourceRpc` (config) / `SOURCE_RPC` (CLI env) from the cluster RPC, default it to
`rpc` so nothing changes for same-cluster use, and print it inside the board's falsifier command —
the row is only falsifiable if it tells you where the source lives.

### F10 (P2) — `normalizeConfig` allows windows that manufacture a false *sound* verdict

`lib.mjs:71` accepts `windowSecs >= 60`. A window that falls entirely inside a trading session has
`closedUpdates === 0`, which the classifier reads as `FROZEN_THROUGH_CLOSURE` → YELLOW → "staleness
guard only" — a *sound* verdict produced by a window that contained no closure to be sound about.
An hourly cadence would print reassuring rows about venues nobody has checked.

A daily UTC window always contains closure, so `86400` is safe today; nothing enforces it. Floor
`windowSecs` at a day, and see F11 for why a day is still not the right unit.

### F11 (P1) — a genuinely sound feed is silent on weekends, and a silent window cannot be a market

Detailed in `005-subject-set.md` §4b. A market-hours-guarded feed emits nothing Saturday and Sunday,
so the keeper's previous-UTC-day window is empty for exactly the subject the brief calls the most
valuable row on the board:

1. `reconstruct` throws `returned no observations` (`lib.mjs:141`), and per **F1** that takes down
   the crank loop, the remaining subjects, and the board — **twice a week, on schedule**.
2. Even with F1 fixed the market cannot be opened: `open_market` requires `n_records > 0`
   (`lib.rs:158`). The strongest possible evidence of a working guard — 48 hours of silence —
   encodes as the empty input set, which the program rejects.

**Fix:** trading-day-aware window selection using `core/campana.mjs` (span a session plus its
surrounding closure; skip subjects on days with no session) rather than `floor(now/windowSecs)`.
This is the one item here that is a design change rather than a patch.

### F12 (P2) — the falsifier command will be rate-limited on the endpoint a stranger has

A weekend window on one of these accounts is ~2,000 observations = 3+ `getSignaturesForAddress`
pages. I hit `Too many requests for a specific RPC call` on `api.mainnet-beta.solana.com` twice while
measuring four accounts back to back. The board's central promise is "run this command yourself";
either name an endpoint that can serve it, or say on the board's face that a public endpoint will
not. Related to F2 — the same pagination limit is what makes RPC reachability a *money* variable.

### F13 (decision, not a defect) — half-day sessions count as CLOSED

`marketStatus` returns `HALF_DAY`, the classifier splits on `=== STATUS.OPEN`, so the shortened
session lands on the closed side. Both twins agree and `reexec/campana.rs:8` documents it as
intentional — so this is a design decision to revisit, not a parity break.

But on `2026-11-27` or `2026-12-24`, a perfectly guarded feed publishes 09:30–13:00 ET and is silent
otherwise; those in-session updates are counted closed with ~4-minute gaps →
`LIVE_THROUGH_CLOSURE` → **RED**, reason string *"updated N× while the US market was CLOSED"*, about
a window in which the market was open. A false public accusation against the best-behaved venue on
the board, on a date already in the committed calendar, reachable by a keeper that simply keeps
running.

My recommendation is to treat `HALF_DAY` as open in both twins. That is a consensus change — parity
vectors regenerated deliberately, and Hiro signs off. The corpus is unaffected (its window is
2026-08-01→05, no half days), so `inputs_hash` and the published verdict do not move.

### Revised blocker list

F1, F2, F3, F5 as filed, plus **F9** (no runnable cluster without it) and **F11** (the sound row
breaks the keeper twice a week). F13 needs a decision before any board runs past November.

## Re-review — `3727f67..7fc2ab2`

**Reviewer:** CC · **Author:** Codex · Four commits against `docs/tasks/006-keeper-hardening.md`.

### Verdict

**CHANGES** — but small ones. Every blocker from the first review is genuinely fixed, and I
reproduced Codex's verification rather than taking it: the parity change is sound in both twins, the
corpus is provably unmoved, and the E2E now exercises the money paths instead of asserting around
them. Three things stop me approving: the repo's primary test command no longer works on a clean
clone, the crank swapped one single point of failure for another, and the post-settle safety check
in `crankMarket` is now a tautology.

### What I verified myself

Not "Codex says" — run on my machine, against a validator I started with a binary built from the
current source (`onchain/target/program-test-deploy/vrdct_bond.so`, 09:02, newer than the 08:57
`campana.rs`/`cmls.rs` edits):

- `npm run test:canonical` — green, **162** parity vectors, 20 Rust unit tests.
- `npm run test:keeper` — green: *quiet-source isolation, idempotent close-to-close open,
  stale-config custody, cached crank/settle, source-loss board skip, feeder reward.*
- `onchain npm run test:integration` — 5/5.
- `cli` local test — 4/4 · `node demo.mjs` · `onchain/client/bond-live.mjs` both green.
- `node reconstruct.mjs corpus/jupiter-spyx-cmls.claim.json` — 3,789 observations re-fetched from
  mainnet, set match identical, **`inputs_hash` still `2f224c44f93a8e2c…`**, claim re-executes to
  its stated verdict. The consensus change did not move the published commitment, exactly as
  required.

### The findings, one by one

| | status |
| --- | --- |
| F1 per-item isolation | **fixed** — `runKeeper` records failures and continues; they render on the board |
| F2 feed from cache | **fixed** — with a new gap, see R2 |
| F3 skip, don't abort | **fixed** — `writeBoard` skips with a printed reason |
| F4 claim uncontested | **implemented**, untested end-to-end (R4) |
| F5 custody beyond config | **fixed** — `keeperMarkets` no longer filters on `subject` |
| F6 E2E boundary race | **fixed** — window derived from a finalized observation's `blockTime` |
| F7 tautological determinism | **fixed** for the board (two real `writeBoard` calls), **reintroduced** in `crankMarket` (R3) |
| F9 source/cluster RPC | **fixed** — `sourceRpc` / `SOURCE_RPC`, both printed in the falsifier line |
| F10 sub-day windows | **fixed** — `windowSecs` is now a hard error, not a floor |
| F11 trading-day windows | **fixed** — `tradingWindow` is close-to-close via `last_close_ts` |
| F12 RPC honesty | **fixed** — the board names its source endpoint and warns about pruning |
| F13 half-day | **fixed** correctly, see below |

The half-day change is right. `is_session_open` uses `HALF_CLOSE_MIN` for calendared half days and
the JS classifier counts `HALF_DAY` as open, so the two agree; the replacement vectors
(`half-day-open-at` YELLOW, `half-day-open-before-close` YELLOW, `half-day-close-at` RED) bracket
the 13:00 ET boundary from both sides, which is exactly the coverage the old single `half-day`
fixture lacked — and that old fixture's flag was RED for a timestamp *inside* the session, which is
the bug, preserved in the diff for anyone who wants to see it. `tradingWindow`'s Thanksgiving case
(Wed close → Friday half-day close, skipping the holiday) is tested and correct.

`7fc2ab2` is a good catch by Codex that I did not ask for: the test-only `chainNow` seam must never
decide a live custody deadline. Right instinct, right fix.

### R1 (P1) — `npm run test:canonical` no longer runs on a clean clone

`tests/canonical-inputs.test.mjs:9` now imports `normalizeConfig` and `tradingWindow` from
`../keeper/lib.mjs`, whose module graph pulls in `@solana/web3.js` at load time. The root
`package.json` declares **no dependencies** and there is no root `node_modules`.

It passes here only by accident of this machine. I removed `keeper/node_modules` and the suite still
ran — because there is a stray `/Users/hiroyusai/node_modules/@solana/web3.js` outside the repo. On
a fresh clone, the first command in `CLAUDE.md` fails with `ERR_MODULE_NOT_FOUND` before a single
assertion, and the failure points at a package the root never asked for.

This one is partly mine: I asked for `normalizeConfig` tests *in* `test:canonical`. The fix is a
choice, not a debate — declare `@solana/web3.js` as a root devDependency, or split the pure parts
out (`tradingWindow` needs only `core/campana.mjs` and is genuinely zero-dep; `normalizeConfig`
needs `PublicKey` and could live behind an injected validator). Either way the gate must be honest
about what it needs. It also brushes against the `core/*.mjs` zero-dependency invariant — not a
violation of the letter, but the root suite is now the first thing in the repo that silently needs a
client dep.

### R2 (P1) — the crank traded an RPC single point of failure for a disk one

`crankMarket` (`keeper/lib.mjs:288`) now reads `cachedCommitment` and nothing else. There is no
fallback. The brief asked for the RPC rebuild to become *a warning*, not to be deleted: cache-first,
then rebuild from RPC on a cache miss and verify the rebuilt digest against `market.inputsHash`
before feeding. The program checks the digest either way, so the fallback cannot settle anything but
the committed inputs — it is free safety.

As written, the keeper cannot defend a challenged position if the cache file is gone, even when the
source RPC is perfectly healthy. Concretely: a keeper redeployed to a new host, a changed `cacheDir`,
a cleared disk — every challenged market becomes a 100% slash at `settle_by`. Same for any market
opened before this change, which have no cache at all (empty set today, not empty later). The test
even encodes cache-loss-means-no-defence as *expected* behaviour, which is how a gap becomes a spec.

### R3 (P2) — the post-settle check in `crankMarket` cannot fail

```js
const truth = settled.settledFlag;
requireValue(settled.state === 2 && settled.byReexecution === 1 && settled.settledFlag === truth, …)
```

`settled.settledFlag === truth` compares a value to itself. The previous code compared the settled
flag against the keeper's own re-execution; that comparison is now gone, so nothing verifies that
the chain landed where the keeper expected. This is the same defect class as F7, in a money path
this time.

The keeper still *can* check it: the cached chunks are the canonical `u32 LE` blockTimes, so
decoding them and running `classifyUpdateTimes` offline gives the expected flag with no RPC at all.
Either restore a real assertion or delete the dead terms — a check that reads as a safety net and
is not one is worse than no check.

### R4 (P2) — `claimUncontested` ships untested end-to-end

The instruction is encoded correctly (`ClaimUncontested` takes `market`, `resolver` pinned to
`market.resolver`, no signer — the keeper passes exactly that), and the program-level behaviour is
covered by `expiry_and_uncontested_are_terminal_exits`. But the keeper's own path — account order,
the `custodyNow > challengeUntil` gate, the post-state assertion — is exercised by nothing.

I accept the reason: `MIN_CHALLENGE_WINDOW_SECS` is 3600 in the program, and a live
`solana-test-validator` cannot warp its clock, so the E2E cannot reach the deadline. Say that in
`keeper/README.md` rather than leaving it silent, and consider an offline assertion on the built
instruction's accounts and discriminator — cheap, and it would catch an account-order regression,
which is the failure mode that actually costs money here.

### Nits

- `cachedCommitment` validates total record bytes but not that chunks are the canonical 200-record
  split. A wrong split fails on-chain with `NonCanonicalChunk` after fees are spent; checking it
  locally is two lines.
- `rewardFor` still returns `cut(pot)` in the neither-side-correct branch, where `settle` makes the
  feeder the outright winner of the whole pot. The CLI prints it as "feeder reward", so a win reads
  as a loss. Filed in the first review, still open.
- The board still carries no chain-derived "as of" line; `board/README.md` on its own cannot tell a
  reader how stale it is.
- `keeperMarkets` still calls `getProgramAccounts` with no `dataSize`/`memcmp` filter.
- Now visible because of close-to-close windows: `Source` is documented in `state.rs:12` as a
  **half-open** window, but `fetchObservations` filters `blockTime <= to` inclusively. Adjacent
  windows therefore share their boundary second, and an observation landing exactly on a session
  close belongs to two consecutive markets. Pre-existing, harmless per market, but the doc and the
  code disagree about a consensus-relevant descriptor.

### Acceptance criteria

§E 1, 2, 4, 5, 6, 7 met and verified by me. §E 3 implemented but unproven (R4). §E 8 not met, and
Codex's account of why is accurate and honest — the program is not deployed to devnet at all, so
there is no truthful Market address to put in a row, and devnet faucet funding was refused at both
5 and 1 SOL. `board/README.md` states the absence plainly and does not pad itself. That is the right
call.

The actual next blocker for §E 8 is not the keeper: **someone has to deploy the program to devnet**,
which needs devnet SOL that a faucet will not hand out at that size. That is Hiro's, not Codex's,
and it is worth saying out loud rather than leaving it as a failed acceptance checkbox.

Fix R1, R2, R3; state R4's limitation; then this merges.

## Codex review — `c360782..ede4745`

**Reviewer:** Codex · **Author:** CC

### Verdict

**CHANGES** — R1, the cache-*missing* part of R2, R3 for intact commitments, and R4's stated
coverage limit are correctly addressed. I independently ran the root canonical suite from a clean
`git archive` with no `node_modules`; it passed, so `keeper/window.mjs` is genuinely dependency-free
and its close-to-close implementation is an exact pure move. I also ran `npm run test:canonical` and
the keeper unit + local-validator E2E; both are green, including the RPC cache-miss recovery case.

### Finding

#### R5 (P1) — a syntactically valid but altered cache still defeats the healthy-RPC fallback and loses the challenged pot

`cachedCommitment` verifies the cache's *declared* `inputsHash`, record count, byte length, and
200-record split, but never recomputes the digest chain over `chunks`
([`keeper/lib.mjs:197-214`](../keeper/lib.mjs)). `recoverCommitment` returns any cache that passes
those shape checks and only calls the source RPC when cache parsing/shape validation throws
([`keeper/lib.mjs:295-308`](../keeper/lib.mjs)). Thus the new fallback covers a missing/truncated
cache, but not the realistic "file exists, bytes changed" case.

Concrete loss path:

1. A challenger bonds the opposite flag on a keeper market. A disk fault or a process with write
   access to the configured `cacheDir` changes one cached `u32 LE` timestamp while retaining a valid
   calendar timestamp, ascending order, the same chunk sizes, and the old JSON `inputsHash` field.
2. The keeper sees a well-shaped cache, never asks an otherwise healthy source RPC to rebuild, and
   feeds the altered bytes. Every `feed` can succeed, but `settle` rejects because the Feed's digest
   is not `Market.inputs_hash` ([`lib.rs:353-359`](../onchain/programs/vrdct-bond/src/lib.rs)).
3. The market remains CHALLENGED. At `settle_by`, the challenger calls `expire_challenged` and takes
   the entire pot, including the resolver's bond.

The same omission can make R3's post-settle comparison spuriously throw if an earlier process had
already completed the correct Feed, then the local cache was altered before a later process calls
`settle`: `prepareOwnFeed` accepts the completed on-chain digest, but
`verdictFromCommitment` reads the altered local bytes afterwards.

**Fix:** after decoding cache chunks, recompute the exact hash chain (header
`[claim_type, calendar_version, n_records]`, then each canonical chunk) and require it equals
`market.inputsHash`. Treat a mismatch as a cache miss so `recoverCommitment` rebuilds from
`sourceRpc`; add the corrupted-but-well-formed cache E2E case.

### Non-blocking notes

- R4's limitation is now explicitly documented, and the offline account-order/discriminator test
  matches Anchor's `(market, resolver)` accounts. I do not see a practical way to advance a live
  `solana-test-validator` clock through the one-hour program minimum; the existing ProgramTest test
  covers the terminal program transition.
- I leave the three re-review nits (board `as of`, `getProgramAccounts` filter, inclusive source
  endpoint versus the half-open wording) for a follow-up; none changes this verdict.

## Codex review — `3453b11`

**Reviewer:** Codex · **Author:** CC

### Verdict

**APPROVE**

`commitmentDigest` is a byte-for-byte extraction of the previous `inputsCommitment` hash rule: the
same 9-byte little-endian header and ordered `sha256(previous_digest, chunk)` chain. The caller still
creates its chunks with `chunksOf`, so the commitment bytes and chunk boundaries do not move.

`cachedCommitment` now verifies that the decoded chunks re-hash to `Market.inputs_hash`; failure is a
cache miss and takes the already bounded RPC-rebuild path. That path constructs its chunks locally
through `inputsCommitment`, then checks `nRecords` and `inputs_hash` before it can return bytes for
`feed`. A separate split assertion there would be redundant: `inputsCommitment` itself produced the
returned canonical split, and the checked digest binds its ordered chunks. The already-complete Feed
path only accepts that same verified commitment hash; the program repeats the count and digest checks
at settlement. I found no remaining path for uncommitted bytes to reach a settling Feed.

The new E2E altered-cache case covers both halves of R5: it refuses the bad cache before fee spend
when source recovery is unavailable, and it rebuilds, re-seeds, and settles when the source is
available. It also closes the prior false R3 post-settlement comparison path.

Verified locally:

- clean `git archive` root `node --test tests/canonical-inputs.test.mjs` (no `node_modules`)
- `npm run test:canonical`
- keeper unit and local-validator E2E suites
- `onchain`: `npm run test:integration`
- `onchain`: `node client/bond-live.mjs`, including its forged digest-chain rejection

The previously noted board freshness, unfiltered program-account scan, and inclusive endpoint versus
half-open wording remain non-blocking follow-up nits.

## Close-out — CC

Recording the last verdict the log is missing, so the chain reads whole.

My re-review of Codex's `3727f67..7fc2ab2` ended at **CHANGES** (R1–R4) and was never followed by a
CC APPROVE, because I fixed those four myself in `ede4745` rather than handing them back. Codex then
reviewed that work, found **R5** — a well-formed but altered commitment cache defeating the
healthy-RPC fallback, with the pot going to the challenger at expiry — and approved the fix in
`3453b11`.

So: **R1–R5 are closed, and every commit on this branch was reviewed by the agent that did not write
it.** Task 005 merges with two things deliberately open, both recorded rather than quietly dropped:

- **Acceptance criterion §E 8 is unmet.** There is no devnet RED row, because the program is not
  deployed to devnet at all and the faucet refused funding at both 5 and 1 SOL. `board/README.md`
  states the absence in its own words and does not pad itself to look balanced. The blocker is an
  operational one and it is Hiro's: someone has to deploy the program and fund a keeper key.
- **Three non-blocking nits**, agreed by both reviewers: the board carries no chain-derived "as of"
  line; `keeperMarkets` scans `getProgramAccounts` unfiltered; and `state.rs` documents `Source` as
  a half-open window while `fetchObservations` filters `blockTime <= to` inclusively, so adjacent
  close-to-close windows share their boundary second.

What the loop caught this round, recorded because it is the argument for keeping it: Codex's first
cut opened bonded positions it could be prevented from defending — one dud subject took down the
crank loop, the board, and every later subject. CC's fixes for that then introduced a cache the
keeper trusted without ever re-hashing, which would have fed altered bytes into a Feed that could
never settle. **Neither agent's "it's green" survived the other reading it. Both directions were
money.**

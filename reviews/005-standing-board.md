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

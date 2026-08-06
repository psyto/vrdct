# Review — Task 004, make a market takeable (`0e4b788`, `ff8ea5e`)

**Reviewer:** CC · **Author:** Codex · **Branch:** `codex/004-make-a-market-takeable`

## Verdict

**CHANGES** — commit A is clean and `check` is genuinely the right product. But `check`'s central
output — *what taking the other side is worth* — states as arithmetic certainty something that is
contingent on somebody cranking, and is **wrong in exactly the case README Honest scope #3 already
flags as open**. Separately, the loudest path in the whole CLI (`REBUILD MISMATCH`) is not actually
covered by the test that claims to cover it, and that test is non-hermetic.

## What holds up

Verified by running against my own build and my own deploy:

- `npm run test:canonical` — 160 parity vectors, **2 definition-hash vectors**, 20 Rust tests green.
- `npm run test:integration` — 5 tests, run twice, green both times.
- Rebuilt SBPFv3, deployed it myself, `client/bond-live.mjs` green; corpus `inputs_hash` unchanged.
- **The descriptor is bound properly.** Rust `market_definition_hash` and JS `marketDefinitionHash`
  emit the same fields in the same order (checked term by term), and the committed
  `market-definition-vectors.txt` has a freshness gate like the parity fixture.
- `validate_source` is strict in *both* directions: CMLS must be sourced, with a non-default account
  and `from_ts < to_ts`; solvency must be fully zeroed. That second half matters — it stops a
  solvency market carrying a decorative source that a reader would mistake for provenance.
- `Source::SPACE` = 49 and `Market::SPACE` = 314; both recomputed, both exact.
- **`check` works with no wallet.** I ran all three of the test's leftover markets with `KEYPAIR`
  unset:

  ```
  honest    → ✓ the resolver is right …                      exit 0
  liar      → ⚠ the resolver is wrong. Challenging with …    exit 0   (+ the exact command)
  unsourced → ⛔ DO NOT BOND … no chain-reconstructible source  exit 2
  ```

  Three distinct exit codes with three distinct meanings — "safe", "act", "you cannot check this
  one" — is better than the brief asked for.
- `crank` refuses on a rebuild mismatch *before* spending fees, rather than letting the chain reject
  it 19 transactions later.

## Findings

### F1 (P1) — `check` tells you challenging an honest resolver is a guaranteed loss. It is not.

`cli/vrdct.mjs:92` — the honest-resolver branch:

> `✓ the resolver is right. Taking the opposite side with 0.0010 SOL loses that bond; completing the
> Feed only earns 0.0001 SOL, for a net 0.0009 SOL loss.`

That is stated as arithmetic. It is actually a bet on whether anyone cranks.

**Failure sequence.** A griefer runs `check`, sees the resolver is honest, and challenges anyway.
Nobody completes a Feed before `settle_by`. `expire_challenged` (`lib.rs`, `state == CHALLENGED`,
`now > settle_by`) pays **the entire pot to the challenger** — the party `check` just told the reader
was certain to lose. The honest resolver is the one with the incentive to crank, so in practice they
usually will; but "usually will" is the whole content of the claim, and `check` prints none of it.

This is not a new hazard — it is README Honest scope #3, the expiry race, which this repo already
names as open and unsolved. The defect is that the CLI's advice contradicts the repo's own stated
caveat, and it does so in the direction that costs a reader money: it makes a contingent outcome
look settled.

**Fix direction.** Both branches must state the contingency, not just the arithmetic. The honest
branch should say the loss holds *if a Feed is completed and settled before `settle_by`*, and that
if none is, expiry pays the challenger the whole pot. Print `settle_by` and how long is left, since
that is the variable the reader is actually betting on. The "resolver is wrong" branch should note
the symmetric fact — that expiry pays the challenger even if nobody cranks — because that makes
challenging *safer* than the number shown, and a reader deserves the real distribution in both
directions.

### F2 (P1) — the `REBUILD MISMATCH` path is untested; the fixture degenerates to the empty case

`cli/tests/check.local.mjs:104-106` asserts `/REBUILD MISMATCH|returned no observations/`. The
fixture it builds uses a one-second window, which returns **zero** observations, so it takes the
empty-source early return at `vrdct.mjs:113` and never reaches the mismatch branch at `:123`. I
confirmed by running that market directly:

```
⛔ DO NOT BOND — source reconstruction returned no observations; its commitment cannot match.
```

An empty window is the easy case and nobody would bond on it anyway. The dangerous case is a
**plausible** one: a source window that returns real observations which hash to something else —
a resolver pointing one hour off, or at a neighbouring account. That is the only situation where a
challenger might otherwise put money down on a market whose commitment is not what it claims, and it
has never executed.

**Fix direction.** Add a fixture whose source window covers a strict subset of the committed
observations — non-empty, different hash — and assert exit `1` and `/REBUILD MISMATCH/`
*specifically*. Split the empty-source case into its own assertion instead of letting the alternation
absorb it.

### F3 (P1) — the CLI test is non-hermetic: it fails against any validator whose clock has drifted

Reproduced. Against the validator that had been running since the previous task:

```
AssertionError: local source 7ji2kR… window 1785964915-1785972115 must finalize both observations
```

Against a freshly started one, the same command passes all three cases. The difference is measured:

```
long-running validator: blockTime 10.0 hours behind wall clock (slot 3874)
fresh validator:        blockTime 1 second behind
```

**Cause.** The test derives its source window from `Date.now()`, while the observations it creates
carry the *validator's* `blockTime`. A test validator's block time tracks slot progression from
genesis, so an idle one drifts arbitrarily far behind the host clock, and the created transactions
land outside the window the test is looking in.

The message makes it worse: "must finalize both observations" reads like a flake and names neither
the cause nor the fix, so the next person to hit it will re-run it and shrug.

**Fix direction.** Take the window from the chain the observations live on —
`getBlockTime(getSlot())` — not from the test host. That is the principle the engine already holds
to: `core/campana.mjs` reads no clock, because a timestamp that comes from chain data is the only
one two parties can agree on. At minimum, assert the drift up front and fail with a message that
says "this validator's blockTime is N hours behind; start a fresh one".

This is the **second** recurrence of one class: 003's F2 was a test that passed or failed on
transaction-cache timing. Worth stating as a standing rule — *a test that mixes host wall-clock or
host tx-timing with chain state is not hermetic, and its green is not evidence.*

## Not blocking

- `check` prints the question **hash**, not the question. Nothing on-chain carries the text, which
  is correct, but a reader cannot tell what they are betting on without a separate lookup. Worth a
  `--question` flag that verifies a supplied string hashes to `market_id`, in a later task.
- Single-RPC is right for production (a market and its source account are on the same chain) and
  only awkward for local testing. No action.

## Required to merge

- [ ] F1 — both branches of `check` state the expiry contingency and show `settle_by` / time left.
- [ ] F2 — a real `REBUILD MISMATCH` fixture (non-empty, wrong hash), asserted specifically.
- [ ] F3 — the test derives its window from chain time, or fails fast naming the drift.
- [ ] `npm run test:canonical`, `npm run test:integration`, `bond-live.mjs`, and the CLI test green —
      the CLI test run twice, once against a validator that has been up for a while.

---

## Re-review — `f1ab86c`

**APPROVE.** All three closed, verified by running the cases myself rather than by reading the diff.

**F1.** Both branches now state the contingency and print `settle_by` with time remaining, computed
from **chain time** rather than the host clock — the same principle the finding was about. Observed
directly:

```
✓ the resolver is right. If a completed Feed settles first, taking the opposite side with 0.0010 SOL
  loses that bond … If no Feed settles before this deadline, expiry can pay the challenger the full
  0.0020 SOL pot. After the deadline, a completed Feed and expiry race; the first terminal
  transaction wins.
settlement deadline  settle_by 2026-08-07T01:26:10Z (24h 59m 25s left; chain time 2026-08-06T00:26:45Z)
```

The "resolver is wrong" branch carries the symmetric disclosure, which is the part that could have
been skipped since it only makes challenging look safer. It wasn't.

**F2.** The mismatch fixture is now a genuine strict subset (`timestamps[0] - 1 → timestamps[0]`),
the assertion names `/REBUILD MISMATCH/` specifically, and the empty-source case is its own market
and its own assertion. Confirmed on a live market: one fixture exits 1 with `REBUILD MISMATCH`, a
different one exits 1 with `returned no observations`. The branch that had never executed now does.

**F3.** Windows come from `getBlockTime(getSlot('finalized'))`, and the test waits for chain time to
advance between the two source transactions so the subset fixture is constructible at all. The suite
passed twice on the validator that had been up for a while, and again after a restart. **Stated
limit:** I could not manufacture a ten-hour drift on demand, so this is verified by construction —
no `Date.now()` remains in the window path — plus green runs, not by re-triggering the original
failure.

Everything else re-run on my own SBPFv3 build and deploy: `test:canonical` (160 parity + 2
definition vectors, 20 Rust tests), `test:integration` (5), `bond-live.mjs`, CLI suite ×2. corpus
`inputs_hash` unchanged.

### Recorded for a later task, not blocking

Chasing F2 surfaced something real. On a default `solana-test-validator` the ledger prunes fast
(`getFirstAvailableBlock` 3141 against slot 3382 — roughly 100 seconds of history), and **every one
of nineteen live markets became uncheckable**, including ones that had returned `commitment MATCHES`
half an hour earlier. That is not a defect: it is README Honest scope #1's retention boundary
happening in front of me, and `check` did the right thing — `DO NOT BOND`, exit 1, refusing to
advise on a market it can no longer reconstruct.

But it exposes a gap in the message. "Source reconstruction returned no observations" currently
covers two situations a reader must not confuse:

- **the resolver pointed at a window that never had records** — evidence against the market, and
- **the market has simply aged out of this RPC's history** — no evidence either way, and the correct
  response is to try an RPC with deeper history, not to conclude anything about the resolver.

`check` should distinguish them, e.g. by comparing the source window against
`getFirstAvailableBlock`'s block time and saying "this RPC's history starts after this market's
window; use an archival RPC" in the second case. Worth a task on its own, since it is the difference
between "this market is bad" and "you are looking with the wrong instrument".

Merged to `main`.

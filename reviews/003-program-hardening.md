# Review — Task 003, program hardening (`1dd15de`)

**Reviewer:** CC · **Author:** Codex · **Branch:** `codex/003-program-hardening`

## Verdict

**CHANGES** — the shape is right and every H-item is genuinely implemented, but `settle` throws away
a **completed re-execution** if it lands after the deadline, which makes a clock rather than the
re-execution decide that payout; and the "closes only once" integration test is **non-deterministic**
and currently proves nothing (reproduced: pass, then fail, same command, no edits).

## What holds up

Verified by running against my own build, not by reading:

- `npm run test:canonical` — JS suite, 160 parity vectors, **19** Rust tests green.
- `node demo.mjs` — green.
- Rebuilt SBPFv3 from this branch, deployed it myself, and ran `client/bond-live.mjs` end to end.
  Both markets settle, opposite winners, and **H6 is live**: `completed-feed feeder +0.1999 SOL` /
  `+0.2000 SOL`. corpus `inputs_hash` still `2f224c44f93a8e2c…`.
- **Account constraints are tight.** I checked each one that moves money: `Settle` pins
  `feed.market == market.key()`, `feed_feeder` to `feed.feeder`, and derives the Feed PDA from
  `feed_feeder.key()` — so the reward cannot be redirected to the caller, which was the specific
  hazard the brief called out. `CloseFeed` requires the feeder as signer with `close = feeder`.
  `CloseMarket` pins `close = rent_payer` to the recorded payer.
- **Space arithmetic recomputed field by field**: `Market` = 264 bytes (8 + 256) and `Feed` = 174
  (8 + 166); both `SPACE` expressions are exact. Replacing the old magic `384` with a written-out sum
  is the right call.
- **No permanent lock remains.** Every bond-holding state has an unconditional eventual exit:
  `OPEN → claim_uncontested` (permissionless, no signer), `CHALLENGED → settle` or
  `expire_challenged`, `SETTLED → close_market`. H1 is closed.
- **Payout conservation checks out.** All three `settle` branches satisfy
  `payout + cranker_reward == pot`; `claim_uncontested` returns `resolver_bond` with
  `challenge_bond == 0`; `expire_challenged` pays the full pot. The market account therefore holds
  exactly its rent at every terminal state, which is what `close_market` returns.
- The digest-chain coverage gap 002 left is closed properly — `parity_tests.rs` now recomputes
  `header_digest` + the chain over the fixture and compares to the JS `inputsCommitment` head.
- H7 is enforced on both sides from one range (`CAL_2026_VALID_FROM/UNTIL` ↔ `validFrom/validUntil`).
- The state × instruction table is real work and matches the code I read.

## Findings

### F1 (P1) — a completed re-execution is discarded after `settle_by`, so the clock decides

`onchain/programs/vrdct-bond/src/lib.rs:295` — `require!(now <= m.settle_by, SettlementDeadlineClosed)`.

**Failure sequence.** Resolver opens honestly and asserts the flag re-execution will produce. A
griefer challenges with the false flag and matches the bond. A feeder streams all 19 chunks; the
Feed PDA closes the commitment at `settle_by − 2s`. The `settle` transaction lands at `settle_by + 1s`
and is **rejected**. `expire_challenged` is now the only exit, and it pays the **entire pot to the
challenger whose assertion the completed re-execution refutes**.

It does not need a near-miss to bite: any challenged market nobody cranks within
`SETTLEMENT_WINDOW_SECS` resolves for the false side, and after the deadline a correct feed can never
undo it.

This contradicts the program's own opening line — *"Re-execution decides a challenged payout"* — and
the README sentence it sits under. A deadline that discards evidence is not a liveness backstop, it
is a second decider.

**Fix direction.** Drop the deadline from `settle`: allow it whenever `state == CHALLENGED` and the
Feed closes the commitment. Keep `expire_challenged` gated on `now > settle_by`. Both then remain
available after the deadline and the boundary becomes a race, which is fine — a party holding a
completed feed has no reason to wait, and can settle the instant it completes. State the residual
race in README rather than resolving it by throwing away a proof.

### F2 (P1) — the "closes only once" test is flaky and proves nothing as written

`onchain/programs/vrdct-bond/tests/state_machine.rs:510` (helper at `:98`).

Reproduced on an unmodified checkout — same command, back to back:

```
run 1: settle_rejects_foreign_feed_and_market_closes_only_once_settled ... ok
run 2: settle_rejects_foreign_feed_and_market_closes_only_once_settled ... FAILED
```

**Cause.** `send()` builds every transaction with the same fee payer, the instruction's own accounts,
no extra signers, and `get_latest_blockhash()`. The two `close_market` calls are therefore
byte-identical whenever the blockhash has not advanced between them, so the second is the *same
transaction* and banks-client returns the cached success of the first. `is_err()` is false through no
fault of the program.

The assertion on the preceding line — `get_account(m2).is_none()` — is the property that actually
holds, and it passed in both runs.

A flaky test in the suite that guards custody is worse than a missing one: the next real failure gets
read as noise.

**Fix direction.** Make the second attempt a distinct transaction (advance the slot, use
`get_new_latest_blockhash`, or a different fee payer) and re-assert. Then decide whether the
`STATE_CLOSED` tombstone + `exit()` + `lamports() > 0` guard in `close_market` is carrying any weight
once the account is provably gone — if the runtime always removes it, say so and simplify; if not,
that path is now genuinely tested for the first time.

### F3 (P2) — README understates what expiry does to the resolver

README's new paragraph says expiry lets anyone "resolve it against the resolver and **make the
challenger whole**." `lib.rs:383` pays the challenger the **entire pot** — a 100% slash, harsher than
any re-executed outcome (those always leave 10% to the feeder).

More importantly it creates an obligation that did not exist before this branch: **the resolver must
now ensure someone cranks within `SETTLEMENT_WINDOW_SECS` or forfeit their whole bond** — possibly to
a challenger who asserted falsely. The crank reward makes that likely in practice, but "likely in
practice" is exactly the kind of assumption `AGENTS.md` requires be named rather than absorbed.

**Fix direction.** Say it in Honest scope: expiry is a 100% slash, and the resolver carries a
liveness obligation. Or soften expiry to bond-back-plus-cut. Either is fine; silence is not.

### F4 (P2) — `settled_flag` can be a flag nothing re-executed, and the account doesn't say so

`claim_uncontested` and `expire_challenged` both write `settled_flag` / `resolved` from an *asserted*
flag. The event is honest (`by_reexecution: false`), but `by_reexecution` exists **only in the
event** — an integrator reading the `Market` account sees a settled verdict with no way to tell
whether anything re-executed it.

**Fix direction.** Persist the distinction on the account, or state plainly in README that consumers
must gate on the event.

## Not blocking

- `Market::SPACE` is now an exact sum with zero slack. Correct, and better than the magic number, but
  audit 001's warning about `Fold::SPACE` now applies to `Feed` too — any new field must move both.
- H7's range is enforced in `fold_chunk`, not in `open_market`, so an out-of-range market *can* be
  opened and is then unsettleable by re-execution, expiring against its opener. That is consistent
  with the design; worth one comment saying it is deliberate.
- `Feed.count` duplicates `fold.count` and `settle` checks both. Harmless.
- `open_market` emits `MarketOpened` before the transfer. Cosmetic; the transaction is atomic.

## Required to merge

- [ ] F1 — a completed re-execution settles regardless of `settle_by`; residual race documented.
- [ ] F2 — the double-close test is deterministic and actually exercises a second transaction.
- [ ] F3 — Honest scope states the 100% expiry slash and the resolver's new liveness obligation.
- [ ] F4 — one line, either in the account or in README.
- [ ] `npm run test:canonical`, `npm run test:integration` (repeat it a few times), `node demo.mjs`,
      and `client/bond-live.mjs` all green; corpus `inputs_hash` unchanged.

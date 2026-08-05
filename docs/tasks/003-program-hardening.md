# Task 003 — Program hardening: no permanent locks, no free denial, no chosen referee

**Assignee:** Codex (frame-thick)
**Reviewer:** CC
**Branch:** `codex/003-program-hardening`
**Status:** queued — **start after 002 merges.** 002 is mergeable alone; this one is not.
**Origin:** [`reviews/001-onchain-bond-adversarial-audit.md`](../../reviews/001-onchain-bond-adversarial-audit.md) P1/P2, plus two findings CC added on triage.

---

## What this task is really about

Audit 001 found four separate ways to make the program do something other than "re-execution decides
the payout". They are not four unrelated bugs. They are one shape: **the program hands control of
its own process to whoever shows up first** — the resolver picks the challenge duration, picks the
referee's address, and squats the address space; any passer-by can reset the shared re-execution
state. Fixing them one at a time will produce a patchwork. Fix the shape.

CC's two additional findings are the same shape carried to its conclusion: a market that cannot
settle has **no exit at all**.

## The findings, with CC's decisions

### H1 (P0, CC-found) — a `CHALLENGED` market can be locked forever with both bonds inside

`settle` is the only exit from `CHALLENGED` (`lib.rs:250`), and it requires the streamed digest to
close on `inputs_hash`. If the preimage cannot be produced, both bonds stay in the PDA permanently.
There is no timeout, no refund, no expiry.

Weaponised: a resolver commits to a random 32-byte `inputs_hash` with no preimage and asserts a
flag. Anyone who disputes burns their bond forever. The attacker burns theirs too — 1:1 mutual
destruction — which a well-funded venue will happily trade to make disputing look suicidal. It also
happens *by accident* any time a claim's inputs stop being reproducible.

**Decision:** add a settlement deadline. `open_market` records `settle_by`, and a new permissionless
instruction resolves an expired `CHALLENGED` market **against the resolver**: the resolver chose a
commitment they could not have re-executed, so the challenger is made whole. Do not add an admin
escape hatch — there is no authority in this program and this must not become one.

**H1 depends on H2.** Shipping the deadline while `reset_feed` still exists would let a griefer stall
an honest resolver into being slashed. Land them together or land H2 first.

### H2 (P1, audit) — permissionless `reset_feed` denies settlement at 1:19 cost

**Decision — remove the shared mutable feed state entirely.** The bug is not that `reset_feed` is
unauthenticated; it is that the re-execution state is a **global mutable** that any actor can touch.

Move the fold and digest into a per-feeder account: `Feed` PDA seeded `[b"feed", market, feeder]`,
holding `{ market, feeder, fold, digest, count }`. `feed` writes only the caller's own account.
`reset_feed` disappears — a feeder who botched their own stream closes and re-opens their own PDA.
`settle` takes a `Feed` account and requires `feed.market == market.key()`,
`feed.count == market.n_records`, `feed.digest == market.inputs_hash`. Close the `Feed` PDA on
settle and return its rent to the feeder.

A griefer can then only reset their own stream. There is no longer a cheap way to deny anyone else's
progress, which is what H1's deadline needs in order to be fair.

### H3 (P1, audit) — caller-chosen (negative) challenge window

**Decision:** bound it in the program. `MIN_CHALLENGE_WINDOW_SECS` and `MAX_CHALLENGE_WINDOW_SECS`
as program constants; reject anything outside. Pick the minimum so a challenger who is watching can
realistically act — propose a value and justify it in one line rather than copying a number from
here. Zero and negative become unrepresentable, not merely discouraged.

### H4 (P1, audit) — PDA squatting on a caller-chosen `market_id`

**Decision:** bind the address to the whole market definition, not to an opaque caller choice. Seed
the market PDA by a hash over `market_id ‖ claim_type ‖ calendar_version ‖ n_records ‖ inputs_hash ‖
yes_when ‖ the bounded terms`. Keep `market_id` (the question hash) as a recorded field so the
question stays discoverable.

Why this dissolves the attack rather than patching it: a squatter can then only occupy *the exact
market you intended to open* — same commitment, same terms — and to do so they must post a real bond
under a real (now-bounded, per H3) challenge window. That is not censorship; that is participating.
Whatever they assert, the re-execution still decides it.

### H5 (P2, audit) — market rent stranded on every terminal path

**Decision:** add `close_market`, callable once `SETTLED`, returning rent to the recorded rent payer.
Record the payer explicitly rather than assuming it is the resolver. This composes with H4: closing
frees the address, and reopening requires the identical full definition, which would produce the
identical verdict — so reuse is not a replay hazard. Say that out loud in a comment; it is the kind
of reasoning a future reader will otherwise have to redo.

### H6 (P1, audit) — the resolver picks the "treasury" → **pay the cranker instead**

The README says the treasury takes 10%. As implemented, one disputant nominates that address and can
nominate itself, so it collects the cut whether it wins or loses. The code is not wrong so much as
**the documentation is false**, which is worse.

**Decision (Hiro, 2026-08-05): remove the treasury entirely and pay the 10% to the cranker who
completed the re-execution.** Not a pinned constant — gone. Two things follow, and both are the
point:

- The program ends up with **zero privileged addresses**. Not "one address that cannot influence a
  verdict" — none at all. Every pubkey it touches is either a disputant or someone who did work.
  That is a materially stronger version of the thesis and it should be stated in README as such.
- Streaming the reference claim costs **19 transactions that nobody is paid for today**. This makes
  cranking a paid job, which is also the answer to "who actually submits the feed" — a question the
  current design leaves to goodwill.

The cost, accepted knowingly: `core/bond.mjs` was written around a treasury cut as the monetization
hook. That hook is being given up.

**Implementation detail you must get right:** the reward goes to **the feeder whose `Feed` account
closed the commitment**, not to whoever calls `settle`. With per-feeder feed accounts (H2) those are
separable, and paying the caller would let a free-rider watch for a completed `Feed` and collect
another party's reward with one transaction. Pay `feed.feeder`. Apply the same rule to the existing
"both sides asserted wrongly → the pot goes to the cranker" branch.

**Also in scope for H6:**

- `core/bond.mjs` must mirror the new split (`cranker` replaces `treasury` in the returned balances),
  and `demo.mjs`'s output line with it. The offline reference model and the program must not describe
  different economics.
- Rename the `MarketSettled` event field `treasury_cut` to something truthful.
- README: the `settle` summary line, the Market A/B walkthrough bullets (`treasury +0.2 SOL`), and
  the "no admin key, no vote, no oracle account" sentence all need updating — the last one gets
  *stronger*, so say so rather than leaving it as-is.

### H7 (P2, CC-found) — the calendar is pinned but its validity range is not

`open_market` requires `calendar_version == CAL_2026_VERSION`, but nothing constrains the
observations to lie inside 2026. A market over 2027 timestamps re-executes under a 2026 holiday
table on **both** sides: parity holds, the answer is meaningless. The audit's differential harness
could not catch this precisely because both implementations are wrong in the same way.

**Decision:** give each calendar an explicit validity range and reject records outside it — in the
Rust fold and in the JS claim-type, from the same constant. A claim that straddles a calendar
boundary must fail to build, not quietly resolve.

## Scope

**Touch:** `onchain/programs/vrdct-bond/src/**`, `onchain/client/bond-live.mjs` (to follow the new
account shapes), `core/campana.mjs` + `claimtypes/closed-market-soundness.mjs` (H7's range only),
`README.md` (honest scope + the on-chain section), `CLAUDE.md` if an invariant changes.

**Do not touch:** `corpus/**`. If the H7 range check rejects the committed corpus claim, stop and
report it — that would mean the reference resolution is outside its own calendar.

## Tests required

- Program-test / integration coverage for the state machine, not just unit tests on pure functions.
  At minimum: negative and zero challenge windows rejected; expired `CHALLENGED` market resolves
  against the resolver; a second feeder cannot disturb the first feeder's stream; `settle` rejects a
  `Feed` account belonging to another market; `close_market` only after `SETTLED` and only once.
- `claim_uncontested` gets its first test — it currently has none.
- H6: the reward lands on `feed.feeder`, and a caller who did not feed cannot collect it.
- H7: a claim straddling the calendar boundary fails to build (JS) and fails to fold (Rust).
- **Close the coverage boundary 002 left.** The committed parity fixture proves JS↔Rust agreement on
  the *fold and verdict*, but not on the **digest chain** — `h_{i+1} = sha256(h_i ‖ chunk_i)` lives
  in `lib.rs` and is exercised only by `client/bond-live.mjs`, which needs a validator and is not in
  `npm run test:canonical`. Since you are already in `lib.rs`, add a host-side test that recomputes
  the chain over the committed vectors and matches the JS `inputsCommitment` head. Extend the fixture
  with the expected `inputs_hash` per vector if that is the cleanest way.
- `node onchain/client/bond-live.mjs` still runs green end-to-end on a local validator.

## Acceptance criteria

- [ ] No instruction lets one actor unilaterally choose the duration, the referee, or the address of
      a market whose outcome another actor is bonded against.
- [ ] No reachable state holds bonds with no exit. Write out the `(state × instruction)` table in the
      PR description and show every terminal path.
- [ ] A griefer cannot affect another feeder's re-execution state at any price.
- [ ] README's "Honest scope" and on-chain section describe what the code now does — including the
      privileged treasury address, if it survives.
- [ ] The residual trusts README already admits are not quietly widened.

## Out of scope

- Paying the cranker (H6's alternative) — Hiro's call, not this task's.
- Devnet/mainnet deployment.
- New claim-types.

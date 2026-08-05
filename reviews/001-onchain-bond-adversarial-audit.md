# Task 001 — Adversarial audit: on-chain bond & settlement

## Verdict

**CHANGES** — a confirmed JS→Rust encoding divergence can pay the opposite side of a challenged market (P0); permissionless reset, caller-controlled challenge duration, and permanent PDA squatting also make an adverse or intended settlement avoidable (P1).

## Findings

### P0 — `staleRecords` coercion lets the Rust verdict differ from the committed JS claim

**Files:** `core/encode.mjs:77`; `onchain/programs/vrdct-bond/src/reexec/solvency.rs:23-40`

`solvency.reexec` treats only the numeric value `0` as fresh (`=== 0`).  The consensus encoder instead applies JavaScript's `>>> 0` coercion.  It silently converts `4294967296`, the string `"0"`, `0.5`, `NaN`, and other non-canonical values to the `u32` value zero.  Rust receives zero and returns `GREEN` where JS returns `STALE`.

**Evidence status: executed.**

**Exploit path:**

1. A lying resolver opens a `reserve-solvency` market whose quantities have adequate backing, `inv2b_ok: true`, and `staleRecords: 4294967296` (or JSON's plausible `"0"`).  The JS claim type re-executes this as `STALE`.
2. `inputsCommitment` encodes the field as `0`; the resolver commits that hash and asserts `GREEN`.
3. An honest challenger independently runs the documented JS verifier, obtains `STALE`, and posts a matching bond with the `STALE` flag.
4. Anyone feeds the exact bytes the resolver committed.  The on-chain fold decodes `stale_records = 0`, derives `GREEN`, and pays the resolver.  The honest challenger loses their bond despite agreeing with the offline engine advertised as the source of truth.

The resolver gains the challenger bond (less the selected treasury cut); this is a direct, reproducible disagreement in the payout function, not the accepted trust that inputs are merely unsourced.

**Executed evidence:** I ran `encodeRecords` and the JS claim type for `4294967296`, `"0"`, and `0.5`; each printed `JS=STALE`, encoded `stale_records=0`, and therefore the Rust `GREEN` branch.  A temporary Rust harness also exercised the actual `solvency::fold_chunk`/`verdict` implementation over the `u128` boundary matrix (see Parity evidence).

**Suggested fix direction:** Reject `staleRecords` unless it is a number, a safe integer, and `0 <= value <= u32::MAX`; make the claim builder enforce the same schema.  Alternatively define an explicit canonical integer parser and use it in both re-execution and encoding.  Add differential regressions for the values above.

### P1 — The resolver can choose a past challenge window and settle an arbitrary assertion atomically

**Files:** `onchain/programs/vrdct-bond/src/lib.rs:100,145-147,333-360`

`challenge_window_secs` has no lower bound.  `open_market` accepts a negative duration; `claim_uncontested` then only requires `now > challenge_until`.

**Evidence status: reasoned from source; not executed against a validator.**

**Exploit path:**

1. A lying resolver (for example, the judged venue) opens a market with an arbitrary flag and `challenge_window_secs = -1`.
2. In the next instruction of the same transaction (or any later transaction), it calls `claim_uncontested`.  With the same `Clock` value, `now > now - 1` is true.
3. The program returns the resolver's bond and emits a settled result carrying the resolver's false flag, before any challenger can submit a transaction and without on-chain re-execution.

The resolver gains a final on-chain result for its desired side with no usable opportunity for the optimistic challenge assumed by README's honest-scope caveat.  This is sharper than an assertion simply going unchallenged during a fixed, visible window: the asserting party chooses a zero-length (or negative) window.

**Suggested fix direction:** Require a protocol-defined positive minimum (and likely maximum) challenge period at open, rather than trusting a caller-provided signed duration.  Add an integration test that an attempted negative/zero window cannot reach `claim_uncontested` immediately.

### P1 — A one-transaction permissionless reset indefinitely prevents streamed settlement

**Files:** `onchain/programs/vrdct-bond/src/lib.rs:209-241`

`reset_feed` is callable by any signer in both `OPEN` and `CHALLENGED` states.  It has no authorisation, cost beyond its transaction fee, rate limit, deadline, or requirement that the existing feed is invalid.  It resets both the fold and digest after any valid chunk.

**Evidence status: reasoned from source; not executed against a validator.**

**Exploit path:**

1. A judged venue that expects to lose, or an unrelated griefer after a market is challenged, watches for a successful `feed` transaction.
2. After each first (or any later) chunk is processed, it submits `reset_feed`, using a priority fee if necessary.  The account returns to `count = 0` and `h_0`.
3. Honest crankers must again submit the whole stream.  The reference 3,789-record CMLS claim needs 19 feeds; the attacker needs only one reset transaction per interrupted attempt, and does not post or lose a bond.
4. Repeating this has no protocol end time.  Both bonds remain locked and the venue avoids the re-executed slash / external market resolution for as long as it is willing to pay transaction fees and priority bids.

The attacker pays one ordinary write transaction plus any chosen priority bid per reset; no lamports are transferred by the instruction.  A final `feed` and `settle` can be combined atomically, but that does not help a 19-transaction stream whose earlier chunks can always be reset.  This cost asymmetry is especially favorable to the well-funded venue named in the threat model.

**Suggested fix direction:** Do not permit arbitrary destructive reset after a valid feed has begun.  Bind a reset authority, require an objectively invalid chunk before reset, or use append-only per-feeder/forked feed state plus a bounded completion/dispute protocol.  The eventual design needs an explicit economic cost or expiry that makes withholding progress finite.

### P1 — A caller can permanently squat a question's sole market PDA cheaply

**Files:** `onchain/programs/vrdct-bond/src/state.rs:15-17`; `onchain/programs/vrdct-bond/src/lib.rs:371-376,333-360`

The only non-literal PDA seed is arbitrary caller input `market_id`.  The account is `init`-only and no instruction closes or recycles it.  Neither the market question nor the commitment/terms is itself validated as the identifier's preimage.

**Evidence status: reasoned from source; not executed against a validator.**

**Exploit path:**

1. Before an honest party opens the publicly known question identifier, the judged venue derives that `market_id` and calls `open_market` first with any commitment/terms, a one-lamport bond, and a negative challenge window.
2. It immediately calls `claim_uncontested`, recovering the one-lamport bond.  The PDA, including its rent reserve and attacker-selected state, remains allocated forever.
3. The honest opener's later `init` at `[b"market", market_id]` fails because the address is already occupied.  They cannot create the intended canonical market at that identifier.

The venue gains permanent censorship of that question/address.  Its lasting cost is the rent reserve and transaction fees, not a bonded stake; this is inexpensive relative to a high-value adverse verdict.

**Suggested fix direction:** Make the identifier commit to the complete canonical market definition (including input commitment and fixed settlement terms), reject invalid duration values, and add a safe post-settlement close/reuse strategy.  If an address is intended to mean a question globally, document and enforce a namespace/versioning rule rather than accepting an opaque 32-byte caller choice.

### P2 — Market-account rent is permanently stranded after every terminal path

**Files:** `onchain/programs/vrdct-bond/src/lib.rs:366-376,305-310,343-360`; `onchain/programs/vrdct-bond/src/state.rs:56-59`

`open_market` makes the resolver pay rent for the 384-byte PDA.  Both settlement paths transfer only bonds; there is no `close` instruction and the settled account cannot release its rent reserve.  Thus every successful or uncontested market strands its creation rent permanently.  This is a custody/accounting loss for each market opener, rather than an attacker-paid slash.

**Evidence status: reasoned from source; not executed against a validator.**

**Suggested fix direction:** Close the PDA on a terminal state and route reclaimed rent according to an explicitly documented rule (normally back to the rent payer), or clearly charge and disclose an intentional creation fee.

### P2 — The resolver chooses the recipient of the advertised 10% slash cut

**Files:** `onchain/programs/vrdct-bond/src/lib.rs:377-378,143,405-412`

`treasury` is an unchecked, resolver-selected address.  A resolver can nominate itself.  If it loses, it receives 10% of the bond supposedly slashed to the treasury; if it wins, it also captures the 10% cut from the challenger.  The re-executed winner still receives the remaining 90%, but the documented economic penalty/incentive is not a protocol treasury cut.

**Evidence status: reasoned from source; not executed against a validator.**

**Suggested fix direction:** Pin the treasury to an immutable program configuration/governance account, or make the recipient an explicit market term agreed to and economically visible to both sides.  Do not describe it as a protocol treasury while one disputant chooses it unilaterally.

### P2 — Empty CMLS claims have an offline verdict but cannot be opened on-chain

**Files:** `claimtypes/closed-market-soundness.mjs:15-28`; `onchain/programs/vrdct-bond/src/reexec/cmls.rs:49-59`; `onchain/programs/vrdct-bond/src/lib.rs:108`

The JS claim type maps an empty observation list to `UNKNOWN`, and the Rust verdict does the same for a default fold.  However, `open_market` rejects `n_records == 0`, so that offline input has no on-chain market representation.  This is not a wrong payout, but it contradicts an unrestricted “every input” parity claim.

**Evidence status: reasoned from source; Rust empty-fold unit test executed.**

**Suggested fix direction:** Either permit and explicitly define empty commitments, or reject empty observations in the JS claim schema and document that on-chain-supported inputs are non-empty.

## Checked and sound

The items below are distinct from the findings above.  “Reasoned” means source-level analysis, not a validator execution.

- **Executed:** `cd onchain && cargo test -p vrdct-bond` passed all 17 existing host-side unit tests.
- **Commitment binding (C; reasoned):** the header includes claim type, calendar version, and record count; `feed` fixes every chunk to `min(CHUNK_RECORDS, remaining)` records; and each chunk itself is an input to the SHA-256 chain.  Different record boundaries cannot reach the same *well-formed* chain without a SHA-256 collision.  `settle` requires both terminal count and digest.  `fold_chunk` and digest advancement occur in one instruction, so a fold error rolls back the digest too.  `reset_feed` restores both pieces of state together; it is a liveness defect, not a path to mixing a good digest with another fold.
- **Commitment cost (C; reasoned):** a partial feed cannot settle, and the exact `n_records`/canonical-chunk checks prevent presenting fewer records under a completed commitment.  A resolver can commit a tiny but misleading input set only under the already documented residual trust that `inputs_hash` pins rather than sources inputs; I found no way to feed fewer bytes for an existing commitment.
- **State transitions (reasoned):** `settle` requires `CHALLENGED`, then writes `SETTLED`; `feed`/`reset_feed` reject `SETTLED`; and Anchor account write locks serialize competing transactions.  At one `Clock` value, `challenge` permits `now <= until` while `claim_uncontested` requires `now > until`; aside from the caller-controlled duration finding, the two outcomes cannot both succeed at the boundary.
- **Custody arithmetic (reasoned):** challenged settlement moves `resolver_bond + challenge_bond - cut` to exactly one winner and `cut` to the recorded treasury.  `cut_of` avoids multiplication overflow, and `move_lamports` uses checked debit/credit.  Bond transfers occur before the challenge state write but transaction atomicity reverts both on failure.  I found no double-settlement or path that pays more than the two recorded bonds; the rent issue is recorded separately.
- **Anchor constraints and sizing (reasoned):** subsequent contexts re-derive the PDA from stored `market_id` and bump; `settle`/`claim_uncontested` pin recipient keys to stored addresses.  The serialized `Market` payload is 313 bytes plus its 8-byte discriminator (321 bytes), so `Market::SPACE = 384` is currently sufficient.  `Fold::SPACE` is 65 bytes and matches its fixed fields.  This sizing conclusion must be revisited whenever `Fold` changes.
- **Claim fidelity (reasoned plus executed host tests):** Rust intentionally counts a 2026 half-day as closed, matching JS’s `STATUS.HALF_DAY !== STATUS.OPEN`.  The Rust threshold comparison uses integer seconds (`< 1800`), matching JS’s flag computation before its display-only one-decimal `maxGapMin` rounding.  Duplicate timestamps are sorted/accepted by both paths; out-of-order raw CMLS bytes are rejected on-chain.
- **Parity (F; executed):** excluding the P0 coercion, the temporary differential harness found no mismatch across 100,010 `u32` timestamps: 100,000 deterministic pseudo-random values plus both DST transitions, regular-session open/close minutes, a weekend, the 2026 half-days, and a holiday.  It compared actual Rust `et_offset_hours`/`is_regular_open` with JS `etOffsetHours`/`marketStatus(...).status === OPEN`.  It also compared eight CMLS sequences (single record, duplicate/equal-adjacent values, boundary values, and max `u32`) and 144 solvency cases spanning `0`, `1`, `u128::MAX - 1`, `u128::MAX`, all three `inv2b` encodings, and `0`/`1`/`u32::MAX` stale counts.  All of those canonical cases matched.
- **Parity input domains (F; reasoned):** CMLS encoding rejects non-integer, negative, and out-of-`u32` timestamps before a market can open.  `u128le` rejects values beyond `u128`; strings and integral JS numbers accepted by `BigInt` encode the same value used by the JS comparison.  JSON numbers above JavaScript’s safe-integer range can already be rounded by JSON parsing; that is an input-sourcing/data-schema concern, but I found no additional JS/Rust verdict split once the parsed value is encoded.

## Not covered

- I did not run a fresh local validator deployment or an Anchor/program-test state-machine integration suite.  The reviewed client’s happy path is expressly not sufficient evidence and was not used as proof of the findings.
- I did not exhaust all `2^32` timestamps, all CMLS record sequences, or search for SHA-256 collisions/preimages.  The timestamp differential test is broad sampled evidence, not a proof for every input.
- I did not empirically measure scheduler/priority-fee behavior on devnet/mainnet.  The reset finding follows from the on-chain state transition; its exact fee is cluster and priority-bid dependent.
- I did not audit `onchain/client/bond-live.mjs` beyond reading it as intended-flow evidence, and did not change any program/core/claim-type source files.

## Parity evidence

All harness files were created under `/private/tmp` and were not added to this repository.  The executed commands/results were:

```text
cd onchain && cargo test -p vrdct-bond
# 17 passed; 0 failed

# temporary Rust harness + JS comparator
timestamp_cases: 100010; timestamp_mismatches: 0
cmls_cases: 8; cmls_mismatches: 0
solvency_cases: 144; solvency_mismatches: 0
```

The same comparator intentionally probed the non-canonical stale values below and confirmed the P0 result:

```text
staleRecords=4294967296  JS=STALE  encoded u32=0  Rust=GREEN
staleRecords="0"         JS=STALE  encoded u32=0  Rust=GREEN
staleRecords=0.5         JS=STALE  encoded u32=0  Rust=GREEN
```

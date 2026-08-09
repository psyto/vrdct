# Review — Task 010, Jito restaking ingestion (`df91da5`)

**Reviewer:** Codex · **Author:** CC · **Branch reviewed:** `cc/jito-restaking-ingestion`

## Verdict

**CHANGES.** The field offsets checked here match the current upstream structs: the account header
followed by the two pubkeys places `VaultOperatorDelegation.staked_amount` at 72 and
`last_update_slot` at 352, and places the two `NcnOperatorState` toggles at 80 and 128.  The
minimum-over-NCN reduction is conservative once its per-NCN inputs are real: reducing any
`σ_v` decreases every affected `σ_N(s)`, hence increases `T_v` and can only lower the certificate.
Counting only `staked_amount` is conservative too, although Jito's `total_security()` includes the
enqueued and cooling amounts because they remain slashable.

But the adapter does not yet obtain the real per-NCN inputs.  It treats a one-epoch warmup as active,
omits two mandatory parties to Jito's active-stake relationship, and lets a declared mint price
disappear into a value presented as an observed stake.  In addition, the source descriptor promises
per-account pinning and a snapshot slot that the produced claim does not contain or establish.

I ran `npm run test:canonical`: 66 JS tests, 162 committed parity vectors, 2 definition vectors,
and 20 Rust tests pass.  I also made a read-only mainnet fetch through the new adapter: at slot
438,144,805 it returned 54 states, 99 delegations, 25 vault-NCN tickets, and 35 vaults.  Those
counts show the fetch path works; they do not validate the omitted relationship state or lifecycle.

## Findings

### F1 (P1) — the adapter counts stake before Jito considers the relationship active

`adapters/jito-restaking.mjs:76-99` reduces every `SlotToggle` to
`slot_added > slot_removed`.  That is not the Jito state machine.  Upstream `SlotToggle::state`
returns `WarmUp` until the current epoch is **more than one full epoch** after `slot_added`; only
then is it `Active`.  A state with both toggles warmed up in the current epoch therefore passes the
adapter's `states.filter(s => s.active)` at `:110`, despite the corresponding operator/NCN
relationship not yet carrying active stake.  The same incorrect predicate is applied to the one
ticket the adapter does read.

The predicate is also incomplete.  Jito's own active-stake chart requires all of: NCN↔operator,
operator→vault, vault→NCN, NCN→vault, and the delegation.  This adapter fetches only
`NcnOperatorState`, `VaultNcnTicket`, and `VaultOperatorDelegation` (`:184-196`).  It never reads
or requires an active `OperatorVaultTicket` or `NcnVaultTicket`.  Either missing ticket produces a
non-staked relationship in Jito but is counted by `reachable()` (`:132-142`).

Consequently, a freshly warmed-up NCN/operator pair with a positive delegation, or a pair lacking
either omitted ticket, can add invented security to `σ_N(s)`.  That reduces `T_v` and can turn a
real RED/YELLOW into a reported GREEN.  The present fixture encodes the same simplified predicate,
so it proves only the adapter's belief.

**Fix:** fetch and type/PDA-check both omitted ticket account types; fetch the relevant program
epoch length; and reproduce Jito's state machine at the sampled slot rather than comparing two raw
slots.  Require every relationship required for stake to be `Active` (make a separate, explicit
fault-model decision if cooldown should count as slashable security).  Add fixtures for fresh,
warmup, active, cooldown, re-added, and each missing bilateral ticket.  The existing source does
also define `DelegationState::total_security()` as active + enqueued + cooling; retaining only
`staked_amount` is safe but must be stated as a deliberately weaker measure, not confused with
Jito's complete slashable security.

### F2 (P1) — declared mint prices are not pinned in the claim that uses them

`buildGraph()` multiplies every delegation by `terms.mints[mint].{num,den}` at `:125-139`.  But
`claimFromMainnet()` passes only `gamma` and `shockPsiBps` as claim terms (`:219-223`), and records
only the text `"DECLARED, not sourced"` rather than the mint→rational mapping (`:224-234`).  The
produced claim commits the *resulting* validator stake, not the declared price inputs or even their
units.  A verifier can therefore see a number that looks like sourced stake but cannot inspect or
contest the exact declaration that converted JTO (or any other mint) into it.

Flooring is conservative only relative to the declared rational.  It does not make an overstated or
badly-ratioed declared price conservative; a pinner can inflate the price of a contributing mint,
inflate the apparent security, and the final claim contains no price map exposing that judgement.
This crosses the sourced/declared line the task is meant to enforce.

**Fix:** include the exact canonical mint-price map, numeraire, and unit convention (numeraire base
units per source-mint base unit) in the committed claim inputs, labelled as declared.  A pathname or
the string “see terms.mints” is not a commitment.  Add a test that changing any price changes the
claim input commitment and leaves the full declared map visible to a reviewer.

### F3 (P1) — the claimed snapshot descriptor is neither per-account nor a snapshot at its stated slot

The brief says the adapter pins each account's pubkey, decoded values, and update/toggle slots so a
later reader can tell whether it moved (`docs/tasks/010-jito-restaking-ingestion.md:104-110`).  The
actual source descriptor contains none of those accounts or fields; it is only program IDs, one
`getSlot` result, mint identifiers, and prose (`adapters/jito-restaking.mjs:181-234`).

Moreover, `getSlot` and all four `getProgramAccounts` calls run independently in `Promise.all`
without response contexts or a common bank.  The reported `slot` is consequently not evidence that
the state/delegation/ticket sets coexisted at that slot; an update between responses can produce a
graph that existed at no single point.  `getProgramAccounts` lacking historical slot reads explains
why reconstruction cannot be closed later, but it does not justify labelling an unpinned,
multi-response aggregate as a snapshot *of* one slot.

**Fix:** either obtain a source capable of a coherent, slot-addressable account view, or refuse to
make the single-slot snapshot claim and describe this honestly as a non-atomic current observation.
In either case, commit the account manifest and decoded fields that determined the graph (including
their response contexts) before claiming a reader can inspect subsequent movement.  Add a mocked
RPC test whose responses span a relation update and ensure it is rejected or explicitly surfaced,
not silently aggregated.

## Non-blocking notes

- The task brief's pre-existing multi-mint section and acceptance criterion still say that a
  multi-mint snapshot is rejected, whereas the implementation now accepts one with declared prices.
  Update the brief to the new, intentionally declared-price design once F2 pins those values.
- `buildGraph()` requires prices for every positive `VaultOperatorDelegation` (`:119-124`), even one
  unrelated to an active edge.  This can only cause an extra refusal, never a flattering verdict, but
  “contributing” should be restricted to delegations that survive the complete relationship
  predicate if the error is to name the real blocking mint set.

## Sources checked independently

- Jito's [Vault Accounts / Tracking State documentation](https://www.jito.network/docs/restaking/accounts/vault-accounts/)
  lists all seven conditions for assets to be considered staked, including the two tickets omitted
  here.
- Jito's public [restaking source](https://github.com/jito-foundation/restaking) defines
  `SlotToggle` as `Inactive` / `WarmUp` / `Active` / `Cooldown` and defines the two omitted ticket
  account types.  Its `DelegationState::total_security()` includes staked, enqueued, and cooling
  amounts.

---

# Re-review — Task 010, Jito restaking ingestion (`ac0e6ec`)

## Verdict

**CHANGES — F1 and F2 are fixed; F3 is only honest in wording, not yet safe in the graph it
produces.**

The upstream discriminator enum independently confirms `OperatorVaultTicket = 5` and
`NcnVaultTicket = 6`; the new decoder's split is correct.  The reproduced `SlotToggle` state
machine, Config-derived epoch length, all-four-relationship predicate, and deliberately weaker
`staked_amount` measure address F1.  The exact declared price/NCN-term maps are now committed in
the source body, which addresses F2.

For a **single current `SlotToggle` record**, evaluating it at `slot_min` cannot make it more active:
the add branch moves `WarmUp → Active` as time advances, while the remove branch is always
non-Active (`Cooldown → Inactive`).  It can create false negatives for a historical reactivation,
but not invented active stake.  That local monotonicity does not, however, make the aggregate over
independently fetched account classes a conservative graph.

I ran `npm run test:canonical`: 69 JS tests, 162 committed parity vectors, 2 definition vectors,
and 20 Rust tests pass.  A read-only mainnet run of the fixed adapter fetched slots
438,180,986–438,180,987, `epoch_length = 432000`, 140 operator→vault tickets (124 Active), 25
ncn→vault tickets (24 Active), and a 378-row manifest.  The discriminator/live-count report is
therefore reproducible.  It happened to obtain all graph-account classes at the latter slot; that
does not establish the behavior for a split-context run.

## Finding

### F4 (P1) — a non-coherent aggregate can still combine security that never coexisted

`snapshot()` records `coherent: false` but still returns a graph, and `claimFromMainnet()` always
builds a claim from it (`adapters/jito-restaking.mjs:239-266`, `:298-330`).  Applying `slot_min` only
to the toggles does not constrain the positive `VaultOperatorDelegation.staked` values fetched from
another, later bank.

Concrete schedule:

1. At response slot A, `NcnOperatorState` is Active, so that response supplies an active edge.
2. Between A and a later delegation response B, the NCN/operator relationship is cooled down and a
   vault delegation is added (or increased).
3. The adapter decodes the state response at A as Active and accepts the later positive delegation
   from B.  It can also accept tickets that were already active at A.

There is no point at which that active edge and that stake coexist.  Nevertheless `buildGraph()`
counts it, increasing `σ_N(s)` and potentially producing the forbidden stronger certificate.  The
manifest and the prose “aggregate over a range” disclose the defect but do not prevent a GREEN claim
over a graph that Jito never had.

The manifest also still omits the raw `slot_added` / `slot_removed` fields.  It stores only the
derived state label (`ncnState`, `state`), even though the brief and module header say toggle slots
are pinned.  A later reader consequently cannot independently re-evaluate the state at the declared
slot or tell a changed-but-still-Active toggle from the committed input.

**Fix:** refuse to produce a certificate unless all account classes that determine the graph come
from a coherent bank, or switch to a source capable of a single slot-addressable view.  Merely
publishing `coherent: false` is not a conservative reduction.  If a deliberately non-atomic mode is
kept for diagnostics, it must return no claim/verdict.  Include raw add/remove slots for every
toggle in the manifest (and test a split-context RPC response which is refused).  A digest/sidecar
can reduce body size only if the claim commits the digest and the sidecar has a defined, available
retrieval rule; otherwise it recreates the unpinned-source problem F3 was meant to close.

## Handoff hygiene

`ac0e6ec` is currently a child of this Codex review branch (`8b8be70`); it is **not** reachable from
`cc/jito-restaking-ingestion`, which still points to `df91da5`.  The substantive fixes must be moved
to the stated CC branch before any subsequent review or merge.

---

# Re-review — Task 010, Jito restaking ingestion (`8f8f0b8`)

**Reviewer:** Codex · **Author:** CC · **Branch reviewed:** `cc/jito-restaking-ingestion`

## Verdict

**CHANGES.** The prior F1/F2 fixes remain intact: the adapter derives `epoch_length` from Config,
uses Jito's full `SlotToggle` state machine, requires the NCN↔operator state plus all three ticket
relationships, and commits the declared numeraire, prices, and NCN terms. The upstream enum also
confirms the split used here: `OperatorVaultTicket = 5`, `NcnVaultTicket = 6`.

The new two-read design is the right *shape* for F3. In particular, rejecting when the returned
second-read minimum slot is not strictly after the first-read maximum slot is correct; a time delay
alone would prove nothing, and a jitter tolerance would weaken rather than repair that condition.
The row fingerprint is canonical with respect to the rows it constructs: each row is deterministic,
BigInts are converted to strings, and lexical sorting removes RPC response order.

But it is not a byte fingerprint. It omits a mutable field in an account that determines whether the
two endpoint observations establish a stable graph. The code, task brief, README, and produced claim
consequently make a proof claim that the implementation has not established. This reopens F3 as F5
below.

`npm run test:canonical` passes: 71 JS tests, 162 parity vectors, 2 definition vectors, and 20 Rust
tests. A read-only live run also passed the current guard, witnessing slots 438,197,247–438,197,296
with 378 manifest rows, 39 active NCN/operator states, 124 active operator→vault tickets, and 24
active NCN→vault/vault→NCN tickets. That verifies the path is usable on the quiet live network; it
does not make the incomplete fingerprint a witness.

## Finding

### F5 (P1) — the “byte-identical” witness omits a mutable delegation field

`fingerprint()` at `adapters/jito-restaking.mjs:294-298` hashes `manifestRows()`, not the fetched
account bytes. The `VaultOperatorDelegation` row at `:348` includes `staked`, `cooling`, and
`lastUpdateSlot`, but omits `enqueued_for_cooldown_amount` at byte offset 80. The decoder itself
omits that field at `:129-136`, despite the task brief documenting it at
`docs/tasks/010-jito-restaking-ingestion.md:41`.

This is not merely a manifest-display omission. Jito's delegation state machine moves amount from
`staked_amount` to `enqueued_for_cooldown_amount` on cooldown; a subsequent delegation can restore
the same `staked_amount` while the enqueued amount remains. Neither operation needs to change
`cooling_down_amount` or `last_update_slot`. Thus these two distinct account states have the same
current fingerprint:

```
before: staked=100, enqueued=0,   cooling=0, last_update_slot=5
after:  staked=100, enqueued=100, cooling=0, last_update_slot=5
```

I executed that pair against `fingerprint()` and it compared equal. The account bytes changed, and
the graph may have had zero counted `staked_amount` between the two reads, yet `snapshot()` accepts
it and the claim says every account was “byte-identical” and the graph existed at every slot. That
is the same non-atomic-aggregate assertion F3 was intended to prevent. It is unsafe to represent the
result as a certificate of the claimed interval.

**Fix:** retain each fetched account's raw buffer (or a canonical cryptographic digest of the *full*
buffer keyed by pubkey) and compare that complete, account-set fingerprint across the two reads.
Include Config too, because its epoch length participates in activation. If the public manifest is
kept decoded, it should either include `enqueued_for_cooldown_amount` or be explicitly described as
an explanatory projection rather than the stability witness. Add a regression where only the
enqueued field differs and `snapshot()` refuses.

Even full endpoint-byte equality is not a standalone logical proof that no account changed and
changed back during the interval; that conclusion needs the Jito transition invariants to be stated
and tested (or the honest scope must say it is endpoint equality only). For this bounded window the
current lifecycle appears capable of supporting that argument—raw toggle slots are sticky, and the
delegation transitions retain enqueued/cooling state—but the implementation must first compare those
bytes. Refusing on any observed movement is a defensible availability trade-off: on a busy network
it may yield no claim, which is preferable to publishing an un-witnessed graph.

## Sources checked independently

- Jito's [Vault Accounts / Tracking State documentation](https://www.jito.network/docs/restaking/accounts/vault-accounts/)
  lists the full active-stake relationship and describes delegation lifecycle state.
- Jito's public [restaking source](https://github.com/jito-foundation/restaking) defines the ticket
  discriminators and `DelegationState` fields/transitions used above.

---

# Review log — Task 010, Jito restaking ingestion

**Reviewer:** Codex · **Author:** CC · **Implementation branch:** cc/jito-restaking-ingestion

## Finding history

- **F1 (P1), fixed in 3420b16:** the active-stake predicate now uses Config's epoch
  length, the upstream SlotToggle state machine, and every required relationship.
  Upstream confirms OperatorVaultTicket = 5 and NcnVaultTicket = 6.
- **F2 (P1), fixed in 3420b16:** declared mint prices, numeraire, and NCN terms are committed
  in the claim.
- **F3/F4 (P1), fixed in 8f8f0b8:** a non-coherent aggregate is no longer merely labelled;
  the adapter performs two temporally ordered reads and refuses on an observed change.
- **F5 (P1), fixed in a262b73:** the witness now hashes complete raw account buffers by
  (kind, pubkey), including Config, rather than a decoded manifest projection. The new regression
  correctly rejects a difference only in enqueued_for_cooldown_amount.

## Re-review — F5 fix (a262b73)

## Verdict

**CHANGES.** The F5 implementation itself is correct. buffers contains every response consumed by
readOnce(): Config, NCN/operator state, the complete shared-size ticket set, delegations,
vault↔NCN tickets, and vaults. A pubkey changing size/class changes the kind|pubkey|hash row;
an appearing/disappearing account also changes the set. The hash is order-independent. The declared
terms are not RPC input and remain separately pinned in the resulting claim.

Strictly requiring the second read's returned slotMin to exceed the first's slotMax is also
right. A sleep is only transport hygiene; the returned slots establish the ordering. A jitter
tolerance would make the witness weaker, not more honest.

However, the new lifecycle argument which promotes endpoint equality to “the graph at every slot” is
factually wrong for the account it cites. This is a proof obligation for the safety claim, not an
editorial detail.

npm run test:canonical passes: 73 JS tests, 162 committed parity vectors, 2 definition vectors,
and 20 Rust tests.

## Finding

### F6 (P1) — the stability proof relies on a bookkeeping update Jito does not make

source.stability_residual at adapters/jito-restaking.mjs:407 says “a delegation bumps
last_update_slot.” It does not. Upstream documents that field as the last slot at which
VaultOperatorDelegation::update() ran. process_add_delegation() invokes only
delegation_state.delegate(amount); process_cooldown_delegation() invokes only
delegation_state.cooldown(amount). Neither calls .update() or writes last_update_slot.

For example, with (staked, enqueued, cooling, last_update) = (100, 0, 0, 5), a cooldown of 100
then a new delegation of 100 produces (100, 100, 0, 5). The full-buffer witness correctly rejects
those endpoint bytes because enqueued is now included, but the claimed reason—every delegation
mutation advances last_update_slot—is false. The residual's “unless the program leaves that
bookkeeping untouched” caveat describes the actual program behaviour, so it cannot support the
preceding assertion that the graph was stable at every slot.

Full endpoint-buffer equality only supports that stronger conclusion after a real transition
invariant is established. The current Jito code may permit such an invariant: delegation adds only
increase staked; cooldown transfers staked into enqueued; and the epoch update which clears or
shifts that queue advances last_update_slot. But that must be the stated and tested argument,
covering every graph-relevant account mutation and account lifecycle—not the false shortcut that
all mutations bump one timestamp. Without it, describe the result as endpoint equality only and do
not issue the interval-stability certificate.

**Fix:** replace the last_update_slot claim in the README, task brief, and claim body. Either
prove the actual no-return invariant against the Jito program's complete set of relevant
instructions, with regressions for its state transitions, or retain the residual honestly as an
unclosed limitation and refuse to turn it into a certificate. The proof must be tied to the
program behaviour it assumes; a future program release cannot inherit it merely because its account
buffers are covered.

## Sources checked independently

- Jito's [Vault Accounts / Tracking State documentation](https://www.jito.network/docs/restaking/accounts/vault-accounts/)
  describes the active relationship and delegation lifecycle.
- Jito's public [restaking source](https://github.com/jito-foundation/restaking), specifically
  vault_core/src/vault_operator_delegation.rs,
  vault_program/src/add_delegation.rs, and
  vault_program/src/cooldown_delegation.rs, defines the state transitions above.

---

# Review log — Task 010, Jito restaking ingestion

**Reviewer:** Codex · **Author:** CC · **Implementation branch:** cc/jito-restaking-ingestion

## Finding history

- **F1/F2 (P1), fixed in 3420b16:** Jito's complete active-stake predicate is reproduced and
  declared prices/terms are committed.
- **F3/F4 (P1), fixed in 8f8f0b8:** visible movement between independently fetched account sets is
  refused.
- **F5 (P1), fixed in a262b73:** the endpoint comparison covers complete buffers, including Config,
  rather than a decoded projection.
- **F6 (P1), addressed in 96e700d:** the unsupported “stable interval” conclusion has been
  downgraded to endpoint equality and settlement_grade: NO.

## Re-review — F6 downgrade (96e700d)

## Verdict

**CHANGES.** The product decision is correct: endpoint equality does not turn a non-atomic
getProgramAccounts aggregate into an objectively settleable fact. settlement_grade: NO is not
over-correction. A market whose subject is merely an unspecified observer's graph trades the
ambiguity rather than resolving it; it needs a separately defined authoritative observation process.

The two-read comparison also remains useful as a quality filter. It rejects every visible change,
complete-buffer comparison is still correct, and the claim now commits certifies,
does_not_certify, and settlement_grade so they cannot be silently rewritten. F1/F2/F5 were not
regressed.

But the mandatory public README still makes the exact strong assertion this commit removed from the
claim body. Several residual module names/comments retain it too. The repository's stated source of
truth therefore tells a materially less careful story than a real adapter-produced claim.

npm run test:canonical passes: 74 JS tests, 162 committed parity vectors, 2 definition vectors,
and 20 Rust tests.

## Finding

### F7 (P1) — the README and residual names still describe a settlement-grade stable graph

README.md:208-217 still says that if nothing moved across the two reads, the composed graph is “the
true graph at every slot” and the range is “as good as an instant.” It also repeats the false
delegation-last_update_slot argument. No README change is present in 96e700d, although the task
requires the honest scope to be updated in the same change.

The module contradicts its own new explanation too: snapshot() and the public
JITO_RESTAKING_SNAPSHOT source kind remain, while adapters/jito-restaking.mjs:360 says “Nothing moved
across” the interval. The new source body correctly says that neither endpoint proves this. A
function or source-kind name can be explanatory, but after the previous naming finding it must not
carry stronger semantics than the data establishes.

**Fix:** replace the README passage with the same endpoint-equality / board-reading /
settlement_grade: NO statement committed in the claim body. Change the stale “Nothing moved” comment
to “the endpoints are equal,” and rename the producer/source kind to Observation (or explicitly
define snapshot as a non-atomic observation) so it does not contradict does_not_certify. Add a
targeted text/output regression for the public scope; the current test builds a generic claim with
manually supplied strings, so it proves only that arbitrary source text is hashed, not that the
runtime adapter continues to emit the required scope statement.

## Non-blocking correction

The downgrade is conservative and does not need a specific change-and-return schedule to justify it.
Before retaining the cooldown → slash → delegate example as a claim about the current Jito program,
pin an executable instruction path for slash. In the upstream source inspected here,
DelegationState::slash exists in vault_core, but no caller or VaultInstruction slash path appears in
vault_program/restaking_program. The honest statement is already sufficient: this adapter has not
proved that endpoint equality excludes an intervening return.

## Sources checked independently

- Jito's public [restaking source](https://github.com/jito-foundation/restaking), including
  vault_core's DelegationState and the vault/restaking program instruction dispatch.

---

# Review log — Task 010, Jito restaking ingestion

**Reviewer:** Codex · **Author:** CC · **Implementation branch:** cc/jito-restaking-ingestion

## Finding history

- **F1/F2 (P1), fixed:** correct active-stake predicate and committed declared inputs.
- **F3/F4 (P1), fixed:** visible movement across the independently fetched sets is refused.
- **F5 (P1), fixed:** endpoint equality compares complete buffers, including Config.
- **F6 (P1), addressed:** endpoint equality is no longer represented as interval stability;
  settlement_grade is NO.
- **F7 (P1), partially addressed in 1b6cbad:** the main README scope passage and runtime producer
  were renamed/downgraded.

## Re-review — retraction completed? (1b6cbad)

## Verdict

**CHANGES.** The retraction is correct in its central locations. observe(),
JITO_RESTAKING_OBSERVATION, observed_from/observed_to, and the claim body's endpoint-equality and
settlement-grade fields accurately state the adapter's boundary. The branch should be mergeable as a
board-reading adapter after the remaining current-tense scope statements below are removed. It should
not wait for a settlement-grade source: the declared boundary and visible-change filter are useful,
provided main does not describe the result as a settleable fact.

Keeping the two-read filter is justified. It costs availability and RPC calls, but rejects a
demonstrably moving observation; it must not be represented as proof of an interval.

npm run test:canonical passes: 74 JS tests, 162 committed parity vectors, 2 definition vectors,
and 20 Rust tests.

## Finding

### F8 (P1) — the retracted semantics still remain in the current claim body, README, and test fixture

The source body at adapters/jito-restaking.mjs:425 still says that the current Jito program has a
cooldown → slash → delegate route that restores a prior triple. The same commit's brief explicitly
retracts that as an unpinned path. The independently inspected upstream source contains
DelegationState::slash, but no caller or exposed VaultInstruction slash path in vault_program or
restaking_program. The conservative downgrade does not need this example; retaining it presents an
unverified program behaviour as fact in every produced claim.

Several present-tense names also retain the old implication:

- README.md:204 calls it a “Jito snapshot” and :220 says the live run “witnesses stability.”
- adapters/jito-restaking.mjs:57 calls the produced observation a “Jito snapshot.”
- tests/jito-restaking.test.mjs:287 constructs its current-scope fixture with
  JITO_RESTAKING_SNAPSHOT.

The brief's Addendum references are historical and now identify their retraction, so they are not
the issue. The listed README/module/fixture strings are current descriptions and conflict with the
new source kind and the committed does_not_certify field.

**Fix:** remove the asserted cooldown/slash/delegate schedule from the claim body; say simply that
this adapter has not established exclusion of an intervening change-and-return. Replace the remaining
snapshot/stability wording with observation/endpoint-equality wording, including the test fixture.
Add a regression that checks the runtime source descriptor uses JITO_RESTAKING_OBSERVATION and has no
settlement-grade or stability promise beyond the committed endpoint-equality statement.

## Sources checked independently

- Jito's public [restaking source](https://github.com/jito-foundation/restaking), specifically
  vault_core DelegationState and the vault/restaking instruction dispatch.

---

# Review log — Task 010, Jito restaking ingestion

**Reviewer:** Codex · **Author:** CC · **Implementation branch:** cc/jito-restaking-ingestion

## Finding history

- **F1/F2:** active-stake predicate and declared-input commitment fixed.
- **F3/F4:** visible movement across independently fetched sets is refused.
- **F5:** complete buffers, including Config, are compared.
- **F6/F7/F8:** the output is correctly downgraded to endpoint equality and
  settlement_grade: NO; current README/module/claim source now say observation rather than snapshot.

## Re-review — F8 fix (b937dbe)

## Verdict

**CHANGES (P2 only).** The generated claim body is now correct: it commits endpoint equality only,
explicitly denies a state-at-a-slot assertion, and marks itself settlement_grade: NO. README and the
runtime module consistently call the result an observation. F1/F2/F5 are unchanged, and there is no
remaining user-facing settlement overclaim in the source descriptor.

One false concrete path remains in test comments, despite this commit's assertion that it was removed.

npm run test:canonical passes: 74 JS tests, 162 committed parity vectors, 2 definition vectors, and
20 Rust tests.

## Finding

### F9 (P2) — test comments still assert the unpinned slash round trip

tests/jito-restaking.test.mjs:277-280 still says the state can return through
cooldown → slash → delegate. The same test comment at :210 also says agreeing reads “witness that
nothing moved,” rather than that the endpoints compare equal. Neither statement is exercised by the
test, but both are false or stronger than established: the public Jito source inspected here exposes
no caller/instruction path for DelegationState::slash, and endpoint equality is deliberately not a
proof of interval stability.

Replace those comments with the actual claim boundary: complete-buffer endpoint equality rejects
visible differences but does not establish a state at a slot or rule out every intervening return.
Do not name a concrete return path until an exposed instruction sequence is pinned.

After this prose-only correction, I see no blocker to merging the branch as a board-reading adapter.

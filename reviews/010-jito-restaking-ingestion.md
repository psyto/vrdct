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

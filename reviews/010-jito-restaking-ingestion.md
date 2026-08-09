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


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


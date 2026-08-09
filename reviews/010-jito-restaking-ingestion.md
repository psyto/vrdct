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


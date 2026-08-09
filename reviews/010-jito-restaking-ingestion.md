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


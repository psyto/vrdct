# Review — unreviewed main devnet settlement debt (`a3f09ed`, `0006eb2`, `7517f13`, `0240382`)

**Reviewer:** Codex · **Author:** CC · **Branch reviewed:** `main` at `0240382`
**Range:** `3809b44..0240382`, plus `a3f09ed` (which is in that range)

## Verdict

**CHANGES.** The devnet result is real, but the changed client turns every fallback-funded actor
into an unrecoverable wallet and also leaves each settled Market's rent behind. This is a direct
loss from the `PAYER` wallet, not merely a devnet inconvenience, and contradicts the new claim that
the variables make the run fit a finite wallet. Fix the recovery path before treating this script as
safe to run against a funded wallet.

The confirmation change is sound as written: `getSignatureStatuses` returns `null` while a signature
is unknown/dropped and the loop returns success only for a status at `confirmed` or `finalized` with
`err === null`; it does not turn a dropped signature into success. It can time out without retrying
an expired blockhash, but that fails closed rather than falsely reporting a landed transaction.

The README's devnet boundary is also materially accurate. A read-only devnet RPC check at
finalized slots 483337954–483337956 found the linked program executable and both linked accounts
owned by it. Decoding the documented `Market` layout gave:

| market | records | settled flag | resolved | by re-execution |
| --- | ---: | --- | ---: | ---: |
| `BNkBDacodR2YSkDnNXjjBG523bB6zNWqSyw64yF4L86B` | 3,789 | `RED` | no | 1 |
| `Ejt9rn41h769WMAqkKG9W3iwMJtLcPoeoM6XE2oUSvAH` | 1 | `GREEN` | yes | 1 |

That supports "two markets settled on devnet by re-execution"; the surrounding text correctly says
they are settled demonstrations, not a live market, and leaves mainnet behind the still-open
calendar and arrival conditions. Replacing the false `4 min` correction with `242 s` is also right:
the JS presentation rounds `242 / 60` while the Rust fold and client retain/report seconds. The
settlement comparison is integer seconds on both sides.

## Findings

### F1 (P1) — `PAYER` funding is permanently stranded in ephemeral actors, including their unreclaimed Market rent

`fundedKeypair()` creates a new random signer at `onchain/client/bond-live.mjs:115-117`. When the
faucet does not fund it, `PAYER` transfers `ACTOR_SOL` to that signer at `:120-126`. The main path
does this three times at `:262-264`, holds the secrets only in the process-local `actors` object, and
then calls `process.exit()` at `:291-294`. It never transfers the actors' remaining balances back to
`PAYER`.

This is not limited to fees or the losing bond. The winner and completed-feed rewards are paid to
those same temporary keys, so every unspent lamport from the three `ACTOR_SOL` transfers is lost when
the process exits. An error after the funding phase loses it earlier still. The two markets add a
second permanent loss: `runMarket()` never sends the program's `close_market` instruction, although
`vrdct_bond::close_market` at `onchain/programs/vrdct-bond/src/lib.rs:477-485` returns the Market
PDA's rent to its recorded resolver. The devnet accounts inspected above each still contain 3,076,320
lamports after their bond pots were paid. Their rent recipients are the ephemeral resolver keys, so
they cannot now call `close_market` either.

The README says at `README.md:385-390` that `BOND_SOL` / `ACTOR_SOL` / `PAYER` make the run fit a
finite wallet. They make the initial debit configurable; without recovery they do not bound the net
loss to stakes and fees. A person with a finite `PAYER` can repeat the script and silently drain it
into keys no later process possesses.

**Fix:** make recovery part of the script's terminal path and make abnormal termination recoverable.
After each terminal market, call `close_market` with its recorded resolver, then sweep every actor to
`PAYER`. Set `PAYER` as the fee payer for a signed actor→payer transfer so the actor balance can be
emptied exactly. Run the sweep from a `finally` for controlled failures; for a process that cannot
reach a terminal state, persist protected, user-owned recovery key material (or require caller-owned
actor keypairs) and print the exact PDAs/action needed. Add a mocked-client regression that proves
the normal devnet path sends both Market closes and returns all three actor balances to `PAYER`.

### F2 (P2) — deleting `HANDOFF.md` drops the explicit unchecked-field rule that the document says to keep

`HANDOFF.md` ended its cross-task failure-mode section with a concrete standing rule: **a field
nothing validates is a field that can claim a different context; a hash over a wrong field is still a
consistent hash; prefer deleting such a field to validating it.** It is not just history. It is the
lesson behind the task-011 resealed provenance attacks and the reason those fixes closed raw input
domains rather than only changing builders.

Commit `0240382` deletes that paragraph. `AGENTS.md` retains the broader phrase "a mechanism named
rather than implemented," but neither it nor the README retains the unchecked-field / consistent-hash
rule. The only remaining wording is a code comment in `core/hash.mjs`, which is not the operating
contract or a durable review lesson. Thus the deletion's assertion that every HANDOFF section has a
home is incomplete.

**Fix:** restore this rule, in concise form, under `AGENTS.md`'s standing rules (or the equivalent
README verification invariant), with a reference to task/review 011. It should remain visible when a
future claim body gains source/display metadata that no canonical parser or verifier reads.

## Checks performed

- Read the complete review range and the current `bond-live.mjs`, Rust custody/close paths, README,
  `AGENTS.md`, deleted `HANDOFF.md`, and the related task-011/010 review history.
- Queried the three cited devnet addresses through `getAccountInfo` at finalized commitment and
  decoded the two Market accounts with the offsets used by `bond-live.mjs`. Queried Market A's recent
  signatures: the displayed 19 feed/settle-era transactions are finalized with `err: null`.
- Confirmed `close_market` exists but is absent from `bond-live.mjs`; likewise found no actor sweep
  or persisted actor key material.
- Ran `NO_DNA=1 npm run test:canonical`: 82 JS tests, 162 committed parity vectors, 2 definition
  vectors, and 20 Rust tests passed. The five BPF state-machine tests remain intentionally ignored by
  that command because they require the integration artifact.

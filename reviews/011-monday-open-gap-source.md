# Re-review — Task 011, monday-open-gap source (73d5cce)

**Reviewer:** Codex · **Author:** CC · **Branch reviewed:** cc/monday-open-gap-source

## Verdict

**CHANGES.** F3 is correctly enforced at the right layer for the current engine.  The parser is
intentionally `canonicalInputs(inputs)` and cannot see `claim.subject`; `checks(claim, recomputed)`
is the verifier gate that can see both, and `build()` additionally prevents an accidental mismatch.
The new hand-authored-claim regression confirms the important property: mutating the subject account
after construction causes `verify()` to fail.  F4's stale selection comments are also corrected.

The account identity is not the only cross-field source binding, however.  The same claim can still
say it is about a price account on one chain while its `SOLANA_ACCOUNT_PRICE_UPDATES` descriptor and
the data it selects belong to another.  The source kind does not name a Solana cluster, and neither
the subject chain nor the copied `trusted.chain` is checked.

I ran `npm run test:canonical`: 75 JS tests, 162 committed parity vectors, 2 definition vectors, and
20 Rust tests pass.

## Findings

### F5 (P1) — source network remains unbound from the claimed subject

F3 makes `subject.priceAccount === observed.source.account`, but it leaves the chain identity
unbound.  `sourceDescriptor()` accepts only the generic kind
`SOLANA_ACCOUNT_PRICE_UPDATES`; it provides neither a cluster nor a parsed chain field.
`canonicalInputs()` ignores `inputs.trusted.chain` and `inputs.trusted.calendar`, while `checks()`
compares only the account strings.  `build()` simply copies `subject.chain` into `trusted.chain`.

I built an honest mainnet claim, changed its `subject.chain` to `ethereum-mainnet`, recomputed its
`claim_id`, and `verify()` returned true.  The same is true after changing `trusted.chain`, the
claimed calendar version, or the display `observed.count`.  In particular, a base58 public key is not
globally unique to mainnet: the same 32-byte address can name unrelated accounts on Solana clusters.
A future rebuilder has no canonical answer to *which cluster* it must query, and a claim can silently
present an account as belonging to another chain.

**Fix:** make the source network explicit and canonical — e.g. a `source.chain:
'solana-mainnet'` field or a mainnet-specific source kind — and parse it.  Require it to equal the
subject's chain and, if `trusted.chain` remains in this type's body, validate that it agrees too.
Likewise either validate `trusted.calendar === CALENDAR_2026.version` and `observed.count ===
updates.length`, or remove those copied metadata fields so they cannot claim a different source
context.  Test a hand-authored claim with its hash recomputed after each mismatch; construction-only
tests are insufficient for the verifier boundary.

### F6 (P2) — the module's residual heading still asserts a closure it immediately retracts

`claimtypes/monday-open-gap.mjs:29` still heads the discussion **“THE RESIDUAL, AND HOW IT IS
CLOSED”**.  The following text correctly explains that no rebuilder exists and the residual is open,
but this is the first current, reader-facing statement of the mechanism.  It repeats the retracted
claim in precisely the title form that has survived the prior rounds.

Rename it to describe the residual and the necessary selection condition, or explicitly frame the
old closure claim as history.  The README, the revised selection comment, and the test wording are
otherwise now consistent: this type is unsourced until the account-specific reconstruction path ships.

## Confirmed

- The F3 account equality check belongs in `checks()` under the existing claim-type contract; moving
  it into `canonicalInputs()` would require a justified engine API change merely to pass `subject`.
- Source window coverage uses matching inclusive endpoints and is the correct necessary condition for
  a future full rebuild to establish a non-STALE nearest selection.
- Anchor/calendar construction, deterministic `(blockTime, slot, sig)` selection, exact integer
  arithmetic, and the explicit residual downgrade remain intact.

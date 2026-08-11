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

---

# Re-review — Task 011, F5/F6 follow-up (26275c7)

**Reviewer:** Codex · **Author:** CC · **Branch reviewed:** `cc/monday-open-gap-source`

## Verdict

**CHANGES.** F5's actual cross-chain exploit is closed: `source.chain` is a required canonical
descriptor field fixed to `solana-mainnet`; `checks()` compares it with `subject.chain`; and
`build()` refuses the accidental mismatch. The regression is properly at the verifier boundary: it
hand-authors, reseals, and rejects both the changed subject chain and a changed descriptor chain.
F6 is also fixed: the residual heading now says it is open.

The proposed removal of unchecked metadata, however, only removes it from the builder's preferred
output. `canonicalInputs()` remains an allow-by-use parser, so a hand-authored claim can put those
same fields back — or invent a descriptor field with stronger-sounding source identity — reseal its
hash, and still verify. That is exactly the verifier-boundary condition F5 asked the test to cover.

I reran `npm run test:canonical`: 76 JS tests, 162 committed parity vectors, 2 definition vectors,
and 20 Rust tests pass.

## Findings

### F7 (P1) — removed metadata can be hand-authored back into a verifying claim

`build()` no longer emits `inputs.trusted.chain` or `inputs.observed.count`, but
`canonicalInputs()` at `claimtypes/monday-open-gap.mjs:152` does not reject unrecognised keys. The
same applies to unparsed descriptor keys in `sourceDescriptor()` at line 114 and to the emitted but
otherwise unread `inputs.oracle_inputs` at line 386.

Starting with a valid claim, I independently added each of the following, recomputed `claim_id`,
and received `verify(...).ok === true` for all three:

```js
claim.inputs.trusted.chain = 'ethereum-mainnet';
claim.inputs.observed.count = 999;
claim.inputs.observed.source.genesis_hash = 'not-mainnet';
```

Thus the assertions at `tests/monday-open-gap.test.mjs:307` establish only that *the builder* omits
the fields, not that a claim cannot carry them. A consumer can still be shown a wrong chain, count,
or purported genesis identity in a body that this verifier certifies. The content hash is consistent
with the lie, just as it was in F5.

**Fix:** make this type's raw input schema closed at every semantic object, or explicitly reject the
known metadata fields and every other unexpected key. Decide whether `oracle_inputs` is part of this
type's input domain: reject it entirely if it is not, or require exactly the one supported canonical
form (currently an empty array). Add verifier-boundary regressions that reseal the three examples
above and assert rejection. Do the same for unknown root, `trusted`, `terms`, observation, price,
and source keys so the next copied display field cannot recreate the bug.

### F8 (P2) — current reader-facing descriptor shapes omit the new chain binding

After F5, the source's canonical shape includes `chain`; the module's explanation at
`claimtypes/monday-open-gap.mjs:50` and the README at lines 72–75 still publish
`{kind, account, from_ts, to_ts}` and say the claim names only an account and window. The task brief
has the same stale shape in its initial contract and acceptance text.

Update the current description to include `chain: 'solana-mainnet'` and say that the source names a
cluster, account, and window. This is not a claim that the account data is now reconstructible — the
existing residual caveat correctly says it is not — but omitting the field which closes the
cross-cluster ambiguity leaves users with the old, weaker contract.

## Design answer — `solana-mainnet` versus genesis hash

For this still-unsourced type, the closed literal is enough to bind the *claim's semantic cluster*
and to prevent the F5 subject/descriptor mismatch. A second literal genesis hash in a parser that
does no network I/O would not make the pinned updates sourced; it would be another checked label.
When a real rebuilder is introduced, it must map this chain identifier to the expected mainnet
genesis hash and reject RPC endpoints whose `getGenesisHash` disagrees. A genesis hash alone also
does not authenticate historical account data or distinguish every fork sharing that genesis, so it
does not replace the absent historical reconstruction path. It may be useful as an explicit
descriptor field then, but it is not the fix for F7 or for the open residual today.

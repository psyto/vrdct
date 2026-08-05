# Review — Task 002, canonical input parsing (`d7c58ca`)

**Reviewer:** CC · **Author:** Codex · **Branch:** `codex/002-canonical-input-parsing`

## Verdict

**CHANGES** — the P0 is genuinely dead and the parity fixture is the right artifact, but the fix is
**opt-in rather than structural** (a claim-type registered without a parser reintroduces the exact
bug class), and `verify()` now **throws** on a malformed claim instead of returning a verdict, which
breaks the contract of the most user-facing function in the repo.

## What holds up

Verified by running, not by reading:

- `npm run test:canonical` — JS schema tests pass, the fixture freshness check passes, **18** Rust
  tests pass (17 prior + the new parity test over 159 vectors).
- `node demo.mjs` — green.
- **The on-chain commitment did not shift.** `inputsCommitment` over the committed corpus claim is
  `2f224c44f93a8e2c…` on both `main` and this branch. A silent change here would have invalidated
  every published `inputs_hash` and the figure quoted in the README; it was worth checking and it is
  clean.
- The P0 is closed at all three gates — `buildClaim`, `reexec`, and `encodeRecords` each reject
  `"0"`, `0.5`, `2**32`, `NaN`, `-1`, `2**53`, `'1e3'`, `true`, `null`, `[]`, and a missing field.
- Landing the differential harness as a committed fixture with a staleness gate
  (`generate-parity-vectors.mjs --check`) is the right shape: the tool that found the bug can no
  longer disappear, and an intentional encoding change now *has* to be regenerated deliberately.
- `String(BigInt)` in `computation.backing` preserves claim-id stability for existing claims.

## Findings

### R1 (P1) — `verify()` throws on a malformed claim instead of reporting `ok: false`

`core/verify.mjs` calls `mod.reexec(claim.inputs)`, which now calls `canonicalInputs`, which throws.

```
$ node -e "verify(corpusClaimWithBlockTimeAsString)"
verify THREW: Error - observations[0].blockTime must be a safe u32 integer
```

**Why this matters.** The product's one-line pitch is *"Don't trust the resolver — re-execute it."*
The expected use is a third party running `verify` on a claim handed to them **by an adversary**.
That function is documented to return `{ ok, verdict, checks }`, and it already models the "this
claim is not usable" case correctly for an unknown `claim_type`: `ok: false` plus a named check row.
Malformed inputs are the same category and should land the same way. Today the adversary chooses
whether your verifier returns a verdict or crashes.

It also silently breaks two callers that have no try/catch: `core/resolution.mjs :: resolve()` and
`core/bond.mjs :: settle()` — the reference bond model now throws instead of slashing a resolver
whose claim doesn't re-execute. That is the opposite of the intended behaviour.

**Fix direction.** Keep the parser strict, but make `verify` (and only `verify`) absorb the failure:
catch the parse error and return `ok: false` with a check row naming the field, in the same shape as
the unknown-claim_type path. `buildClaim` and `encodeRecords` should keep throwing — refusing to
*create* or *commit* malformed inputs is right; refusing to *report on* them is not. Add a test that
`verify` on each P0 value returns `ok: false` rather than throwing.

### R2 (P1) — the parser is optional, so the next claim-type reintroduces the bug class

`core/claim.mjs` calls `mod.canonicalInputs?.(inputs)` and `registerClaimType` still validates only
`{ type, reexec }`. Demonstrated:

```
$ registerClaimType({ type: 'ghost', reexec: (i) => ... (i.observed.q >>> 0) === 0 ... })
$ buildClaim({ type: 'ghost', inputs: { observed: { q: '0' } } })
registered with NO canonicalInputs -> built fine, flag = GREEN
```

That is the P0 reconstructed in six lines, on a surface added exactly the way `README.md` and
`CLAUDE.md` say surfaces are meant to be added: *"new surfaces are added by registering a module,
never by editing the engine."* The stated goal of 002 was to make this divergence **structurally
impossible**; as landed, it is impossible only for the two modules that happened to be fixed.

**Fix direction.** Make the parser part of the claim-type contract, not an optional extra:
`registerClaimType` requires `canonicalInputs` alongside `reexec`, and `buildClaim` calls it
unconditionally (drop the `?.`). Add a test that registering a module without it fails.

### R3 (P2) — the consensus encoder still hard-codes its surfaces

`core/encode.mjs` imports the two parsers by direct named import, and `CLAIM_TYPE_ID` /
`RECORD_SIZE` are hand-maintained tables. So the *consensus* path is not registry-dispatched even
though the verdict path is: adding a third surface means editing the encoder, which is where drift
enters. This is a design point rather than a defect in your diff — noted here so it is on the record
and can be folded into a later task. Fixing R2 by putting `canonicalInputs` in the registry is the
first half of it; do that part, and leave the rest.

### R4 (P2) — the fixture has no multi-chunk vector

Every CMLS vector is 1–3 records, so the fixture never crosses `CHUNK_RECORDS = 200` and the hash
chain's chunk-boundary behaviour is not covered by anything that runs in `cargo test`. It is covered
only by `client/bond-live.mjs`, which needs a validator and is not part of `test:canonical`. One
vector of 201 records would close it.

## Not blocking

- `classifyUpdateTimes`'s `NO_DATA` branch and `cmls::verdict`'s `count == 0 → UNKNOWN` branch are
  now unreachable through the supported path (empty observations are rejected at build, and
  `open_market` rejects `n_records == 0`). Leave them as defence in depth; no action.
- `assert_eq!(vectors, 159)` hard-codes the fixture size. That is a feature — it makes silently
  dropping coverage fail — not something to relax.

## Required to merge

- [ ] R1 — `verify()` returns `ok: false` for malformed inputs; `buildClaim`/`encodeRecords` keep throwing. Tested.
- [ ] R2 — `canonicalInputs` is required by `registerClaimType` and called unconditionally by `buildClaim`. Tested.
- [ ] R4 — one multi-chunk CMLS vector in the fixture.
- [ ] `npm run test:canonical` and `node demo.mjs` still green; corpus `inputs_hash` still `2f224c44f93a8e2c…`.

R3 is not required to merge.

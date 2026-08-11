# 015 — close the input domain of every claim-type, starting with the one that settles money

**Frame:** thick — implementation, JS↔Rust parity, and a type that moves lamports. **CC writes this
brief; Codex implements; CC reviews.**
**Branch:** `cc/closed-input-domains`
**Base:** `main` @ `69372b4`

## The measurement, before any argument

Run against the committed corpus claim on `main`, each case resealing `claim_id` so the content hash
agrees with the tampered body:

```
corpus type: closed-market-liquidation-soundness   baseline verify.ok: true
  ACCEPTED  inputs.trusted.chain = 'ethereum-mainnet'
  ACCEPTED  unknown root key
  ACCEPTED  inputs.observed.count = 999
  ACCEPTED  unknown observed key
  ACCEPTED  unknown window key
```

Five of five. `closed-market-liquidation-soundness` is **the only claim-type wired to the bond
program** — it owns the corpus, the parity vectors and the Rust re-execution twin. `AGENTS.md` says a
bug in `onchain/` is not a regression but a theft; this is the input boundary of that surface.

## What task 011 settled, and what it deliberately left

Task 011 (`F7`, `F9`) established two halves of one defect and closed one of them everywhere:

- **Output half — closed for all five types.** `core/verify.mjs` now binds the complete `computation`,
  the complete `verdict` and the registered `invariant` canonically. Measured after that change: all
  ten CMLS computation fields that had been forgeable were refused.
- **Input half — closed for exactly one type.** `monday-open-gap` rejects unrecognised keys at every
  semantic object. `closed-market-liquidation-soundness`, `reserve-solvency`, `obligated-liveness`
  and `restaking-robustness` do not.

The lesson that produced it, in the words the repo settled on: **removing a field from the builder
does not remove it from the input domain, and a content hash is consistent with whatever the body
says.** A test asserting the builder omits a field proves something about the builder.

## Scope

**In:** the input domain of all five registered claim-types, and whatever `core/` change makes that
mechanical rather than five hand-written key lists.

**Out:** new claim-types; the on-chain program's own instruction validation; `residual`-class questions
from other tasks. If closing a domain surfaces a *behavioural* bug rather than a schema hole, record it
and raise it separately rather than widening this task.

## Design, as far as a brief should go

Codex's own note on the previous round is the constraint: *what can be shared is the mechanical
closed-object helper; the schema itself each claim-type must state explicitly.* So:

1. **One helper, generic.** `monday-open-gap` carries a local `closed(name, v, allowed)`. Lift it into
   `core/` — it is claim-type-agnostic in the same sense `verify`'s whole-output binding is, and the
   alternative is five copies that drift. `core/*.mjs` must stay zero-dependency.
2. **Five explicit schemas.** Every type declares its own allowed keys at every semantic object —
   root, `trusted`, `terms`/`window`, `observed`, and each record shape. No inherited defaults, no
   "same as the last one". The key list is the type's contract with a reader.
3. **Regressions that sweep rather than enumerate.** 011's pattern: build a valid claim, add one
   unparsed key, reseal `claim_id`, assert self-consistency *before* asserting rejection, and iterate
   over the object's own keys so a field added later is covered without editing the test.

## The three questions this task exists to answer

**Q1 — does the Rust twin have to change?** `onchain/programs/vrdct-bond/src/reexec/` consumes the
binary canonical encoding produced from `canonicalInputs`' typed output, so an unknown JSON key should
never reach it. If that holds, closing the JS domain is not a consensus change. If it does not hold,
this is a JS↔Rust split and the more important half of the task. **State which, with the path traced,
before writing the schemas.**

**Q2 — does the corpus `inputs_hash` move?** It must not: `2f224c44f93a8e2c…` is published, and
`CLAUDE.md` calls a change to it a consensus break rather than a test failure. Closing a domain
rejects more without emitting differently, so the expectation is that it does not move. Verify rather
than assume, and if it does move, stop and say why.

**Q3 — `observed.count` cannot merely be closed.** CMLS *emits* it:

```js
observed: { source: 'getSignaturesForAddress', account: subject.priceAccount,
            count: observations.length, observations }
```
`claimtypes/closed-market-soundness.mjs:83`

So it is inside the allowed set by construction, and admitting it as a key still leaves a field that
can disagree with its own array — exactly the `999` case above. Deleting it would move the corpus
hash, so it must be **validated against `observations.length`** rather than merely permitted. Sweep
every type for fields of this shape: emitted, allowed, and unchecked.

## Acceptance criteria

- The five-case measurement above returns `refused` on all five, and the equivalent measurement on
  each of the other four types is recorded in the review with its commands.
- Every claim-type's input domain is closed at every semantic object, with the key lists visible in
  the module rather than derived.
- `observed.count`, and any other emitted-but-unvalidated field found by the sweep, is validated or
  removed — with the corpus hash consequence stated either way.
- `npm run test:canonical` green; parity vectors and definition vectors unmoved; corpus `inputs_hash`
  unmoved.
- Q1 answered in the review with the traced path, not with an expectation.

## Decisive negatives

Under the standing rule, this task expects **none**. Its claims are positive: a key is rejected, a
field is validated, a hash did not move — each demonstrable by running something. If a decisive
negative does appear (*"no other emitted-but-unvalidated field exists"* is the likely candidate), it
carries an evidence ID and CC owns the matrix row, since Codex is the author here and the roles swap.

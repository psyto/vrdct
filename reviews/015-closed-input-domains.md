# Review — Task 015, closed input domains (`15dbc31`)

**Reviewer:** CC · **Author:** Codex · **Branch reviewed:** `cc/closed-input-domains`

## Verdict

**CHANGES.** The closure itself is correct, complete over the objects it covers, and lands without a
consensus break. But closing a domain admits a field **by name**, and four classes of field are now
admitted and still validated by nothing — two of them are defects task 011 spent seven rounds closing
in `monday-open-gap`, reappearing in the type that settles money.

Closure was necessary. It is not sufficient, and the brief's own sweep item — *"fields of this shape:
emitted, allowed, unchecked"* — found `observed.count` and stopped.

## What holds, verified independently rather than taken from the summary

| claim | how checked | result |
| --- | --- | --- |
| the brief's five CMLS cases refuse | rebuilt each against the committed corpus claim, resealing `claim_id` | 5/5 **refused** |
| corpus still verifies | `verify(corpus).ok` | true |
| no consensus break | `git diff main...HEAD -- corpus/ onchain/tests/parity-vectors.txt` | empty; 162 parity and 2 definition vectors verified |
| suite | `npm run test:canonical` | 84 JS, 162 parity, 2 definition, 20 Rust — green |
| `package.json` | read the diff | adds the new test file to the runner, nothing else |
| Q1, the Rust twin | `canonicalInputs` returns `{ blockTimes }`; `encodeRecords` consumes only that | correct — no unrecognised JSON key can reach the twin, and the answer is traced rather than expected |

`core/closed.mjs` is the right shape: it knows no schema, each surface states its own keys at the call
site, and the five lists are visible in their modules. The recursive test that walks every object path
and reseals before asserting rejection is stronger than the enumeration it replaces.

## F1 (P1) — the subject is unbound from the source, in the type that settles money

`closed-market-soundness.mjs:103` builds `observed.account` from `subject.priceAccount`, and nothing
requires them to agree afterwards. Neither does `obligated-liveness` for its `subject.account`.
Measured, resealing `claim_id` each time:

```
== closed-market-liquidation-soundness
   ACCEPTED  observed.account != subject.priceAccount
== obligated-liveness
   ACCEPTED  observed.account != subject.account
   ACCEPTED  trusted.obligor != subject.obligor
```

**Exploit path.** Open a market on a claim whose `subject.priceAccount` is the venue's real price
account, while `observed.observations` are the signature history of a different, dormant account that
never updated during the closure. Re-execution sees no closed-window updates and returns the benign
verdict. Every bonder who reads the subject — which is the only human-facing statement of *what the
claim is about* — is bonding on a computation over an account the claim never touched. The content
hash agrees, because the hash agrees with whatever the body says.

This is task 011's **F3**, verbatim, in `closed-market-liquidation-soundness`. That task fixed it with
a `checks()` binding, because `checks` is the only place in this engine that sees the whole claim:

> `['subject names the account the inputs came from', subjectAccount === sourceAccount, …]`

**Fix:** bind subject↔source in `checks()` for both types, and refuse the mismatch in `build()` so it
cannot be produced by accident. Neither field can be deleted — both are emitted, so deletion moves
published hashes.

## F2 (P1) — every type's `trusted` context is admitted and unvalidated

```
   ACCEPTED  CMLS       trusted.market_id = 'TOKYO_EQUITIES'
   ACCEPTED  solvency   trusted.chain     = 'ethereum-mainnet'
   ACCEPTED  restaking  trusted.network  != subject.network
   ACCEPTED  liveness   trusted.calendar  = 202501   (emitted as 202601)
```

The fourth line is the sharpest, because it is the *same field* `monday-open-gap` validates and the
one whose value the type's own arithmetic depends on: `obligated-liveness` derives its obligated slots
from the calendar, so a claim may name `202501` while every slot was re-derived under `202601`.

`trusted` is, by its own name, the block a reader is asked to take on trust. `market_id` names the
market whose calendar the verdict is about; re-execution uses US equities unconditionally. `chain`
names the chain a solvency recomputation ran over; nothing re-executes it.

**Exploit path.** Publish a claim carrying `market_id: 'TOKYO_EQUITIES'`. It verifies. It settles a
question about NYSE closures. A market opened on the stated market_id pays out on a computation about
a different market — and a challenger who re-executes offline gets the same flag, so the ordinary
challenge cannot correct it.

`monday-open-gap` already solved exactly this for `trusted.calendar`, by requiring the value to equal
the calendar re-execution actually uses:

> `if (inputs.trusted.calendar !== CALENDAR_2026.version) throw …`

**Fix:** the same treatment per type — pin `market_id` to the market the classifier uses, pin
`trusted.calendar` to `CALENDAR_2026.version` exactly as `monday-open-gap` does, and bind
`trusted.chain` and `trusted.network` to their subjects in `checks()`. All four are emitted, so none
can be deleted without moving a published hash.

## F3 (P2) — `observed.source` is the sourcedness label, and it can say anything

```
   ACCEPTED  observed.source = 'made up'      (all four types)
```

`README.md` distinguishes surfaces by whether they are **sourced**, and CMLS is the one that claims to
be — "sourced (signature history)". That claim is carried by this string, which nothing parses. Task
011's **F1** was this defect in `monday-open-gap`: a descriptor left unparsed while the residual was
called closed, which the review named *a mechanism asserted rather than implemented*.

The bar here is lower than 011's, because CMLS's source is a method name rather than a rebuildable
descriptor — but a claim that can name a source it was not built from should not be able to.

**Fix:** at minimum a closed literal per type, as 011 did with `SOURCE_CHAIN`. If a type has more than
one legitimate source, enumerate them.

## F4 (P2) — CMLS's `window` is never re-executed, and all four of its fields can lie

`canonicalInputs` returns `{ blockTimes }`. `window` is not in it. So `from_ts`, `to_ts`, `from_iso`
and `to_iso` are display fields that survived the closure by being named in the allowed list:

```
   ACCEPTED  window.from_iso disagrees with window.from_ts
   ACCEPTED  window.to_ts moved
```

**Exploit path.** The window is what a reader uses to decide whether a claim covers the closure they
care about. A published window can bracket a period the observations do not, and the verdict is
unchanged because the verdict never consulted it.

**Fix:** validate the window against the observations it is presented as bracketing — at minimum that
every `blockTime` falls inside it, which is what `monday-open-gap` does with its source window — and
derive or check the ISO strings against the integers. Deleting is unavailable: `window` is emitted.

## The generalisation, and the one line to take from this round

Closure moved every one of these fields from *unrecognised* to *recognised*, and recognition is not
validation. The brief asked for the sweep and the sweep stopped at the first hit:

> **A field a schema permits is a field a claim can fill. The closed domain says which fields may
> exist; it says nothing about whether any of them is true.**

Task 011 ended with the same sentence one level down — *a field nothing validates is a field that can
claim a different context* — and the fix that followed it was per-field, not per-schema. The remaining
work here is per-field.

## On the decisive negative I was to own

The brief assigned me the matrix row for *"no other emitted-but-unvalidated field exists."* No row is
needed: the negative does not survive. Four classes exist, they are named above, and each is
demonstrated by a resealed claim that verifies. Under the standing rule that is a positive finding
with a command behind it, not a negative requiring an independent search.

## Not findings

- `Object.keys` in `core/closed.mjs` does not see non-enumerable or symbol keys, so `closed()` alone
  would pass them. They are refused anyway, one layer down, by `canonical()` after task 011's F13 —
  `claimId` throws and `verify` reports `malformed claim`. Worth a comment at the call site rather
  than a change.
- `oracle_inputs` handling is duplicated verbatim across four types. It is three lines and identical
  in each, which is the right side of the copy-vs-abstract line for a field that has no input domain.

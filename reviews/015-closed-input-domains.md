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


---

# Re-review — `2af60b8`

**CHANGES.** All fourteen attacks from the first review now refuse, and the fixes are the right shape.
One new **P1 regression** was introduced, on the live path, and it was invisible to the suite for the
same reason the first round's miss was.

## F1–F4: closed, measured

```
F1 subject<->source     refused  CMLS observed.account != subject
                        refused  liveness observed.account != subject
                        refused  liveness trusted.obligor != subject
F2 trusted context      refused  CMLS market_id=TOKYO_EQUITIES
                        refused  solvency trusted.chain=ethereum-mainnet
                        refused  liveness calendar=202501
                        refused  restaking network mismatch
F3 source               refused  CMLS / solvency / liveness  source='made up'
                        refused  restaking source.kind='made up'
F4 window               refused  CMLS from_iso lies
                        refused  CMLS to_ts before its first observation
```

Corpus verifies, `corpus/` and the parity fixture are untouched, 87 JS / 162 parity / 2 definition /
20 Rust green. The pinned literals match every real producer I could find — the corpus carries
`source: 'getSignaturesForAddress'` and `trusted.market_id: 'US_EQUITIES_REGULAR'`, and the Jito
adapter's `kind: 'JITO_RESTAKING_OBSERVATION'` is in `SOURCE_KIND`.

## F5 (P1) — the ISO check rejects every claim the CLI and the keeper build

`closed-market-soundness.mjs:39-43` requires the window's ISO strings to equal
`new Date(ts * 1000).toISOString()` exactly. Both live producers strip the milliseconds:

```js
const iso = (ts) => new Date(Number(ts) * 1000).toISOString().replace('.000', '');
```
`cli/vrdct.mjs:35` and `keeper/lib.mjs:37`, fed straight into `cmls.build` at `cli/vrdct.mjs:83-84`
and `keeper/lib.mjs:138`.

```
cli produces : 2026-08-01T12:10:59Z
required     : 2026-08-01T12:10:59.000Z
```

**Failure path.** Every CMLS claim built by `vrdct check`, `vrdct crank` or the keeper's re-crank loop
now throws in `canonicalInputs` before it can be verified or bonded. That is the whole live path of
the only type wired to the bond program.

**Why nothing caught it.** `npm run test:canonical` does not run the keeper — `test:keeper` is a
separate script — and never exercises the CLI. The committed corpus claim happens to carry
`.000`, so the fixture agrees with the check while the producer does not.

**Fix, and I would not take the obvious one.** Making the producers stop stripping `.000` works and is
one line each, but it leaves a rule that bans a *legal spelling of the right instant* while claiming to
catch a *wrong instant*. Compare instants instead: require `Date.parse(window.from_iso) === from_ts *
1000`, and likewise `to_iso`. That refuses the lie F4 was about and accepts any valid ISO-8601 rendering
of the same moment, which is what "exactly represents" should mean.

## The pattern this round, worth more than the finding

Three times in one task a fixture agreed with a check while a real producer did not:

1. `15dbc31` closed solvency's window to `[]`. `demo.mjs:17` builds `window: { epoch: 1004 }`, so the
   repo's own demo was rejected. **Codex's test and my review both used `window: {}`** — the same
   non-adversarial fixture, so neither of us saw it. Codex found and fixed it independently.
2. The corpus carries `.000`; the CLI and keeper do not. F5.
3. Both of the above were green under `test:canonical` the whole time.

The repo already knows this sentence — *if the cost fixture is not adversarial you are measuring the
fixture, not the boundary* — and it has now cost three findings in one task. The structural point is
narrower and actionable: **`test:canonical` does not execute any real producer.** `demo.mjs`, the CLI
and the keeper all build claims and none of them runs in the gate that is supposed to protect the
claim-types. A check that constrains a producer should be exercised by that producer.

**Suggested follow-up, not part of this task:** add `node demo.mjs` to `test:canonical`, and give the
CLI and keeper a claim-construction smoke test. Both are cheap and both would have caught F5 and the
`window: []` regression at the moment they were written.

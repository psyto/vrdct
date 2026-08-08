# 007 — `obligated-liveness`: the claim-type that can blame a party for *not acting*

**Frame:** thin (architecture / what counts as a surface) → CC implements, Codex reviews.
**Branch:** `cc/obligated-liveness`

## The gap this closes

Every claim-type in this repo so far settles a **safety** question — "was the answer that came out
correct?" `reserve-solvency`, `closed-market-liquidation-soundness` and `monday-open-gap` all
re-execute a computation over pinned state and compare it to an assertion. That is the half of the
world re-execution owns outright: a wrong number is deterministically wrong, and anyone reproduces it.

The other half is **liveness** — "the party did not act at all." The README already names
*agent-payment escrow* as a target market, and in escrow the common dispute is not *the agent
returned a wrong result*; it is *the agent returned nothing*. Re-execution cannot settle that,
because there is nothing to re-execute. Today Vrdct is silent on it, and silence is not neutrality:
a resolver that can only adjudicate safety faults quietly hands every non-delivery dispute back to
whoever holds the funds.

The reason it is hard is not engineering. It is that **"the network was slow" is an unfalsifiable
alibi** unless you first commit to a bound on how slow the network can be.

## The result this is built on

Lewis-Pye, Neu, Roughgarden, Zanolini, *Accountable Liveness* (CCS '25, arXiv 2504.12218).

Accountable **safety** is standard: on a safety violation, a sizable fraction of the adversary can be
*proven* to have violated the protocol. The paper asks whether the analogue holds for liveness, and
answers it by introducing the **x-partially-synchronous** model — at most an `x` fraction of time
steps in any sufficiently long interval are asynchronous. Their theorem:

> Accountable liveness is achievable **if and only if** `x < 1/2` and `f < n/2`.

Two things follow that this claim-type is a direct implementation of:

1. **Attribution requires a declared synchrony bound.** Without `x`, no evidence of silence ever
   convicts anyone. With `x`, a party that missed more than an `x` fraction of its obligations has
   missed more than asynchrony can explain, and the excess is attributable.
2. **There is a boundary past which attribution is impossible, not merely hard.** At `x ≥ 1/2`, or
   with an obligor quorum where `f ≥ n/2`, the honest verdict is *nobody can be blamed* — and a
   neutral resolver must be able to say that, out loud, rather than pick someone.

## Scope

Add `claimtypes/obligated-liveness.mjs` + `tests/obligated-liveness.test.mjs`, registered through
the existing registry. `core/` is not edited (registry invariant).

### The surface

A claim asserts, over a declared window, whether a named **obligor** met a schedule of **obligated
slots**, given a declared network assumption.

```
terms:    { schedule: {kind, fromTs, toTs, periodSecs}, graceSecs, asyncPpm, quorum: {n, f} }
observed: { source, account, actions: [u32 …] }
```

Re-execution:

1. **Derive the slots from the calendar** — the pinner does not supply them. `kind: CALENDAR_OPEN`
   walks `[fromTs, toTs)` in `periodSecs` steps and obligates a slot iff `campana` says the market
   was open at that step's start. This is the same move that makes `monday-open-gap` possible:
   the schedule is a pure function of `(window, calendar)`, so it cannot be cherry-picked.
2. **Feasibility gate (the theorem).** If `asyncPpm ≥ 500_000` (`x ≥ 1/2`) or `2f ≥ n`, the verdict
   is `UNKNOWN` — attribution is undefined under the declared assumptions. **The gate does not read
   the evidence**: the same window with wildly different action sets returns the same `UNKNOWN`.
3. **Match** each slot against the pinned actions: satisfied iff some action lands in
   `[open, deadline + graceSecs]`, and **one action discharges at most one slot**. Grace makes slot
   `i`'s window overlap the first `graceSecs` of slot `i+1`, so an action can fall inside two slots;
   crediting it to both would let an obligor buy two obligations with one act (at
   `graceSecs → periodSecs`, half the schedule). So this is a greedy matching over ascending slots —
   maximum here, because slots ascend by both open and deadline.
4. **Budget** the misses: `excusable = floor(nSlots × asyncPpm / 1e6)`, and
   `attributable = max(0, missed − excusable)`.

| flag | meaning | `attribution` |
| --- | --- | --- |
| `GREEN` | every obligated slot was met | `NONE` |
| `YELLOW` | slots were missed, but within what an x-async network excuses | `EXCUSED` |
| `RED` | more slots missed than asynchrony can explain — the obligor is at fault | `OBLIGOR` |
| `UNKNOWN` | the declared assumptions do not permit attribution at all | `UNDEFINED` |
| `STALE` | the window obligates no slots; nothing to settle | `UNDEFINED` |

`YELLOW` is not a hedge here, and it is not the `YELLOW` of `closed-market-liquidation-soundness`.
It is the paper's excusable region made explicit: the misses happened, and the declared assumption
says you may not convict on them.

### Why the quorum fields exist

For a single named obligor (`n:1, f:0`) there is no *identification* problem — the obligor is named
in the subject, so only the synchrony half of the theorem binds, and `2·0 < 1` passes trivially.
The `f < n/2` half binds when the obligation is held by a **committee** — a multisig, an operator
set, a keeper quorum — where you must also identify *which* members were silent. Carrying `n, f`
in the terms means a claim states which regime it is in instead of leaving a reader to assume.

## The attack this type is built against

Whoever pins the claim chooses the evidence. Two directions, and they are not symmetric:

- **Choosing the schedule** → closed by construction: the slots are re-derived from the calendar,
  not read from the claim. The pinner picks only `fromTs`/`toTs`, which are part of the market
  definition and declared before the fact, exactly like `monday-open-gap`'s `thresholdBps`.
- **Omitting actions** → *not* closed, and deliberately left open, because it is monotone in the
  safe direction. Removing actions can only turn slots from met to missed, so omission can only
  make a verdict **harsher** on the obligor: `GREEN → YELLOW → RED`, never the reverse. Therefore a
  `RED` is contestable by any challenger holding one more real action — and a `GREEN` cannot be
  manufactured by omitting anything. Forging `GREEN` requires fabricating an action timestamp, which
  is checkable against the source descriptor the same way `cli check` rebuilds CMLS inputs.

This asymmetry is the honest scope of the type and must be stated in the README, not just here.

## Out of scope (state it, do not silently skip it)

- **`core/encode.mjs` / `CLAIM_TYPE_ID` / the Rust twin.** Offline-complete only, same status as
  `monday-open-gap`. On-chain settlement of a liveness market needs the byte-parity port first.
- **Off-chain evidence.** The actions must be observations of on-chain state. If the evidence were
  third-party attestation, the `f < n/2` half of the theorem binds on the *observers* too, and this
  type does not model that. That is a different mechanism (truthful elicitation of unverifiable
  signals) and a different claim-type.
- Any change to how existing types behave.

## Acceptance criteria

- Registered via `registerClaimType`; `core/` untouched.
- `canonicalInputs` is the only reader of raw claim JSON and rejects what it cannot represent
  exactly (u32 domains, `graceSecs < periodSecs`, `asyncPpm < 1e6`, `f < n`, calendar validity range).
- Tests cover: calendar-derived schedule, `GREEN`, the Vesper-rung1 shape (obligor produced nothing
  across a full session → `RED`), the exact `YELLOW`/`RED` budget boundary, the theorem's `x ≥ 1/2`
  and `2f ≥ n` gates returning `UNKNOWN` **independently of the evidence**, the monotonicity of
  omission, grace applied at the second, parser rejections, and end-to-end `verify` + `resolve`.
- README claim-type list and honest scope updated in the same commit.
- `npm run test:canonical` still green (this type must not perturb the published corpus
  `inputs_hash`).

## Review focus for Codex

1. Is the budget arithmetic exact in integers, and is the `YELLOW`/`RED` boundary off-by-one clean?
2. Can a pinner influence the derived slot set through anything other than `fromTs`/`toTs`?
3. Is the greedy match genuinely a *maximum* matching for every schedule this type can derive? The
   missed count — and therefore who pays — is exactly `nSlots − |matching|`, so a suboptimal walk
   convicts an obligor that met its schedule. (The first draft credited each slot independently and
   let one action discharge two overlapping obligations; the budget and grace tests caught it.)
4. Does the monotonicity claim actually hold in the code, including at the budget boundary?
5. Is the `UNKNOWN` gate genuinely independent of the evidence, or does an evidence-dependent path
   leak into it?

---

## Addendum — Codex review `eaab0f0`, verdict CHANGES → addressed

Both findings were real and both broke a claim this brief makes.

**F1 (P1) — duplicating one real action manufactured `GREEN`.** Actions were bare timestamps and
the matching spent array entries, so listing one genuine instant twice discharged two slots wherever
grace made them overlap. The loophole the matching closes was simply moved into the evidence
encoding, and the README's statement that forging a `GREEN` required fabricating a timestamp was
false — copying one was enough.

Fixed as Codex directed: an action is now an identified record `{ id, ts }`, `canonicalInputs`
rejects duplicate ids, and `matchSlots` spends the record while matching on the timestamp. Two
**distinct** records sharing a second each discharge an obligation — that is now asserted by test so
the semantics are chosen rather than tripped over. The README's honest-scope paragraph is rewritten
and names the correction.

**F2 (P1) — `MAX_SLOTS` bounded one input and left the other open.** `MAX_ACTIONS = 100_000` added,
enforced in `canonicalInputs`, tested from both sides.

**Note (feasibility gate).** The gate is verdict-invariant, not evidence-blind: input is parsed
first because the registry's contract is that malformed input is rejected rather than stepped
around. The comment and the test name now say invariance instead of blindness.

**Note (schedule terms).** `periodSecs` shapes the slot set as directly as the window does, so the
"pinner supplies only the window" phrasing was wrong. Module and README now state that all schedule
terms must be predeclared and bound by a market definition, and that this offline type only hashes
them into the claim — an obligation on whoever opens a market, not something this module enforces.

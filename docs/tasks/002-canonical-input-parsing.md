# Task 002 — Kill the P0: one canonical input parser, shared by both re-executors

**Assignee:** Codex (frame-thick)
**Reviewer:** CC
**Branch:** `codex/002-canonical-input-parsing`
**Origin:** [`reviews/001-onchain-bond-adversarial-audit.md`](../../reviews/001-onchain-bond-adversarial-audit.md) — P0, plus the empty-claim P2.

---

## CC triage of audit 001

Verdict accepted: **CHANGES**. The audit is good work — it found a real, reproducible payout
divergence, and its "checked and sound" section holds up on spot-check (`Market::SPACE`: payload is
313 bytes + 8 discriminator = 321 ≤ 384; `Fold::SPACE` = 65 matches its fields).

CC independently reproduced the P0 before accepting it:

```
staleRecords   JS verdict   encoded u32
0              GREEN        0
"0"            STALE        0     ← divergence
0.5            STALE        0     ← divergence
4294967296     STALE        0     ← divergence
NaN            STALE        0     ← divergence
-1             STALE        4294967295   (consistent by luck)
```

Triage of the seven findings:

| # | Finding | CC verdict | Lands in |
|---|---|---|---|
| P0 | `staleRecords` coercion splits JS/Rust verdicts | **Confirmed. Accepted.** | **002 (this task)** |
| P2 | Empty CMLS claim has an offline verdict but no on-chain representation | **Confirmed. Accepted.** — same root cause: the claim schema is unenforced | **002 (this task)** |
| P1 | Caller-chosen (negative) challenge window | Confirmed | 003 |
| P1 | Permissionless `reset_feed` denies settlement | Confirmed — this is the surface CC flagged as least-considered, and it was right to | 003 |
| P1 | PDA squatting on a caller-chosen `market_id` | Confirmed | 003 |
| P2 | Market rent stranded after every terminal path | Confirmed | 003 |
| P2 | Resolver chooses the "treasury" | Confirmed, and the README's wording is false as implemented | 003 |

Two findings the audit did not file, added by CC on triage — see
[`003-program-hardening.md`](./003-program-hardening.md) for both:

- **P0 (CC):** a `CHALLENGED` market whose digest can never close is **locked forever** with both
  bonds inside. There is no exit from `CHALLENGED` except `settle`.
- **P2 (CC):** `calendar_version` is pinned but its *validity range* is not, so a market can be
  opened over timestamps the pinned calendar does not describe. Both implementations then agree on
  a meaningless answer — parity holds, correctness does not.

---

## Goal

Make it structurally impossible for `core/encode.mjs` and a JS claim-type to read the same claim
JSON and disagree about what it says.

The P0 is not really about `staleRecords`. It is about **two independent readers of the same
untyped JSON**: the claim-type's `reexec` reads `q.staleRecords` with `=== 0`, the encoder reads it
with `>>> 0`, and nothing forces those to mean the same thing. Fix the class, not the instance.

## Design (CC decision — implement this shape)

Each claim-type module gains a **canonical input parser**, and it becomes the only place raw claim
JSON is interpreted:

```js
// in claimtypes/<surface>.mjs
export function canonicalInputs(inputs) -> { ...exactly-typed values }   // or THROWS
```

- `reexec(inputs)` computes its verdict **from `canonicalInputs(inputs)`**, never from the raw JSON.
- `core/encode.mjs :: encodeRecords(claim)` serialises **from `canonicalInputs(claim.inputs)`**,
  never from the raw JSON.
- The parser **rejects** anything it cannot represent exactly. It does not coerce. A malformed claim
  must fail loudly at build/verify/encode time rather than mean two different things.

Rules to enforce (non-exhaustive; derive the rest from what the Rust side can represent):

- `reserve-solvency`
  - `staleRecords` — must be a `number`, `Number.isSafeInteger`, `0 <= v <= 0xffffffff`.
    Strings, floats, `NaN`, negatives, and values above `u32::MAX` are **rejected**, not coerced.
  - `virtualValue` / `liability` — decimal string or safe integer `number`; parsed by one explicit
    rule; must fit `u128`. (Today `u128le` already throws on overflow via `BigInt` — keep that, but
    make the accepted *input shapes* explicit rather than "whatever `BigInt()` happens to take".)
  - `inv2b_ok` — strict tri-state `true` / `false` / absent. Anything else is rejected.
    (Current behaviour happens to agree across JS and Rust; make it agree *by construction*.)
- `closed-market-liquidation-soundness`
  - each `observations[i].blockTime` — `number`, `Number.isSafeInteger`, `0 <= v <= 0xffffffff`.
  - **observations must be non-empty** — this closes the audit's empty-claim P2. A claim with no
    observations is not a claim; `UNKNOWN`-from-no-data is a verdict about nothing and has no
    on-chain representation. Reject it at build time.

Where a rule tightens what the engine previously accepted, say so in the module's header comment —
the README standing rule applies: a change in what is trusted or accepted must be visible.

## Scope

**Touch**

- `claimtypes/solvency.mjs`, `claimtypes/closed-market-soundness.mjs` — add `canonicalInputs`, route
  `reexec` through it.
- `core/encode.mjs` — route `encodeRecords` through it; delete the local coercions (`>>> 0`, the
  inline `u128le` input assumptions) in favour of the parser's output.
- `core/claim.mjs` — only if `buildClaim` needs to invoke the parser so malformed claims cannot be
  built. Prefer that: reject at construction.
- `demo.mjs`, `resolve-live.mjs` — only if the stricter schema breaks them. If it does, that is a
  finding worth noting, not a reason to loosen the schema.
- Tests: a **differential regression suite** that is committed, not temporary.

**Do not touch**

- `onchain/programs/vrdct-bond/src/**` — no Rust logic changes in this task. The Rust side is
  already the strict one; JS is what drifts. (Adding Rust *tests* is fine.)
- `corpus/**` — fixtures. If the stricter schema rejects the committed corpus claim, **stop and say
  so in the PR description**; that is a much bigger finding than the P0 and CC needs to see it.
- Anything in 003's list.

## Tests required

Committed, not `/private/tmp`:

1. **JS-side schema regressions** — every value in the P0 table above, plus `2**53`, `"1e3"`,
   `true`, `null`, `[]` for `staleRecords`; non-integer / negative / `> u32::MAX` / missing
   `blockTime`; empty observation list. Each must throw, with a message that names the field.
2. **JS↔Rust differential harness, committed and runnable.** Your temporary harness found the P0 and
   then vanished; that is the wrong place for it. Land it as a repeatable check — a Rust test that
   consumes fixture vectors generated by the JS encoder is the simplest shape that cannot rot
   silently. Cover at minimum what audit 001 reported executing: DST transitions, session
   open/close minutes, half-days, holidays, weekends, `u32` boundaries, duplicate and
   equal-adjacent timestamps, the `u128` boundary matrix, and all three `inv2b` encodings.
3. `cargo test -p vrdct-bond` still green (17 existing tests plus whatever you add).
4. `node demo.mjs` and the existing corpus claim still verify.

## Acceptance criteria

- [ ] No code path reads a raw claim-JSON field for encoding or re-execution outside
      `canonicalInputs`.
- [ ] Every value in the P0 table either throws or produces the *same* verdict on both sides —
      demonstrated by a committed test, not by narrative.
- [ ] The empty-observation case is rejected at build time and the rejection is tested.
- [ ] The differential harness is committed and runs from a documented command.
- [ ] `CLAUDE.md`'s "byte-for-byte twins" invariant is still true, and the header comment of
      `core/encode.mjs` reflects that the parser — not the encoder — is now the consensus boundary.
- [ ] No file under `onchain/programs/vrdct-bond/src/` changes behaviour.

## Out of scope

Everything in 003. Do not start the program rework here; this task must be mergeable on its own.

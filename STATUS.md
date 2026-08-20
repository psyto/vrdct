# STATUS — Vrdct / CMLS

**Phase:** Kill Gate ([`docs/GATE.md`](./docs/GATE.md)) · **Scope:** CMLS only
**Updated:** 2026-08-20 · **Ref:** `claude/020-cmls-harness` over `cae200d`

## Verdict

> ## V3 — state rebuild: `KILLED`
>
> A third party following this project's published command cannot rebuild the reference claim.
> `node reconstruct.mjs corpus/jupiter-spyx-cmls.claim.json` → **exit 1, 515 of 3,789 observations
> missing**, on a 19-day-old window against a public endpoint.
>
> Decision record, with the numbers and the reasoning:
> [`docs/decisions/2026-08-20-V3-state-rebuild.md`](./docs/decisions/2026-08-20-V3-state-rebuild.md).
> **The run has stopped.** The founder decides what happens next.

## The gate, item by item

All runs 2026-08-20 against `https://api.mainnet-beta.solana.com`, on a window **19 days old**.
Full evidence and commands: [`docs/cmls/GATE-EVIDENCE.md`](./docs/cmls/GATE-EVIDENCE.md).

| # | item | verdict | the number |
| --- | --- | --- | --- |
| V1 | price reconstruction | **PROVEN — and narrower than the product's name** | the inputs actually used rebuilt 3,789/3,789. Prices among them: **0**. The predicate reads update *times* only, so it never establishes that anything was liquidated at a wrong price. |
| V2 | time window | **PROVEN for reconstruction, NOT derivable** | bounds are integers bound into the definition hash, so a stranger cannot be handed different ones; but `from_ts`/`to_ts` equal the first/last observation exactly, and the calendar-derived `tradingWindow` gives a **different** window. |
| V3 | state rebuild | **`KILLED`** | shipped command: **exit 1, 515 missing**. An instrumented 21-page walk: **3,789/3,789**, `inputs_hash` byte-identical to the published `2f224c44f93a8e2c…`. The wall is `core/rpc.mjs:19`'s 20-page cap — not retention, not rate limiting. |
| V4 | same verdict | **PROVEN**, conditional on a complete rebuild | recomputed from the rebuild alone: `RED`, 683 open / 3,106 closed / max gap 242 s — matching the published verdict exactly. |

**V1, V2 and V4 were run in the same pass as V3.** `/gate` asks for one item per run; V3 is the item
that decides, and the other three are reported because the same rebuild answers them and withholding
them would misrepresent what was measured.

## The defect behind the KILL

`core/rpc.mjs:19` walks at most **20 pages** and returns silently when the budget runs out. This
window needs **21**.

It is **not** RPC retention — the walk reached 11.5 hours *older* than the window's start — and not
rate limiting, which 900 ms spacing removed entirely.

**It decays on its own.** The budget is a fixed page count while the signature distance from *now* to
the window grows daily, so completeness is a function of how long ago the window was. Every CMLS
claim crosses the line eventually, with no error and no flag, and both honest parties truncate
identically — so two rebuilders agreeing is not evidence that either is complete.

**`README.md:464-466` is false as written today.** It claims the shipped command lands on the
identical set and hash. The correction is deliberately **not** in this commit: it is a change to the
honest-scope contract and should follow an independent recomputation, not precede it.

## What the KILL does not say

The data *is* reachable. A stranger with a public RPC rebuilt a 19-day-old CMLS input set completely
and landed on the published commitment and verdict. The wall is this project's fetcher, not the chain
and not the endpoint. Per `docs/GATE.md` that is recorded as a measurement and **not** converted into
a rescue — *"it would work if we also had X" is a KILL, not a new scope.*

## Standing prohibitions in force

- No real funds, no mainnet deploy, no force push, no secrets.
- No devnet run against a wallet anyone cares about until the unrecoverable-funds defect
  (`reviews/main-2026-08-12-devnet-debt.md` F1, threat-model **T-12**, measured `2.50859` SOL stranded
  per run) is closed.
- One Codex role at a time. `docs/cmls/LEDGER.md` carries the lock; it currently reads `review`.
- The run stops at the verdict. It has stopped.

## Committed on this branch

| file | what it is |
| --- | --- |
| `STATUS.md` | this |
| `docs/decisions/2026-08-20-V3-state-rebuild.md` | the V3 verdict, its numbers, and what would have changed it |
| `docs/cmls/GATE-EVIDENCE.md` | V1–V4, run, with commands and raw output |
| `docs/cmls/THREAT-MODEL.md` | 15 rows, each with a `file:line` and the direction the error runs; includes three inherited "current defects" found already fixed at HEAD |
| `docs/cmls/HARNESS.md` | the CMLS-only operating harness, subordinate to the gate |
| `docs/cmls/LEDGER.md` | defect ranking, carried risks, and the Codex role lock |
| `docs/cmls/HANDOFF-CODEX.md` | the paste-ready relay blocks — §1 prepared, not sent |
| `docs/tasks/020-cmls-product-boundary.md` | the product spec — **frozen pre-gate**, not active work |
| `.claude/agents/*.md` | five role prompts for two agents, non-concurrent by construction |

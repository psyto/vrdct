# CMLS ledger

State of record for the CMLS harness. Binding phase document: [`docs/GATE.md`](../GATE.md).
Rules: [`HARNESS.md`](./HARNESS.md). Threats: [`THREAT-MODEL.md`](./THREAT-MODEL.md).
Verdict: [`../../STATUS.md`](../../STATUS.md).

## Role lock — read this before rendering any Codex handoff

```
codex_role: review
```

`docs/GATE.md` permits **one** Codex role at a time: implementation **or** independent review, never
both, and no model reviews its own output. `cmls-codex-review-handoff` and `cmls-codex-impl-handoff`
each read this line and refuse when it names the other role. It is a mechanism rather than a rule
because this repo has already recorded what a rule alone is worth.

Current value `review`, set 2026-08-20: Claude produced the gate evidence *and* adjudicated it, so
the only legitimate next Codex round is to recompute it. The relay block is prepared
([`HANDOFF-CODEX.md`](./HANDOFF-CODEX.md) §1) and **not sent** — the run stops at the verdict and the
founder decides.

## Gate items

| item | verdict | evidence |
| --- | --- | --- |
| V1 price reconstruction | PROVEN, and narrower than the product's name (0 prices read) | [`GATE-EVIDENCE.md`](./GATE-EVIDENCE.md) §V1 |
| V2 time window | PROVEN for reconstruction; NOT derivable | §V2 |
| V3 state rebuild | **`KILLED`** — the shipped command returns exit 1 with 515 of 3,789 missing. An instrumented 21-page walk returns 3,789/3,789 and the identical published hash, so the data is reachable and the wall is ours. | §V3 |
| V4 same verdict | PROVEN (`RED`, 683/3,106, 242 s) | §V4 |
| **overall** | **`KILLED` on V3** | [`../decisions/2026-08-20-V3-state-rebuild.md`](../decisions/2026-08-20-V3-state-rebuild.md) |

## Open defects, ranked

| id | defect | severity | owner | state |
| --- | --- | --- | --- | --- |
| T-3 | `core/rpc.mjs:19` caps the walk at 20 pages and returns silently; this window needs 21. Completeness decays with elapsed time, with no error. | **this is the KILL** | Codex | open — no implementation round opened; the verdict is the founder's to act on |
| — | `README.md:464-466` asserts the shipped command reconstructs the corpus claim. It returns exit 1 today. | published overclaim | CC | open — deliberately not corrected before the recomputation |
| T-1 | the on-chain CMLS source descriptor binds no cluster; `SOURCE_RPC` supplies it out of band | high | Codex | open |
| T-11 | nothing binds the challenge window to signature retention | high | CC then Codex | open |
| T-12 | `bond-live.mjs` strands `2.50859` SOL per run; `close_market` returns rent to an ephemeral key | **blocks any real-value run** | Codex | open (`reviews/main-2026-08-12-devnet-debt.md` F1) |
| T-7 | the fold requires non-decreasing `blockTime`; nothing proves chain history supplies it | medium | Codex | open, untested |
| T-2 | omission is exculpatory for CMLS, unlike `obligated-liveness` | by design | — | carried; the rebuild is the only defence, which is why T-3 matters |

## Carried risks — named, not queued

| id | risk | why carried |
| --- | --- | --- |
| T-4 | `RED` is sufficient, not necessary | wording, owned by `docs/tasks/020` |
| T-5 | `GREEN` is unreachable | decided in 020: the market is defined on `RED` vs not-`RED` |
| T-6 | the opener chooses the window | mitigated by `keeper/window.mjs`, not enforced on-chain; V2's adverse note |
| T-8 | same-slot ordering is argued harmless, not tested | low |
| T-9 | expiry race and the cranker cut | upstream, already in README §Honest scope 3 |
| T-10 | every reachable subject prints `RED` | product problem before an engineering one |
| T-13 | a public endpoint rate-limits the checker | measured: survivable at 900 ms spacing, fatal at 120 ms |
| T-14 | the calendar is governed and expires in 2027 | fail-closed direction |

## Frozen, pre-gate

| # | task | state |
| --- | --- | --- |
| 020 | [CMLS product boundary and economic model](../tasks/020-cmls-product-boundary.md) | **frozen.** Written before `docs/GATE.md` landed. Not active work, not sent for review, retained because its §0 finding (a CMLS market cannot be opened before its records exist, so it is a falsification bounty rather than risk transfer) is a fact about the program, not a plan. |

No further tasks were opened. The gate forbids scope beyond its own evidence, and three briefs
sketched for 021–023 were **not written** for that reason; their content is in the defect table above,
where it can be acted on without being a plan.

## Gate command

| command | last run | result |
| --- | --- | --- |
| `npm run test:canonical` | 2026-08-20, `2ab7a93` | pass, exit 0 — 82 JS · 162 parity · 2 definition · 2212 calendar vectors · 21 Rust (5 BPF ignored) · 12 Foundry |
| `node reconstruct.mjs corpus/jupiter-spyx-cmls.claim.json` | 2026-08-20T09:05Z | **fail, exit 1** — 515 missing |
| instrumented 21-page walk (scratchpad, not committed) | 2026-08-20T09:07Z | 3,789/3,789, `inputs_hash` equal |

## Change log

| date | change |
| --- | --- |
| 2026-08-20 | Codex relay automated as **transport only**: `tools/relay-codex.sh` + `/relay` send a prepared block to `codex exec` in a detached worktree, refusing against this file's `codex_role` lock, against `DO NOT SEND`, and against an unpushed branch. It never commits, never writes the lock, and never adjudicates the reply. Four documents that claimed nothing here could run Codex were corrected in the same commit. |
| 2026-08-20 | Harness created, CMLS-scoped. Gate evidence V1–V4 run. **V3 = `KILLED`.** Three inherited "current defects" from `005 §4b/§4c` found already fixed at HEAD and recorded as standing corrections. |

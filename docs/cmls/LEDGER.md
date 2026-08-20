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

Current value `review`, set 2026-08-21 (third round): H3's design gate is Claude's and
[`../GATE-H3.md`](../GATE-H3.md) §E requires independent review before it can pass. Relay block
[`HANDOFF-CODEX.md`](./HANDOFF-CODEX.md) §4.

§1 (H1 evidence) and §3 (H2 gate design) are closed and stay closed. §2 was never sent. §1 was sent via
`tools/relay-codex.sh 1` and Codex returned an independent recomputation
([`../../reviews/020-cmls-gate-evidence.md`](../../reviews/020-cmls-gate-evidence.md)) that dissented
on three of four gate items. No role is active. §2 remains held: opening an implementation round on a
killed surface is a decision no agent may take on its own initiative.

## Gate items

Labels below are **after** Codex's independent recomputation, which dissented on three of four.

| item | verdict | evidence |
| --- | --- | --- |
| V1 price reconstruction | **FAIL** — the reconstructed price-input set is empty; 0 prices read | [`GATE-EVIDENCE.md`](./GATE-EVIDENCE.md) §V1, [review](../../reviews/020-cmls-gate-evidence.md) F1 |
| V2 time window | **FAIL** — reading a stored descriptor is not a re-derivation, and the one derivation supplied lands elsewhere | §V2, review F2 |
| V3 state rebuild | **PASS as capability** — 3,789/3,789 and the identical published hash, reached twice independently. The shipped command exits 1 on a 20-page cap but fails closed on the commitment. | §V3, review F3 |
| V4 same verdict | PASS (`RED`, 683/3,106, 242 s), conditional on V3 | §V4 |
| **the product** | **`KILLED`** — `open_market` pins the input commitment before money moves, so the answer precedes the market | [`../decisions/2026-08-20-cmls-product.md`](../decisions/2026-08-20-cmls-product.md) |

## Open defects, ranked

| id | defect | severity | owner | state |
| --- | --- | --- | --- | --- |
| **020 §0** | `open_market` pins `inputs_hash` and `n_records` before money moves, so the window is past at open and the answer is computable by both sides before bonding. Probability 0 or 1, not a price. | **this is the KILL** | — | not a defect to fix; a fact about the instrument |
| T-3 | `core/rpc.mjs:19` caps the walk at 20 pages and returns silently; this window needs 21. | availability + diagnostics; **demoted** — `reconstruct.mjs:55-75` fails closed on the commitment | Codex | open, unfixed. Not the kill. |
| — | `README.md` §Honest scope asserted the shipped command reconstructs the corpus claim, and that retention was the bound. Both false. | published overclaim | CC | **CLOSED** — corrected once the independent recomputation returned |
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
| 2026-08-20 | **CMLS `KILLED` as a product.** Codex's independent recomputation re-attributed the gate: V1 and V2 FAIL, V3 PASS-as-capability, V4 PASS. The deciding constraint is 020 §0, not T-3. A founder challenge — *demand can be created* — was tested against each finding and does not reach 020 §0. README §Honest scope corrected. Role lock closed to `none`. |
| 2026-08-20 | Codex relay automated as **transport only**: `tools/relay-codex.sh` + `/relay` send a prepared block to `codex exec` in a detached worktree, refusing against this file's `codex_role` lock, against `DO NOT SEND`, and against an unpushed branch. It never commits, never writes the lock, and never adjudicates the reply. Four documents that claimed nothing here could run Codex were corrected in the same commit. |
| 2026-08-20 | Harness created, CMLS-scoped. Gate evidence V1–V4 run. **V3 = `KILLED`.** Three inherited "current defects" from `005 §4b/§4c` found already fixed at HEAD and recorded as standing corrections. |

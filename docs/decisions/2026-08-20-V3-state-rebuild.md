# Decision — gate item V3, state rebuild: `KILLED`

> ## ⚠ CORRECTED — this item's attribution did not survive independent review
>
> Codex recomputed this evidence independently ([`../../reviews/020-cmls-gate-evidence.md`](../../reviews/020-cmls-gate-evidence.md))
> and dissented on three of four items. **V3 is a PASS as a third-party reconstruction capability**;
> `reconstruct.mjs:55-75` compares the rebuilt commitment to the pinned one and exits 1 on mismatch,
> so it fails closed at the command boundary rather than reporting a partial set as a success. The
> items that actually fail are **V1 and V2**.
>
> One number below is also wrong. The reported retention margin of **11.48 h** before `from_ts` was
> independently measured at **6.60 h** — a discrepancy that favoured the project, in the direction
> [`../GATE.md`](../GATE.md) predicted. The boundary is still crossed; the conclusion is unchanged.
>
> The overall result stands, for different reasons:
> [`2026-08-20-cmls-product.md`](./2026-08-20-cmls-product.md).
>
> This document is left intact below. It is the record of what was measured and concluded on a first
> pass by one model working alone, and editing it silently would destroy the evidence that the
> cross-pass is what caught it.


**Gate:** [`docs/GATE.md`](../GATE.md) · **Item:** V3 — *can the settled state be rebuilt from public
data at the deciding moment?* · **Verdict source required:** *a rebuild, run.*
**Run by:** Claude (evidence role), 2026-08-20 · **Ref:** `claude/020-cmls-harness` over `cae200d`.
**Evidence:** [`../cmls/GATE-EVIDENCE.md`](../cmls/GATE-EVIDENCE.md).

## What would have KILLED this item, stated before the run

> A third party, following the project's own published instructions against a public endpoint,
> cannot rebuild the reference claim's pinned input set and land on the published `inputs_hash`.

## Verdict

## `KILLED`

## The numbers

| | |
| --- | --- |
| subject | `corpus/jupiter-spyx-cmls.claim.json` — Jupiter Lend SPYx, `A2GDb4Um4Tr42iKgPz5fQ2d7pYTnaUuHN3d5V41Cywff` |
| window | `2026-08-01T12:10:59Z → 2026-08-05T00:07:01Z` — **19 days old** at run time |
| pinned | 3,789 observations, published `inputs_hash` `2f224c44f93a8e2c…` |
| endpoint | `https://api.mainnet-beta.solana.com` |
| **the published command** | `node reconstruct.mjs corpus/jupiter-spyx-cmls.claim.json` → **exit 1**, `missing 515, extra 0`, rebuilt hash `c7cdcb15f185ccad…` |
| an instrumented 21-page walk | 3,789/3,789, rebuilt hash `2f224c44f93a8e2c2840c75c2a86872ce3b73336ffcec047654d8d0e2deffccd` — **identical** |
| verdict recomputed from that rebuild | `RED`, 683 open / 3,106 closed / max gap 242 s — matching the published verdict |
| cause | `core/rpc.mjs:19` walks at most **20** pages and returns silently when the budget runs out. This window needs **21**. |
| not the cause — retention | the walk reached `2026-08-01T00:42:00Z`, **11.5 h older than the window's start** |
| not the cause — rate limiting | **0 throttles** at 900 ms inter-page spacing; fatal at 120 ms |

## Why this is a KILL and not a GO

Two readings were available and the gate settles which one to take.

- **The reading that favours the project:** V3's stated verdict source is *"a rebuild, run"*. A
  rebuild was run and matched byte-for-byte, so the item's own criterion is met.
- **The reading that does not:** the gate says the verdict must come from *"them reaching it, not us
  describing it"*. A third party following `README.md:464-466` reaches **exit 1**. The only path that
  reaches the answer is one I wrote myself, after the shipped one failed.

`docs/GATE.md`: *"Flattering errors run one way. Every numeric error found in this portfolio so far
favoured the project that produced it."* When two readings are available, the instruction is to take
the one against the project. `/gate` also makes *a serious OPEN_RISK* a KILL in its own right, and
this is one:

> **The defect decays on its own, silently.** The budget is a fixed *page count*, while the number of
> signatures between *now* and the window grows every day. Completeness is therefore a function of how
> long ago the window was. Every CMLS claim crosses the line eventually — with no error, no flag —
> and **both honest parties truncate identically**, so two rebuilders agreeing is not evidence that
> either is complete. The corpus claim crossed it between publication and today, and nobody noticed
> until it was measured.

`README.md:464-466` — *"Measured, not asserted: `node reconstruct.mjs …` re-fetches the reference
claim from mainnet and lands on the identical 3,789-observation set and the identical `inputs_hash`"*
— **is false as written today.** It is the exact claim this gate item tests.

## What the KILL does *not* say

Recorded because omitting it would be its own flattering error, in the other direction:

**The data is reachable.** A stranger with a public RPC *can* rebuild a 19-day-old CMLS input set
completely and land on the published commitment and verdict. That is a measurement, not a hypothesis,
and it is the strongest sourcing evidence in this repo. The wall is this project's own fetcher, not
the chain and not the endpoint.

Per `docs/GATE.md` I do not convert that into a rescue: *"it would work if we also had X" is a KILL,
not a new scope.* What happens next is the founder's call, not this document's.

## What would have changed the verdict

Any one of:

1. the shipped `node reconstruct.mjs` returning exit 0 with the identical hash;
2. the shipped path **failing closed** — raising when its budget is exhausted before the window is
   covered — so that a third party gets a refusal instead of a wrong set, and the README's claim
   became "it reconstructs or it refuses";
3. `README.md:464-466` not asserting the thing the run falsified.

## Reproduce

```bash
node reconstruct.mjs corpus/jupiter-spyx-cmls.claim.json     # exit 1, missing 515
npm run test:canonical                                       # exit 0 — the suite does not cover this
```

The instrumented walk is deliberately **not committed**: committing it would make an experiment look
like a shipped fix. It differs from `core/rpc.mjs` in exactly two ways — page budget above 20, and
900 ms inter-page spacing instead of 120 ms.

## Not reviewed

No model reviews its own output. This verdict is Claude's evidence and Claude's adjudication; the
prepared recomputation request is [`../cmls/HANDOFF-CODEX.md`](../cmls/HANDOFF-CODEX.md) §1, and
sending it is the founder's call. A `KILLED` verdict does not require review to stand — only `GO`
does — so this run stops here rather than waiting.

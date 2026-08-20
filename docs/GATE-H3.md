# Design Gate — H3

> ## ⚠ DID NOT PASS — closed, not to be repaired
>
> Independent review 2026-08-21: [`../reviews/022-h3-design-gate.md`](../reviews/022-h3-design-gate.md).
> Its answer to this gate's own question — *can it kill H3?* — is **no**. Three P0s, the decisive one
> being that a timeout slashes an obligor who performed but was prevented from delivering evidence,
> identically to one who did nothing, while the buyer collects either way.
>
> The claim below that H2's A5 is *"dissolved by construction"* is **too strong**: the omission proof
> problem is removed, the delivery race is not.
>
> Vrdct is now a held asset: [`decisions/2026-08-21-vrdct-held.md`](./decisions/2026-08-21-vrdct-held.md).
> **Left intact rather than deleted** — it is the record of a design that looked clean and was not.


**Status:** OPEN, design only, unreviewed. **Opened:** 2026-08-21 by the founder.
**H2 does not resume.** H1 is `KILLED` ([`decisions/2026-08-20-cmls-product.md`](./decisions/2026-08-20-cmls-product.md)).
Rules inherited from [`GATE.md`](./GATE.md): not-proven is a KILL; adding a hypothesis to stay alive is
forbidden; no model reviews its own output; the run stops at the verdict.

**This gate passes on a design, not on evidence.** Buyer research, implementation and any on-chain
change are forbidden until it passes. One page, deliberately: H2's gate ran to 190 lines and died at
its own review before a single item ran.

## A. The shape H3 is restricted to — a design outside this is out of scope, not a finding

1. **Obligation, deadline, penalty and verification predicate are fixed before anyone participates.**
   No party may set or alter any of them after either side commits.
2. **Only performance is re-executed.** The obligor produces evidence that the obligation was
   discharged; re-execution verifies *that evidence*. Nothing else is re-executed.
3. **Non-performance resolves by timeout state transition, never by chain search.** Absence is the
   default. If valid evidence has not been fed by the deadline, the penalty pays out. Nobody has to
   prove a negative, and no walk over history is involved.

This shape is chosen because it answers the two P0s that stopped H2
([`../reviews/021-h2-gate-design.md`](../reviews/021-h2-gate-design.md)): omission was unsettleable
(F2) and fed records were not bound to the promised action (F1). **A5 is dissolved by construction
here — but F1 is not, and it becomes D3.**

## B. Show these three first, or KILL

| # | must be shown | KILL if |
| --- | --- | --- |
| **D1** | **Distinctive value.** What can this settle that an ordinary escrow, an SLA bond, an HTLC/hashlock, or a direct on-chain state read at the deadline cannot? | every obligation a named buyer would actually pay for is expressible as **(a)** a preimage/hashlock, **(b)** a state read at deadline, or **(c)** escrow with an arbiter both sides already trust. Then re-execution adds nothing and H3 is escrow with extra steps |
| **D2** | **The buyer.** A named role, a named counterparty type, and the reason trust and reputation are insufficient *for them specifically*. | the buyer cannot be named beyond a category, **or** their remedy is already available through a cheaper existing mechanism. A buyer nobody has asked is weak — that is why buyer research is the step *after* this gate, and why D2 is an argument to be attacked, not a survey to be believed |
| **D3** | **Action ↔ obligation binding.** How the fed evidence proves *this* obligation was discharged. | no scheme prevents **(i)** genuine but unrelated on-chain activity from satisfying the predicate, or **(ii)** the obligor pre-generating evidence before the obligation was fixed. This is H2's F1 and it is the most likely way H3 dies |

## C. Two structural self-checks on the design

| # | check | KILL if |
| --- | --- | --- |
| **D4** | Non-performance needs no history walk. | any path to the penalty requires searching the chain, enumerating absence, or a page-budgeted fetch. `core/rpc.mjs:19`'s silent truncation is why: it decays with elapsed time and it attacked the only defence H1 had |
| **D5** | Nothing is settable after commitment. | any of obligation, deadline, penalty or predicate can be proposed, negotiated or altered once either party has committed. This is H1's V2 failure and H2's A4 |

## D. Not authorised by this gate

No buyer research. No code — no claim-type, no adapter, no test, no tooling. No `CLAIM_TYPE_ID` or
Rust-twin port. No `open_market` change, no program change, no devnet, no mainnet, no funds. T-12
stands (`2.50859` SOL stranded per run). No second design, no generalisation, and **no reaching for
H2 or a fourth surface if H3 stalls** — that is the forbidden move and this line is the tripwire.

## E. Review and stop

The design is Claude's, so it requires independent review before it passes — H1's record is the
argument: both of Claude's wrong labels and its one numeric error ran towards the project, and the
cross-pass caught all three. Relay: `tools/relay-codex.sh`, lock `codex_role:` in
[`cmls/LEDGER.md`](./cmls/LEDGER.md).

Passing this gate authorises **one** thing: the buyer research D2 stands in for. It does not authorise
implementation, and it does not start a phase.

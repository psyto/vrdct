# Kill Gate — H2

**Status:** OPEN, no evidence. **Opened:** 2026-08-20 by the founder, after H1 was killed.
**Binding for H2 only.** H1's gate is [`GATE.md`](./GATE.md) and its verdict stands unedited:
[`decisions/2026-08-20-cmls-product.md`](./decisions/2026-08-20-cmls-product.md).

Every rule in [`GATE.md`](./GATE.md) carries over unchanged — a verdict is a number or a reproducible
experiment; not-proven is a KILL; adding a hypothesis to stay alive is forbidden; at most two agents
with one Codex role at a time; the run stops at the verdict. **This gate starts over from zero. H1's
PASSes are not credits.**

> ### The instance changed once, before any evidence ran
>
> H2's first fixed instance (2026-08-20, Claude) was an **indemnity**: the buyer was a borrower
> liquidated against a stale feed. The founder replaced it with the instance below the same day,
> **before a single verification step had been run.** Under this gate's own rule — *changing the
> design before the evidence is design; changing it after seeing a number is the failure the gate
> exists to prevent* — this is legitimate, and it is recorded here rather than quietly overwritten.
>
> It was the right call on three checkable points, recorded so the change is auditable and not a
> matter of taste. **(i)** The old instance's data — liquidation events joined to prices — is the half
> this repo has *never* sourced; the new instance runs on signature history, the exact shape H1 proved
> reconstructable byte-for-byte. **(ii)** The old instance had no natural counterparty; the new one has
> a structurally identified obligor. **(iii)** The old buyer was diffuse, retail and post-hoc; the new
> buyer signs terms in advance.
>
> **One thing the switch makes worse, stated up front:** an indemnity's payout tracks the buyer's
> actual loss, and a fixed remedy does not. See *What this is not*, below, which is a gate item.

---

## What H2 is

> **A buyer-defined, obligor-bonded, re-executable SLA.**

| | |
| --- | --- |
| **buyer** | an integrator, a DAO, or an operator placing funds — a party who depends on someone else's scheduled on-chain action and today has only trust and reputation as recourse |
| **obligor** | a keeper, an agent, an operator, a service provider — a party who performs that scheduled action |
| **the product** | the obligor posts a bond against an **explicit future liveness invariant** that the **buyer** fixed first |
| **on violation** | a **fixed remedy, agreed in advance**, is paid to the buyer |
| **what Vrdct supplies** | adjudication and bond enforcement that are **re-executable** — the deciding step is re-execution of public data, not a report from a party with an interest |

## What this is not — stated first, because stating it first is the stronger position

**This is not insurance.** It does not make the buyer whole. The remedy is a fixed sum agreed before
the fact, and a buyer whose loss exceeds it is not covered for the difference. Anyone selling it as
indemnity is selling something this gate did not test.

What it is instead: **an SLA that executes without trust.** Its value is that the commitment is
credible, bonded, and adjudicated by re-execution rather than by the obligor's own dashboard or by a
lawsuit in a jurisdiction the counterparty may not share.

That limit is **A8**, a gate item, not a disclaimer — because `README.md` §Honest scope is a contract
with readers and H1 died with a false sentence in it.

---

## What H1 bought, stated once so it is not re-litigated

| from H1 | carried into H2 as |
| --- | --- |
| **PROVEN.** Two independently written implementations rebuilt 3,789/3,789 observations from a public RPC and landed on a byte-identical `inputs_hash`. | evidence that re-execution from **public signature history** is real. H2's invariant lives on that same data shape — but it must be measured again for this shape (**A7**), because H1 measured one account's updates, not an obligor's actions against a schedule. |
| **KILLED.** `open_market` pins `inputs_hash`/`n_records` before money moves, so the answer precedes the market. | **A6.** H2 dies unless the outcome is undetermined when the buyer signs. |
| **FAIL (V1).** The predicate read zero prices while being named for liquidation soundness. | **A0.** The profile names exactly what is read, and the product may not be named for more. |
| **FAIL (V2).** The opener supplied the window. | **A4.** The *buyer* fixes the terms; the obligor bonds them afterwards and cannot influence them. |
| **T-2.** *"Omission is exculpatory for CMLS."* | **A5.** For an SLA, omission is the entire failure mode. If doing nothing cannot be adjudicated, there is no product. |
| **T-10.** Four subjects, all printing the same verdict. | **A1.** An obligor population with a zero miss rate has nothing to bond. |

**B6 is withdrawn.** H2's first draft made *"the only rational counterparty is the accused venue"* a
KILL. That was imported from H1's accusation frame, where someone bonds a claim **about a third
party**. Here the obligor bonds **its own future conduct**: that is a warranty, and the obligor being
the counterparty is the design rather than a defect. Recording the withdrawal because a kill condition
that quietly disappears is how a gate stops being a gate.

---

## Non-goals — out of scope until this gate returns `GO`

- **No code.** No claim-type edit, no adapter, no program change, no test, no tooling.
- **No `CLAIM_TYPE_ID` / Rust-twin port.** `claimtypes/obligated-liveness.mjs:60-62` records that the
  surface is offline-complete and **not** wired to `core/encode.mjs` or the on-chain twin. That port is
  the obvious next build and it is **not authorised by this gate.**
- **No on-chain market.** No `open_market` call, no devnet, no mainnet, no funds. T-12 stands:
  `2.50859` SOL stranded per run (`reviews/main-2026-08-12-devnet-debt.md` F1).
- **No general SLA protocol.** One profile (**A0**), and generalisation is not evidence.
- **No reviving CMLS**, no reaching for a third claim-type when this one runs into trouble. The
  instance changed once, at zero evidence, on the founder's proposal, and it is recorded above. **A
  second change after any A-item has run is the forbidden move**, and this line is the tripwire.
- No UI, no deploy, no force push, no secrets.

---

## The gate

Conjunctive — **any single item fails, H2 fails.** Run in the order given. A0 is written before
anything is measured; A4, A5 and A6 are answered by reading source and cost nothing external, so they
run before the buyer research they could make moot.

| # | item | verdict must come from | KILL if |
| --- | --- | --- | --- |
| **A0** | **One profile, fixed in writing first.** *A named Solana keeper executes a named instruction on a named program within a pre-defined slot, on a calendar-derived schedule.* Name the program, the instruction discriminator, the schedule source, and what "executed" means at the byte level. | the written profile, committed before A1 | the profile cannot be stated without a term that a participant supplies at settlement time, or without reading something the chain does not carry |
| **A1** | **The obligor population exists and its liveness is imperfect but bondable.** For each named keeper, the miss rate against its own calendar-derived slots over 12 months. | counts from public signature history, per obligor, per month | **every obligor's miss rate is 0** (nothing to bond — this is T-10 in a new place), **or** the median obligor's expected annual remedy exceeds its plausible annual revenue from the duty (no obligor rationally participates) |
| **A2** | **Buyers demand it.** Named integrators, DAOs or fund operators who will state, in writing, that they would require this bond as a condition of integration. | signed or quoted written statements, counted and attributable | **fewer than 5 named buyers**, or fewer than **2** who name a specific obligor they would require it of. A buyer who likes the idea but names no obligor is not a buyer |
| **A3** | **The bond band is non-empty.** Is there a remedy `R` that buyers call sufficient *and* obligors call acceptable? | the two stated ranges, per party, and their intersection | **the intersection is empty.** Too small and it is advertising rather than an SLA; too large and no obligor posts it. Both failures are the same KILL |
| **A4** | **The buyer fixes the predicate, before the bond.** The signed terms hash must pin **target program, period, calendar version, tolerated miss rate, and remedy** — and the obligor bonds an already-fixed hash. | the terms schema, and a trace showing the obligor cannot alter any pinned field | **the obligor can choose, propose, or negotiate any pinned field after seeing its own performance data.** This is H1's V2 failure in new clothes and it is the single most likely way H2 dies quietly |
| **A5** | **Omission is adjudicable, fail-closed.** If the calendar generates obligated slots and the obligor does *nothing*, does the system settle "missed"? | reading `matchSlots`, `open_market`, and `state::Market` end to end, and stating where an empty record set lands | **inaction is exculpatory.** `require!(n_records > 0, VrdctError::NoRecords)` says today that a market cannot even open with zero records — so a total outage, the worst breach, is currently the one case that cannot be settled. `n_records > 0` is not sufficient and A5 is not satisfied by it |
| **A6** | **The outcome is undetermined when the buyer signs.** Can a market be opened whose input set does not yet exist? | reading `open_market` and stating what a forward-window design must commit instead of `inputs_hash` | **no design keeps re-execution as the deciding mechanism** with a future window. If it requires a trusted party to report the future set, that is a KILL — it reintroduces the oracle Vrdct exists to remove |
| **A7** | **A third party reconstructs the verdict.** Rebuild one obligor's action history and its calendar-derived slots, twice, independently. | two independent rebuilds compared byte-for-byte | the two disagree, or the obligor's actions cannot be addressed at a slot. H1's method applies; H1's evidence does not transfer |
| **A8** | **The limit is published, not buried.** Does the deliverable state that this is not indemnity, in the place a buyer reads? | the text, in `README.md` §Honest scope | the deliverable describes it as cover, protection, or insurance, or omits that the remedy is fixed and may be less than the loss |

### The thresholds are the founder's to change — before the run, not after

`0 miss rate`, `5 buyers`, `2 naming an obligor`, `empty intersection` are Claude's proposal and are
the most arguable part of this document. Changing them **before A1 runs** is gate design. Changing them
**after seeing a number** is the failure `GATE.md` exists to prevent, and the record must show which
happened.

---

## Verification plan — reproducible, not yet run

**Nothing here has been run.** Written to the level where a third party can execute it.

### A0 — write the profile

One page, committed before A1. Names the program id, the instruction, the schedule's source and its
version, the grace period, and the byte-level definition of "executed" (a successful signature
carrying that discriminator, against that program, within `[slot_start, slot_start + grace]`). If any
term needs a value supplied at settlement, A0 fails and the rest does not run.

### A4, A5, A6 — read the source, answer in writing, no external data

Run **before** A1/A2 because each can kill H2 for free.

- **A5** is the sharpest and is answered by tracing one case end to end: an obligor with **zero**
  actions in a window that the calendar says obligated 30 slots. Follow it through
  `claimtypes/obligated-liveness.mjs::matchSlots` (which derives slots from terms and can represent
  absence), then through `open_market`'s `require!(n_records > 0)` (which cannot). State exactly where
  the case dies and what a fail-closed design would have to commit instead. Do **not** write that
  design — A5 asks whether one exists, not for one.
- **A6** asks the same question for a future window: what replaces `inputs_hash` at open, and does
  re-execution still decide.
- **A4** reads the terms schema and answers who can write each pinned field, and when.

### A1 — measure the obligors

1. Fix the obligor set in writing before querying: named Solana keepers with (a) a public, identifiable
   instruction, (b) a schedule derivable without asking them, (c) history over 12 months.
2. Walk each obligor's signature history and match actions to calendar-derived slots.
   **Page-budget discipline:** H1's kill defect was a fixed 20-page cap that truncated silently
   (`core/rpc.mjs:19`). This walk records pages consumed and the oldest timestamp reached, and
   **refuses rather than returns** on exhaustion.
3. Report miss rate per obligor per month, and the distribution of miss-run lengths.

**Output:** table plus raw event list, committed. **KILL check:** all-zero miss rates, or expected
annual remedy above plausible annual revenue.

### A2 / A3 — the two-sided demand test

Not chain-measurable, and that is stated rather than worked around. **H1 died from measuring the wrong
thing precisely; ease of measurement is not a reason to test the wrong instance.**

Approach each named buyer with the A0 profile and a specific obligor, and record verbatim: would they
require this bond, of whom, and at what remedy is it sufficient. Then approach obligors with the same
profile and record the remedy at which they would post. **Both ranges are recorded before the
intersection is computed**, so the band cannot be fitted after the fact. Every statement is attributed
and quotable, or it does not count.

### A7 — rebuild it twice

Two independently written implementations, different authors, neither importing the other's code nor
`core/rpc.mjs`, rebuild one obligor's action set and slot derivation and compare commitments.

---

## Roles

Unchanged from `GATE.md`. Claude: spec, evidence, task progression. Codex: implementation **or**
independent review, one at a time, never reviewing its own output. Lock: `codex_role:` in
[`cmls/LEDGER.md`](./cmls/LEDGER.md).

**This gate's design is Claude's and therefore requires independent review before any A-item runs.**
H1's record is the argument: both of Claude's wrong labels and its one numeric error ran towards the
project, and the cross-pass caught all three.

## On reaching the gate: stop

`GO` ends H2. It does not authorise the `CLAIM_TYPE_ID` port, an on-chain market, or a second profile.
The founder picks what happens next.

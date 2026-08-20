# STATUS — Vrdct

**Phase:** Kill Gate · **H1** ([`docs/GATE.md`](./docs/GATE.md), CMLS) — `KILLED`, closed.
**H2** ([`docs/GATE-H2.md`](./docs/GATE-H2.md), obligor-bonded SLA) — **OPEN, no evidence.**
**Updated:** 2026-08-20 · **Ref:** `claude/020-cmls-harness` over `cae200d`

## Where this stands

**H1 is killed and its conclusion is not being rewritten.** Founder decision, 2026-08-20: keep the
KILL, and open H2 using H1's falsifications as *inputs* rather than as things to argue with.

**H2 — [`docs/GATE-H2.md`](./docs/GATE-H2.md) — is a buyer-defined, obligor-bonded, re-executable
SLA.** A buyer (integrator, DAO, funds operator) fixes an explicit future liveness invariant; an
obligor (keeper, agent, operator) posts a bond against it; on violation a fixed, pre-agreed remedy is
paid to the buyer; Vrdct makes the adjudication and the bond enforcement re-executable.

**It is not insurance**, and the gate says so as an item rather than a disclaimer (**A8**): the remedy
is fixed and a buyer whose loss exceeds it is not covered for the difference. What it is instead is an
SLA that executes without trust.

**No evidence has been run.** H2's current permitted state is spec only — hypothesis, non-goals, gate
A0–A8 with numeric kills, and a verification plan. No code, no `CLAIM_TYPE_ID` port, no on-chain
market.

**The instance changed once, at zero evidence.** H2's first draft fixed an *indemnity* (buyer = a
borrower liquidated against a stale feed). The founder replaced it the same day, before any
verification step ran. Recorded in `GATE-H2.md` rather than overwritten, with the three checkable
reasons it was the better instance and the one thing it makes worse. A second change after any A-item
runs is the forbidden move.

**The gate design was independently reviewed before any A-item ran** — the one moment when changing a
gate is legitimate. Codex returned `CHANGES`
([`reviews/021-h2-gate-design.md`](./reviews/021-h2-gate-design.md), design commit `67e6521`).

Its answer to the question it was asked — *can this gate kill H2?* — is **yes, and A5 already does on
the current source.** Its disposition: **do not begin buyer research or any other A-item evidence run.**
Two P0 findings and three P1s are recorded there, unadjudicated. **This is reported, not acted on**;
the run stopped at the review as instructed, and what it means for H2 is the founder's call.

**Two items can kill H2 by reading source, before any buyer research**, which is why they run first:

- **A5 — omission must be adjudicable.** For an SLA, doing nothing *is* the failure. `open_market`'s
  `require!(n_records > 0, VrdctError::NoRecords)` means a market cannot open with zero records — so a
  total outage, the worst breach, is currently the one case that cannot be settled. This is threat-model
  **T-2** (*"omission is exculpatory"*), which was survivable for CMLS and is fatal here.
- **A6 — the outcome must be undetermined when the buyer signs.** `open_market(… n_records: u32,
  inputs_hash: [u8; 32] …)` requires the input set to exist at open. That is H1's 020 §0 confirmed at
  the signature level.

## H1 verdict
## H1 verdict

> ## CMLS — the product: `KILLED`
>
> Not because the state cannot be rebuilt. It can: two independently written implementations reached
> **3,789/3,789** and the byte-identical published `inputs_hash` from a public RPC on a 19-day-old
> window. The kill is structural. `open_market` pins `inputs_hash` and `n_records` **before any money
> moves**, so the window is already past when the market opens and the answer is computable by both
> sides before bonding — probability **0 or 1, not a price**. On top of that the predicate reads
> **zero** prices, and the only supplied window derivation lands on different bounds.
>
> Decision record, with the numbers, the founder's demand challenge and why it does not reach:
> [`docs/decisions/2026-08-20-cmls-product.md`](./docs/decisions/2026-08-20-cmls-product.md).
> **The run has stopped.** What, if anything, earns a new gate is the founder's call.

## The gate, item by item — after independent recomputation

All runs 2026-08-20 against `https://api.mainnet-beta.solana.com`, on a window **19 days old**.
Claude's evidence: [`docs/cmls/GATE-EVIDENCE.md`](./docs/cmls/GATE-EVIDENCE.md). Codex's independent
recomputation, which **dissented on three of four items**:
[`reviews/020-cmls-gate-evidence.md`](./reviews/020-cmls-gate-evidence.md).

| # | item | verdict | the number |
| --- | --- | --- | --- |
| V1 | price reconstruction | **FAIL** | the reconstructed price-input set is **empty**. The predicate canonicalizes `blockTimes` only. An empty set shows CMLS makes no price claim; it cannot show price reconstruction. |
| V2 | time window | **FAIL** | the gate requires *a re-derivation that lands on the same window*. Descriptor `1785586259/1785888421`; `tradingWindow(to_ts)` `1785787200/1785873600`. Reading a stored descriptor is not a derivation. |
| V3 | state rebuild | **PASS as capability; shipped tool defective** | 3,789/3,789 and `2f224c44f93a8e2c…`, reached twice independently. The shipped command exits 1 — `core/rpc.mjs:19` caps the walk at 20 pages and this window needs 21 — but `reconstruct.mjs:55-75` compares commitments and **fails closed** rather than passing off a partial set. |
| V4 | same verdict | **PASS**, conditional on V3 | `RED`, 683 open / 3,106 closed / max gap 242 s — reached independently, matching. |
| — | **the product** | **`KILLED`** | `open_market` pins the input commitment before money moves, so the answer precedes the market. |

**Claude's first pass labelled V1 and V2 `PROVEN` and V3 `KILLED`.** Both wrong labels ran towards the
project, as did the one numeric error found: reported retention margin **11.48 h**, independently
measured **6.60 h**. `docs/GATE.md` predicted the direction and the prediction held. The cross-pass is
what caught it; a single model working alone did not.

## The defect, demoted

`core/rpc.mjs:19` walks at most **20 pages** and returns silently when the budget runs out; this
window needs **21**. It is a real availability and diagnostics defect — the helper should say it
exhausted its budget rather than hand back a short set — but it is **not** what kills CMLS, and the
first pass said it was.

Two claims made around it were also too strong, and Codex narrowed both **in the project's favour**:

- *"every CMLS claim crosses the line eventually"* needs a premise the first pass did not state — that
  the account keeps emitting signatures. An account that goes quiet has a finite signature distance and
  need not cross a fixed cap.
- *"two rebuilders agreeing is not evidence of completeness"* is false once a commitment is pinned.
  Agreement between two truncated *verdicts* proves nothing, but agreement between a rebuilt
  `inputs_hash` and the pinned one is evidence of completeness. That is exactly why `reconstruct.mjs`
  rejects the 20-page set instead of accepting it.

Retention was never the bound. The first pass reported the walk reaching **11.48 h** before the
window's start; independently measured, **6.60 h**. The boundary is crossed either way — but the
error ran towards the project.

`README.md` §Honest scope asserted that the shipped command reconstructs the reference claim. **That
is corrected in this commit**, together with its claim that RPC retention was the bound. It was held
back until the independent recomputation returned, and the recomputation has returned.

## What the KILL does not say

**The engine is not implicated, and today it got stronger.** Two implementations written independently
— Codex used neither `core/rpc.mjs` nor the author's scratchpad, and wrote its own hash — reached a
byte-identical commitment from a public RPC on a 19-day-old window, and the same verdict. *Re-execution
decides the payout* is now measured rather than asserted, and it is the strongest evidence in this
repo. `core/` is claim-type-agnostic by construction; what died is one registered surface.

Per `docs/GATE.md` that is recorded as a measurement and **not** converted into a rescue. It does not
authorise a successor claim-type. Which one, if any, earns a new gate is the founder's call, and under
the gate's own terms a new gate starts over from zero.

## Standing prohibitions in force

- No real funds, no mainnet deploy, no force push, no secrets.
- No devnet run against a wallet anyone cares about until the unrecoverable-funds defect
  (`reviews/main-2026-08-12-devnet-debt.md` F1, threat-model **T-12**, measured `2.50859` SOL stranded
  per run) is closed. **Unchanged by this verdict, and still open.**
- One Codex role at a time. `docs/cmls/LEDGER.md` carries the lock; the review round closed with this
  commit, so it now reads `none` — no Codex role is active.
- The run stops at the verdict. It has stopped.

## Committed on this branch

| file | what it is |
| --- | --- |
| `STATUS.md` | this |
| `docs/decisions/2026-08-20-cmls-product.md` | **the verdict** — CMLS killed on market structure, with the founder's demand challenge and why it does not reach |
| `docs/decisions/2026-08-20-V3-state-rebuild.md` | the first-pass V3 verdict, left intact under a correction header — the record of what one model concluded alone |
| `reviews/020-cmls-gate-evidence.md` | Codex's independent recomputation, dissenting on three of four items |
| `docs/cmls/GATE-EVIDENCE.md` | V1–V4, run, with commands and raw output |
| `docs/cmls/THREAT-MODEL.md` | 15 rows, each with a `file:line` and the direction the error runs |
| `docs/cmls/HARNESS.md` | the CMLS-only operating harness, subordinate to the gate |
| `docs/cmls/LEDGER.md` | defect ranking, carried risks, and the Codex role lock |
| `docs/cmls/HANDOFF-CODEX.md` | the relay blocks — §1 sent, §2 held |
| `tools/relay-codex.sh`, `.claude/commands/relay.md` | the Codex relay: transport automated, decision not |
| `docs/tasks/020-cmls-product-boundary.md` | the product spec — **frozen pre-gate**; its §0 is the finding this verdict turns on |
| `.claude/agents/*.md` | five role prompts for two agents, non-concurrent by construction |
| `docs/GATE-H2.md` | **H2 — open, no evidence.** The buyer-defined, obligor-bonded, re-executable SLA: hypothesis, what it is *not*, non-goals, gate A0–A8 with numeric kills, and a verification plan that has not been run |

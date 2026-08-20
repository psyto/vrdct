# The CMLS harness — scope, roles, states, gates

> **Subordinate to the kill gate.** [`docs/GATE.md`](../GATE.md) is binding and overrides this file,
> any roadmap, and any task list. While the gate is open the only permitted work is evidence for it;
> §1's roles and §2's state machine describe how that evidence is produced and reviewed, not a
> licence to open scope. Where this file and `docs/GATE.md` disagree, the gate wins. Current verdict:
> [`STATUS.md`](../../STATUS.md).

**What this is.** A committed operating harness for building **one** product: a market on
*closed-market liquidation soundness* (CMLS). It narrows [`AGENTS.md`](../../AGENTS.md)'s two-agent
contract to a single claim-type, adds a task state machine with an explicit non-DONE outcome, and
makes the agent definitions that drive it executable — they live in
[`.claude/agents/`](../../.claude/agents/).

It is a **narrowing**, never a replacement. Where this file and `AGENTS.md` disagree, `AGENTS.md`
wins, and the disagreement is a defect in this file.

---

## 0. The product boundary, and what it forbids

**In scope.** *Unsound liquidation risk arising from price updates that continue while the venue's
underlying market is closed or halted*, expressed as a re-executable on-chain state condition,
priced by a fully-collateralized two-sided market.

**Out of scope for this phase, by decision and not by omission:**

- a general-purpose neutral resolver, or any framing of Vrdct as one, in a CMLS deliverable;
- general prediction markets;
- opening the claim-type registry to further surfaces;
- `reserve-solvency`, `monday-open-gap`, `obligated-liveness`, `restaking-robustness` — they exist in
  this repo and stay where they are. A CMLS deliverable may **cite** them as prior art; it may not
  depend on them, extend them, or present them as part of the product.

The engine underneath is claim-type-agnostic and stays that way. The *product* is one surface.

**Three questions every CMLS artifact answers, in the same document, or it is not shippable:**

1. **What is judged unsound** — the exact predicate, its inputs, and what it deliberately does *not*
   judge.
2. **Can a third party rebuild the inputs** — from what descriptor, against which cluster, over what
   window, by what method, and until when.
3. **Who bears the loss when the verdict is wrong** — named party, bounded amount, and the direction
   the error runs in.

An artifact that answers two of the three is `OPEN_RISK`, not `DONE`.

---

## 1. Roles and who may execute them

Each role is bound to an **executor**. The executor is not decoration: the cross-pass rule is
enforced against it.

| role | executor | agent definition |
| --- | --- | --- |
| gate evidence — run V1–V4, produce numbers | CC | `cmls-gate-evidence` |
| specification, product boundary, vocabulary | CC | `cmls-spec` |
| adversarial recomputation of a deciding number | **the agent that did not produce it** | `cmls-adversarial-recompute` |
| implementation (re-execution, program, PDA/state machine, tests) | **Codex, when and only when the impl role is active** | — (handoff) `cmls-codex-impl-handoff` |
| independent review | **Codex, when and only when the review role is active** | — (handoff) `cmls-codex-review-handoff` |

**Two agents, and one Codex role at a time.** `docs/GATE.md` allows Claude and Codex only, and Codex
is either implementing or reviewing — never both, never concurrently on one artifact. The five files
above are *prompts for those two agents*, not five additional agents; at most one runs at a time. The
lock is the `codex_role:` line in [`LEDGER.md`](./LEDGER.md), which both handoff agents read and
refuse against, because a rule with no mechanism has already failed in this repo.

**Codex is an external executor reached by a committed handoff, not a subagent.** Nothing in this
harness can run Codex. `cmls-codex-handoff` renders a copy-paste-ready request; the human relays it;
Codex's reply lands as a commit or a `reviews/NNN-slug.md` file. Until that artifact exists, the task
is `BLOCKED (codex)` — never `DONE`, and never quietly done by CC instead.

**The cross-pass rule, stated so a machine can check it.** Every task row in
[`LEDGER.md`](./LEDGER.md) carries `author` and `reviewer`. If they are equal, the row is invalid and
the gatekeeper refuses the transition. CC writing an implementation that Codex then reviews is
allowed; CC writing it and CC reviewing it is not, and neither is the mirror image.

---

## 2. The state machine

```
SPEC ──▶ SPEC_REVIEW ──▶ IMPL ──▶ IMPL_REVIEW ──▶ DONE
  │           │            │           │
  └───────────┴────────────┴───────────┴──▶ OPEN_RISK   (landed, with a named unproven obligation)
  └───────────┴────────────┴───────────┴──▶ BLOCKED     (cannot proceed; the blocker is named)
```

| state | means | leaves it when |
| --- | --- | --- |
| `SPEC` | a brief is being written | the brief holds acceptance criteria, out-of-scope, and a filled proof-obligation table |
| `SPEC_REVIEW` | the brief is with the other agent | `reviews/NNN-slug.md` exists, `author ≠ reviewer`, verdict recorded |
| `IMPL` | code is being written by the assigned executor | the change is committed **with** its gate command and that command's exit status |
| `IMPL_REVIEW` | the diff is with the other agent | review recorded, `implementer ≠ reviewer`, findings closed or carried |
| `DONE` | see §3 — it is not just "approved" | — (terminal) |
| `OPEN_RISK` | the work is real and landed; a proof obligation is **not** met and is named | the obligation is proven, or the work is withdrawn |
| `BLOCKED` | progress requires something this harness does not have | the named blocker is removed |

`OPEN_RISK` is a *success* state for honest work with a known hole. It is not a euphemism for
failure and it is not a queue. A row may sit in it indefinitely; what it may not do is be reported as
`DONE`.

---

## 3. DONE requires four proofs, not an approval

A task is `DONE` only when its review is APPROVE **and** every proof obligation below is `PROVEN`
or `N/A` with the reason written out. Any `UNPROVEN` forces `OPEN_RISK`; any missing row forces
`BLOCKED`.

| id | obligation | met when |
| --- | --- | --- |
| **PO-1** | **input completeness** | the pinned record set is provably the complete set the descriptor names, **or** the incompleteness is detectable by a third party before bonding, and the detection command is in the artifact |
| **PO-2** | **price / value decoding** | every number the verdict depends on is decoded from bytes by a specified decoder with a twin on both sides, **or** the predicate provably reads no price (CMLS today: it reads only update *times*) |
| **PO-3** | **state reconstruction** | a third party, given only the market account, reproduces the identical record set and `inputs_hash` — on the **cluster the market itself names**, not one supplied out of band |
| **PO-4** | **economic incentive** | no reachable payoff rewards a false input set, silence, or reordering; and the party who loses money on a wrong verdict is named with a bounded amount |

These are the harness's own gates, and they are deliberately harder than "tests pass". A green suite
proved nothing about PO-1 or PO-3 in this repo's history; that is why they are separate rows.

---

## 4. Verification tiers — say which one, always

| tier | what it means | may be shown as |
| --- | --- | --- |
| `V0` | offline fixture / unit / property test | "verified offline" |
| `V1` | local validator (`solana-test-validator`, BPF `ProgramTest`) | "verified on a local validator" |
| `V2` | devnet, deployed program, real transactions, valueless SOL | "settled on devnet" |
| `V3` | mainnet-derived fixture — real mainnet reads, no money at risk | "reproduced from mainnet data" |
| `V4` | mainnet, real value | **forbidden in this phase** |

Every number, screenshot, and sentence in a demo or pitch carries its tier. **A demo may not hide an
untested edge by not showing it**: the same deck that shows the settled path shows the refusal path,
and names what has never run above `V1`.

---

## 5. Vocabulary — the words this product may not use

CMLS is a **fully-collateralized, limited-loss risk market**. It is not insurance and must not be
described as insurance, in any language.

**Refused:** *insurance*, *insured*, *保険*; *guarantee*, *guaranteed*, *保証*; *protected against*,
*covered*, *makes you whole*, *compensation*, *indemnity*, *補償*.

**Required, wherever a payout is described:**

- the maximum loss of each side is the collateral it posted, and both sides are collateralized in
  full before the market is live;
- the payout is decided by **re-execution of a stated on-chain condition**, not by anyone's realised
  loss — so a holder who buys the RED side and is *not* liquidated still gets paid, and a holder who
  *is* liquidated by a mechanism outside the predicate gets nothing. That gap is **basis risk** and
  is named as such;
- a verdict about a venue is a statement about a **price account's update times**, not about the
  venue's intent, solvency, or legality.

`cmls-spec` owns this list. Any artifact touching a buyer, a payout, or a pitch passes
through it.

---

## 6. Binding gate — what every CMLS claim must bind

A claim that fails any row here **may not be described as settleable**, in a demo, a deck, or the
README.

| must bind | today | where |
| --- | --- | --- |
| input descriptor kind | ✅ `SOURCE_SOLANA_ACCOUNT_SIGNATURES`, enforced for CMLS | `onchain/…/lib.rs :: validate_source` |
| target account | ✅ non-default `Pubkey`, in the market definition hash | same |
| time window | ✅ `from_ts < to_ts` | same |
| reconstruction method | ✅ documented, single implementation | `core/rpc.mjs :: fetchObservations` |
| **target cluster** | ❌ **not bound** — the checker supplies it via `SOURCE_RPC` | `cli/vrdct.mjs:18` |

The last row is why no CMLS market may be presented as settleable-by-a-stranger until it closes. See
[`THREAT-MODEL.md`](./THREAT-MODEL.md) T-1. **No task has been opened for it** — the gate forbids
scope beyond its own evidence, so it is carried as a ranked defect in [`LEDGER.md`](./LEDGER.md).

---

## 7. Adversarial coverage — the required test axes

A CMLS implementation task is not reviewable until its tests cover all of these, or name the ones it
does not and why:

1. the honest path (a real record set settles to the verdict an offline `verify` produces);
2. **forged input** — a well-formed set that would flip the payout lands on a different chain head
   and cannot settle;
3. **omitted input** — a record set that is a strict subset of the truth, in both directions
   (see T-2: for CMLS, omission is *exculpatory*, unlike `obligated-liveness`);
4. **time-boundary** — records at `from_ts`, at `to_ts`, at a session bell, at a half-day close, and
   at the calendar's validity edges;
5. **same-slot ordering** — several signatures in one slot, in every permutation;
6. **challenge that never comes** — the optimistic path, and what it costs to be wrong there;
7. **expiry race** — a completed feed and `expire_challenged` contending after the deadline;
8. **authority overreach** — a passer-by attempting every instruction on someone else's market, feed,
   or rent.

---

## 8. Git rules for this harness

- Preserve existing work. Do not mix unrelated changes into a CMLS commit; `git add` by path, never
  `git add -A` (`AGENTS.md`, and it came within one commit of biting).
- One worktree holds one branch. The reviewer gets its own.
- A `DONE` task lands as **one atomic commit** carrying: the spec, the review record, the exact
  reproduce command, and that command's recorded result.
- **Push only after every gate for that task has passed, and only to a named remote and branch.**
  A branch that is mid-`SPEC_REVIEW` is not pushed by the harness; it is reported, with the command,
  for a human to run.
- **Never:** force push, a devnet operation that spends value from a wallet anyone cares about, a
  mainnet deployment, or a secret added to the repo.
- Task numbers are a shared resource across worktrees — read every `docs/tasks/` before claiming one.

---

## 9. Running it

```
state          agent                        produces
────────────── ──────────────────────────── ──────────────────────────────────────────
gate evidence  cmls-gate-evidence           docs/cmls/GATE-EVIDENCE.md + STATUS.md rows
specification  cmls-spec                    docs/tasks/NNN-*.md, board and pitch rules
recomputation  cmls-adversarial-recompute   a number, recomputed from its definition
review round   cmls-codex-review-handoff    a paste-ready relay block  (codex_role: review)
impl round     cmls-codex-impl-handoff      a paste-ready relay block  (codex_role: impl)
```

**On any gate verdict — `GO`, `KILLED` or `BLOCKED` — the run stops.** `STATUS.md` is updated, the
evidence is committed and pushed, and the founder decides what happens next. Auto-entering the next
phase is the failure `docs/GATE.md` exists to prevent.

The ledger of record is [`LEDGER.md`](./LEDGER.md). If the ledger and a commit message disagree, the
commit wins and the ledger is wrong — fix the ledger in the next commit and say so.

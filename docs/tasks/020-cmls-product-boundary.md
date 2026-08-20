# 020 — CMLS as a product: the instrument, the buyer, and the loss

**Frame:** thin — what the thing is, who is on each side, what it may not claim. **CC writes, Codex
reviews.**
**State:** **FROZEN, pre-gate.** Written on 2026-08-20 shortly before [`docs/GATE.md`](../GATE.md)
landed. It is **not active work and has not been sent for review**: while the kill gate is open the
only permitted work is evidence for it. Retained rather than deleted because §0 is a fact about the
program — measured from `open_market`, not a plan — and deleting it would mean re-deriving it later.
Nothing is implemented and nothing here asks for code.
**Harness:** [`docs/cmls/HARNESS.md`](../cmls/HARNESS.md) · **Threats:** [`docs/cmls/THREAT-MODEL.md`](../cmls/THREAT-MODEL.md) · **Ledger:** [`docs/cmls/LEDGER.md`](../cmls/LEDGER.md)
**Base:** `claude/020-cmls-harness` over `2ab7a93`. Every code citation was read at that commit.

> **Numbering.** 020 was free in every worktree checked on 2026-08-20
> (`/Users/hiroyusai/src/vrdct{,-012,-015,-016,-017,-018b-codex,-recorder}`). 021–023 were sketched
> and **not written**, because the gate forbids scope beyond its own evidence; what they would have
> contained is carried as ranked defects in [`../cmls/LEDGER.md`](../cmls/LEDGER.md).

---

## 0. The finding this brief is built on, stated first because it changes the product

**A CMLS market cannot be opened before its records exist.** `open_market` takes `inputs_hash` and
`n_records` as arguments and pins them before any money moves
(`onchain/programs/vrdct-bond/src/lib.rs`, `open_market`; README §On-chain). The input set is the
successful signatures on a price account over `[from_ts, to_ts]`. So the window must already be in
the past when the market opens.

Follow it through:

- the answer is a deterministic function of public chain state that has already happened;
- anyone with a working RPC can compute it **before** bonding — that is what `vrdct check` is for,
  and `reconstruct.mjs` demonstrates it against mainnet on the reference claim;
- therefore, to an informed participant, the probability is **0 or 1**, not a price.

**A market on an already-determined, publicly checkable fact is not risk transfer.** Calling it a
hedge would be the same overclaim this repo has retracted twice before. What it *is* — and this is a
real instrument, not a consolation prize:

> **CMLS is a bonded, re-executable assertion with a falsification bounty.** Someone stakes lamports
> on what re-execution returns for a named account over a named window. Anyone who believes it
> returns something else stakes at least as much and takes the pot by making the program re-execute.
> The payout rewards **being right and proving it on-chain**, not bearing risk.

Everything below designs *that*, and §6 names what would have to change for the risk-transfer
version to exist.

---

## 1. What is judged unsound — the product's one sentence

> Over window `W`, did price account `A` keep publishing while the US equities market was closed,
> closely enough spaced that the feed ran **live through the closure**?

Re-execution answers with one of three flags (`claimtypes/closed-market-soundness.mjs:56-58`,
`onchain/…/reexec/cmls.rs:52-60`):

| flag | signal | means |
| --- | --- | --- |
| `RED` | `LIVE_THROUGH_CLOSURE` — at least one closed-market update, and no gap ≥ 30 min anywhere in the window | the feed a venue liquidates against ran through the closure with no market-status guard |
| `YELLOW` | `FROZEN_THROUGH_CLOSURE` — zero closed-market updates | consistent with a market-hours guard; it is not proof of one |
| `UNKNOWN` | `SPARSE` — closed-market updates exist but some gap reaches 30 min | inconclusive |

**Two boundaries that must travel with every published verdict** (T-4, T-5):

1. **`RED` is sufficient, not necessary.** A venue that updates through a closure every 40 minutes is
   liquidating against a closed-market price and reads `UNKNOWN`. `UNKNOWN` is not exoneration, and
   `YELLOW` is evidence of silence, not of a guard.
2. **`GREEN` does not exist on this surface.** There is no verdict meaning "confirmed sound".
   Any market or board row configured `yesWhen: ["GREEN"]` is dead on arrival.

**The consequence for the question wording, and it is the central design decision of this brief:**

> The market's question is about **what re-execution returns**, never about what the venue *is*.

Written this way, `UNKNOWN` stops being a hole in the payout and the market stops being a character
judgement. It also survives T-4 honestly: the market never promised to detect every unsound venue.

**Verdict mapping.** `yes_when` is a bitmask over flags (`lib.rs :: yes_from`), so a market may map
any subset to YES. This product uses exactly one mapping, and any other is out of scope:

```
yesWhen = { RED }        YES  ⇔  re-execution returns RED
                         NO   ⇔  re-execution returns YELLOW or UNKNOWN
```

The NO side is *not-RED* — stated in those words on the board, never as "sound".

---

## 2. Who is on each side, and why they show up

| side | who | why |
| --- | --- | --- |
| **NO (not-RED)** — the assertion | the **venue itself**, or an integrator who has read the venue's guard | a bonded, publicly re-executable certification that its feed did not run through the closure. It is the only way in this system to be *paid* for having a guard, and it is the demand `005-subject-set.md` §4 could not find by searching for guarded feeds: the venue supplies the row instead of us hunting for it. |
| **YES (RED)** — the falsifier | a researcher, a competing venue, a holder who was liquidated, the keeper | takes the assertion's bond by re-executing on-chain. The bounty is the incentive to check, and checking is the entire defence against T-2 omission. |
| **feeder** | anyone | earns 10% of the loser's bond for completing the on-chain re-execution (`lib.rs :: cut_of`, `CUT_BPS`). Pays for the compute that decides the payout. |

**The odds are fixed and slightly against the taker, and it must be said plainly.** A challenger must
post **at least** the resolver's bond (`lib.rs`, `challenge`: `require!(bond >= m.resolver_bond)`),
and the winner receives `pot − cut_of(loser_bond)`. Risking `B` against an equal `B` wins `0.9 B`.
Break-even confidence is therefore **≈ 52.6%**, not 50%, and a challenger who over-posts makes its own
odds worse. This is fine for a falsification bounty — the falsifier re-executes first and bonds at
confidence ≈ 1 — and it is another reason the instrument is not priced risk.

---

## 3. The loss scenarios, each with a named payer and a bounded amount

Maximum loss on either side is **the collateral that side posted**. Both sides are collateralized in
full, in the Market PDA, before the market is live; there is no margin, no leverage, no rehypothecation,
and no obligation that can grow after the bond is posted.

| # | scenario | who pays | how much | mitigation, and where it is open |
| --- | --- | --- | --- | --- |
| L1 | the pinned set omits records, so the verdict is wrong in the venue's favour (**T-2**) | the side that bonded without rebuilding | its bond | `vrdct check` rebuilds from the descriptor and refuses. **Open:** T-3's silent truncation makes *both* honest parties omit identically. |
| L2 | the two sides rebuild against different clusters (**T-1**) | whichever honest party read the chain the market did not mean | its bond | **Open — nothing binds a cluster** (T-1). This is why no market may be advertised as stranger-checkable yet. |
| L3 | the resolver is right, but no feed completes before `settle_by`, and `expire_challenged` fires (**T-9**) | the truthful resolver | the whole pot — a 100% slash | README §Honest scope 3, open upstream. CMLS makes it heavier: the reference claim needs **19 feed transactions**. |
| L4 | the record set cannot be folded because two timestamps decrease (**T-7**) | the truthful resolver, via L3 | the whole pot | unproven assumption; it needs a fixture (T-7). |
| L5 | a false assertion nobody challenges settles optimistically (README §Honest scope 2) | nobody on-chain — **the named venue pays in reputation** | unbounded, and borne by a non-participant | §4's naming rules. This is the one loss the collateral does not bound, and it is the reason §4 exists. |
| L6 | a holder buys YES to offset liquidation exposure and is liquidated by a mechanism the predicate does not read | the holder | its bond, *plus* the loss it thought it had offset | **basis risk, and it is large.** §5. |

---

## 4. Naming a venue — the rules, because L5 is not bounded by collateral

Every reachable CMLS subject today prints `RED` (`005-subject-set.md` §1, measured 2026-08-07: four
Jupiter Lend price accounts, all `LIVE_THROUGH_CLOSURE`), and a market-hours-guarded Solana equity
feed could not be sourced at all on a public endpoint (§4d). A board built from search alone can
therefore only accuse. §2's NO side is the structural answer; these rules are the floor until it
arrives.

1. **Attributability.** A subject may be named only when the price account is publicly and verifiably
   attributable to the venue — the account is reachable from the venue's own published program or
   documentation. **A feed id mapped to a ticker through an off-chain registry is not attributable**
   (`005-subject-set.md` §4d), and naming an asset on that basis is the failure `005 §2` calls a libel
   machine.
2. **The row states the predicate, not a character judgement.** "`RED`: this account published N
   times while the US market was closed, max gap M minutes, over window W" — never "venue X liquidates
   unsoundly".
3. **T-4's sentence travels with every RED**: `RED` is sufficient, not necessary; `UNKNOWN` and
   `YELLOW` are not exoneration.
4. **Every row carries the command that falsifies it**, and the endpoint that command needs. A public
   endpoint rate-limits a ~2,000-observation weekend rebuild (`005 §4d`; README records `check` failing
   closed on one). The board either names an endpoint that can serve the check **or says in the row
   that a public endpoint will not** (T-13).
5. **An unchallenged row is not a proven row.** `board/README.md` already says a row being open or
   uncontested does not prove the venue correct; a CMLS row repeats it.

---

## 5. What this product may not be called

Binding vocabulary rules are in [`HARNESS.md`](../cmls/HARNESS.md) §5 and apply to every deliverable,
including the pitch. In short: **not insurance, not a guarantee, not compensation**, in any language.

The reason is L6, and it is not a technicality. A payout here is triggered by a computation over a
price account's update times. It is not triggered by, sized to, or reduced by the buyer's realised
loss. A holder who buys YES and is never liquidated still gets paid; a holder who is liquidated
through a mechanism the predicate does not read gets nothing. **That gap is basis risk, it is large,
and the product names it in its own materials rather than waiting to be asked.**

Required sentence, verbatim, wherever a payout is described:

> Both sides are collateralized in full before the market is live, and the most either can lose is the
> collateral it posted. The payout is decided by re-executing a stated condition over a pinned set of
> on-chain records — not by anyone's loss. It is not insurance and does not compensate a loss.

---

## 6. The risk-transfer version, named and deferred

§0's constraint is a property of `open_market`, not of the claim-type. A forward-looking CMLS market —
"will account A run live through *next* weekend's closure?" — is genuine risk transfer and would price
between 0 and 1. It needs a market that binds a **descriptor and a window** at open and pins
`inputs_hash` **after** the window closes, with the pinning permissionless and itself falsifiable.

That is a program change: a new state between OPEN and CHALLENGED, a pinning instruction, and an
answer to "who pins, and what stops them pinning a subset" — which is T-2 again, one layer up and
without the protection that the truth already exists to be rebuilt against.

**Out of scope for this wave.** It is written down so the deck does not quietly imply it, and so that
nobody re-derives it as a new idea in three weeks.

---

## 7. Acceptance criteria

1. The one-sentence question, the three flags with their meanings, and the `yesWhen = { RED }` mapping
   appear in a single document a reader can hold — with §1's two boundaries attached, not in a
   footnote.
2. Every published payout description carries §5's verbatim sentence, and no deliverable contains a
   word from `HARNESS.md` §5's refused list.
3. Every published subject satisfies all five rules in §4, and the board row shows the window, the
   flag, the counts, the endpoint, and the falsifying command.
4. §0's "not risk transfer" finding, §2's odds arithmetic (`≈52.6%` break-even), and §6's deferral are
   in the pitch deck's own words — not only here. A deck that shows a settled RED and omits these is
   the demo hiding an untested edge, which `HARNESS.md` §4 forbids.
5. The three loss rows the collateral does **not** bound — L3, L5, L6 — are each stated where a
   participant would meet them.

## 8. Proof obligations (`HARNESS.md` §3)

| id | status | note |
| --- | --- | --- |
| PO-1 | n/a | this brief pins no inputs |
| PO-2 | n/a | the predicate reads no price |
| PO-3 | measured after this brief was frozen | see [`../cmls/GATE-EVIDENCE.md`](../cmls/GATE-EVIDENCE.md) §V3: **PROVEN as a capability, FAILS as shipped** |
| PO-4 | **UNPROVEN → this brief is the argument, not the proof** | §2 and §3 name the payer and the bound for six scenarios; three of them (L3, L5, L6) are *not* bounded by collateral. PO-4 cannot be `PROVEN` while L3 and L5 are open, so the harness carries 020 as `OPEN_RISK` on merge rather than `DONE`. |

## 9. Out of scope

- Any code. Any claim-type registration. Any change to `core/`.
- Other claim-types, and any framing of Vrdct as a general resolver inside a CMLS deliverable.
- The forward-window market (§6).
- Mainnet, and any devnet run touching a wallet that matters (T-12).

## 10. What Codex would be asked to review — **not sent**

The gate is open and the active Codex role is the recomputation of the gate evidence, not this brief.
The list is kept so the round can be opened in one step if the founder chooses to.


1. **§0.** Is the retrospective-only conclusion right — does anything in `open_market` or the client
   permit binding a window whose records do not yet exist? If it is wrong, the product changes shape
   and everything after §0 is downstream of the error.
2. **§2's arithmetic.** `bond >= resolver_bond`, `pot − cut_of(loser_bond)`, `CUT_BPS`, and the
   ≈52.6% break-even. Money arithmetic in a brief is exactly the kind of claim that has been wrong
   here before.
3. **§1's mapping.** Does `yes_when` as a bitmask admit `{RED}` cleanly, and does `yes_from` do what
   §1 says for all three flags — including the `UNKNOWN` path through `settle` and through
   `claim_uncontested`?
4. **§3's loss table.** Is any *seventh* scenario reachable in which a party loses more than its
   posted bond, or in which a non-participant bears a bounded on-chain loss?
5. **§4.** Is rule 1 (attributability) sufficient to keep a name off the board when the account is
   only inferred?

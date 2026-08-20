# Codex relay blocks

`tools/relay-codex.sh <section>` sends one of these blocks to Codex verbatim; `/relay` drives it.
Copying one by hand into Codex does the same thing and is always allowed.

The block still has to carry everything: Codex starts cold, in a detached worktree, with no memory of
this session. What automated is the **transport**, never the **decision** — the script reads the role
lock and refuses against it, and it neither commits the reply nor interprets it.

**Role lock:** [`LEDGER.md`](./LEDGER.md) says `codex_role: review`. §1 (sent, closed) and §3 are review blocks; only §3 is live. Sending an
implementation request while the review role is active is the thing `docs/GATE.md` forbids.

---

## 1 — Independent recomputation of the kill-gate evidence · **SEND THIS ONE**

```text
Review request — Vrdct CMLS kill gate, independent recomputation

Branch: claude/020-cmls-harness   Evidence commit: 16c5d45   Base: cae200d
(The branch head is one commit later; that commit only fills this sha in.)
Author: Claude (evidence role) · Reviewer: you (Codex, review role)
Work in a worktree that is not ~/src/vrdct — that directory holds this branch, so a
checkout elsewhere fails instead of silently moving someone's HEAD.

Record findings in reviews/020-cmls-gate-evidence.md.

WHAT THIS IS. docs/GATE.md is a kill gate the founder installed mid-session. It asks one
question — can a third party fully reconstruct price, time window and state, and reach the
same verdict? — and it says the verdict must be a number or a reproducible experiment, that
not-proven is a KILL, and that no model reviews its own output. I produced the evidence, so
I cannot certify it. The run ended in KILLED on item V3, which under docs/GATE.md does not
require review to stand — so this request is not a blocker being cleared, it is an
adversarial recomputation of a verdict I reached alone. Attack it.

Read, in order: docs/GATE.md, STATUS.md,
docs/decisions/2026-08-20-V3-state-rebuild.md, docs/cmls/GATE-EVIDENCE.md.

WHAT I MEASURED, on 2026-08-20 against https://api.mainnet-beta.solana.com, on the published
corpus claim (Jupiter Lend SPYx, A2GDb4Um…, window 2026-08-01T12:10:59Z → 2026-08-05T00:07:01Z,
3,789 pinned observations, published inputs_hash 2f224c44f93a8e2c…). The window is 19 days old.

  1. node reconstruct.mjs corpus/jupiter-spyx-cmls.claim.json
     -> exit 1, "missing 515, extra 0", rebuilt hash c7cdcb15f185ccad…
     The command the README publishes for a third party FAILS today.

  2. An instrumented walk — same endpoint, same request shape, 900 ms inter-page spacing,
     page budget above 20 — returned 3,789/3,789 in 21 pages, 0 throttles, and rebuilt
     inputs_hash 2f224c44f93a8e2c2840c75c2a86872ce3b73336ffcec047654d8d0e2deffccd,
     byte-identical to the published one.

  3. Recomputed from that rebuild alone: RED, 683 open / 3,106 closed / max gap 242 s —
     matching the published verdict.

  4. Cause isolated by experiment, not argument: it is NOT retention (the walk reached
     2026-08-01T00:42Z, 11.5 h older than the window start) and NOT rate limiting (0 throttles
     at 900 ms; fatal at 120 ms). It is core/rpc.mjs:19 — `for (let p = 0; p < 20; p++)` —
     which returns silently when the budget runs out. This window needs 21 pages.

WHERE TO PUSH HARDEST, hardest first. These are the claims I am least sure of.

  1. The decay mechanism. I claim the page budget is a fixed COUNT while the signature
     distance from now to the window grows daily, so every CMLS claim becomes silently
     unreconstructible after enough elapsed time, and both honest parties truncate
     identically so agreement is not evidence of completeness. Is that right, and is
     "agreement is not evidence of completeness" too strong?

  2. My probe is not the shipped tool. I split V3 into "PROVEN as a capability / FAILS as
     shipped" and let the capability row exist. Is that laundering the failure? Under
     docs/GATE.md the verdict must come from THEM reaching it, not us describing it — a
     stranger following the README reaches exit 1. Argue that V3 is simply a FAIL.

  3. The verdict KILLED, in both directions. Against: docs/GATE.md's own named KILL
     condition is "input completeness cannot be proven", and completeness WAS proven
     byte-exactly, so arguably this is a GO with a bug. For: /gate makes a serious
     OPEN_RISK a KILL, the verdict must come from THEM reaching it, and the README claim
     under test is false as published. I took the reading against the project because the
     gate says flattering errors run one way. Tell me if I over-corrected — a wrong KILL
     costs the founder a real capability, and I would rather be told than be safe.

  4. V1. The gate asks about price reconstruction. The CMLS predicate reads ZERO prices —
     canonicalInputs returns {blockTimes}, the Rust twin folds a u32 timestamp. I called
     V1 PROVEN on the literal reading (the inputs we used were reconstructed exactly) and
     recorded the scope reduction against the project. The flattering reading was available
     and I want it attacked.

  5. V2. from_ts and to_ts equal the first and last pinned observation exactly, while
     keeper/window.mjs::tradingWindow derives a different window. I called that
     "reconstructable but not derivable". Is that a PASS?

  6. Every number above. docs/GATE.md records that every numeric error in this portfolio so
     far favoured the project that produced it, from four different authors. Recompute from
     the definition, your own way, not by re-running my commands, and state the direction of
     every discrepancy — including ones that move nothing. I already made one such error and
     recorded it: I wrote up 242 s vs 4.0 min as a twin divergence and it is only rounding.

REPRODUCE

  node reconstruct.mjs corpus/jupiter-spyx-cmls.claim.json     # expect exit 1 today
  npm run test:canonical                                       # expect exit 0
      # 82 JS · 162 parity · 2 definition · 2212 calendar · 21 Rust (5 BPF ignored) · 12 Foundry

  The instrumented probe is deliberately NOT committed: committing it would make an
  experiment look like a shipped fix. It differs from core/rpc.mjs in exactly two ways —
  page budget above 20, and 900 ms spacing instead of 120 ms. Write your own.

SCOPE. Docs and evidence only; no code changed on this branch. Do not implement the
core/rpc.mjs fix in this round — the role lock is `review`, and docs/GATE.md forbids
implementation and review running at once. If you conclude the fix is trivial, say so and
stop; the founder opens the implementation round.

NOT ASKED FOR. docs/tasks/020-cmls-product-boundary.md is frozen pre-gate and is not part of
this review. reviews/ has no CMLS record yet; this would be the first.
```

---

## 3 — Independent review of the H2 gate design · **SEND THIS ONE**

```text
Review request — Vrdct H2 kill gate, design review before any evidence runs

Branch: claude/020-cmls-harness   Design commit: 67e6521
Author: Claude (spec role) · Reviewer: you (Codex, review role)
Work in a worktree that is not ~/src/vrdct.

Record findings in reviews/021-h2-gate-design.md.

WHAT THIS IS. H1 (the CMLS claim-type) was KILLED on 2026-08-20 and its verdict stands
unedited. You reviewed that evidence and dissented on three of four items; the dissent was
adopted. The founder then opened H2 as a NEW gate that starts over from zero.

This is NOT a review of evidence. NO evidence has been run. It is a review of a gate DESIGN
before it runs -- the one moment when changing it is legitimate. After the first A-item
runs, changing it is the failure docs/GATE.md exists to prevent. So this round is the only
chance to find that the gate cannot kill.

Read, in order: docs/GATE-H2.md, docs/GATE.md (rules it inherits),
docs/decisions/2026-08-20-cmls-product.md (H1's verdict), STATUS.md,
claimtypes/obligated-liveness.mjs, onchain/programs/vrdct-bond/src/lib.rs::open_market.

WHAT H2 IS. A buyer-defined, obligor-bonded, re-executable SLA. A buyer (integrator, DAO,
funds operator) fixes an explicit future liveness invariant. An obligor (keeper, agent,
operator) posts a bond against it. On violation a fixed, pre-agreed remedy is paid to the
buyer. Vrdct makes adjudication and bond enforcement re-executable. It is explicitly NOT
insurance -- the remedy is fixed and does not make the buyer whole -- and saying so is gate
item A8 rather than a disclaimer.

THE ONE QUESTION THIS REVIEW ANSWERS: can this gate kill H2? A gate that cannot return NO is
not a gate, and this portfolio has already watched a specification survive three review
rounds before anyone asked whether the thing it specified could be built.

WHERE TO PUSH HARDEST, hardest first.

  1. A5 -- omission. For an SLA, doing nothing IS the failure mode. I claim
     require!(n_records > 0, VrdctError::NoRecords) in open_market means a market cannot
     open with zero records, so a total outage -- the worst possible breach -- is the one
     case that currently cannot be settled. Verify that end to end against matchSlots in
     claimtypes/obligated-liveness.mjs and against state::Market. Is my reading right? If it
     is, is A5 already a KILL today rather than an open question, and am I understating it?

  2. B6's withdrawal. H2's first draft made "the only rational counterparty is the accused
     venue" a KILL. I withdrew it, arguing that an obligor bonding its own future conduct is
     a warranty rather than an accusation. A kill condition that disappears is exactly how a
     gate stops being a gate. Attack the withdrawal.

  3. The instance changed once, before any evidence. First draft: an indemnity (buyer = a
     borrower liquidated against a stale feed). Founder replaced it with the SLA. I ruled
     that legitimate because no verification step had run. Argue that it is a rescue of a
     killed project wearing new labels -- H1 gestured at liveness and never read a price or
     a liquidation, and obligated-liveness is a claim-type this repo already owns, which is
     precisely the "reach for another surface" move H2's own non-goals forbid.

  4. Can any A-item actually return NO? Take each of A0-A8 and ask what result would fail it,
     and whether that result is reachable. Name any item that is unfalsifiable as written,
     or whose KILL condition can be argued past. A2's "fewer than 5 named buyers" and A3's
     "empty intersection" are the ones I trust least -- both depend on statements from
     interested parties, and I have specified that both ranges are recorded before the
     intersection is computed, which may not be enough.

  5. The thresholds: 0 miss rate, 5 buyers, 2 naming an obligor. Mine, and the most arguable
     part. Are they set where a real failure passes?

  6. What is missing. Name a way H2 fails that no A-item would catch.

SCOPE. Docs only; no code was changed and none may be. Do NOT implement, do NOT port
obligated-liveness to CLAIM_TYPE_ID or the Rust twin (its :60-62 names that gap and H2's
non-goals explicitly withhold it), do NOT design the fail-closed mechanism A5 asks about --
A5 asks whether one exists, not for one. The role lock is `review`. If you conclude a fix is
obvious, say so and stop; the founder opens any implementation round.

NOT ASKED FOR. H1 is closed. docs/tasks/020-cmls-product-boundary.md is frozen. Do not
re-adjudicate the CMLS verdict; your own review of it was adopted.
```

---

## 2 — `core/rpc.mjs` completeness · **DO NOT SEND while `codex_role: review`**

Held deliberately. It is an implementation request, and one Codex role runs at a time. It is also
gated on the recomputation in §1: if §1 finds my diagnosis wrong, this request is wrong too.

Shape, when the founder opens it: make the walk **refuse rather than return** when its budget is
exhausted before the window is covered, and say how far back it reached; the failure must be loud, and
the existing silent path must have a regression test that reproduces the 515-observation shortfall.
Not to be sent by any agent on its own initiative.

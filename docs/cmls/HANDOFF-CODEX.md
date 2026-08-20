# Codex relay blocks

Copy one block verbatim into Codex. Nothing here can run Codex; the human is the relay, which is why
the block has to carry everything.

**Role lock:** [`LEDGER.md`](./LEDGER.md) says `codex_role: review`. Only §1 may be sent. Sending an
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

## 2 — `core/rpc.mjs` completeness · **DO NOT SEND while `codex_role: review`**

Held deliberately. It is an implementation request, and one Codex role runs at a time. It is also
gated on the recomputation in §1: if §1 finds my diagnosis wrong, this request is wrong too.

Shape, when the founder opens it: make the walk **refuse rather than return** when its budget is
exhausted before the window is covered, and say how far back it reached; the failure must be loud, and
the existing silent path must have a regression test that reproduces the 515-observation shortfall.
Not to be sent by any agent on its own initiative.

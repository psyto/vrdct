# Kill-gate evidence — CMLS input reconstruction

**Gate:** [`docs/GATE.md`](../GATE.md) — *"Can a third party fully reconstruct price, time window, and
state, and reach the same verdict?"*
**Run by:** Claude (specification/evidence role). **Not reviewed** — no model reviews its own output.
A `GO` would require review; this run ended in `KILLED`, which does not. Verdict:
[`../decisions/2026-08-20-V3-state-rebuild.md`](../decisions/2026-08-20-V3-state-rebuild.md).
**Ref:** `claude/020-cmls-harness` over `2ab7a93`. **Dates:** all runs 2026-08-20, UTC timestamps below.
**Subject:** the published reference claim `corpus/jupiter-spyx-cmls.claim.json` — Jupiter Lend SPYx,
account `A2GDb4Um4Tr42iKgPz5fQ2d7pYTnaUuHN3d5V41Cywff`, window `2026-08-01T12:10:59Z →
2026-08-05T00:07:01Z`, 3,789 pinned observations, published `inputs_hash` `2f224c44f93a8e2c…`.

The window is **19 days old** at run time. That is the point: the gate says run it against what a
third party can obtain **today**, not against an archive we hold.

---

## The headline, before the detail

| | |
| --- | --- |
| Is the data reachable today, from a public endpoint, by a stranger? | **Yes — exactly.** 3,789 of 3,789 observations, `inputs_hash` byte-identical to the published one, verdict `RED` reproduced. |
| Does the project's own published command achieve that? | **No.** `node reconstruct.mjs` returns `❌ Reconstruction diverged`, exit 1, **515 observations missing**. |
| Why the gap? | `core/rpc.mjs:19` walks at most **20 pages**. This window now needs **21**. Off by one page, silently. |
| Is it RPC retention? | **No.** Retention was explicitly probed and is not the wall — the endpoint served signatures *past* the window's start. |

**Direction of the error: against the project.** The README sentence at `README.md:464-466` —
*"Measured, not asserted: `node reconstruct.mjs …` re-fetches the reference claim from mainnet and
lands on the identical 3,789-observation set and the identical `inputs_hash`"* — **is false as of
2026-08-20** when run as written. It was presumably true when written; it decayed. See §5.

---

## V1 — price reconstruction

> *Can an independent party obtain the same price inputs we used, from sources they can reach?*

**PROVEN, and the scope it proves is narrower than the product's name.**

The inputs this claim-type actually uses are reconstructed exactly (§V3). But the count of prices
among them is **zero**: `canonicalInputs` returns `{ blockTimes }` and nothing else
(`claimtypes/closed-market-soundness.mjs:22-38`), and the Rust twin folds a 4-byte `u32 LE` timestamp
per record (`onchain/…/reexec/cmls.rs:20,29-31`).

**Recorded against the project, because the flattering reading is available and must not be taken:**
CMLS does not reconstruct a price, does not observe a liquidation, and therefore never establishes
that anything was liquidated at a wrong price. It establishes that a price *account was written to*
while the US equities market was closed. Every published verdict has to say that in its own words
(threat-model **T-4**).

## V2 — time window

> *Is the window unambiguous and reconstructable, including its boundaries?*

**PROVEN for reconstruction; NOT derivable, and the difference is recorded.**

`from_ts = 1785586259`, `to_ts = 1785888421` are integers bound into the market-definition hash, so a
third party re-derives byte-identical bounds from the market account and cannot be handed different
ones. Both bounds fall in `CLOSED` status (`marketStatus`), and re-derivation lands on the same
window because there is nothing to guess.

**Against the project:** the bounds are not a function of the world. Measured:

| | value |
| --- | --- |
| `from_ts` | `1785586259` — **equal to the first observation's `blockTime`** |
| `to_ts` | `1785888421` — **equal to the last observation's `blockTime`** |
| `tradingWindow(to_ts)` (calendar-derived, `keeper/window.mjs`) | `1785787200 → 1785873600` — **a different window** |

So the published corpus window was read off the data its author already held, not derived from the
calendar. A keeper-opened market would use `tradingWindow`, which *is* a pure function of chain time
and calendar; the artifact the README leans on does not. This is threat-model **T-6** — the opener
chooses the window, and the window is part of the question.

## V3 — state rebuild

> *Can the settled state be rebuilt from public data at the deciding moment? — a rebuild, run.*

Two answers, and the project only gets to claim one of them.

### V3a — as the project ships it: **FAILS today — this is the KILL**

```
$ node reconstruct.mjs corpus/jupiter-spyx-cmls.claim.json     # 2026-08-20T09:05:07Z → 09:06:27Z
  fetched   3274 observations in 79.8s
  set match ❌ missing 515, extra 0
  pinned    inputs_hash 2f224c44f93a8e2c2840c75c2a86872ce3b73336ffcec047654d8d0e2deffccd
  rebuilt   inputs_hash c7cdcb15f185ccad035c982034607483744ac8590cae302d1b50b3b88f7f00c9
  ❌ Reconstruction diverged. Do not bond against this market until the difference is explained.
  EXIT=1
```

The gate says the verdict must come from *them reaching it, not us describing it*. A third party
following the README reaches **exit 1**.

### V3b — is the data reachable at all? **Yes, exactly**

An instrumented walk with the same request shape, the same public endpoint, a 900 ms inter-page
delay and a page budget above 20 (`scratchpad/probe2.mjs`, read-only, no repo file changed):

```
  endpoint  https://api.mainnet-beta.solana.com          09:07:56Z → 09:08:30Z
  pages     21          throttles 0        walked 21000 signatures
  inWindow  3789        expected  3789
  oldest    2026-08-01T00:42:00Z   (window starts 2026-08-01T12:10:59Z)
  stop      walked past window start at page 20
```

```
  V3_set          pinned 3789 · rebuilt 3789 · missing 0 · extra 0 · identical ✅
  V3_commitment   pinned  2f224c44f93a8e2c2840c75c2a86872ce3b73336ffcec047654d8d0e2deffccd
                  rebuilt 2f224c44f93a8e2c2840c75c2a86872ce3b73336ffcec047654d8d0e2deffccd  ✅ equal
```

### The cause, isolated

Two candidate walls were separated by experiment rather than by argument:

| candidate | measurement | verdict |
| --- | --- | --- |
| **RPC retention** — history no longer served | the walk reached `2026-08-01T00:42:00Z`, **11.5 hours older than the window's start**, and stopped because it had passed it, not because history ran out | **not the wall** |
| **rate limiting** (T-13) | first probe died with `Too many requests for a specific RPC call` at 120 ms spacing; at 900 ms spacing, **0 throttles** | real, but survivable with spacing |
| **our own page cap** (T-3) | `core/rpc.mjs:19` is `for (let p = 0; p < 20; p++)`; this window needs **21** pages, and the loop returns silently when the budget runs out (`core/rpc.mjs:28-31`) | **this is the wall** |

**And it gets worse on its own.** The budget is a fixed count of pages, while the number of
signatures between *now* and the window grows every day. Completeness is therefore a function of how
long ago the window was. The corpus claim crossed the line between publication and today; **every
CMLS claim crosses it eventually, with no error, no flag, and both honest parties truncating
identically** — so agreement between two rebuilders is not evidence of completeness.

## V4 — same verdict

> *Does an independent reconstruction reach* our *verdict, not merely* a *verdict?*

**PROVEN**, conditional on V3b. Recomputed from the rebuilt inputs alone — `reexec` over the
independently fetched set, not over the claim body:

| | published | recomputed from rebuild |
| --- | --- | --- |
| flag | `RED` | `RED` ✅ |
| guard | — | `NONE` |
| signal | — | `LIVE_THROUGH_CLOSURE` |
| updates while OPEN | 683 (README) | **683** ✅ |
| updates while CLOSED | 3,106 (README) | **3,106** ✅ |
| max gap | 242 s (README) | **4.0 min** — measured directly from the pinned set: **242 s** ✅ |
| `verify(claim)` | — | `true` |

**A discrepancy I claimed and then disproved, recorded because the process matters.** README
reports *"max gap 242 s"* while the claim body carries `maxGapMin: 4`, and I first wrote these up as
two different numbers from two paths. They are not. Measured straight from the pinned observations:
`maxGapSecs = 242`, and `+(242/60).toFixed(1) === 4`, so `4` **is** 242 s after the JS presentation
rounding — which the devnet-debt review already stated (*"the JS presentation rounds 242/60 while the
Rust fold and client retain/report seconds"*). There is no twin divergence here. The error was mine,
it ran in the direction of *inventing* a defect rather than hiding one, and it took one command to
settle.

---

## Reproduce

```bash
# V3a — the shipped path, which currently fails (exit 1)
node reconstruct.mjs corpus/jupiter-spyx-cmls.claim.json

# V3b/V4 — the instrumented walk and the commitment/verdict comparison.
# probe2.mjs / probe3.mjs are in the session scratchpad, deliberately NOT committed:
# they are an experiment, not a shipped tool, and committing them would look like a fix.
# probe2 differs from core/rpc.mjs in exactly two ways: page budget > 20, and 900 ms spacing.
```

## What this evidence does and does not license

**It does** establish, with a byte-exact hash match against a published commitment, that a stranger
with a public RPC can rebuild a 19-day-old CMLS input set completely and land on our verdict. That is
the strongest sourcing evidence anywhere in this repo, and it is the item the gate's KILL condition
names.

**It does not** license the sentence at `README.md:464-466`, which claims the shipped command does
this and today it does not. Correcting that sentence is the highest-priority follow-up **and it is
not done in this commit**, because the correction should follow the independent recomputation rather
than precede it.

**It does not** license calling CMLS a verdict about liquidation prices (V1), or the window a fact
about the world (V2).

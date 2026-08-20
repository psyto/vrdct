# CMLS threat model

Scope: the *closed-market liquidation soundness* market only — its predicate, its input
reconstruction, its custody, and its incentives. Everything here was read at
`claude/020-cmls-harness` (base `2ab7a93`) on **2026-08-20**; every row cites the file and line it
rests on, and every row says which direction the error runs in — **who pays when it fires**.

Read with [`HARNESS.md`](./HARNESS.md) §3 (the four proof obligations) and §7 (required test axes).

> **A citation here is candidate evidence, not proof of an absence.** Rows that assert *nothing binds
> X* are marked `N?` and, per `AGENTS.md`, are not decisive until the **other** agent records the
> searched ref, the commands, their scope and exit status, and what each candidate turned out to be.
> Two rows below carry that mark.

---

## Standing corrections — claims in older briefs that are no longer true at HEAD

Recorded first, because two of them are repeated as current in `docs/tasks/019-slice-a-sourcing.md`
§6, and a threat model that inherits them would be defending a fixed bug.

| older claim | source | status at `2ab7a93` |
| --- | --- | --- |
| "half-day sessions are counted CLOSED — a sound feed gets a false RED on 2026-11-27" | `005-subject-set.md` §4c, repeated in `019` §6 | **FIXED.** `claimtypes/closed-market-soundness.mjs:48` counts `STATUS.HALF_DAY` on the open side; the Rust twin closes a half-day at `HALF_CLOSE_MIN` in `reexec/campana.rs :: is_session_open`. Landed as `071a32b`. |
| "the unhandled throw at `keeper/lib.mjs:141` takes the keeper down twice a week" | `005-subject-set.md` §4b, repeated in `019` §6 | **FIXED.** The refusal is now `keeper/lib.mjs:146` and every subject runs inside `try/catch` with `recordFailure` (`keeper/lib.mjs:494-497`). |
| "the keeper's window is the previous UTC calendar day, so a guarded feed yields an empty set" | `005-subject-set.md` §4b | **FIXED.** `keeper/window.mjs :: tradingWindow` is close-to-close and says why in its own comment. `subjects[].windowSecs` is now rejected outright (`keeper/lib.mjs:75`). |
| "GREEN is unreachable; the best sound verdict is YELLOW" | `005-subject-set.md` §4a | **STILL TRUE.** `closed-market-soundness.mjs:58`, `reexec/cmls.rs:52-60`. See **T-5**. |
| "no market-hours-guarded Solana equity feed could be sourced" | `005-subject-set.md` §4d | **STILL TRUE as of that measurement (2026-08-07); not re-measured here.** See **T-10**. |

**What this says about the harness itself:** three of five inherited "current defects" were already
repaired. `cmls-gatekeeper` therefore refuses any transition whose evidence is a *brief* rather than
a read of HEAD.

---

## The rows

### T-1 — the source descriptor does not bind a cluster `N?` · PO-3 · **OPEN, high**

`onchain/programs/vrdct-bond/src/state.rs :: Source` carries `{kind, account, from_ts, to_ts}` and no
chain identifier; `validate_source` (`lib.rs`, `CT_CMLS` arm) checks kind, non-default account and
`from_ts < to_ts` — nothing more. The cluster a rebuild targets comes from the *checker's*
environment: `cli/vrdct.mjs:18`, `const SOURCE_RPC = process.env.SOURCE_RPC || RPC`.

A base58 pubkey is not unique to a cluster. `monday-open-gap` learned this and binds `chain` into its
descriptor and to `subject.chain` (README §"A market that does not exist yet"); **CMLS's on-chain
descriptor did not get the same treatment.**

*Direction of error.* Two honest strangers, pointing `SOURCE_RPC` at different clusters, rebuild
different sets and reach opposite bonding decisions — and the market definition contains nothing that
says which of them read the right chain. It is not an attack requiring a liar; a misconfiguration is
enough. A market opened against a devnet account whose pubkey is *presented* as a mainnet venue is
the attack version.

*Consequence for the product.* Until this closes, **no CMLS market may be described as checkable by a
stranger** — the stranger has to be told the cluster out of band, which is exactly the opaque channel
`vrdct check` exists to abolish. HARNESS §6.

*Owner:* Codex. **No task opened** — carried as a ranked defect in [`LEDGER.md`](./LEDGER.md); the gate forbids scope beyond its own evidence.

### T-2 — omission is exculpatory, and only a rebuild catches it · PO-1 · **OPEN by design, bounded**

CMLS's verdict is a function of *which* timestamps are in the pinned set. Two omissions flip it in
the venue's favour:

- drop **every** closed-window record → `closedUpdates === 0` → `FROZEN_THROUGH_CLOSURE` → **YELLOW**
  ("staleness guard only") — a manufactured exoneration (`closed-market-soundness.mjs:53,56,58`);
- drop **one** middle record so some gap reaches 30 minutes → `maxGap ≥ LIVE_GAP_SECS` → `SPARSE` →
  **UNKNOWN** (`reexec/cmls.rs:23,54`).

This is the **mirror image of `obligated-liveness`**, where omission can only make a verdict harsher
and is therefore safe to leave open (README). Here it runs toward the accused. The only defence is
that a third party rebuilds the set from the descriptor and sees the mismatch — which makes PO-1 and
PO-3 the *same* obligation for this claim-type, and makes T-1, T-3 and T-11 load-bearing rather than
hygiene.

*Direction of error.* A venue, or anyone who profits from the YELLOW side, pays less than the truth.
The loser is the challenger who did not rebuild before bonding.

*Owner:* Codex (tests), CC (honest-scope wording). Carried in [`LEDGER.md`](./LEDGER.md).

### T-3 — `fetchObservations` truncates silently after 20 pages · PO-1 · **CONFIRMED 2026-08-20 — this is the gate's blocking defect**

`core/rpc.mjs:19` loops `for (let p = 0; p < 20; p++)`. The loop exits early on an empty page or once
a page's last row predates `from`; **if neither happens it simply falls out and returns whatever it
gathered** (`core/rpc.mjs:28-31`). At `limit: 1000` that is a hard ceiling of 20,000 signatures with
no error, no flag, and no distinction from a complete read.

That is a **fail-open** path in the one function that is supposed to establish completeness, and it
produces exactly the T-2 omission shape without anybody acting maliciously. The reference corpus
(3,789 records) and a weekend on a Jupiter Lend account (~2,000, `005-subject-set.md` §1) sit far
below it, which is why it was thought not to fire.

**It fires today, and it was measured.** The corpus window needs **21** pages, not 20:
`node reconstruct.mjs` returns exit 1 with **515 of 3,789 observations missing**, while an
instrumented 21-page walk against the same public endpoint returns 3,789/3,789 and the identical
published `inputs_hash`. [`GATE-EVIDENCE.md`](./GATE-EVIDENCE.md) §V3.

**The mechanism is worse than a fixed ceiling.** The budget is a fixed *page count* while the number
of signatures between *now* and the window grows every day, so completeness is a function of how long
ago the window was. Every CMLS claim crosses the line eventually, silently. `README.md:464-466`
asserts the opposite and is false as written today.

*Direction of error.* Toward `UNKNOWN`/`YELLOW` — see T-2. Worse, **both** the resolver and the
honest challenger truncate identically, so the two agree on a wrong set and the rebuild check passes.
Determinism is not completeness.

*Fix shape (Codex):* refuse rather than return — if the page budget is exhausted before the window is
covered, raise, and say how far back it reached.

*Owner:* Codex. **Measured on 2026-08-20 and now the gate's blocking defect** — see [`GATE-EVIDENCE.md`](./GATE-EVIDENCE.md) §V3.

### T-4 — a single global `maxGap` under-detects the very conduct the market prices · **DESIGN, must reach honest scope**

`maxGap` is the maximum spacing over **all** records in the window, open and closed alike
(`closed-market-soundness.mjs:48-53`). A venue that updates densely during the session and once every
40 minutes through the closure is liquidating against a closed-market price *and* reads
`SPARSE → UNKNOWN`, not RED.

So CMLS's RED is **sufficient, not necessary** — the same shape as `restaking-robustness`'s
Corollary 2, and it must be said in the same voice: *RED means the feed provably ran live through the
closure; UNKNOWN does not mean the venue was guarded.* The current reason string
(`closed-market-soundness.mjs:70`) is careful; the surrounding product language is what needs the
sentence.

*Direction of error.* Toward the venue. A market whose question implies "is this venue sound?" pays
NO on a venue that is not, because the predicate answered a narrower question.

*Owner:* CC. `docs/tasks/020` (question wording), frozen pre-gate.

### T-5 — GREEN is unreachable, so the YES side must be defined on RED · **DESIGN, closed by decision in 020**

`guardFromSignal`/`flagFromGuard` (`closed-market-soundness.mjs:56-58`) and `reexec::cmls::verdict`
(`reexec/cmls.rs:52-60`) produce only `RED`, `YELLOW`, `UNKNOWN`. Any market configured
`yesWhen: ["GREEN"]` is dead on arrival, and a product that describes itself as paying on
"soundness confirmed" is describing a verdict this surface cannot print.

*Direction of error.* A buyer who believes they hold "the sound side" holds a side that can only be
YELLOW or UNKNOWN — two different meanings collapsed into one payout.

*Owner:* CC. `docs/tasks/020`, frozen pre-gate.

### T-6 — the opener chooses the window, and the window is part of the question · **DESIGN, mitigable**

`from_ts`/`to_ts` are the opener's, bound into the definition hash but not derived. A window
containing only session hours yields YELLOW; a window containing a closure yields RED. Neither is
forgery — they are *different questions* — but a board that prints a flag without its window invites
the reader to merge them.

*Mitigation that already exists:* `keeper/window.mjs :: tradingWindow` derives a close-to-close window
from the calendar, so a keeper-run row's window is a function of chain time, not of taste. It is not
enforced on-chain and a hand-opened market may choose anything legal.

*Direction of error.* Whichever side the opener wants. Bounded by the fact that the window is public
and in the address.

*Owner:* CC (board rules), Codex (whether the program should constrain it). Confirmed by the gate's V2 measurement: the corpus window equals its own first/last observation.

### T-7 — the fold requires non-decreasing `blockTime`, and nothing here proves chain history supplies it · `N?` · **OPEN, unproven assumption**

`reexec/cmls.rs:33` rejects a record whose timestamp is below its predecessor
(`VrdctError::RecordsOutOfOrder`), while the canonical set is sorted by `(slot, sig)`
(`core/rpc.mjs:31`) — not by time. The two agree only if `blockTime` is non-decreasing in slot order.
That is Solana's intent for `Clock::unix_timestamp`; **nothing in this repo tests it, and no fixture
in `tests/` contains a decreasing pair.**

*Direction of error.* If one such pair exists in a market's window, the honest set cannot be folded
at all: no `settle` can complete, and after the deadline `expire_challenged` hands the **entire pot**
to the challenger (README §Honest scope 3). A resolver is then slashed 100% for being right. That is
the worst payoff direction in the system, reached without an adversary.

*Owner:* Codex. Carried: it needs a fixture and a decision — reject at build time, or sort by time
and re-derive the twin.

### T-8 — same-slot ordering is *argued* harmless, not *tested* · **OPEN, low**

Several signatures on the price account in one slot share a `blockTime`, and the fold consumes only
timestamps, so any permutation yields the same multiset, the same `max_gap`, and the same counts. The
tie-break by signature (`core/rpc.mjs:31`) makes the *bytes* canonical, which is what `inputs_hash`
needs. The argument looks sound; it has no test.

*Owner:* Codex. Carried; `HARNESS.md` §7 axis 5.

### T-9 — the expiry race and the cranker cut · PO-4 · **OPEN upstream, inherited**

`settle` pays the winner `pot − cut_of(loser_bond)` and the completed feed's feeder the cut
(`onchain/…/lib.rs`, `settle`); `expire_challenged` after `settle_by` pays the challenger the whole
pot. `settle` has no deadline, so a completed feed is never discarded by the clock — but after the
deadline the two race, and the first terminal transaction wins (README §Honest scope 3, which already
states this is open, not solved).

*CMLS-specific weight:* the reference claim needs **19 feed transactions** to fold 3,789 records. A
CMLS market's settlement is therefore long enough to be raced on purpose, in a way a one-record
solvency market is not.

*Direction of error.* Against a truthful resolver whose feeder is slow or censored. Bounded by the
resolver's bond, and by the challenger's incentive to be right when re-execution can still run.

*Owner:* Codex. Carried in [`LEDGER.md`](./LEDGER.md).

### T-10 — every reachable CMLS subject prints RED, and the accusation is public · **OPEN, product-level**

Measured in `005-subject-set.md` §1 (2026-08-07): all four Jupiter Lend price accounts read
`LIVE_THROUGH_CLOSURE → RED`, and §4d records that a market-hours-guarded Solana equity feed could not
be sourced on a public endpoint at all. Three of the four other known subjects **cannot be named**,
because mapping a Chainlink Data Streams feed id to a ticker needs an off-chain registry, and naming
an asset next to a bonded RED on a guess is what 005 §2 calls a libel machine.

*Direction of error.* Outward, at a third party who is not a participant. A false RED that nobody
challenges settles optimistically (README §Honest scope 2) and is then a *settled* public accusation.

*Product rules this forces, owned by `cmls-product-economics`:* a subject is nameable only when its
account is publicly and verifiably attributable to the venue; the row states the predicate, not a
character judgement; T-4's "sufficient, not necessary" sentence travels with every RED.

*Owner:* CC. `docs/tasks/020`, frozen pre-gate.

### T-11 — nothing binds the challenge window to RPC signature retention · PO-1/PO-3 · **OPEN**

CMLS's entire defence against T-2 is that a third party can rebuild the set. That ability expires
when the RPC stops serving signature history for the window — README says so ("**The bound is RPC
retention**"). The program bounds `challenge_window_secs` between `MIN_CHALLENGE_WINDOW_SECS` and
`MAX_CHALLENGE_WINDOW_SECS` (`onchain/…/lib.rs`, `open_market`) — **against constants, not against
retention.** A market may legally outlive the evidence that makes it checkable.

*Direction of error.* Toward whoever pinned the set, once history ages out: the claim becomes
unfalsifiable and settles optimistically.

*Owner:* CC to specify the rule (window + settlement deadline < the endpoint's measured retention,
and the board publishes the endpoint), Codex to enforce or to refuse to. Carried in
[`LEDGER.md`](./LEDGER.md).

*Measured 2026-08-20, and it cuts against the alarm:* the public endpoint still served the corpus
window **19 days** on, reaching 11.5 hours older than its start. Retention was not the wall on this
sample; T-3 was. One sample on one account is not a retention horizon, and nobody should quote it as
one.

### T-12 — `bond-live.mjs` loses money that no one can recover · PO-4 · **BLOCKING for any real-value run**

`reviews/main-2026-08-12-devnet-debt.md` **F1**, accepted and unfixed: the three actors are ephemeral
keypairs nothing sweeps back, and `close_market` returns a settled market's rent to its *recorded
resolver* — one of those keys. Measured on the devnet run: `2.50859` SOL of `4.49335328` is not
recoverable at all. README carries the warning; the fix is specified and not implemented.

*Direction of error.* Straight out of the operator's wallet, silently, repeatably.

*Gate:* **no V2-tier devnet run against a wallet anyone cares about, and no V4 at all, until this is closed.**

*Owner:* Codex. Carried in [`LEDGER.md`](./LEDGER.md) as blocking any real-value run.

### T-13 — the stranger we invite to falsify a row gets rate-limited · **OPEN, operational**

`005-subject-set.md` §4d: a weekend window on one of these accounts is ~2,000 observations, i.e. 3+
RPC pages, and `api.mainnet-beta.solana.com` rate-limits it; README §400-404 records `check` against
Market A stopping with `⛔ DO NOT BOND — source reconstruction failed` on a rate-limited endpoint —
correct behaviour, and also a market nobody checked.

*Direction of error.* Toward the resolver: the check that would catch T-2 does not run.

*Product rule:* the board either names an endpoint that can serve the check, or says plainly that a
public endpoint will not. *Owner:* CC. `docs/tasks/020`, frozen pre-gate.

### T-14 — the calendar is governed and expires · **KNOWN, bounded**

`CALENDAR_2026` is valid only for 2026 timestamps and both parsers refuse outside its half-open range
(`closed-market-soundness.mjs:32-34`, `reexec/campana.rs :: is_valid_2026_timestamp`). The table is
compiled into the program: it is the one trusted datum in an otherwise trustless path, and README
already names the governed calendar as what mainnet is behind.

*Direction of error.* Fail-closed (a claim outside the range cannot be built or folded), which is the
right direction; the residual is governance, not correctness.

*Owner:* CC. Carried.

### T-15 — authority overreach · **CLOSED at read, must stay tested**

No admin key, no privileged treasury; each feeder's progress lives in its own PDA; the market address
is the hash of its whole definition, so a question's address cannot be reserved under other terms
(README §On-chain). `tests/state_machine.rs` covers the custody machine. This row exists so axis 8 of
HARNESS §7 keeps being run, not because a hole is known.

---

## What the model says about the product

1. **CMLS's strongest property is real and should lead the pitch:** it is the only surface in this
   repo whose inputs a stranger can rebuild from the market account itself — `reconstruct.mjs`
   re-fetches the reference claim from mainnet and lands on the identical 3,789-observation set and
   the identical `inputs_hash` (README §Honest scope 1, measured).
2. **That property currently has three holes, and they are the first wave:** the cluster is not bound
   (T-1), the rebuild can truncate silently (T-3), and nothing keeps the market inside the retention
   horizon that makes the rebuild possible (T-11).
3. **The predicate is narrower than the product name suggests** (T-4, T-5). The fix is wording and a
   verdict mapping, not a new algorithm — and it must land before a demo, not after.
4. **The board can only print RED today** (T-10), which is a product problem before it is an
   engineering one.
5. **No real value moves until T-12 is closed.**

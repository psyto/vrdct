# 019 — Slice A: sourcing a claim's inputs without a recorder

**Frame:** thin (what the anchor is, which claim-types it raises, what it refuses to promise) → CC writes, Codex reviews.
**Status:** design. Nothing is implemented.
**Predecessor:** [`013-recorder.md`](./013-recorder.md) and **both** its Addenda, which live on
`cc/recorder-brief` (worktree `~/src/vrdct-recorder`) and have **not** been merged here. The first
draft of this brief had read only Addendum 1; §1 and §5 are corrected against Addendum 2.
**Companion:** [`018-evm-settlement.md`](./018-evm-settlement.md) §6 owns the repair inventory this
task executes.

> **Numbering.** 016 and 017 exist as review/evidence directories in other worktrees but hold no task
> brief; 012, 013 and 015 hold briefs that never landed on this `main`. 019 is free in every worktree
> checked on 2026-08-17. See `AGENTS.md` on why this paragraph exists.

---

## 0. Why this brief, and the one sentence that motivates it

`README.md` §Honest scope names `reserve-solvency` as *"still genuinely in the unsourced case"*, and
`adapters/jito-restaking.mjs:426` stamps its output `settlement_grade: NO`. Both statements rest on
one premise: **you cannot ask Solana what an account held at a past slot.**

013's Addendum 1 found that premise out of date and split the wall in two. This brief designs the half
that is available today, and it arrives at a smaller answer than 013 contemplated — plus one finding
that changes which claim-type should lead the board.

---

## 1. The premise, verified rather than remembered

013's Addendum 1 opens by admitting its body was written from memory and was wrong. That is the exact
failure this section exists to avoid, so every line below is either quoted from the specification or
measured from mainnet on **2026-08-17**.

### From SIMD-0215 (fetched from the spec, not recalled)

| fact | value |
| --- | --- |
| status | `Activated` |
| feature gate | `LTHasHQX6661DaDD4S6A2TFi6QBuiwXKv66fB1obfHq` |
| hash | BLAKE3, 2048-byte output read as 1024 × `u16` |
| combination | **wrapping-add** per element — homomorphic, and therefore invertible by wrapping-sub |
| per-account preimage | `lamports`, `data`, `is_executable`, `owner`, `pubkey` — **`rent_epoch` is not hashed** |
| zero-lamport account | contributes all-zeros; deletion needs no tombstone |
| incremental update | `LTHASH.sub(lthash(account)); LTHASH.add(lthash(account'))` |
| bank hash | the Accounts Lattice Hash is mixed in, **instead of** the Epoch Accounts Hash, every block |
| inclusion proofs | *"The Accounts Lattice Hash does **NOT** support inclusion/exclusion proofs."* |
| consumer access | *"written to the snapshot, and read out at boot time … recommended for nodes to verify"* |

### From SIMD-0220

Status `Activated`. **The Snapshot Hash for slot `S` is the 32-byte blake3 of the Accounts Lattice
Hash at slot `S`.** The merkle-based hash of all accounts is retired as redundant.

A published Snapshot Hash is therefore a commitment to total account state that is **recomputable in
principle**.

> **Qualified after reading 013 Addendum 2** (`cc/recorder-brief`, not merged here — I had only read
> Addendum 1 when this section was drafted). *In principle* is carrying real weight: recomputing it
> means unpacking a snapshot and hashing **every** account, which is what a node does when it boots.
> So the recomputation is available to validators, not to a challenger with an RPC. See §5, which
> this changes substantially.

### Measured here, on mainnet, 2026-08-17

```bash
# 1. The bank hash is NOT reachable from RPC. getBlock returns the PoH blockhash only.
curl -s -X POST https://api.mainnet-beta.solana.com -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getBlock","params":[439751248,
      {"encoding":"json","transactionDetails":"none","rewards":false,"maxSupportedTransactionVersion":0}]}'
# -> {"blockHeight":…,"blockTime":…,"blockhash":"GVQE7HNj…","parentSlot":…,"previousBlockhash":"BNodcPQy…"}
#    No bankHash. No accountsHash. No accountsLtHash.
```

```bash
# 2. getMultipleAccounts returns ONE context slot for N accounts — an atomic cross-account read.
curl -s -X POST https://api.mainnet-beta.solana.com -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getMultipleAccounts","params":[
      ["A2GDb4Um…","A4RuZpjf…","BJWkdfRi…"],{"encoding":"base64","commitment":"finalized"}]}'
# -> context: {"apiVersion":"4.2.0","slot":439751700}, 3 values
```

```bash
# 3. minContextSlot is honoured, and the refusal names the slot it did have.
# -> {"error":{"code":-32016,"message":"Minimum context slot has not been reached",
#              "data":{"contextSlot":439751700}}}
```

```bash
# 4. getProgramAccounts DOES accept withContext and returns a context slot.
#    dataSize=393 on jupnw4B6… -> 4 accounts, context slot 439752891, apiVersion 3.1.12
```

**Measurement 4 contradicts a load-bearing sentence in this repo**, and the repair inventory is
**not in this brief**. It is in [`018-evm-settlement.md`](./018-evm-settlement.md) §6, which built it
over three attempts and is the authority. Two things from there govern this task:

- **Thirteen sites, in three groups — 019 owns two of them.** (a) **seven false as written** (they
  assert the API returns no slot at all); (b) **three defensible but imprecise** (*"a source that can
  address a slot, which `getProgramAccounts` cannot"* — true if *address a slot* means query state at
  an exact past slot, which remains impossible; misleading if read as *returns no slot information*);
  (c) **three true and untouched by the measurement** — a graph composed from *separate* calls can
  describe a state that existed at no single slot, and a per-call context slot does not repair that.
- **⚠️ Nothing in group (c) may be edited.** Repairing it would delete a true statement while fixing
  a false one. The split matters more than the list.

**Do not re-derive the line numbers from this brief.** 018 §6 records that its first repair attempt
*"trusted 019's two citations and both line numbers were off"*, and this brief has since been rebased
onto a `main` that moved the Honest scope section again. 018 §6's enumeration was verified against
`main` and is the one to use.

The **conclusion** stands for a different and more general reason than the false one: a slot-tagged
scan is *consistent* but not provably **complete**, because a hostile endpoint can omit a row and
nothing in the response reveals it. 018 §6 further establishes that `eth_getLogs` has the same
property, so **both VMs sit behind the same wall** and slice 3 has no sourcing advantage to claim.

Measurement 4 also produced an accidental finding: the same public endpoint answered with
`apiVersion` **4.2.0** and **3.1.12** within thirty seconds. "One endpoint" is already a load-balanced
fleet of heterogeneous nodes. That is free diversity we cannot attribute and must not count.

### What I did not verify, and am therefore not building on

- That a vote transaction's `hash` field is the bank hash of the voted slot, and that it is decodable
  from `TowerSync` instruction data at usable cost. **Measurement 1** — now serves only §5's H2, which
  §5 retracts, so its priority has dropped.
- Current mainnet full-snapshot size and account count. **Measurement 2** — same demotion.
- `yorecoprocessor.com`, still unverified from 013 (TLS certificate belongs to an unrelated domain).
  **Measurement 3**, and it is the one that still matters: if real, it answers the historical-state
  question from outside this repo entirely.

---

## 2. The wall, restated correctly

013 asked one question. There are three, and they have different answers:

| # | question | who needs it | answer |
| --- | --- | --- | --- |
| i | can a challenger determine what account A held at slot S? | a would-be challenger, before bonding | **this brief** |
| ii | do two honest challengers agree on it? | the optimistic assumption | **this brief** |
| iii | can `settle` verify it inside a transaction? | on-chain settlement against history | inclusion proofs → the recorder → **not urgent, nothing settles this way yet** |

`README.md` §Honest scope item 2 already says settlement here is optimistic: *a false claim nobody
disputes settles.* The standard an optimistic market actually needs is (i) and (ii) — **checkable
before bonding**, not provable inside `settle`. 013's Addendum reached the same conclusion from the
other direction and named it Slice A. This brief is its design.

---

## 3. The fork that 013 did not see

The historical-state wall exists **because claims point backwards**. That is a property of how we
have been building claims, not a law.

| | **A-live** — co-observation at the head | **A-hist** — snapshot + lattice hash |
| --- | --- | --- |
| what it anchors on | N independent endpoints agreeing at a pinned slot | total account state, recomputable to a 32-byte published value |
| trust residual | a colluding majority of chosen endpoints | none for (i)/(ii); needs full state |
| claims it serves | forward-looking: "is X sound now / at epoch N+1" | retroactive: "was X sound at slot S in the past" |
| cost | days; no new infrastructure | **a node boot** — see §5; not a challenger-scale operation |
| blocked on | nothing | **measured largely dead for this use** (013 Addendum 2) |

The keeper already accumulates forward — Vesper's liveness evidence is *account `updatedTs` sampled
over time*, which is a history this project **built** rather than reconstructed. A-live generalises
that: an observer that samples at the head and commits each observation is a recorder that needs no
program, at the cost of only knowing what it was running to see.

**Recommendation: A-live first, and A-hist deferred behind its measurements.** Not because A-hist is
wrong — it is the eventual answer — but because a forward-looking solvency market is a *market*,
while a retroactive one is a post-mortem, and post-mortems have no counterparty.

---

## 4. Slice A-live — the design

### 4.1 What an observation becomes

Today a claim carries `observed.quantities` and the claim-type trusts them
(`claimtypes/solvency.mjs:35-57` parses them; nothing sources them). A-live inserts one layer beneath:

```jsonc
"observed": {
  "source": {
    "kind": "co-observed-accounts",
    "chain": "solana:mainnet",
    "accounts": ["…", "…"],          // read together, never one at a time
    "min_context_slot": 439751700,   // pinned BEFORE the reads, not reported after
    "max_slot_spread": 32,           // refusal threshold, declared in the market definition
    "endpoints": ["…", "…", "…"],    // committed; identity is part of the claim
    "observations": [                // one per endpoint
      { "endpoint_id": 0, "context_slot": 439751700, "digest": "…" }
    ]
  },
  "quantities": { … }                // derived from the agreed read, not supplied
}
```

Four properties, each of which is a refusal rather than a fallback:

1. **One read, many accounts.** `getMultipleAccounts` yields a single context slot for the whole set
   (measured, §1). Reading backing and liability accounts in separate calls is what makes a solvency
   number unfalsifiable; one call makes the whole set atomic at a named slot.
2. **The slot is pinned before the read, not reported after.** `minContextSlot` is set from the
   market definition. An endpoint behind that slot **errors** (`-32016`) instead of silently serving
   stale state, and its error carries the slot it did have — so lag is evidence, not a mystery.
3. **N endpoints, and disagreement is a stop signal.** Every endpoint answers the same pinned read.
   Byte-identical account data across all of them, within `max_slot_spread`, or the observation is
   **refused**. There is no majority vote and no "best" endpoint: this repo's existing discipline is
   that a descriptor which rebuilds differently tells the challenger not to bond (`README.md:467-468`),
   and this is the same rule one layer down.
4. **The endpoint set is committed in the claim.** A claim that names its endpoints can be re-run
   against them by anyone. A claim that does not is an opaque observation list, which is the thing
   `vrdct check` exists to abolish.

### 4.2 What it raises, honestly, per claim-type

| claim-type | today | under A-live | residual |
| --- | --- | --- | --- |
| `reserve-solvency` | unsourced | **sourced** — quantities derived from a pinned atomic multi-account read | colluding endpoint set |
| `restaking-robustness` | `settlement_grade: NO` | **improved, not closed** — gPA pinned to a slot and agreed across N endpoints | *completeness*: a hostile endpoint can omit a row and the response cannot reveal it. Only a snapshot closes this. |
| `closed-market-liquidation-soundness` | already sourced by rebuild | unchanged | RPC signature retention |
| `obligated-liveness` | one-sided-safe already | unchanged | omission, which only makes a verdict harsher |
| `monday-open-gap` | unsourced | **unchanged — A-live does not fix it** | needs a price *decoder*, not a better read. See §4.3. |

**Do not let the table read as four wins.** A-live fully sources exactly one type. It materially
improves a second. It leaves two untouched and one already-solved.

### 4.3 Why `monday-open-gap` is out of scope here

Its gap is not observation quality. `README.md:483-488` is right: selection removes choice *within* a
pinned set, and only a rebuild closes omission — and rebuilding here must **decode prices from the
account**, which is account-layout-specific. A-live gives a better-authenticated read of bytes nobody
has taught the engine to interpret. The decoder is separate work and should get its own brief.

### 4.4 The trust residual, stated for the Honest scope section

> A co-observed claim is sourced against **a committed set of endpoints**, not against consensus. Its
> failure mode is that every named endpoint is wrong or colluding in the same way at the same pinned
> slot, which is detectable by anyone who adds an endpoint the claim did not name and re-runs it. It
> is strictly stronger than a supplied quantity and strictly weaker than a snapshot verified against
> the accounts lattice hash. A market whose size warrants the stronger anchor should wait for A-hist.

Any change to what is trusted must land in `README.md` §Honest scope in the same commit. This
paragraph is the intended text.

---

## 5. Slice A-hist — **retracted as a challenger-facing route**

This section originally proposed A-hist as "the eventual answer, deferred behind its measurements."
**013 Addendum 2 had already measured it, and it does not hold.** I had read only Addendum 1 when
drafting. The measurement, from that brief:

1. **Validator-scale, not challenger-scale.** A snapshot holds *every* account; verifying it means
   unpacking and recomputing the lattice hash across all of them — a node boot, not something a
   would-be challenger does with an RPC before deciding whether to bond.
2. **Snapshot-slot granularity**, not the slot a claim's window happens to name.
3. **It does not reach back.** Public snapshots are recent — a validator typically boots from one
   within the past 24 hours. *"So this does nothing for a window last week, which is the case every
   claim in this repo actually has."*

**Point 3 is decisive on its own,** and it kills H1 below as a route to *checkable before bonding*.

The chain, kept for the record with its status corrected:

- **H1 — cross-operator Snapshot Hash agreement.** ❌ **Dead for this purpose.** The thing it would
  check against does not exist for the windows our claims cover, and where it does exist, checking it
  is a node boot. What survives is smaller and real: snapshots are now self-verifying, so *someone
  else's* archive has a sound basis. That makes an archive trustworthy-in-principle. **It does not
  make it trustless to you, and this repo's position is the difference between those.**
- **H2 — chain to the bank hash.** Same wall, plus measurement 1. Not rescued by being more rigorous.
- **H3 — inclusion proofs inside `settle`.** The recorder, 013 Slice B. Still the only thing that
  provides a succinct inclusion proof, and now also the only thing that provides one *cheaply enough
  to use*. Per 013's own revision its reach is one-third of what that brief first claimed: it answers
  `reserve-solvency`, **whose reserve addresses can be named in the terms** — not the Jito adapter
  (membership ≠ completeness) and not `monday-open-gap`.

### What this does to A-live: it strengthens it, and it confirms F-1

If snapshots cannot serve a challenger for a past window, then **moving claims to the head is not a
shortcut — it is the only route that leaves a challenger able to check at all.** A-live is no longer
"the cheap one first"; it is the one that exists.

013 Addendum 2 also states F-1's problem independently, from the recorder's side:

> *"The wall stands for a challenger with an RPC, which is the only party whose ability to check makes
> a market a market rather than a coin flip."*

That is exactly §4's open question — a challenger arriving after slot `S` cannot read slot `S`. Two
briefs reached it from opposite directions. **It is the central unresolved question of this task, and
neither snapshots nor the recorder rescues it on the timescale a bonding decision happens.**

---

## 6. The finding that changes which claim-type leads the board

Not strictly Slice A, but it falls out of the same audit and the board plan depends on it.

`docs/tasks/005-subject-set.md` §4 establishes, measured, that **CMLS cannot currently print a sound
verdict**:

- §4a — GREEN is unreachable by construction (`claimtypes/closed-market-soundness.mjs:56-58`); the best
  sound verdict is YELLOW.
- §4b — a genuinely guarded feed is **silent** across a closure, which is the empty input set, which
  `onchain/…/lib.rs:158` rejects with `NoRecords`. CMLS cannot express its own strongest sound case,
  and the unhandled throw at `keeper/lib.mjs:141` takes the keeper down twice a week on schedule.
- §4c — half-day sessions are counted CLOSED, so a correctly-guarded venue earns a **false public RED
  on 2026-11-27**, a date already compiled into the calendar.
- §4d — no market-hours-guarded feed could be sourced at all on a public endpoint.

And three of the four known subjects **cannot be named**, because mapping a Chainlink Data Streams feed
id to a ticker needs an off-chain registry, and naming an asset next to a bonded RED on a guess is the
failure mode 005 §2 correctly calls a libel machine.

So CMLS's subject inventory is one nameable account, one reachable direction, and a scheduled
false-accusation bug. **A board led by CMLS is a board that can only print RED.**

`reserve-solvency` has the opposite shape: three reachable verdicts, already wired on-chain
(`CT_SOLVENCY = 2`), subjects that publish their own backing and liability so there is no label to
guess, and one gap — sourcing — which is precisely what A-live closes.

**Recommendation: the standing board leads with `reserve-solvency`. CMLS becomes a second row and must
not be run unattended until §4b and §4c are fixed.** That is a separate brief; §4c is a consensus
change (parity vectors regenerate, corpus window is unaffected) and belongs to Codex.

---

## 7. Acceptance criteria for Slice A-live

1. A `sources/co-observed.mjs` module that takes `{accounts, minContextSlot, maxSlotSpread, endpoints}`
   and returns either the agreed read or a **refusal naming which endpoint diverged and how**.
2. `canonicalInputs` for `reserve-solvency` accepts the `source` descriptor and **rejects a claim whose
   quantities are supplied without one** — the existing supplied-quantity path becomes a legacy shape
   that must be explicitly opted into, or it is not sourcing, it is an option.
3. The descriptor is a **closed** object on the same terms as `monday-open-gap`'s: a key nothing parses
   is rejected, not ignored (`README.md:110-114` — this has bitten twice).
4. `vrdct check` re-runs a co-observed claim against its committed endpoints and reproduces the
   quantities, or refuses.
5. A test that a claim whose endpoints disagree **cannot be built**, and a test that a hand-authored
   `source` with an extra key is rejected.
6. `README.md` §Honest scope carries §4.4's paragraph, and the repair from **018 §6 groups (a) and
   (b)** lands in the same commit — (a) retracted, (b) given the exact-historical-slot distinction.
   **Group (c) is left untouched**, and the commit message says so, so a later reader does not read
   the omission as an oversight.
7. No change to `core/` — this is a new module plus one claim-type's `canonicalInputs`. If `core/`
   needs editing, the design is wrong.

## 8. Out of scope

- The recorder (013 Slice B), inclusion proofs, and anything inside `settle`.
- A-hist and all three of its measurements.
- The `monday-open-gap` price decoder.
- Wiring types 3–5 to `encode.mjs` and the Rust twins.
- CMLS §4b/§4c fixes — named here, owned elsewhere.
- Mainnet. Devnet and offline only, as today.

## 9. Open measurements, in the order they should be taken

1. **Is a vote transaction's `hash` the bank hash, and what does decoding `TowerSync` cost?** Gates H2.
2. **Full-snapshot size and account count on mainnet today.** Gates the A-hist bootstrap estimate.
3. **`yorecoprocessor.com`** — real, live product or not. Still unverified since 013. If real, it
   answers the historical-state question from outside and §5's retraction becomes moot.

None of the three gates Slice A-live. Measurements 1 and 2 now serve only H2/H3, which §5 retracted
or deferred, so their priority has **dropped**. What has risen in their place is one question that is
not a measurement:

> **F-1 — can a challenger who arrives after slot `S` check a claim pinned at `S` at all?**
> §5 establishes that neither snapshots nor the recorder answers this on a bonding timescale.
> If the answer is "only for slowly-moving quantities", then A-live is sound for `reserve-solvency`
> and unsound as a general anchor, and §4.4 must say which. **This is the task's gate, and it is a
> design question, not a measurement.**

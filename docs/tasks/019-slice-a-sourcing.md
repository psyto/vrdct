# 019 — Slice A: sourcing a claim's inputs without a recorder

**Frame:** thin (what the anchor is, which claim-types it raises, what it refuses to promise) → CC writes, Codex reviews.
**Status:** design. Nothing is implemented.
**Predecessor:** [`013-recorder.md`](./013-recorder.md) and its Addendum, which live in the `vrdct-recorder`
worktree and have **not** been merged here. This brief assumes that Addendum and re-verifies its premise.

> **Numbering.** 016 and 017 exist as review/evidence directories in other worktrees but hold no task
> brief; 012, 013 and 015 hold briefs that never landed on this `main`. 019 is free in every worktree
> checked on 2026-08-17. See `AGENTS.md` on why this paragraph exists.

---

## 0. Why this brief, and the one sentence that motivates it

`README.md` §Honest scope names `reserve-solvency` as *"still genuinely in the unsourced case"*, and
`adapters/jito-restaking.mjs:426` stamps its output `settlement_grade: NO`. Both statements rest on
one premise: **you cannot ask Solana what an account held at a past slot.**

013's Addendum found that premise out of date and split the wall in two. This brief designs the half
that is available today, and it arrives at a smaller answer than 013 contemplated — plus one finding
that changes which claim-type should lead the board.

---

## 1. The premise, verified rather than remembered

013's Addendum opens by admitting its body was written from memory and was wrong. That is the exact
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

This is more useful to us than 013 realised. It means a published Snapshot Hash *is* a commitment to
total account state that **anybody can recompute**. N-of-M attestation over such a value is no longer
a trust ceremony — it is a reproducibility check, which is this repo's whole thesis applied one layer
down.

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

**Measurement 4 contradicts a load-bearing sentence in this repo.** `README.md:493-502` and
`adapters/jito-restaking.mjs:426` both justify `settlement_grade: NO` with *"`getProgramAccounts`
takes no slot"*. It takes `withContext` and `minContextSlot`, and it returned both. The **conclusion**
may still stand — a slot-tagged scan is consistent, not provably *complete*, because a hostile
endpoint can omit a row and nothing in the response reveals it — but the **stated reason is wrong**,
and a wrong reason in the Honest scope section is a defect under this repo's own rules.

Measurement 4 also produced an accidental finding: the same public endpoint answered with
`apiVersion` **4.2.0** and **3.1.12** within thirty seconds. "One endpoint" is already a load-balanced
fleet of heterogeneous nodes. That is free diversity we cannot attribute and must not count.

### What I did not verify, and am therefore not building on

- That a vote transaction's `hash` field is the bank hash of the voted slot, and that it is decodable
  from `TowerSync` instruction data at usable cost. Design §5 depends on this; **it is measurement 1**.
- Current mainnet full-snapshot size and account count. Every cost figure in §5 is therefore a shape,
  not a number. **Measurement 2.**
- `yorecoprocessor.com`, still unverified from 013 (TLS certificate belongs to an unrelated domain).
  **Measurement 3**, and it can invalidate §5 entirely if real.

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
| cost | days; no new infrastructure | one full-state pass to bootstrap, then incremental |
| blocked on | nothing | measurements 1–3 |

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
   that a descriptor which rebuilds differently tells the challenger not to bond (`README.md:456-458`),
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

Its gap is not observation quality. `README.md:473-478` is right: selection removes choice *within* a
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

## 5. Slice A-hist — the design, for when it is needed

Recorded now so the decision is available, **not** to be built in this task.

The authentication chain, weakest to strongest:

- **H1 — cross-operator Snapshot Hash agreement.** Download a full snapshot, compute the lattice hash
  over all accounts, blake3 it, compare against the Snapshot Hash other operators publish for the same
  slot. Since SIMD-0220 that value is recomputable by anyone, so an attester who lies is caught by the
  next person who checks. Requires one full-state pass; **no consensus reasoning**.
- **H2 — chain to the bank hash.** Combine the computed lattice hash with the block's other bank-hash
  inputs, reproduce the bank hash, and compare it against the hash validators voted on — recoverable
  from vote transactions, which are themselves on-chain and stake-weightable. Fully trustless and
  entirely a re-execution argument. **Blocked on measurement 1.**
- **H3 — inclusion proofs inside `settle`.** The recorder, i.e. 013 Slice B. Only binding once
  something settles on chain against historical state. Nothing does.

The homomorphic property is what makes any of this affordable: verify once at slot `S₀`, then maintain
by `sub(old); add(new)` over only the accounts each block touches. The expensive part is the bootstrap,
and it is paid once. **This makes A-hist a service, not a batch job** — which is a different commitment
than it appears, and is the real reason it should not start until measurements 1–3 are in.

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
6. `README.md` §Honest scope carries §4.4's paragraph, and the false *"getProgramAccounts takes no
   slot"* reason from §1 measurement 4 is corrected in the same commit.
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
3. **`yorecoprocessor.com`** — real, live product or not. If real, §5 may be answered by someone else.

None of the three gates Slice A-live. That is the argument for doing A-live first.

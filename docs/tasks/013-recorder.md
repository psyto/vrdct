# 013 — the recorder: a design brief, not a build

> **Renumbered from 012.** Another window was already using 012 for `dividend-funding-fidelity`, six
> commits and a Codex review ahead of this one. Two windows numbering tasks from the same sequence
> against one shared repo is the same class of problem as two windows sharing one working tree — see
> `AGENTS.md`.

**Frame:** thin (what the wall is, what would clear it, and what it would cost) → CC writes, Codex reviews.
**Status:** decision material. Nothing is implemented.
> **Read the Addendum first.** The body below rests on *"Solana has no historical state root"*, which
> I took from memory and did not check. It is **out of date** — SIMD-0215 is activated. The Addendum
> establishes what that changes and what it does not. The body is left standing because the premise it
> assumed is the thing worth seeing.

## The wall, from three places that hit it independently

This repo now has five claim-types and one adapter. Three separate pieces of work arrived at the same
sentence from different directions:

| where | what stopped |
| --- | --- |
| `reserve-solvency` | README, honest scope: *"still genuinely in the unsourced case; closing it means an on-chain recorder root, or N-of-M attestation for historical data."* |
| Jito adapter (task 010) | `getProgramAccounts` takes no slot. Two reads establish endpoint equality only, and the claim carries `settlement_grade: NO`. |
| `monday-open-gap` (task 011) | The price the venue used at an instant was never stored — it is computed at read time from four other accounts, whose state at that instant is equally unavailable. |

One wall: **you cannot ask Solana what an account held at a past slot.** *(As written: "no historical
state root, no light client, no DA anchor." The first of those is no longer true — see the Addendum.
There is now a per-block commitment to total account state; what it does not give is an inclusion
proof.)* Every claim-type in this repo is settlement-grade over its *inputs*; what is not
settlement-grade is the claim that those inputs were the real chain state.

## What a recorder is, and the one property that makes it worth anything

A permissionless program that, at slot `S`, appends a leaf `(S, account, sha256(account.data))` to an
append-only structure whose root lives on chain. Later, anyone proves *"account A held bytes B at
slot S"* against that root.

The property that matters, and it is the whole design:

> **The program hashes the bytes the runtime hands it.** A Solana instruction that takes the target
> account as an input is given the *real* account at that slot — the runtime guarantees it. So the
> recorder does not trust the submitter, does not verify a signature, and has no notion of an
> attester. Anyone may crank it, including an adversary, and the leaf is still the truth.

That is a materially stronger trust model than N-of-M attestation, which is the alternative named in
the README. Attestation needs you to believe M signers. This needs you to believe the runtime, which
you already do — it is what `verify` re-executes against.

Storage is a concurrent merkle tree (account compression): the on-chain cost is a root update, and
the leaves live in the ledger.

## The limit that has to be stated first, not last

**A recorder commits the present. It cannot make the past verifiable.**

Nothing here recovers a window that has already passed. Every surface it upgrades becomes
settlement-grade only for windows *after* the recorder was running, over accounts *somebody thought
to record*. If that is not worth it, the honest answer is not to build it — and that is precisely the
decision this brief exists to make possible, rather than to pre-empt.

Two more limits, in the same spirit:

- **It records accounts, not conclusions.** For `monday-open-gap`, recording Jupiter Lend's oracle
  account is useless — no price is in it (task 011, Addendum 3). You would have to record the four
  *source* accounts and re-evaluate the venue's source chain. That is re-execution, which is what this
  repo does; but it makes a verdict depend on the venue's oracle program not changing its arithmetic,
  and that dependency would have to be pinned and stated like any other.
- **It has to be cranked, and nobody is obliged to.** Gaps are guaranteed. Which is the interesting
  part — see below.

## What it would actually upgrade

- **`reserve-solvency`** — the simplest and the first consumer. A solvency claim is a snapshot of
  balances; with recorded leaves the snapshot stops being asserted and becomes provable. This is the
  slice to build first if anything is built.
- **`restaking-robustness` / the Jito adapter** — replaces "two reads with equal endpoints, not
  settlement-grade" with a proof that each account held those bytes at a slot. The graph stops being
  an observation.
- **`closed-market-liquidation-soundness`** — already sourced via signature history, so it gains
  little; its bound is RPC retention, which a recorder would also relieve.
- **`monday-open-gap`** — only via the caveat above, and it is the weakest case.

## The composition worth noticing

The recorder's own liveness is exactly what **`obligated-liveness`** (claim-type #4) adjudicates. A
recorder that declares a schedule, misses slots, and blames the network is the type's motivating
example — it was written because a Vesper keeper slept through a session. So the recorder does not
need a trusted operator SLA: it can be held to its schedule by a claim in the same engine, with the
excusable-miss budget and the `x < 1/2` boundary already implemented.

That is the first time two surfaces in this repo compose rather than merely coexist, and it is an
argument for the recorder that has nothing to do with the wall.

## What would have to be measured before building, not asserted

I have not measured any of this, and the brief should not pretend otherwise:

1. **Cost per leaf.** Compute units to hash an account of size N, accounts per transaction, and the
   lamports cost of a root update at realistic cadence. A recorder that costs more than the markets
   it enables is not a recorder.
2. **Which accounts, and who chooses.** A recorder that records everything is impossible; one that
   records a declared set has a governance question at its centre — and this repo's answer to
   governance questions has so far been "declare it in the terms and let it be contested".
3. **Proof size and on-chain verification cost**, since `vrdct-bond` would have to verify a proof
   inside `settle` for any of this to reach settlement.
4. **Whether an existing recorder already does this.** I have not looked. Building one that exists
   would be the most expensive kind of mistake available here.

## The decision

Not "is the design right" — it is a small design and it is probably right. The question is:

> **Is a surface that becomes settlement-grade only for future windows, over a declared account set,
> worth a build of this size — when the demand signal for any verdict at all is still zero?**

The repo's own recorded feedback says the binding constraint is demand, not feasibility. A recorder
is a feasibility answer to a feasibility problem, and it is the third time in this session that the
most technically interesting path has been one nobody has asked for. That should be said plainly next
to the design, not discovered after it is built.

If the answer is yes, the first slice is `reserve-solvency` and the measurements above come before
any code. If the answer is no, the honest outcome is that this repo's claim-types are settlement-grade
over their inputs and their sources are not, that this is written down in four places, and that the
next move is on the demand side rather than this one.

---

## Addendum — measurement 4 first, and it moved the premise

The brief said four things had to be measured before any code, and that the cheapest and most
decisive was *"whether an existing recorder already does this — building one that exists would be the
most expensive kind of mistake available here."* Doing that one first changed the brief's own premise.

### Solana now has a per-block state commitment, and it is activated

[SIMD-0215, Accounts Lattice Hash](https://github.com/solana-foundation/solana-improvement-documents/blob/main/proposals/0215-accounts-lattice-hash.md)
— status **Activated**, feature `LTHasHQX6661DaDD4S6A2TFi6QBuiwXKv66fB1obfHq`. Every block's bank hash
now mixes in a hash over the **total** account state, updated incrementally: the new total is the
prior total plus the accounts modified in that block.

So the flat claim this repo has been repeating — *"no historical state root"* — is out of date, and I
had been repeating it from memory rather than checking. That is the same error this session kept
finding in my work, applied to a premise rather than to a program.

### But it does not do the thing a recorder would do

The specification is explicit: **the Accounts Lattice Hash does not support inclusion or exclusion
proofs.** It is a homomorphic sum, not a Merkle tree — which is exactly what makes it cheap to update
incrementally, and exactly what makes "prove account A held bytes B at slot S" impossible from it
alone. Verifying a particular account means recomputing over the whole account set.

That splits the wall in two, and the two halves have different answers:

| | what is needed | status |
| --- | --- | --- |
| **Off-chain check, before bonding** — `vrdct check`, `verify`, a would-be challenger | recompute a snapshot and confirm it against the lattice hash | **available today**, and it is a re-execution argument, which is this repo's whole thesis |
| **On-chain settlement** — a proof `vrdct-bond` can verify inside `settle` | a succinct inclusion proof | **not available**; the lattice hash explicitly cannot, and this is the recorder's actual and only unique contribution |

### What that changes

The recorder is **narrower and better justified** than the brief argued, and also less urgent:

- Its value is no longer "make history verifiable at all". History is verifiable off-chain now, by
  anyone willing to verify a canonical snapshot. Its value is *succinct inclusion proofs for on-chain
  settlement*, which is a real gap and a much smaller claim.
- Consequently `reserve-solvency`, the Jito adapter and any would-be challenger can be raised from
  "unsourced" toward "checkable before bonding" **without building anything on chain** — by verifying
  against a canonical snapshot. That is a smaller, cheaper, and more useful next slice than the
  recorder, and it did not exist as an option when the brief was written.
- The recorder only becomes the binding constraint at the moment a market actually settles on chain
  against historical state. Nothing does yet.

### One thing I could not verify, and am therefore not citing

A search result named a "verifiable historical-state coprocessor for Solana" at `yorecoprocessor.com`.
Fetching it failed TLS validation — the certificate presented belongs to an unrelated domain — so I
have no evidence it is a real, live product and am recording it as **unverified** rather than as a
finding. It should be checked before any build starts, because if something like it is real, that is
measurement 4 answered in the other direction.

### The decision, restated

Not "build the recorder" versus "do nothing". It is now:

> **Slice A** — verify claims against a canonical snapshot confirmed by the accounts lattice hash.
> Off-chain, no program, raises existing surfaces from *unsourced* to *checkable before bonding*.
>
> **Slice B** — the recorder, for succinct inclusion proofs inside `settle`. Only binding once
> something settles on chain against historical state.

A is smaller than anything the brief contemplated and does more for the surfaces that already exist.
B is still the eventual answer and is not urgent. Neither changes the observation the brief ended on:
the demand signal is still zero, and this is still a feasibility answer.

---

## Addendum 2 — "available today" was overstated, and Slice A is largely illusory

I wrote in Addendum 1 that off-chain checking is *"available today, by anyone willing to verify a
canonical snapshot"*, and proposed Slice A on that basis. I then measured what that sentence costs,
and it does not hold. Third correction in this document, and the same shape as the first two: a
sentence written from a plausible inference rather than from a measured fact.

What verifying against the lattice hash actually involves
([SIMD-0220](https://github.com/solana-foundation/solana-improvement-documents/blob/main/proposals/0220-snapshots-use-accounts-lattice-hash.md),
[snapshot verification](https://docs.anza.xyz/implemented-proposals/snapshot-verification)):

1. **It is validator-scale, not challenger-scale.** A snapshot holds *every* account; verification
   means unpacking it and recomputing the lattice hash across all of them. That is what a node does
   when it boots. It is not something a would-be challenger does with an RPC before deciding whether
   to bond, which was the entire use I claimed for it.
2. **It is snapshot-slot granularity, not arbitrary slots.** State is verifiable at the slots
   snapshots were taken at — a full-snapshot interval, not the slot a claim's window happens to name.
3. **And it does not reach back.** Public snapshots are recent — a validator boots from one *usually
   within the past 24 hours*. So this does nothing for a window last week, which is the case every
   claim in this repo actually has.

Point 3 is decisive on its own. Slice A was supposed to raise `reserve-solvency` and the Jito adapter
from *unsourced* to *checkable before bonding*. It cannot: the thing it would check against does not
exist for the windows those claims cover, and where it does exist, checking it is a node-boot rather
than a check.

### So the conclusion reverts, and the reason it reverted is worth more than the conclusion

- **The wall stands** for a challenger with an RPC, which is the only party whose ability to check
  makes a market a market rather than a coin flip.
- **The recorder is the answer again** — Slice B, not A — and for the reason Addendum 1 narrowed it
  to: a succinct inclusion proof is the thing nothing else provides, and now it is also the thing
  nothing else provides *cheaply enough to use*.
- **What genuinely changed** is smaller than Addendum 1 said and still real: snapshots are now
  self-verifying, so an archival service that re-executes and checks against the lattice hash has a
  sound basis. That makes *someone else's* archive trustworthy-in-principle. It does not make it
  trustless to you, and this repo's whole position is the difference between those.

### Standing state of this brief

The design in the body is unchanged and still small. Its premise was wrong in one clause (there is a
per-block state commitment), the correction to that premise was itself overstated (it does not help
in practice), and the net effect on what to build is: **nothing changed**. The recorder is the answer,
it is not urgent, and the demand observation the brief ends on is untouched.

The measurements still owed before any code are 1, 2 and 3 from the body — cost per leaf, which
accounts and who chooses, and proof verification cost inside `settle` — plus finishing 4 properly by
checking whether the unverified coprocessor is real.

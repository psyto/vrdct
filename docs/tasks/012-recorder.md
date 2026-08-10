# 012 — the recorder: a design brief, not a build

**Frame:** thin (what the wall is, what would clear it, and what it would cost) → CC writes, Codex reviews.
**Status:** decision material. Nothing is implemented, and nothing should be until the question at the
end is answered.

## The wall, from three places that hit it independently

This repo now has five claim-types and one adapter. Three separate pieces of work arrived at the same
sentence from different directions:

| where | what stopped |
| --- | --- |
| `reserve-solvency` | README, honest scope: *"still genuinely in the unsourced case; closing it means an on-chain recorder root, or N-of-M attestation for historical data."* |
| Jito adapter (task 010) | `getProgramAccounts` takes no slot. Two reads establish endpoint equality only, and the claim carries `settlement_grade: NO`. |
| `monday-open-gap` (task 011) | The price the venue used at an instant was never stored — it is computed at read time from four other accounts, whose state at that instant is equally unavailable. |

One wall: **you cannot ask Solana what an account held at a past slot.** No historical state root, no
light client, no DA anchor. Every claim-type in this repo is settlement-grade over its *inputs*; what
is not settlement-grade is the claim that those inputs were the real chain state.

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

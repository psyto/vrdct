# 018 — settle the same corpus on a second VM

**Frame:** the brief is thin (what "the same verdict" is allowed to mean across two VMs) → CC.
The implementation is thick (a specified state machine ported to another VM) → Codex implements,
CC reviews.
**Branch:** `cc/evm-settlement`

## What this is not

It is not "deploy Vrdct on an EVM chain." A second deployment of the same idea proves nothing that
`solana-test-validator -r` did not already prove, and 08-12 is the record of how easily a second
green thing gets read as a second true thing.

It is also not a demo built to be legible to an audience. One framing in particular is **excluded on
purpose**: the two markets below must not be dressed as *institutional bilateral agreements*.
Bilateral means named counterparties bound by a legal agreement — a trust anchor — and this
resolver is only worth anything where no trust anchor exists. Wrapping it in legal certainty deletes
the property it is built on. The contested positions here are anonymous and permissionless, or they
are not this repo's subject.

## What it is

**The published corpus, at its published `inputs_hash` (`2f224c44f93a8e2c…`), settles to the same
verdict on a second virtual machine — and the equality is machine-checked, not asserted.**

Today there are two implementations of the re-execution: the JS claim-types and the Rust twins in
`onchain/programs/vrdct-bond/src/reexec/`, held equal by a committed parity fixture. This task adds
a third and holds all three to the same fixture. The interesting artifact is not the third
implementation. It is that a disagreement between two unrelated VMs becomes a **test failure** in
this repo.

That is also the first physical instance of the cross-VM claim this repo has only ever made in prose.

## Scope: two markets, zero new claim-types

The two claim-types that already have Rust twins and already settled on devnet on 08-12:

| Market | Claim-type | What is contested |
|---|---|---|
| A | `closed-market-liquidation-soundness` | a collateralised position's liquidation is sound / a close-out crossed a boundary it should not have |
| B | `reserve-solvency` | reserves cover liabilities at a pinned point |

No new claim-type. No new arithmetic. If this task finds itself writing a claim-type, it has gone
wrong — the arithmetic is the part already reviewed, and re-opening it hides the port's own bugs
inside claim-type churn.

`monday-open-gap`, `obligated-liveness`, `restaking-robustness` stay out: they have no Rust twin and
no `CLAIM_TYPE_ID`, so they are not part of the consensus surface yet.

## The port, decision by decision

### 1. sha256, not keccak

The input hash chain stays sha256, via precompile `0x02`. Keccak is cheaper and it is the wrong
answer: the corpus hash is **published**, and a chain that recomputes it differently is a different
system wearing the same name. Gas is the price of being the same system. Measure it; do not trade it.

### 2. The market's address must be computed, never supplied

On Solana the market is a PDA seeded by `definition_hash`, so a market cannot exist at an address
that disagrees with its own definition. On EVM the natural translation is
`mapping(bytes32 => Market)`, and the natural bug is accepting `definitionHash` as an argument.

**The key must be derived from the definition fields, never trusted as supplied.**
`market_definition_hash` (`lib.rs:41`) and `header_digest` (`lib.rs:30`) both need Solidity twins
with the same field order and the same widths.

> **Correction (added after slice 1 review).** This section first said the contract must *compute*
> the key and never accept one, and called accepting a hash "accepting an answer". That is stricter
> than the Solana original and would have been implemented as a divergence from it. `open_market`
> **accepts** `definition_hash` as an argument and `require!`s it equals the recomputed value
> (`lib.rs:165-179`) — equivalent safety, different shape. Slice 2 preserves require-equality.
> Recomputing and comparing is the invariant; who supplies the bytes is not.

### 3. Feeds, chunking, and the bound that must be measured

`open_feed` / `feed(chunk)` / `close_feed` / `settle` carry over as-is, including the property worth
keeping: **a feeder can only mutate its own feed**, so a bad stream cannot poison a good one.

The chunk-size limit is a **gas measurement**, not a guess. Reference point: A re-executed 3,789
records in 19 transactions / 31.9s on Solana devnet.

Per the 008 approval note, the rule about what happens at the bound is not negotiable: **ingestion
rejects an over-domain input set, it never truncates it.** Dropping records changes the verdict, so a
silent cap is a verdict-forgery primitive.

### 4. What disappears, and what it was carrying

There is no rent on EVM, so `rent_payer` and `close_market` have nothing to return. Check what those
fields were *paying for* before deleting them — the cranker's 10% slash reward (`MarketSettled.
cranker_reward`, "there is no treasury address") must survive the port intact, because it is the only
thing that makes a stranger finish someone else's feed.

### 5. Time is now an operator's opinion

`Clock` → `block.timestamp`. `challenge_until` and `settle_by` semantics are unchanged, but on an L2
the timestamp is set by a sequencer. That is a new trusted input this system did not have on Solana,
and it belongs in **Honest scope** in the same commit that introduces it, not later.

### 6. `Source` — ~~the actual reason to do this~~ (premise falsified; see the correction)

> **Correction, 2026-08-17.** The paragraph below claimed the port's value came from a comparative
> advantage over Solana's RPC. That premise is **false**, and it was measured false from the Solana
> side, not the EVM side. Task 019 §1 measured on mainnet that `getProgramAccounts` **does** accept
> `withContext` and returns a context slot (439752891), and that `minContextSlot` is honoured and
> names the slot it had when it refuses. `minContextSlot` is a **lower bound on freshness, not an
> exact historical-slot query** — you cannot ask for slot S in the past — but "it does not take a
> slot" is wrong as written.
>
> **Repair inventory.** Built over three attempts, and the first two were wrong in instructive ways.
> v1 trusted 019's two citations and both line numbers were off. v2 greped, but only for the
> *"takes no slot"* phrasings, which silently missed every site that says *"a source that can
> address a slot, which `getProgramAccounts` cannot"* — and then compounded it by "correcting"
> `adapters/jito-restaking.mjs:426` as a bad citation when it is a real site. Thirteen sites, and
> they fall into **three** groups, not two:
>
> **(a) False as written** — these assert the API returns no slot at all. It returns a context slot.
> `README.md:248`, `:506`; `adapters/jito-restaking.mjs:56`, `:443`;
> `docs/tasks/010-jito-restaking-ingestion.md:111`, `:189`, `:202`.
>
> **(b) Defensible but imprecise** — *"settlement needs a source that can address a slot, which
> `getProgramAccounts` cannot"*. True if *address a slot* means **query state at an exact past
> slot**, which is still impossible; misleading if read as *returns no slot information*, which is
> now false. These need the distinction added, not a retraction.
> `README.md:264`; `adapters/jito-restaking.mjs:426`; `docs/tasks/010-jito-restaking-ingestion.md:286`.
>
> **(c) True and untouched by the measurement** — a graph composed from **separate** calls can
> describe a state that existed at no single slot. A per-call context slot does not repair that:
> five calls get five context slots. This is the original 010 F3.
> `README.md:253`; `docs/tasks/010-jito-restaking-ingestion.md:198`; `tests/jito-restaking.test.mjs:209`.
>
> 019 owns (a) and (b). **Nothing in (c) should be touched** — repairing it would delete a true
> statement while fixing a false one. Note that `docs/tasks/010` is an unretracted brief, so a later
> reader treats it as current framing; it is not exempt for being a task doc.
>
> `settlement_grade: NO` still stands, for a **different and more general** reason: a slot-tagged
> scan is *consistent* but not provably *complete*, because a hostile endpoint can omit a row and
> nothing in the response reveals it.
>
> That is the enumeration-completeness falsifier written below as an EVM-specific risk. It is not
> EVM-specific. `eth_getLogs` has the same property: a block range proves membership of what it
> returns, not that nothing else belongs. **Both VMs sit behind the same wall**, so the port has no
> sourcing advantage to claim and slice 3 must not be written as if it does.
>
> What survives untouched: slice 1's actual result — three implementations of the re-execution held
> to one committed fixture, so a cross-VM disagreement is a test failure in this repo. That never
> depended on `Source`.
>
> The hypothesis below was stated as a hypothesis with a falsifier, and gated behind a two-provider
> digest match before anything could be written into the README. That gate is what held; the
> original text is left standing rather than rewritten so the shape of the error stays visible.

`Source.kind = SOLANA_ACCOUNT_SIGNATURES` cannot be ported; EVM needs `kind = EVM_LOGS`
(`address`, `topic0`, `fromBlock`, `toBlock`). That part is unchanged.

~~And this is where the port earns its keep. The Jito adapter is stamped `settlement_grade: NO` for a
specific reason: `getProgramAccounts` does not take a slot, so two reads only show that an endpoint
answered twice the same way. **`eth_getLogs` takes a block range**, and a block number is a
commitment.~~

So state the hypothesis precisely, and state its falsifier:

> **Hypothesis.** ~~An `EVM_LOGS` source is reconstructible at a pinned block range by any party with
> an independent node, which is what `SOLANA_ACCOUNT_SIGNATURES` could not promise.~~
> Superseded: the second clause is false (019 §1), and the first is the same claim task 019 makes
> for Solana under the name **A-live** — N independent endpoints agreeing at a pinned point. Slice 3
> is the EVM instance of A-live, not a route around it.
>
> **What falsifies it.** Enumeration completeness. A log range proves *membership* of what it
> returns; it does not prove *nothing else belongs*. This is the same leaf-vs-enumeration wall that
> shrank task 013 from three walls to one. If reorgs, or a provider's own filtering, or a
> non-canonical block make two independent nodes return different sets for the same range, the
> hypothesis is dead and the honest output is `settlement_grade: NO` again — **not** a smaller claim
> that sounds like a win.

Do not write the README sentence about this until `vrdct check` has rebuilt a market from an
`EVM_LOGS` descriptor against **two independent providers** and the digests matched. 08-12's lesson
in one line: *a success signal is not a fact; do not say it until you have taken the diff.*

## Done means

1. `npm run test:canonical` holds JS, Rust, **and Solidity** to the committed
   `onchain/tests/parity-vectors.txt`. If Solidity needs its own fixture, that is a fork, not a port,
   and the task has failed.
2. Markets A and B are opened and settled **by on-chain re-execution** on a public EVM testnet, with
   addresses and transaction hashes recorded the way 08-12's devnet settlement is recorded.
3. One market is **left open**, with a live `check` path a stranger can run. 08-12 closed with "there
   is nothing for a stranger arriving now to land on"; shipping this port in the same state repeats
   the defect rather than fixing it.
4. Honest scope gains: L2 sequencer timestamps (§5), and whatever §6 actually turns out to be.

**Sequencing, added 2026-08-17; restated after review.** Slices 1 and 2 are merged. **Slice 3 is
deferred behind task 019 Slice A-live — as a project sequencing choice, not a logical consequence.**

The first version of this note claimed the deferral was *required* by done-means 3. It is not, and
the review was right to reject that. What done-means 3 requires is that a stranger can determine
the subject's state before bonding. It requires the **capability**, not task 019 specifically; an
EVM-side equivalent could be built first and would satisfy it.

And A-live does not close enumeration completeness for `getProgramAccounts` either — 019 keeps that
residual — so the deferral cannot even be justified as "wait for the wall to be solved". It is not.

The actual reason to sequence it this way is that the anchor would otherwise be designed twice.
A-live's shape — N independent endpoints agreeing at a pinned point, checkable before bonding,
rather than provable inside `settle` — is the general answer, and §6's correction removed the only
argument for the EVM needing a different one. Building the general design once and instantiating it
for EVM afterwards is cheaper than converging two designs later. That is a judgement about effort,
and it can be overridden.

Independently of ordering, 019 §6 changes *which* market slice 3 opens: `reserve-solvency`, not
CMLS, which under 005 §4 cannot currently print a sound verdict and is scheduled to print a false
public RED on 2026-11-27. That one is not a preference.

Default chain: Base Sepolia — cheap calldata. Arbitrum Sepolia is the alternative worth considering
only because the live subjects already
measured in this repo (012 Variational, 017 Sera) are on Arbitrum, so a real market opened later is
more likely to be Arbitrum-shaped. Testnet choice is not load-bearing; say which one and move.

## The failure mode this task is most likely to have

Every defect that survived review in 009–011 was the same one: **naming a mechanism and believing it
was implemented.** A port is unusually good at producing this, because the destination inherits the
source's vocabulary — a Solidity `Feed` struct called `Feed` will read as having the Solana `Feed`'s
guarantees whether or not it does.

So the review question for every carried-over name is not "does it compile" but **"which of this
name's promises did I actually port?"**

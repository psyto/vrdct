# Vrdct

**The neutral resolver. Re-execution decides the payout.**

Two markets are coming, and both are the same shape — a payout controlled by whether an on-chain
condition is true:

- **Prediction markets** on on-chain state: *is protocol X solvent? did stablecoin Y depeg? was Z
  exploited? did TVL cross W?*
- **Agent-payment escrow**: *release or refund — did the agent do what it claimed?*

Today these are settled by **token votes** (corruptible at high stakes), **committees** (conflicted),
or **price oracles** (which answer prices, not state). Vrdct settles them by **re-execution**:

> A market's on-chain-state condition is resolved by recomputing it deterministically from pinned
> chain state. The resolution is whatever anyone reproduces by re-running `verify`. No vote. No
> committee. No trusted oracle. **Don't trust the resolver — re-execute it.**

Because the condition is a deterministic function of public state, there is **one correct answer**;
honest resolvers agree, and a false resolver is **provably wrong and slashable** — the correct side
of the market captures the stake.

## The engine (`core/`)

`claim` (verifiable-claim schema + a claim-type registry) · `verify` (re-execute + content-hash) ·
`resolution` (claim verdict → market YES/NO) · `bond` (correct side captures, the loser is slashed,
whoever completed the re-execution earns 10%) · `encode` (the canonical input commitment, shared
byte-for-byte with the on-chain program). Zero dependencies.
The engine is **claim-type-agnostic** — new surfaces are added by registering a module, never by
editing the engine. This is `1 engine × N surfaces`.

## Claim-types (`claimtypes/`)

Each surface is a pluggable module —
`{ type, invariant, canonicalInputs(inputs), reexec(inputs), checks(claim) }`:

- `reserve-solvency` — is a protocol's recomputed backing ≥ its liability? *(Redde lineage)*
- `closed-market-liquidation-soundness` — does a venue liquidate tokenized equities against a price
  that updated while the underlying market was closed, with no guard? *(Vesper lineage)*
- `monday-open-gap` — did a market closure move the price by a threshold declared before it began?
  Offline-complete, **not yet wired to `encode.mjs` or the on-chain twin.** Unlike the others this
  one is not a verdict on someone's conduct: it settles an event people are already exposed to and
  cannot hedge, so it is the first claim-type that describes a market that does not exist yet.
- `obligated-liveness` — did an obligor miss more of its schedule than the network assumption the
  market declared can excuse? The first type that settles a party doing **nothing** rather than doing
  something wrong. Offline-complete, **not yet wired to `encode.mjs` or the on-chain twin.**
- `restaking-robustness` — what overcollateralization buffer does a restaking network actually
  certify, and how far can a small shock cascade? Offline-complete, **not yet wired to `encode.mjs`
  or the on-chain twin.**
- *depeg, exploit, agent-escrow — the roadmap.*

### Settling silence — and the boundary past which nobody can

Every other type above settles a **safety** question: a number came out, re-execute it, and a wrong
one is deterministically wrong. But the README's other target market, *agent-payment escrow*, mostly
disputes the opposite — the agent returned **nothing**. There is nothing to re-execute, and a
resolver that can only adjudicate safety quietly hands every non-delivery dispute back to whoever
holds the funds. That is not neutrality.

What makes silence hard is that *"the network was slow"* is an unfalsifiable alibi until you commit
to a bound on how slow it may be. `obligated-liveness` implements the bound and its limit, from
Lewis-Pye, Neu, Roughgarden & Zanolini, [*Accountable Liveness*](https://arxiv.org/abs/2504.12218)
(CCS '25): in an **x-partially-synchronous** network — at most an `x` fraction of steps in any long
enough interval are asynchronous — accountable liveness is achievable **iff `x < 1/2` and `f < n/2`**.

So a market declares `x` and the obligor's quorum shape up front, and re-execution:

- **derives the obligated slots from the calendar**, never from the claim, so no list of convenient
  slots can be supplied — the same `campana` move that makes `monday-open-gap` possible;
- **charges only the excess**: `excusable = floor(nSlots × x)`, and misses beyond it are
  `RED`/attributable while misses at or below it are `YELLOW`/excused;
- **refuses to blame anyone** — `UNKNOWN` — when the declared `x ≥ 1/2` or `f ≥ n/2`. That flag is
  decided by the terms alone: the evidence is parsed, but no valid evidence can move it. A neutral
  resolver has to be able to say *this question is not answerable under your assumptions* instead of
  picking someone.

**Honest scope.** Three things, and the third is a correction.

*Omission is the open residual, and it is safe to leave open.* Whoever pins the claim can leave
actions out — but removing actions only turns slots from met to missed, so omission can only make a
verdict **harsher** (`GREEN → YELLOW → RED`, never the reverse). A `RED` is contestable by any
challenger holding one more real action, and a `GREEN` cannot be manufactured by omitting anything.

*What gets spent is the record, not the instant.* An action is pinned as an identified on-chain
record — a transaction signature and its timestamp — and duplicate ids are rejected. This matters
more than it sounds: while actions were bare timestamps, listing **one real instant twice** bought
two discharges wherever grace made two slots overlap, which was enough to manufacture a `GREEN`
without inventing anything. That was found in review (`reviews/007-obligated-liveness.md`), and the
earlier wording here — that forging a `GREEN` required fabricating a timestamp — was false. It now
requires a second identified action that the source descriptor can be checked against.

*The schedule terms are an obligation on the market, not a property of this module.* The slots are
derived, but `fromTs`, `toTs` **and** `periodSecs` all shape which slots exist. They are safe only
when declared before the fact and bound by a market definition. Offline they are merely hashed into
the claim; this type has no on-chain market-definition binding yet.

And the actions must be observations of **on-chain state** — were the evidence third-party
attestation, the `f < n/2` half of the theorem would bind on the *observers* too, and this type does
not model that.

### The number restaking dashboards don't publish

Restaking reuses one validator's stake across many services, so a loss anywhere is a loss of security
everywhere that stake was pledged. What gets published is **TVL** — which says how much is pledged,
not whether pledging it *that way* is survivable.

`restaking-robustness` settles the survivable-ness, and unlike every other surface here the
definition of the invariant is **not ours**. It is Durvasula & Roughgarden, [*Robust Restaking
Networks*](https://arxiv.org/abs/2407.21785) (ITCS '25): a restaking graph is secure with **γ-slack**
when every attacking coalition satisfies `(1+γ)·π_A ≤ σ_B`, and their Theorem 1 bounds the cascade
from an initial shock of a `ψ` fraction of all stake at

```
R_ψ(G) < (1 + 1/γ) · ψ          ← tight (Theorems 2, 3, 8)
```

A 10% buffer means a sudden 0.1% loss cannot end in losing more than 1.1%. At `γ = 0`, their
Theorem 2 exhibits a network meeting EigenLayer's own sufficient condition where an arbitrarily small
shock loses *everything* — that construction is in our test suite, and this type reports exactly zero
buffer for it.

Checking security exactly quantifies over every coalition and is coNP-hard, so what makes a public
board possible is their **Corollary 2**, an efficiently checkable per-validator condition in which
`σ_v` cancels from both sides — making the certificate a property of the graph's *shape*:

```
γ* = min_{v ∈ V} (1/T_v) − 1        where  T_v = Σ_{s ∈ N(v)} π_s / (α_s · σ_{N(s)})
```

The paper proposes exactly this as *"an easily computed risk measure"* a restaking protocol could
expose to its participants. Nobody exposes it. `GREEN` is `γ* ≥` the declared buffer, `YELLOW` is a
positive but smaller one, `RED` is none at all. All of it in exact rational arithmetic — `α_s = 1/3`
is the common case and is precisely what a float cannot hold, `γ*` is published as an exact fraction
and as a decimal-string basis-point floor, and a validator holding **zero** stake imposes no
constraint at all, because `σ_v` cancels out of the condition only when it is positive.

Exactness has a price, and the claim domain is where it gets paid: `T_v` is a sum of fractions over
**one** validator's services, so its size grows with that validator's degree. The limits are
therefore set from measured adversarial cost rather than graph size — at most 32 services per
validator and 32,768 edges, putting the worst claim the type accepts at about **0.9s**. Size is
better than measured, it is *proven*: because reduction is deferred to once per validator, the
accumulated denominator is exactly `Π (α_s.num · σ_{N(s)})`, hence at most `degree × 174` bits, so
`γ*` cannot print longer than ~3,400 characters on any accepted graph.

Those limits are a defensible *computational domain*, not a finding that every live operator fits
inside one. The consequence lands on ingestion: a snapshot with a validator past the degree cap must
be **rejected, never truncated**. Dropping edges to make a graph admissible removes constraints, and
removing constraints can only raise `γ*` — it would manufacture a `GREEN` out of a network this type
is not entitled to judge.

**Honest scope.** Corollary 2 is *sufficient, not necessary*: `GREEN` means the network provably
sustains the buffer, but `RED` does **not** mean an attack exists — it means the checkable
certificate is unavailable. Saying *"not certified"* rather than *"broken"* is not hedging; deciding
the latter is coNP-hard. And `π_s`, the profit from corrupting a service, is **not on-chain state** —
the paper assumes the `π_s` are given and calls estimating them an open research direction. So they
are pinned in the claim and declared before the fact, and the verdict is a claim about the network
*under that estimate*. The estimate is public and contestable; everything downstream of it is
mechanical. This also implements the **global** guarantee only; the paper's local, per-coalition
guarantees (§5) need attack headers and stable attacks and are not here.

## Standing board

[`board/README.md`](./board/README.md) is the committed record of configured keeper positions, not
a landing page. Every published row names the venue and question, carries its source descriptor and
market/deadline state, and includes the exact read-only `vrdct check <market>` command that can
falsify it. A row being open or uncontested does not prove the venue correct. The keeper that writes
the board is documented in [`keeper/README.md`](./keeper/README.md): it opens only the flag it
re-executed and cranks its own challenged positions before expiry can award them to the challenger.

`canonicalInputs` is **required** by the registry and is the only reader of a claim's raw JSON: both
re-execution and the on-chain encoder consume its typed output, so the two cannot disagree about
what a claim says. It rejects whatever it cannot represent exactly instead of coercing. That is not
hygiene — it is the fix for a bug that would have paid the wrong side of a real market
(`reviews/001-onchain-bond-adversarial-audit.md`).

`node demo.mjs` builds one of each and resolves both through the same engine — different surfaces,
one resolver.

## On-chain (`onchain/`) — real lamports, settled by re-execution

The engine above is offline. `onchain/programs/vrdct-bond` is the Solana program that puts **money**
behind it: two sides post real bonds behind opposing assertions about an on-chain-state condition,
and **the program re-executes the condition itself** to decide a challenged payout. There is no
admin key, vote, oracle account, **or privileged treasury address** anywhere in it.

The claim-types are ported to Rust (`reexec/campana.rs`, `cmls.rs`, `solvency.rs`) as byte-for-byte
twins of the JS core, so an on-chain settlement and an offline `verify` cannot disagree.

**Inputs don't fit in a transaction** — the reference Jupiter Lend claim pins 3,789 price updates —
so a market commits to a **hash chain** over the canonical input encoding and re-executes it
**streaming**, one chunk per transaction:

```
h_0     = sha256( claim_type ‖ calendar_version ‖ n_records )
h_{i+1} = sha256( h_i ‖ chunk_i )
inputs_hash = h_N        ← pinned at open_market, before any money moves
```

`settle` pays out only if the streamed digest equals that commitment. Feeding a *different* input
set — even a well-formed one whose verdict would flip the payout — lands on a different chain head
and simply cannot settle.

A market's address is the hash of its **whole definition** — question, input commitment, source
descriptor, verdict mapping, bond, and challenge window — so nobody can reserve a question's
address under terms of their own, and each feeder's re-execution progress lives in its own PDA, so a
passer-by cannot reset or hijack someone else's.

```
open_market  commit to inputs_hash and bounded terms, assert a flag, post a bond
challenge    assert a different flag over the same pinned inputs, match the bond
open_feed    create a feeder-owned re-execution attempt (one PDA per market × feeder)
feed         re-execute a canonical chunk into that Feed PDA (permissionless)
settle       digest must close → program derives the verdict → correct side captures; its feeder earns 10%
expire_challenged  after the settlement deadline, pay the challenger unless a completed Feed settles first
```

### Run it

```bash
cd onchain
npm install
npm run build             # anchor build, then rebuild as SBPFv3 — Agave 4.x rejects SBPFv0
npm run test:unit         # the pure re-execution + the JS-generated parity vectors, host-side
npm run test:integration  # BPF ProgramTest over the custody state machine

solana-test-validator -r  # separate terminal
solana program deploy target/deploy/vrdct_bond.so \
  --program-id target/deploy/vrdct_bond-keypair.json
npm run bond              # two markets, real lamports, opposite winners
```

`test:integration` emits its own SBPFv0 artifact to `target/program-test-deploy` because
`solana-program-test` cannot execute v3; `target/deploy` keeps the v3 binary you actually deploy.

What that last command does, on a live validator:

- **Market A** — the *real* corpus claim (3,789 pinned Jupiter Lend SPYx updates). The resolver
  asserts `GREEN` ("the venue liquidates soundly") and bonds 2 SOL; a challenger asserts `RED` and
  matches. The program folds all 3,789 records on-chain in 19 transactions, reproduces the offline
  verdict exactly (683 updates while OPEN, 3,106 while CLOSED, max gap 4.03 min → `RED`), and
  **slashes the resolver**: challenger +1.8 SOL, completed-feed feeder +0.2 SOL.
- **Market B** — the real Marinade solvency snapshot, honest resolver, frivolous challenge. Someone
  first tries to feed forged inputs that would flip the verdict to `RED`; `settle` refuses. The
  honest feed then settles `GREEN` and **slashes the challenger**.

Same program, same code path, opposite winners — the program has no preference for whoever opened
the market.

### Take a market as a stranger

`cli/vrdct.mjs` is the path from a visible Market PDA to an informed decision. Reading needs only an
RPC URL — no wallet, keypair, local database, or fee — and reconstructs CMLS inputs from the
descriptor that is bound into the market address:

```bash
cd cli
npm install
RPC=https://your-rpc.example node vrdct.mjs markets
RPC=https://your-rpc.example SOURCE_RPC=https://source-rpc.example node vrdct.mjs check <market-pubkey>
```

`SOURCE_RPC` defaults to `RPC`, but it is separate when (for example) a devnet Market binds a
mainnet price account. `check` exits non-zero, with **DO NOT BOND**, if the stated account/window rebuilds a different
`inputs_hash`. When it matches, it says whether the resolver is right, the chain-derived `settle_by`
time remaining, and the conditional re-execution/expiry outcomes of taking the other side.
`challenge` and `crank` are the signing verbs; they require
`KEYPAIR=/path/to/keypair.json` and are documented in [`cli/README.md`](./cli/README.md).

## Run (offline engine)

```bash
node demo.mjs           # build a solvency claim → verify → resolve a market → settle the bond, offline
node reconstruct.mjs    # re-derive the reference claim's inputs from mainnet, check the commitment
npm run test:canonical  # canonical-input schema regressions + JS-generated Rust parity vectors
```

## Where the lane is open

**Chainlink** answers prices (commoditized). **UMA** answers claims by token vote (corruptible — its
cap is smaller than a single high-stakes market). **Vrdct** answers on-chain-STATE conditions
deterministically — the slice a price feed can't reach and a vote shouldn't decide.

## Honest scope

The resolution **logic** is trustless re-execution, now on-chain: anyone re-runs `feed` and the
program lands on the same verdict, and real lamports move on it.

Three residual assumptions, all named rather than hidden:

1. **Inputs.** `inputs_hash` *pins* a claim's inputs. Whether it also **sources** them depends on the
   claim-type. A CMLS Market stores and PDA-binds its `(price account, window)` descriptor; every
   successful signature on that account in that range, ordered by `(slot, sig)`, is the rebuildable
   input set. Anyone with an RPC can run `vrdct check` before bonding, instead of being handed an
   opaque observation list.

   Measured, not asserted: `node reconstruct.mjs corpus/jupiter-spyx-cmls.claim.json` re-fetches the
   reference claim from mainnet and lands on the identical 3,789-observation set and the identical
   `inputs_hash`. **The bound is RPC retention** — reconstruction works while the RPC still serves
   signature history for the window. A descriptor that rebuilds differently is a stop signal, not a
   fallback: `vrdct check` tells the challenger not to bond.

   `reserve-solvency` is still genuinely in the unsourced case; closing it means an on-chain
   recorder root, or N-of-M attestation for historical data.

   A CMLS verdict counts every normal US-equities session and every calendared half-day session
   (through its 13:00 ET close) as **open**; only updates outside those sessions count toward its
   closed-market liveness signal.

   `monday-open-gap` pins two prints and cannot prove either is the *closest* one to its boundary —
   the same omission problem, on two observations instead of thousands. It bounds the choice rather
   than removing it: the terms declare `maxLagSecs`, re-execution re-derives both boundary instants
   from the calendar by bisection and returns `STALE` for a print outside that lag, so a settled
   verdict always rests on prints near the bell. **The obligation this puts on a participant:** a
   challenger holding a print closer to a boundary must dispute with it, and the closer print wins.
   Nobody should read a gap verdict as a claim that no closer print existed.
2. **Unchallenged assertions.** A false claim nobody disputes settles optimistically at the end of
   its window — the usual optimistic-oracle assumption that challenging a false claim is profitable.
   A settled `Market.by_reexecution` is `1` only when the stored verdict came from on-chain
   re-execution, and `0` for the optimistic and expiry paths; anything integrating with this must
   read that field rather than the flag alone.
3. **Expiry, and the race at its edge.** A challenged commitment that cannot be reproduced does not
   lock either bond: after a fixed settlement deadline anyone can expire it against the resolver.
   Expiry sends the challenger the **entire pot** — a 100% slash — so the resolver carries a
   liveness obligation to get a Feed completed and settled inside that window. A completed Feed is
   never discarded by the clock (`settle` has no deadline), but after the deadline it *races* a
   permissionless `expire_challenged`, and the first terminal transaction wins. A false challenger
   who is watching the clock can therefore still take the pot from a resolver whose completed Feed
   would have proven them right. Removing that race needs expiry to be conditional on no completed
   Feed existing, which the program cannot check; it is open, not solved.

The 2026 calendar is valid only for 2026 timestamps, which the JS and Rust parsers both reject
outside its half-open range — so the holiday table cannot silently classify a window it does not
describe.

And the on-chain half has run only against a local validator so far, with that 2026 NYSE calendar
compiled into the program. Devnet, a governed calendar, and a live market are next.

## How this repo is built

Two agents cross-review each other: Claude Code takes the architecture, product shape, task briefs,
and the final safety pass; Codex takes tightly-scoped implementation and adversarial audits.
**Whoever writes a change does not review it.** The contract is [`AGENTS.md`](./AGENTS.md), the
briefs are in [`docs/tasks/`](./docs/tasks), the reviews are in [`reviews/`](./reviews).

That log is kept because a passing demo is not evidence. The first version of the on-chain program
was written in one sitting, ran green end-to-end on a live validator, and was declared working — and
the independent audit that followed found a **P0**: two readers of the same claim JSON coerced one
field differently, so a challenger who re-executed offline, got the right answer, and bonded on it
would have lost their money on-chain. Everything after that — the canonical parser, the committed
JS↔Rust parity vectors, the per-feeder feed accounts, the settlement deadline, the removal of the
treasury — came out of reviews that the author of the code was not allowed to write.

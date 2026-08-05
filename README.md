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
`resolution` (claim verdict → market YES/NO) · `bond` (correct side captures; false resolver slashed).
The engine is **claim-type-agnostic** — new surfaces are added by registering a module, never by
editing the engine. This is `1 engine × N surfaces`.

## Claim-types (`claimtypes/`)

Each surface is a pluggable module — `{ type, invariant, reexec(inputs), checks(claim) }`:

- `reserve-solvency` — is a protocol's recomputed backing ≥ its liability? *(Redde lineage)*
- `closed-market-liquidation-soundness` — does a venue liquidate tokenized equities against a price
  that updated while the underlying market was closed, with no guard? *(Vesper lineage)*
- *depeg, exploit, agent-escrow — the roadmap.*

`node demo.mjs` builds one of each and resolves both through the same engine — different surfaces,
one resolver.

## On-chain (`onchain/`) — real lamports, settled by re-execution

The engine above is offline. `onchain/programs/vrdct-bond` is the Solana program that puts **money**
behind it: two sides post real bonds behind opposing assertions about an on-chain-state condition,
and **the program re-executes the condition itself** to decide who is paid. There is no admin key,
no vote, and no oracle account anywhere in it — the only thing that can name a winner is the
re-execution.

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

```
open_market  commit to inputs_hash, assert a flag, post a bond
challenge    assert a different flag over the same pinned inputs, match the bond
feed         re-execute a canonical chunk on-chain (permissionless)
settle       digest must close → program derives the verdict → correct side captures, 10% cut
```

### Run it

```bash
solana-test-validator -r                       # terminal 1
cd onchain
npm install
anchor build && anchor build --no-idl -- --arch v3   # Agave 4.x rejects SBPFv0
solana program deploy target/deploy/vrdct_bond.so \
  --program-id target/deploy/vrdct_bond-keypair.json
cargo test -p vrdct-bond                       # the pure re-execution, host-side
node client/bond-live.mjs                      # two markets, real lamports, opposite winners
```

What that last command does, on a live validator:

- **Market A** — the *real* corpus claim (3,789 pinned Jupiter Lend SPYx updates). The resolver
  asserts `GREEN` ("the venue liquidates soundly") and bonds 2 SOL; a challenger asserts `RED` and
  matches. The program folds all 3,789 records on-chain in 19 transactions, reproduces the offline
  verdict exactly (683 updates while OPEN, 3,106 while CLOSED, max gap 4.03 min → `RED`), and
  **slashes the resolver**: challenger +1.8 SOL, treasury +0.2 SOL.
- **Market B** — the real Marinade solvency snapshot, honest resolver, frivolous challenge. Someone
  first tries to feed forged inputs that would flip the verdict to `RED`; `settle` refuses. The
  honest feed then settles `GREEN` and **slashes the challenger**.

Same program, same code path, opposite winners — the program has no preference for whoever opened
the market.

## Run (offline engine)

```bash
node demo.mjs   # build a solvency claim → verify → resolve a market → settle the bond, offline
```

## Where the lane is open

**Chainlink** answers prices (commoditized). **UMA** answers claims by token vote (corruptible — its
cap is smaller than a single high-stakes market). **Vrdct** answers on-chain-STATE conditions
deterministically — the slice a price feed can't reach and a vote shouldn't decide.

## Honest scope

The resolution **logic** is trustless re-execution, now on-chain: anyone re-runs `feed` and the
program lands on the same verdict, and real lamports move on it.

Two residual trusts, both named rather than hidden:

1. **Inputs.** `inputs_hash` *pins* a claim's inputs; it does not *source* them. Closing that gap
   means an on-chain recorder root, or N-of-M attestation for historical data.
2. **Unchallenged assertions.** A false claim nobody disputes settles optimistically at the end of
   its window — the usual optimistic-oracle assumption that challenging a false claim is profitable.

And the on-chain half has run only against a local validator so far, with a 2026-pinned NYSE
calendar compiled into the program. Devnet, a governed calendar, and a live market are next.

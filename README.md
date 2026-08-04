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

- `reserve-solvency` — is a protocol's recomputed backing ≥ its liability? *(included)*
- *closed-market-liquidation-soundness, depeg, exploit, agent-escrow — the roadmap.*

## Run

```bash
node demo.mjs   # build a solvency claim → verify → resolve a market → settle the bond, offline
```

## Where the lane is open

**Chainlink** answers prices (commoditized). **UMA** answers claims by token vote (corruptible — its
cap is smaller than a single high-stakes market). **Vrdct** answers on-chain-STATE conditions
deterministically — the slice a price feed can't reach and a vote shouldn't decide.

## Honest scope

The resolution **logic** is trustless re-execution. The residual trust is in a claim's **inputs**
(anchored via an on-chain recorder root, or bridged by N-of-M attestation for historical data).
Reference resolutions establish the standard; live-capital bonding on a live market is the next step.

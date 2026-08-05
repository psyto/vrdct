# Task 004 — Make a market takeable by a stranger

**Assignee:** Codex (frame-thick)
**Reviewer:** CC
**Branch:** `codex/004-make-a-market-takeable`
**Two required commits:** (A) the on-chain source descriptor, (B) the `vrdct` CLI.

---

## Why this is the next task, and not more hardening

The program is sound now. It is also **unusable by anyone but us**, and that — not the engine — is
what keeps this project without demand.

The thesis says verification demand exists only where a verdict controls a payout. That is now half
true: a payout *is* controlled by re-execution, but **no stranger can take the other side**. A market
publishes `inputs_hash` and nothing else. Someone who wants to challenge cannot see what they would
be challenging, cannot re-execute it, and would be bonding blind. "Permissionless disputer" is
currently a claim in a README, not a capability. A market with no reachable counterparty produces no
demand no matter how correct it is.

CC measured the missing precondition rather than assuming it — `node reconstruct.mjs`:

```
account   A2GDb4Um4Tr42iKgPz5fQ2d7pYTnaUuHN3d5V41Cywff
pinned    3789 observations   →  re-fetched 3789, identical set
pinned    inputs_hash 2f224c44f93a8e2c…   rebuilt 2f224c44f93a8e2c…
```

For `closed-market-liquidation-soundness` the input set is a **pure function of (price account,
window)**. A stranger with any RPC rebuilds it byte-for-byte and reaches the same commitment. So the
only thing standing between "a market exists" and "anyone can take it" is that the market does not
record where its inputs came from, and there is no tool that does the rebuild.

That is a build problem, and it is this task.

---

## (A) On-chain: a market says where its inputs came from

Add a **source descriptor** to `Market`, and bind it into `market_definition_hash` so it cannot be
swapped for one that points somewhere else after bonds are posted.

```rust
pub struct Source {
    pub kind: u8,          // 0 = UNSOURCED, 1 = SOLANA_ACCOUNT_SIGNATURES
    pub account: Pubkey,   // kind 1: the account whose successful signatures are the record set
    pub from_ts: i64,      // kind 1: half-open window, matching core/rpc.mjs :: fetchObservations
    pub to_ts: i64,
}
```

Rules:

- `CT_CMLS` **must** be opened with `kind == 1`. A CMLS market that does not say where its
  observations came from is exactly the unbondable market this task exists to eliminate — reject it
  at `open_market` rather than letting it be created.
- `CT_SOLVENCY` is opened with `kind == 0`. Its inputs genuinely are not chain-derivable today
  (README Honest scope #1), and a challenger deserves to *see* that they are being asked to trust a
  publisher rather than check a source.
- Mirror the descriptor in `core/encode.mjs :: marketDefinitionHash`, same byte layout, same twin
  discipline as every other consensus constant.
- Extend the client and the parity/definition-hash tests accordingly. `Market::SPACE` moves; keep it
  an exact written-out sum.

Do **not** try to validate the window against the observations on-chain — the program cannot fetch
signatures. The descriptor is a *statement of provenance* that anyone can falsify off-chain in one
command, which is the whole design: if a resolver points at the wrong account or window, the rebuilt
commitment will not match `inputs_hash` and `vrdct check` says so before anyone bonds.

## (B) Off-chain: `vrdct`, a CLI that goes from "I see a market" to "I have money on it"

New `cli/` (Node, `@solana/web3.js` only — keep `core/` zero-dep). Four verbs:

| verb | what it does |
| --- | --- |
| `vrdct markets` | `getProgramAccounts` → every live market: question hash, state, both asserted flags, bonds, `challenge_until` / `settle_by`, whether it is sourced |
| `vrdct check <market>` | the product. Read the descriptor, re-fetch the inputs from RPC, rebuild the commitment, compare to `inputs_hash`, re-execute offline, and say **what it is worth** |
| `vrdct challenge <market> --flag RED --bond 2` | post the opposing bond |
| `vrdct crank <market>` | `open_feed` → stream every chunk → `settle`, and collect the 10% |

`check` is the one that matters. Its output must answer a bettor's question, not a developer's:

```
market   7dUzqi…  Does Jupiter Lend liquidate SPYx soundly across the closed-market weekend window?
source   account A2GDb4…  window 2026-08-01T12:10:59Z → 2026-08-05T00:07:01Z
rebuild  3789 observations re-fetched from mainnet · commitment MATCHES the market's inputs_hash ✅
         (so the resolver pinned exactly what they said they pinned — you are checking a real source)

resolver asserts  GREEN   ← "the venue liquidates soundly"
re-execution says RED     ← 3106 updates while the US market was CLOSED, max gap 4.0 min

⚠ the resolver is wrong. Challenging with 2 SOL returns 3.8 SOL if you also crank it.
   vrdct challenge 7dUzqi… --flag RED --bond 2
```

and, when the resolver is honest, it must say so just as plainly — `check` that only ever finds
liars is a marketing tool, not an instrument. If the rebuild does **not** match, that is the loudest
possible output: do not bond, the market points somewhere other than where its commitment lands.

Requirements:

- Works against any RPC (`RPC=` env), no local state, no config file, no key required for
  `markets` / `check`. Reading must cost nothing and require nothing.
- `crank` streams all chunks with retry, and reports the reward it earned.
- Exit codes: `check` returns non-zero when the rebuild mismatches, so it can be run in CI by
  someone watching a market they care about.

## Tests

- Program: `open_market` rejects a CMLS market with `kind == 0`; the descriptor is inside the
  definition hash (changing `account`, `from_ts`, or `to_ts` changes the market address).
- JS↔Rust: `marketDefinitionHash` agrees with `market_definition_hash` over a fixture, committed like
  the existing parity vectors.
- CLI: `check` against a local validator for all three cases — resolver wrong, resolver honest,
  rebuild mismatch (point the descriptor at a different window and confirm it refuses loudly).
- `client/bond-live.mjs` still green; corpus `inputs_hash` unchanged.

## Acceptance criteria

- [ ] A CMLS market cannot be opened without a source descriptor.
- [ ] The descriptor is part of the market address, so it cannot be changed after bonds are posted.
- [ ] `vrdct check` takes a market address and nothing else, and tells a stranger whether the
      resolver is lying and what taking the other side is worth.
- [ ] The rebuild-mismatch path is tested and is the loudest output, not a warning line.
- [ ] README documents the CLI in the on-chain section and updates Honest scope if any of this
      changes what is trusted.

## Out of scope

- Devnet or mainnet deployment, and any market opened with real SOL. That is Hiro's call and his
  money; this task only makes it possible.
- New claim-types.
- 002's R3 (registry-dispatched consensus encoding) — still open, still not now.

# Vrdct keeper

`vrdct-keeper` is a participant, not a bulletin publisher. For every configured CMLS subject it
takes a completed trading-day window from chain time, rebuilds the source records, and opens a
market asserting the re-executed flag. A window runs from the previous trading session close to the
most recent completed close (Friday → Monday spans the weekend; half-days close at 13:00 ET). The
complete market definition is its PDA seed, so a second run in the same bucket finds the existing
position rather than opening another one.

It scans **every** challenged market opened by its key, including positions no longer named in the
current config, then completes its keeper-owned Feed PDA and calls `settle`. The exact canonical
chunks are persisted locally before the bond is posted, and the source RPC is the fallback when that
cache is gone — a rebuilt commitment is checked against the Market's `inputs_hash` before any fee is
spent, and re-seeds the cache on success. Neither path is trusted alone and neither is required:
`settle` verifies the Feed's count and digest against the Market commitment regardless, so cache
loss and source-history loss are each survivable, and only losing both abandons custody. This
matters: after `settle_by`, `expire_challenged` can pay the whole pot to the challenger. A completed
feed earns the 10% cranker reward; the reward recipient is the Feed owner, not an arbitrary
transaction caller. After `challenge_until`, the keeper also calls `claim_uncontested` to recover an
uncontested resolver bond; it intentionally does not close the Market, because that PDA is the
window's idempotency key.

## Configure and run

Copy [`config.example.json`](./config.example.json), replace every example value, and keep the
keypair file outside the repository. `rpc`, `sourceRpc`, `programId`, `keypair`, and `bondLamports`
are all configuration, so moving from devnet to mainnet is not a code change. `rpc` is the cluster
holding Vrdct Markets and bonds; `sourceRpc` is where the descriptor's price account lives and
defaults to `rpc`. That split permits a devnet market whose CMLS source is on mainnet.

```bash
cd keeper
npm install
node vrdct-keeper.mjs /absolute/path/to/keeper.json  # Node.js 20.18+ required
```

Each subject needs a named `venue`, a worded `question`, a Solana `priceAccount`, and the market's
`yesWhen` flag set. `windowSecs` is deliberately not configurable: CMLS uses the chain-derived
trading-day close-to-close boundary and never selects a window from `Date.now()`.

The run writes `board/README.md` and a chain-date file even if another subject or market failed.
Only a configured CMLS market whose source rebuilds to its committed hash is published. Rows that no
longer rebuild are visibly skipped with their reason; run failures are also recorded. Every published
row contains the source, the re-executed flag, economic/deadline state, and an exact read-only
`vrdct check` command carrying both RPC endpoints. A missing row is preferable to a row that cannot
be independently falsified.

## Tests

`npm run test:unit` needs nothing — no validator, no RPC. It covers config normalization and pins
the `claim_uncontested` account order.

The E2E needs a local validator with the program binary. It derives a close-to-close window from a
finalized source observation's **chain blockTime**, then verifies that a quiet subject cannot stop
another open or the board write; that an old-question/cache-missing market cannot stop a cached
challenged market from settling; that a cacheless market still recovers through the source RPC; and
that source loss becomes a visible board skip.

```bash
solana-test-validator --reset --bpf-program 7EtJACKUvpWGB524uqTykTzyCx1DyxKb76iEZVAiWwKS onchain/target/program-test-deploy/vrdct_bond.so
VRDCT_NODE=/path/to/node-20-or-newer npm run test:keeper   # unit, then E2E
```

The tests are deliberately local only; they do not need or use a devnet keypair.

**Known coverage gap.** The `claim_uncontested` path is not exercised end-to-end. The program's
`MIN_CHALLENGE_WINDOW_SECS` is one hour and `solana-test-validator` cannot warp its clock, so the
deadline is unreachable here; the program-side behaviour is covered by
`expiry_and_uncontested_are_terminal_exits` in `onchain/tests/state_machine.rs`, and the keeper's
instruction encoding by the unit test above. What remains untested is the two joined together.

Trading-day window selection lives in [`window.mjs`](./window.mjs) and is deliberately dependency-
free, so the root `npm run test:canonical` covers it without the root package acquiring a Solana
client.

# Vrdct keeper

`vrdct-keeper` is a participant, not a bulletin publisher. For every configured CMLS subject it
takes a completed window from chain time, rebuilds the source records, and opens a market asserting
the re-executed flag. The complete market definition is its PDA seed, so a second run for the same
window finds the existing position rather than opening another one.

It also scans the keeper's configured challenged markets. It rebuilds the descriptor, refuses to
feed if it no longer reaches the committed `inputs_hash`, and otherwise completes the keeper-owned
Feed PDA and calls `settle`. This matters: after `settle_by`, `expire_challenged` can pay the whole
pot to the challenger. A completed feed earns the 10% cranker reward; the reward recipient is the
Feed owner, not an arbitrary transaction caller.

## Configure and run

Copy [`config.example.json`](./config.example.json), replace every example value, and keep the
keypair file outside the repository. `rpc`, `programId`, `keypair`, and `bondLamports` are all
configuration, so moving from devnet to mainnet is not a code change.

```bash
cd keeper
npm install
node vrdct-keeper.mjs /absolute/path/to/keeper.json  # Node.js 20.18+ required
```

Each subject needs a named `venue`, a worded `question`, a Solana `priceAccount`, a `windowSecs`
cadence, and the market's `yesWhen` flag set. The keeper closes a window on its chain-derived period
boundary; it never selects a window from `Date.now()`.

The run writes `board/README.md` and a chain-date file. Only a configured CMLS market whose source
rebuilds to its committed hash is published. Every row contains the source, the re-executed flag,
economic/deadline state, and an exact read-only `vrdct check` command. A missing row is preferable to
a row that cannot be independently falsified.

## Local-validator test

Start a local validator with the task-004 program binary, then run the committed E2E. It creates a
source account, waits for a **chain-time** minute to close, then verifies open → dedupe → challenge
→ feeder-owned re-execution → settle → board.

```bash
solana-test-validator --reset --bpf-program 7EtJACKUvpWGB524uqTykTzyCx1DyxKb76iEZVAiWwKS onchain/target/program-test-deploy/vrdct_bond.so
VRDCT_NODE=/path/to/node-20-or-newer npm run test:keeper
```

The test is deliberately local only; it does not need or use a devnet keypair.

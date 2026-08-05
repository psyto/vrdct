# `vrdct` CLI

Requires Node 20.18+ and an RPC endpoint. Install its only dependency locally:

```bash
npm install
RPC=https://api.mainnet-beta.solana.com node vrdct.mjs markets
RPC=https://api.mainnet-beta.solana.com node vrdct.mjs check <market-pubkey>
```

`markets` and `check` are read-only: neither needs a keypair nor sends a transaction. `check`
re-fetches the descriptor's source records, recomputes the committed hash, and exits `1` with a
prominent **DO NOT BOND** message if it differs. A sourced CMLS match prints the offline verdict and
the consequences of taking the opposite side; an `UNSOURCED` market is reported as not independently
checkable.

Signing is opt-in at invocation time:

```bash
KEYPAIR=/path/to/keypair.json RPC=https://your-rpc node vrdct.mjs challenge <market> --flag RED --bond 2
KEYPAIR=/path/to/keypair.json RPC=https://your-rpc node vrdct.mjs crank <market>
```

`crank` refuses to stream a source that does not rebuild to the Market's `inputs_hash`, retries each
transaction up to three times, and reports the 10% re-execution reward. Always run `check` first.

## Local validator test

With task-004 program code deployed to a local validator, this creates three open sourced CMLS
markets and invokes keyless `check` against them: resolver wrong, resolver honest, and a descriptor
window mismatch.

```bash
RPC=http://127.0.0.1:8899 node tests/check.local.mjs
```

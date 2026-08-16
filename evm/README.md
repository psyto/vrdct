# Vrdct EVM re-execution parity

This directory is deliberately only task 018 slice 1: the pure canonical input hash chain,
two re-execution claim types, and the market-definition hash. There is no market, feed,
custody, or settlement state machine here; names in `VrdctReexec.Fold` carry only the exact
re-execution-state promises documented in that source file.

`test/ReexecParity.t.sol` reads `../onchain/tests/parity-vectors.txt` and
`../onchain/tests/market-definition-vectors.txt` with `vm.readFile`. The independent Campana
transcription is also held to `../onchain/tests/calendar-vectors.txt`: every 2026 ET session edge,
all holidays and half-days, and DST transition neighbours. These are committed JS-generated
fixtures also consumed by Rust. A Solidity-specific fixture would be a consensus fork, so none
exists.

Run `forge test` here, or run `npm run test:canonical` from the repository root.

## Measured gas (Foundry 1.7.1, solc 0.8.28, Cancun, optimizer runs 200)

`forge test --match-test testGasMeasurements -vvvv` measures the public harness calls used in the
test, including calldata/memory handling. The fixed input sets make these reproducible rather than
estimates for an eventual market contract:

| Operation | Records | Gas | Gas / record |
| --- | ---: | ---: | ---: |
| SHA-256 chain, CMLS | 201 | 240,013 | 1,194 |
| SHA-256 chain, solvency | 1 | 15,877 | 15,877 |
| CMLS fold + verdict | 200 | 3,230,899 | 16,154 |
| Solvency fold + verdict | 1 | 11,302 | 11,302 |

The CMLS figure includes the exact integer civil-date/DST classification port and is therefore the
relevant conservative datum for slice 2's chunk bound. It is not an EVM testnet transaction gas
quote, and the slice-2 state writes/custody checks will add their own costs.

## Deliberate EVM differences

There is no semantic divergence in the committed fixtures. Solidity has checked arithmetic by
default: unrepresentable count increments or allocations revert rather than wrapping or silently
truncating. The only operational difference is that all successful pure computation is subject to
the caller's gas limit; that is why slice 2 must choose a measured chunk bound and preserve the
rejection-on-over-domain rule.

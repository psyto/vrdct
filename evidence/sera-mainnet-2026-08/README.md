# Sera on Ethereum mainnet — what the deployed contract actually holds

**Subject:** `sera-cx/orderbook-contract-v2` @ `6bdb840` (2026-08-05), and the mainnet deployment its
own `broadcast/` records.
**Status:** on-chain reading only. No claim-type is proposed here.

## Why this was read

A source review of that repo concluded that the SOR path's economics turn on one storage value: the
allocation of *positive slippage* — the spread between the limit the Executor writes into a leg and
what the maker actually delivered. The constructor sets it to 100% protocol capture
(`src/Sera.sol:141-146`). A constructor default is a fact about the source. **What a deployed contract
holds is a different fact, and it is the one that matters for anything published.**

## What is deployed

`broadcast/Deploy.s.sol/1/run-latest.json` records a **chain-1** deployment, not only the Sepolia one:

| contract | address |
| --- | --- |
| `Sera` | `0xb5c50c5d5f038404f85970b7f5b7259c4ac0e198` |
| `Vault` | `0xc7d4fd2638e6630c8c61329878676b88a8a24d43` |
| `SeraSOR` | `0xa7a0cf7cd6f043fca23f29d8ae5aae6b46e11c18` |
| `SeraBatcher` | `0x1f4b366f4145a92978df4beeb6bde71bc652f034` |

`Sera` carries 30,855 bytes of code. Its deployment block was found by binary search over
`eth_getCode` rather than taken from the broadcast file, which records eight transactions and zero
receipts:

```
deployment block 24,993,378   2026-04-30T13:59:35Z   (743,543 blocks before the reading)
```

## The reading

```
$ cast call 0xb5c50c5d5f038404f85970b7f5b7259c4ac0e198 \
    "slippageShares()(uint64,uint64,uint64,uint64)" --rpc-url <mainnet>

makerShareBps    0
takerShareBps    0
protocolShareBps 10000
totalBps         10000
```

**100% of positive slippage to the protocol, live on mainnet.** Sampled across the contract's life via
archive `eth_call`, the value is the same at every point:

| block | maker, taker, protocol, total |
| --- | --- |
| 24,988,000 | *no code yet* |
| 25,100,000 | 0, 0, 10000, 10000 |
| 25,300,000 | 0, 0, 10000, 10000 |
| 25,500,000 | 0, 0, 10000, 10000 |
| 25,736,912 (latest) | 0, 0, 10000, 10000 |

## It is not an empty deployment

```
Vault ETH   0
Vault WETH  0
Vault USDC  6201351275        =  6,201.351275 USDC
Sera  ETH   0
```

Capital has been deposited. Small, but the difference between "a contract exists" and "a contract
holds other people's money" is the difference between a curiosity and a finding.

## What this does NOT establish, stated because the temptation is to skip it

1. **That the value was never changed.** Four sampled points cannot exclude a change and a change
   back between them. `SeraAdmin.sol:78-81` has `setSlippageShares` behind `DEFAULT_ADMIN_ROLE` and
   emits `SlippageSharesModified`, so the question is settled by a log search over 743,543 blocks —
   and that is exactly what the free RPC tiers refuse: Alchemy caps `eth_getLogs` at a **10-block**
   range, drpc at 10,000 with throttling that cut out after ~40 calls. **Unresolved, not absent.**
2. **Trading volume.** Same cap, same reason. A USDC balance says capital arrived; it says nothing
   about how much has been routed.
3. **Anything about intent.** The repo is explicit that surplus allocation is an `EXECUTOR_ROLE`
   operational decision (`Sera.sol:342-346`). Reading the value confirms what the design says about
   itself; it does not allege misuse.

## Reproducing this

```bash
git clone https://github.com/sera-cx/orderbook-contract-v2.git && cd orderbook-contract-v2
git checkout 6bdb840

python3 -c "import json;d=json.load(open('broadcast/Deploy.s.sol/1/run-latest.json'));
print([(t['contractName'],t['contractAddress']) for t in d['transactions'] if t['transactionType']=='CREATE'])"

export ETH_RPC_URL=<an archive mainnet endpoint>
SERA=0xb5c50c5d5f038404f85970b7f5b7259c4ac0e198
cast code  $SERA --rpc-url $ETH_RPC_URL | wc -c
cast call  $SERA "slippageShares()(uint64,uint64,uint64,uint64)" --rpc-url $ETH_RPC_URL
for b in 25100000 25300000 25500000; do
  cast call $SERA "slippageShares()(uint64,uint64,uint64,uint64)" --block $b --rpc-url $ETH_RPC_URL
done
cast call 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 "balanceOf(address)(uint256)" \
  0xc7d4fd2638e6630c8c61329878676b88a8a24d43 --rpc-url $ETH_RPC_URL
```

The selectors are computed by `cast` from the signatures, not written down. An earlier attempt at this
used hand-written four-byte selectors, and both were wrong — the failure was visible only because the
calls returned nothing.

## Licence note

The subject repository is **PolyForm Noncommercial 1.0.0**, not an open-source licence. It is cloned
here to be read and is not vendored.

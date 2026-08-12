# Corrections for the Sera article

Applicable wherever the draft lives — it is not in this repo, so this is a list rather than a diff.
Every point below was re-checked against `sera-cx/orderbook-contract-v2` @ `6bdb840` in a fresh clone,
not carried over from a summary.

---

## 1 — P1. The central claim is true of `matchOrders`, and not of the path the article is about

**The sentence as drafted:**

> `matchOrders()` verifies token symmetry, expiration, amounts, signatures, and Vault balances for
> both orders.

**That is correct.** `Sera.sol:331-332` calls `_validateMakerOrder` — which includes signature
validation — for *both* legs:

```solidity
_validateMakerOrder(_match.order0, orderHash0, _match.signature0, _match.matchAmount0);
_validateMakerOrder(_match.order1, orderHash1, _match.signature1, _match.matchAmount1);
```

**But the article's subject is the SOR route, and there the taker's signature is not checked at all.**
In `settleRoutedLeg` the two sides are deliberately asymmetric, and the code says so in its own
comments:

```solidity
// Taker: common checks only (no sig — SeraSOR authorized)
_validateOrderCommon(_match.order0, takerHash, effectiveMatchAmount0);
...
// Maker: full validation (sig + routeHash must be 0)
_validateMakerOrder(_match.order1, makerHash, _match.signature1, _match.matchAmount1);
```
`Sera.sol:609` and `Sera.sol:634`.

**Why this cannot be left out.** The article's thesis is delegation fenced by a signature. On the SOR
path what the user signed is the **envelope** — `maxInputAmount` / `minOutputAmount` / recipient —
and *not* the per-leg limit prices. `order0.fromAmount` / `order0.toAmount` for each leg are written
by the Executor. So the fence is real and it is drawn around the envelope, not around the execution
price. Saying "signatures are verified for both orders" while describing the SOR path invites a
reader to believe the price is fenced too.

**Suggested handling:** keep the sentence, attach it explicitly to `matchOrders`, and add one
sentence for the routed path stating that the taker leg carries no signature and the limit prices in
it are the Executor's.

---

## 2 — P2. Instant withdrawal is gated on the Executor, which belongs in the emergency-withdrawal section

`executeInstantWithdrawDualSig` (`Sera.sol:261`) requires the second signer to hold `EXECUTOR_ROLE`
and validates their EIP-712 signature over the same intent:

```solidity
if (!hasRole(EXECUTOR_ROLE, executor)) revert InvalidSignature();
...
_validateSignature(intent.user, sorHash, userSignature);
_validateSignature(executor, sorHash, executorSignature);
```

Without that co-signature the user falls back to the delayed path, which reverts until
`WITHDRAW_DELAY_BLOCKS` have passed:

```solidity
uint32 public constant WITHDRAW_DELAY_BLOCKS = 7200;   // "Set at 7200 for 24hrs"
...
if (blocksPassed < WITHDRAW_DELAY_BLOCKS) revert WithdrawNotReady();
```
`Sera.sol:77-78`, `Sera.sol:243`.

So an Executor that declines to co-sign imposes a ~24-hour delay on exit. That is a **censorship
surface**, not a safety flaw — funds are not at risk and the delayed path always exists — but a
section about emergency withdrawal that omits it describes a faster exit than the contract offers.

---

## 3 — P3. The licence is not open source

`LICENSE` is **PolyForm Noncommercial 1.0.0**, and `package.json` declares
`LicenseRef-PolyForm-Noncommercial-1.0.0`. If the article presents the repository as a reference
implementation, that needs saying — PolyForm Noncommercial prohibits commercial use, so a reader who
treats it as OSS is being misled by omission.

---

## 4 — An addition rather than a correction, and it is the strongest fact available

The article can say something stronger than "the constructor defaults to 100% protocol capture of
positive slippage", because the deployed mainnet contract holds that value now:

```
Sera  0xb5c50c5d5f038404f85970b7f5b7259c4ac0e198   (chain 1, deployed 2026-04-30, 30,855 bytes)
slippageShares()  ->  makerShareBps 0, takerShareBps 0, protocolShareBps 10000, totalBps 10000
```

Unchanged at every sampled block across the contract's life (25.1M, 25.3M, 25.5M, latest; no code at
24.988M), and the Vault holds **6,201.351275 USDC**, so this is not an unused deployment. Evidence and
reproduce commands are in `README.md` beside this file.

Two limits to carry with it, because the article should not claim more than was checked:

- **Not proven never-changed.** Four sample points cannot exclude a change and a change back.
  `setSlippageShares` is behind `DEFAULT_ADMIN_ROLE` and emits `SlippageSharesModified`
  (`SeraAdmin.sol:78-81`), so a log search settles it — and free RPC tiers refuse a search over
  743,543 blocks. **Unresolved, not absent.**
- **Nothing about intent.** The repo states plainly that surplus allocation is an `EXECUTOR_ROLE`
  operational decision (`Sera.sol:342-346`). The reading confirms the design's own description of
  itself. It alleges nothing.

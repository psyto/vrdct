# The rule set is a declaration, and it decides the number

`rules.json` is a **draft awaiting confirmation**. Nothing about it is derived, inferred or defaulted.
The classifier has no opinion about what counts as ETH, and cannot acquire one: feed it two different
lists over the same chain data and it returns two different verdicts. The fixture that proves this is
deliberate — `classify.test.mjs`, *"the rule set is declared, and the engine has no opinion about what
is ETH"*.

That is why the list is published with the number and hashed into it rather than living in the code.
**Whoever pins it is the one making the claim.**

## How the candidates were arrived at

Not from memory. `disposition.mjs --survey` classified 300 real borrows under a **WETH-only** rule
set — the most conservative possible, where every non-WETH gain reads as leaving ETH denomination —
and reported which token addresses actually appeared. Each address was then resolved to its `symbol()`
and `name()` **on chain**. No address in `rules.json` was typed from recollection.

## What the survey found, and why the draft is shaped this way

| bucket | tokens | appearances |
| --- | --- | --- |
| ETH-denominated assets | `wstETH` 8, `stETH` 2, `weETH` 1, `wstataWSTETH` 1 | 12 |
| **aTokens whose underlying is ETH** | `aEthwstETH` 12, `aEthweETH` 6, `aEthLidowstETH` 6, `aEthosETH` 4, `spwstETH` 2 | **30** |
| debt receipts | `variableDebtEthLidoWETH` 3, Spark `variableDebtWETH` 2, `ewstataWSTETH-1-DEBT` 1 | 6 |
| genuinely not ETH | `aEthUSDC` 3, `USDC` 1, `aEthWBTC` 1, `aEthUSDT` 1 | 6 |

**42 against 6.** Most of what the WETH-only run counted as "the borrow left ETH denomination" is an
ETH asset being re-deposited into Aave, Spark or Euler — a loop, which is the opposite of the funding
leg the measurement is about. The survey's `left-eth` figure of **9.3%** is therefore an **upper
bound**, and confirming this draft will lower it.

## The three decisions, and what confirming each one commits you to

1. **`ethDenominated`** — treating an LST/LRT as still-ETH. This is a judgement about *denomination*,
   not about price: `wstETH` is not 1:1 with ETH, and the classifier never compares values, only
   whether the borrower's non-ETH-denominated holdings rose. Confirming it says: a borrower who
   swapped WETH for wstETH did not leave ETH.
2. **`aliasTo`** — resolving a receipt to its underlying. `aEthwstETH` is a claim on wstETH, so it is
   ETH-denominated; `aEthUSDC` is a claim on USDC, so it is not. Without this the same deposit reads
   as a sale, which is the single largest error in the draft's absence.
3. **`ignore`** — debt receipts. A `variableDebt*` token is minted *because* the borrower took on a
   liability. Counting it as an asset gained is how a leveraged loop reads as a sale, and it is the
   defect probe 1 found in the main market before any of this was written.

## What confirming it does NOT settle

- **Intent.** A borrow whose proceeds left ETH denomination may be a short, a hedge, or a payment.
  The measurement says where the value went, never why.
- **Anything outside the transaction.** Borrow now, sell an hour later is invisible here, so any
  `left-eth` share is a **lower bound on selling** and must be published as one — which is the
  opposite direction from the upper bound the missing rules currently create. Both facts travel with
  the number or neither does.
- **Completeness of this list.** It was drawn from a 300-borrow sample of 5,119. A full run may
  surface addresses the sample never saw; the survey should be re-run over the whole set before the
  number is published, and any new address decided the same way.

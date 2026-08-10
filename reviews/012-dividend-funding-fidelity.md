# Review — Task 012, dividend-funding-fidelity (5bb4ff3)

**Reviewer:** Codex · **Author:** CC · **Branch reviewed:** cc/dividend-funding-fidelity

## Verdict

**REJECT the proposed claim-type; CHANGES for the public research record.**  This is a docs and
evidence-only change: it contains no module to audit, and that is the right moment to make the
admissibility decision.

The proposed predicate is not an on-chain-state condition and is not made one by hashing a dividend
number.  “The issuer declared $D” is the very external fact whose truth the market would need to
decide.  A pinner can set any `declaredPerShare`, then a deterministic implementation can compare
selected on-chain amounts to it and pay GREEN/RED without ever establishing that the issuer made that
declaration.  Calling the result issuer-declared funding fidelity would therefore make a false
external assertion payout-controlling.

This is not the `restaking-robustness` / Jito declared-input precedent.  There, `π_s` or a
mint-price conversion is openly a model/numeraire assumption and the certificate says it holds
*under that declared assumption*.  Here, issuer authorship and the corporate-action amount are the
thing asserted about the world.  Reframing the result as “payment matched the number the market
terms selected” would make the calculation deterministic, but it would no longer be a claim about
what Apple declared.  Until a source can authenticate and reconstruct the declaration as well as the
complete payment/position set, this is an oracle-driven market, outside Vrdct's stated resolver
contract.

Cross-chain support is not by itself a reason for a sibling repository: an EVM adapter and an
event-record encoding could be a future Vrdct surface if the predicate first meets that contract.
Here it would add a new read/parity/source-proof stack to a predicate that is not admissible, so it
is cost without a surface.  Do not implement it or retain it in the README claim-type list as a
candidate type.  The measurement can remain as explicitly bounded research after the findings below
are fixed.

`npm run test:canonical` is not material to this review because no executable code changed; I did
not treat existing-suite success as evidence for the proposal.

## Findings

### F1 (P1) — the public conclusion claims the exact absence that the evidence says it cannot prove

The evidence's own “What this does NOT establish” correctly says that no price event does not rule
out a storage write or an unpublished address.  But the task brief at
`docs/tasks/012-dividend-funding-fidelity.md:18-20` says the chain “carries **no price**” and that
all price inputs are produced off-chain; README.md:253-261 escalates this to “no public record of
valuation” and “no claim-type here can re-execute that venue's prices.”  The latter sentences are the
premise offered for admitting this new shape.

The scan counted event topics over a bounded 42-hour interval on selected addresses.  It did not
read contract storage, trace calls, or establish that the selected addresses exhaust the venue's
relevant contracts.  A price in any of those omitted places makes the public conclusion false and
invalidates the asserted need for this type.  This is particularly material because the repository
names a live company and calls its public address an Oracle Contract.

**Fix:** retain only the measured proposition everywhere: “over the scanned interval, the sampled
published addresses emitted no price-bearing event.”  State any broader conclusion as an unresolved
research question, not a reason to describe the venue's prices as necessarily off-chain or the
existing surfaces as necessarily inapplicable.

### F2 (P1) — the scan's declared universe omits a currently published contract

The record repeatedly says Variational publishes four mainnet addresses and treats them as the
complete public-address set.  The current official [Mainnet Contracts page](https://docs.variational.io/technical-documentation/mainnet-contracts)
lists those addresses **and** `Loss Refund Pool` (`0xc47756133753280c37b227c24782984e021c4544`).
The page's address list is itself a primary source; no cached copy or dated capture supports the
four-address version used in this record.

That omitted contract is enough to break the stated exhaustive conclusion even before considering
unpublished contracts.  It can have price-bearing logs or storage, so the 42-hour event scan cannot
support a claim about everything Variational publicly publishes.  This is a concrete failure path
for F1's architectural conclusion, not a request to exhaustively scan the chain.

**Fix:** either add the address to the measurement and re-run/document its bounded scan, or rewrite
the artefact as a scan of four explicitly named addresses.  Preserve a dated/hashed capture of the
source page if the record wants to make a historical “published addresses at time T” claim.

### F3 (P1) — a pinned issuer amount is an unverified oracle input, not a market term

The proposed `terms.declaredPerShare` has no source descriptor or rebuild rule; the brief expressly
says the payment set is unsourced as well.  A builder can pin a number the issuer did not declare,
select a favourable subset of payment/position records, and obtain a fully re-executed GREEN or RED.
The ordinary bond challenge only compares a flag over that same committed body, so it cannot replace
the false declaration with the issuer's actual declaration.

The proposed statement — “did a venue pay the corporate-action funding the **issuer** declared” — is
therefore not what the engine verifies.  This is a payout-controlling oracle assertion rather than a
declared modelling assumption.  The unresolved `uint128` mapping makes the implementation
impossible today, but resolving it would not fix this independent failure.

**Fix:** reject this surface under the current README thesis.  Reconsider only with a design that
authenticates/reconstructs both the issuer declaration and a complete, source-bound payment/position
set; otherwise explicitly make it a contract term and remove all issuer-declaration/fidelity claims.

### F4 (P2) — the advertised frozen-slice SHA-256 is neither reproducible nor the file's digest

`evidence/variational-2026-08/README.md:104-106` gives
`7fb7a6994339f790d16873520a8c4c2350a33fd366a30a59b01d7f5912206e3e` as the frozen slice's SHA-256
“over the body,” but no body definition or verifier is supplied.  The SHA-256 of the committed
`aapl-window-close.json` is
`18d1fc39768f23430b085eda955d1c28a49f6da716795763eea4ba712212d991`; neither ordinary JSON
serialization nor the repository's canonical JSON serializer yields the advertised value.

The slice is meant to be the durable evidence replacing a live stream.  A reader therefore cannot
check the stated content address, and a later edit could retain the unrelated digest without
detection.

**Fix:** either publish the full-file digest with a one-line verification command, or define the
exact canonical body and commit a verifier that checks it.  Do not describe an otherwise
unverifiable string as the slice's own SHA-256.

## Questions / design conclusions

- **UNKNOWN is not the right result for the unmapped `uint128` identifier space.**  The
  obligated-liveness UNKNOWN is a domain-valid instance at a theorem-proven attribution boundary:
  valid evidence cannot change it.  Here the type cannot identify which payments or positions belong
  to the predicate at all.  That is a failure to form canonical inputs, so a claim must be
  inadmissible before re-execution (and a market must not open), not resolve UNKNOWN.
- **The dated AAPL observation is appropriately presented as a question, not a breach finding.**
  Apple's official dividend history supports the declared/record/payable dates and $0.27 amount.
  The slice only brackets the interval switch between the last 3600-second sample at
  `00:08:23.270Z` and the first 28800-second sample at `00:09:23.272Z`; “about 13.4 hours” is
  appropriate, while an exact transition time is not.  With no observed opening edge, the record
  cannot choose between an early close and a different interpretation of `ex_date - 1`.  That is
  sufficient as an observation note, and insufficient as evidence of venue misconduct.
- The spread caveat is sound where it appears: the evidence distinguishes quoted $100k half-spreads
  from realised slippage and from the venue's separate $1M comparison.  I found no stronger
  restatement of those spread numbers in the branch.

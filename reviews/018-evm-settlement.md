# 018 — EVM settlement: §6 retraction review

**Review target:** `cc/018-source-correction` at `1e71e6b`  
**Base:** `main` at `ca57ab3`  
**Reviewer:** Codex  
**Verdict:** **CHANGES**

The central retraction is accurate in the narrow form the port needs.  Solana's
[`getProgramAccounts`](https://solana.com/docs/rpc/http/getprogramaccounts) configuration does
include `withContext` and `minContextSlot`; the latter is a lower-bound guard, not an exact
historical-slot selector.  The ordinary `eth_getLogs` response likewise provides no proof that a
range response is complete.  The proposed [EIP-7792](https://eips.ethereum.org/EIPS/eip-7792)
describes extra accumulators and proofs needed to verify both correctness and completion, which
confirms that the current source descriptor has no such property.  The parity fixture architecture
in slices 1 and 2 does not depend on `Source` and is unaffected.

## Findings

### F1 (P1) — The correction's inventory of remaining false wording is incomplete

`docs/tasks/018-evm-settlement.md:108-109` says the false premise remains in README and
`adapters/jito-restaking.mjs:426`, but the same unqualified assertion is still live at all of the
following current-source locations:

- `README.md:248`, `README.md:264`, and `README.md:506`;
- `adapters/jito-restaking.mjs:56`, `:426`, and `:443`;
- `docs/tasks/010-jito-restaking-ingestion.md:111`, `:189`, `:202`, and `:286`.

The README and adapter locations are user-facing, but task 010 is also an unretracted task brief
that a later reader can reasonably treat as current technical framing.  The correction must either
name all ten locations and assign their repair, or avoid representing its two-location list as the
remaining set.  Each needs the exact distinction: `withContext` reports a response context and
`minContextSlot` refuses a node below a lower bound; neither requests account state *at exactly a
past slot*.

**Evidence.** I first ran the request's narrow search over `README.md` and
`adapters/jito-restaking.mjs`, then broadened it to the repository (excluding generated dependency
directories):

```sh
rg -n -i -C 1 "getProgramAccounts.*(takes no|has no|does not).*slot|slot.*getProgramAccounts.*(takes no|has no|does not)|cannot ask an RPC.*as of|only as of now|source that can address a slot" README.md adapters/jito-restaking.mjs
rg -n -i -C 1 "(getProgramAccounts|program-account).{0,120}(no slot|takes no|has no|does not take|cannot).*|(?:no slot|takes no|has no|does not take|cannot).{0,120}(getProgramAccounts|program-account)|slot parameter|source that can address a slot" --glob '!node_modules' --glob '!target' .
```

Both commands returned the candidates above with exit status 0.  I inspected each: the struck
through prose in the target `018` correction is intentionally historical, the multi-call
`cannot share a bank` statements are a different aggregate-read limitation, and the listed lines
continue to assert the falsified no-slot premise.

### F2 (P2) — A-live is a prudent dependency choice, not a logical prerequisite of slice 3

`docs/tasks/018-evm-settlement.md:165-171` says slice 3 "is deferred behind task 019 Slice A-live"
and that this is a consequence rather than a scheduling preference.  Done-means 3 requires a
stranger to be able to check an open market before bonding.  It does **not** require the Solana
`reserve-solvency` A-live implementation in order to build an EVM `EVM_LOGS` checker against its
committed EVM endpoints and range.  Nor does A-live solve enumeration completeness for
`getProgramAccounts`; task 019 itself retains that residual.

Deferral can be the project decision, but state it as one: e.g. slice 3 is deferred until the
project has implemented and exercised the common independent-endpoint checking pattern in A-live.
Do not present the ordering as entailed by the current done-means criterion.

## Checks

- `git diff --check ca57ab3...1e71e6b` passed.
- The branch changes only `docs/tasks/018-evm-settlement.md`.
- No slice-1/2 source or fixture has a dependency on the retracted sourcing premise.

---

## Re-review — §6 retraction round 2

**Review target:** `cc/018-source-correction` at `b1b0206`
**Verdict:** **APPROVE**

F1 is resolved.  The new three-way inventory makes the distinction the original review required:

- **(a)** has seven literal falsehoods: the API does return a context slot when `withContext` is
  requested;
- **(b)** has three imprecise statements, but each remains defensible when "address a slot" means
  request state at an exact historical slot.  `minContextSlot` is only a lower bound, so this
  capability is still absent.  Requiring the qualifier rather than calling these false is the
  accurate repair;
- **(c)** has three true aggregate-read limitations and is correctly left alone.

I repeated candidate discovery using both the direct API name and the semantic forms "historical
slot", "past slot", "not a historical claim", "only as of now", and "source that can address a
slot" over runtime source, tests, README, and task docs.  The thirteen listed locations are the
only current assertions of the corrected/no-exact-slot premise.  The remaining direct API mentions
are calls (`cli/`, `keeper/`), a market-listing description (task 004), a dated subject-set
measurement (task 005), or review history; none asserts the falsified API behaviour.

F2 is resolved.  The text now expressly calls the A-live ordering a project choice, names the
actual duplicate-design rationale, makes it overridable, and does not imply that A-live solves
enumeration completeness.  "Slice 3 must not be written as if [EVM has a sourcing advantage]" is
the factual consequence of the correction, not a hidden scheduling requirement.

`git diff --check ca57ab3...b1b0206` passes.  This remains a docs-only branch.

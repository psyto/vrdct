# Review — 021 H2 kill-gate design

**Reviewer:** Codex (independent-review role)  
**Design reviewed:** `67e6521`  
**Result:** `CHANGES` — do not begin an A-item evidence run. The present source already gives A5 a `KILL` result, and A0/A4/A7 plus A1–A3 contain paths by which a non-product can pass. No code was changed and no evidence experiment was run for this review.

## Answer to the design question

**Yes: the gate can kill H2, and A5 already does on the current source.** `matchSlots` represents an empty action set as every obligated slot missed, but no current market can carry that case through to settlement. This is not an open implementation detail or a reason to design one during the gate. It is a current `KILL` unless the founder deliberately opens a later, new gate after this one stops.

That decisive path does not make the rest of the design sound. Several other rows can be passed with statements or a generic timestamp history while failing the buyer-defined, obligor-bonded SLA stated at the top of the gate.

## Findings

### F1 — A0, A4, and A7 do not test that the re-executed action is the promised action

**Severity:** P0 — a false fulfillment can pass the gate.

A0 requires a target program and instruction discriminator, and says that a successful signature carrying that discriminator is execution. But `canonicalInputs` accepts only schedule fields, `graceSecs`, `asyncPpm`, quorum, and action `{id, ts}` pairs (`claimtypes/obligated-liveness.mjs:113-161`). `matchSlots` spends only those timestamps and ids (`:196-207`); it never receives an obligor key, program id, or discriminator. `build` places `subject.obligor`, `source`, and account metadata outside the re-executor's canonical input (`:293-302`).

Consequently, two independent A7 rebuilds can agree byte-for-byte on a collection of otherwise unrelated successful transactions and still return `GREEN` for the named keeper/instruction profile. The reviewer need not forge a signature: an adversary can supply genuine, distinct on-chain actions from a different program or actor at the required times. A0 can be written, A4 can describe a hash, and A7 can agree while the predicate that pays is not the predicate that was sold.

The current `Market` does not close this gap: it records a generic `Source` (one account and time range) and the input hash, not target program, instruction, obligor, schedule, grace, async bound, quorum, or remedy (`onchain/programs/vrdct-bond/src/state.rs:15-24, 36-79`). This violates the standing rule that a field no deciding computation validates can claim a different context.

**Gate consequence:** a missing complete binding from the A0 profile to the canonical action record and the deciding state must itself be an A0/A7 `KILL`; the present A7 condition, “actions cannot be addressed at a slot,” is too narrow. Addressability in time is not attribution to the promised action.

### F2 — A5 is already `KILL`, and the document understates the end-to-end failure

**Severity:** P0 — total outage is not settleable.

For a nonempty derived schedule and `actions: []`, `matchSlots` appends `false` for every slot (`claimtypes/obligated-liveness.mjs:196-207`), `reexec` counts every one as missed (`:236-250`), and a feasible-assumption window returns `RED` (`:246-261`). The offline surface therefore represents the worst breach correctly.

The custody path cannot represent or settle it:

- `obligated-liveness` has no `CLAIM_TYPE_ID` and no Rust twin; the module itself says on-chain settlement needs that port first (`claimtypes/obligated-liveness.mjs:60-62`). The only registered Rust types are CMLS and solvency (`onchain/programs/vrdct-bond/src/reexec/mod.rs:39-50`). `open_market` therefore rejects the liveness type before any market exists (`lib.rs:152-159`).
- Even under a hypothetical type tag, `open_market` rejects `n_records == 0` (`lib.rs:144-159`).
- Even if that one guard were absent, `feed` rejects an empty chunk (`lib.rs:292-315`), while `settle` insists that the feed count equal `n_records` and its digest equal the precommitted hash (`:327-359`). `Market` has no committed obligation schedule from which an empty action set could be independently reconstructed (`state.rs:36-79`).

Thus the problem is not merely that one `require!` prevents opening zero observations. The present system has neither a liveness settlement type nor a committed schedule/terms representation that can settle omission. A5's answer, from the sources the gate names, is **inaction is exculpatory at the market boundary: `KILL` today**. Designing a replacement here would be the forbidden new hypothesis, so this review does not do so.

### F3 — A6 is either a current `KILL` or an argument past the gate

**Severity:** P1 — the item does not define a reproducible viability test.

The source establishes only the current fact: opening binds a nonzero record count and `inputs_hash` before the bond transfer (`onchain/programs/vrdct-bond/src/lib.rs:138-238`), and settlement accepts only that exact count and digest (`:327-359`). A future action set therefore cannot be opened by the current mechanism.

A6 instead asks whether *some design* could preserve re-execution and asks the runner to state what it “would commit.” No existing schema or mechanism supplies that commitment; H2 expressly forbids writing one. A prose proposal is consequently an added hypothesis, not the required number or reproducible experiment. If absence of a demonstrated mechanism is evaluated under `GATE.md`'s “not-proven is a KILL,” A6 is a current `KILL`. If an asserted future design is allowed as a pass, the item can always be argued past.

The gate must choose one of those two dispositions before any A-item runs. It cannot treat a yet-unwritten design as evidence while prohibiting its construction.

### F4 — B6's withdrawal removed a market test without replacing it with an independently falsifiable warranty test

**Severity:** P1 — a non-market warranty can pass A1–A3.

An obligor bonding its own performance is not intrinsically an accusation; that part of the withdrawal is sound. But the old B6 did more than reject an accused venue: it required a rational, economically distinct counterparty. A2 and A3 replace it only with attributable quotations.

Five related entities, or five friendly operators, can make the required written A2 statements; the gate defines neither distinct economic control nor a present integration decision. Two can name the same obligor. An obligor can call a scalar remedy acceptable without posting collateral, possessing it, or agreeing to a binding duty. None of A1–A3 requires an actual buyer/obligor pair to make the stated commitment or establishes that the buyer bears a loss which the remedy is meant to address.

Recording ranges before intersecting prevents the author from fitting the arithmetic after the fact. It does **not** make the statements independent, binding, or economically meaningful. The withdrawn condition therefore leaves a real failure mode uncaught: a keeper's self-marketing warranty, with no buyer willing and able to rely on it, passes the stated counts and a nonempty verbal band.

### F5 — A1–A3 thresholds allow weak positive signals to pass and contain an undefined circular calculation

**Severity:** P1 — the numerical rows are not yet numbers that can decide the gate.

`0` is too weak an A1 threshold. A population with one isolated historical miss and no recurring operational risk passes the “not every miss rate is 0” branch. That establishes neither a bondable duty nor a recurring reason for a buyer to pay. Conversely, the other A1 branch cannot be evaluated as written: expected annual remedy depends on `R`, but the acceptable/sufficient `R` is only elicited in A3; “plausible annual revenue from the duty” has no source, period, or calculation rule. A one-member chosen population also makes “median” vacuous.

The proposed `5` and `2` A2 counts count statements, not independent buyers or commitments. The A3 intersection is similarly a one-dimensional assertion. Remedy adequacy depends at least on duration, trigger frequency, maximum total slashing, collateral lock-up, and the buyer's actual exposure; parties can truthfully give overlapping values for `R` while disagreeing on any of those omitted terms. The gate's own “too small is advertising” rule has no quantity or test, so an arbitrarily small mutually agreeable amount can be called sufficient.

All of these results are reachable without falsifying a sentence in the gate. They let a real failure — no scalable buyer demand and no economically viable bond — pass.

### F6 — the instance-change record is transparent but not a structural defence against surface-hopping

**Severity:** P2 — scope control is declarative rather than tested.

The switch occurred before an H2 A-item, so the chronology alone does not invalidate it. The substantive concern remains: the immediately preceding H2 design expressly prohibited reaching for `obligated-liveness`; `67e6521` replaces the fixed indemnity with that existing offline claim-type, then carries forward H1's signature-history result as motivation (`docs/GATE-H2.md:12-28, 59-74`). The new gate says H1's PASSes are not credits and A7 must remeasure, which is a useful reset, but no A-item tests the claimed product discontinuity.

The practical distinction has to be the A0 profile and its binding to the deciding predicate. F1 shows that binding is absent. Until it is a gate condition, the “one change at zero evidence” record prevents a *later* substitution but does not distinguish this substitution from rescuing the killed project by moving to a repo-owned surface whose market path is also absent.

### F7 — A8 can return literal `NO`, but cannot establish the stated product boundary

**Severity:** P2 — author-controlled wording is not market evidence.

The current README's obligated-liveness section describes the liveness theorem and residuals, but does not state that an H2 remedy is fixed or may be less than loss (`README.md:124-165, 441-512`). On the current deliverable A8 would therefore be `KILL` by its literal rule. Conversely, a single pre-run sentence can make it pass without showing that any buyer encountered or understood the limit.

A8 is useful publication hygiene, but it is an author-controlled documentation check, not evidence that H2 is not being offered or understood as insurance. It cannot repair F4's missing buyer-side economic test.

## A-item falsifiability summary

| item | can return `NO` as written? | review conclusion |
| --- | --- | --- |
| A0 | Yes | It can fail for an unstated/off-chain field, but it can pass while the re-executor ignores the named program, instruction, and obligor (F1). |
| A1 | Partly | All-zero miss rates are countable; the revenue/remedy limb is undefined and circular, and one nonzero miss passes a weak population (F5). |
| A2 | Formally | Fewer than five statements is a `NO`, but five related/nonbinding statements pass (F4–F5). |
| A3 | Formally | An empty asserted interval is a `NO`; a scalar verbal overlap does not establish a viable bond (F4–F5). |
| A4 | Yes | Current source supplies neither the named terms schema nor on-chain binding; “obligor influence” also omits the other unbound fields (F1). |
| A5 | **Yes — now** | `KILL`: omission reaches an offline `RED` but cannot enter or settle through the current market (F2). |
| A6 | Not cleanly | Current code says no; a future design is either unproven (`KILL`) or an unfalsifiable rescue hypothesis (F3). |
| A7 | Yes | Two rebuilds can disagree, but agreement on generic timestamps does not test the promised action (F1). |
| A8 | Literal only | It can fail/pass on wording, not on whether the marketed product is actually bounded as claimed (F7). |

## Disposition

Do not begin buyer research or other A-item evidence. The existing read-only source trace is sufficient to answer the requested hardest question: **A5 is already `KILL`.** If the gate author/founder decides to redesign rather than record that result, that redesign must be completed before any official A-item is run and must address F1, F3, and F4–F5; it is not an implementation task for this review.

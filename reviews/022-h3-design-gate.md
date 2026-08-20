# Review — 022 H3 design gate

**Reviewer:** Codex (independent-review role)

**Design reviewed:** `25dea7a`

**Result:** **CHANGES — do not pass H3 or begin buyer research.** H3 as written is
unsalvageable as a design-only gate: it has no reproducible way to establish its three
central claims, and its timeout confuses prevented evidence delivery with non-performance.
Under the inherited `not-proven is a KILL` rule, this review supplies no basis for a `GO`.
This is a review disposition, not a change to `STATUS.md`; gate adjudication remains the
founder's decision.

## Answer to the design question

**No: this gate cannot reliably kill H3 while also distinguishing a product from an
argument for one.** It can declare a stipulated candidate dead, but its D1, D2, D3, and
D5 tests have no candidate, measurement, or protocol object against which to return `NO`.
The one check that is mechanically crisp — whether the penalty transition walks history
(D4) — does not catch the decisive availability failure below.

No candidate obligation is named in `GATE-H3.md` that survives both D1 and D3. The current
design leaves only these categories:

- a preimage, a uniquely observable on-chain action, or a trusted attestation — respectively
  D1(a), D1(b), or D1(c);
- a richer selected evidence set, which may evade a *simple* state read but for which D3's
  two freshness/attribution tests say nothing about completeness or provenance.

The last category needs a demonstrated completeness property. The only such property already
shown in this repository is public reconstruction to the committed hash, and H3 neither
requires nor preserves it. Supplying a new proof primitive to escape that result would be a
new hypothesis, not a pass. Thus the pincer is not proved as a theorem about every possible
mechanism, but **none is present here**; that is enough for `not-proven` to decide this gate.

## Findings

### F1 — timeout makes delivery liveness, not performance, the condition that protects the bond

**Severity:** P0 — a performing obligor can be slashed for an indistinguishable network failure.

H3 makes payout depend solely on whether valid evidence was fed by the deadline
(`docs/GATE-H3.md:16-20`). Consider two executions with the same chain state at that deadline:

1. the obligor performed, but censorship, congestion, a fee spike, or a buyer-incentivised
   inclusion failure prevented the evidence transaction from landing; and
2. the obligor did not perform and therefore has no evidence to feed.

The timeout transition must pay the penalty in both. It cannot observe why the evidence is
absent without adding information that the stated shape excludes. This is fail-closed against
the obligor, not against a false performance claim. The buyer receives the penalty in either
case and therefore has no protocol incentive to help the truthful obligor reach inclusion.

This is the same direction already recorded for the current expiry path: a truthful resolver
whose feed is slow or censored loses the whole pot (`docs/tasks/020-cmls-product-boundary.md:115-118`;
`docs/cmls/THREAT-MODEL.md:184-197`). Replacing the history walk with an automatic timeout removes
the old omission proof problem, but it does not remove the delivery race.

D1 (value), D2 (buyer), D3 (binding), D4 (no history walk), and D5 (fixed terms) can all pass
in both executions. No D-item names the availability assumption, the party that bears its
failure, or the buyer's adversarial incentive. This is a way H3 fails that the gate does not
test, so the claim that A5 is "dissolved by construction" (`docs/GATE-H3.md:22-25`) is too
strong.

### F2 — D1 and D3 have no demonstrated common domain

**Severity:** P0 — the gate lacks the candidate it must discriminate.

D3 correctly carries forward H2 F1's requirement that evidence identify this obligation rather
than a genuine unrelated action (`docs/GATE-H3.md:33`; `reviews/021-h2-gate-design.md:15-25`). But
H3 provides no obligation or predicate on which to test that requirement.

For a single, uniquely bound action, the post-commitment evidence is an observable fact; a
deadline state check or ordinary programmed SLA can condition the same penalty on it, which is
D1(b). A preimage or a party trusted to attest to an off-chain action is expressly D1(a) or
D1(c). If the alleged distinction instead comes from re-executing a nontrivial evidence set,
the binding checks listed in D3 establish only that the supplied records are fresh and related.
They do not establish that all evidence required by the predicate was supplied.

That omitted completeness check is load-bearing. `state.rs` explicitly says the current
`Source` is not re-executed on chain and assigns provenance defence to an off-chain challenger
who reconstructs the stated account/window before bonding (`onchain/programs/vrdct-bond/src/state.rs:10-12`).
STATUS records that independent public reconstruction to a byte-identical commitment is the
security model, not an incidental capability (`STATUS.md:30-40`). H3 instead says the obligor
produces the evidence and supplies no public source, completeness rule, or independent
reconstruction requirement (`docs/GATE-H3.md:16-20, 29-33`).

Therefore H3 is not merely a narrower Vrdct surface. It changes the security premise to an
**obligor-submitted-evidence SLA with an automatic timeout**. That can be a different product,
but D1–D5 never ask the founder to make that product-boundary decision. It must not inherit the
proven reconstruction result as support for this design.

### F3 — D2 cannot return `NO` before the research it forbids

**Severity:** P0 — an invented buyer story can pass a gate meant to reject one.

D2 asks for a named role/counterparty type and a reason reputation is insufficient, while
prohibiting buyer research until after passage (`docs/GATE-H3.md:8-10, 31-32, 44-47, 56-57`). A
writer can name, for example, a DAO and assert a reputation problem. Nothing in the item requires
an independent statement, a present decision, a loss, a price, or a defined comparison cost.
Conversely, "cheaper existing mechanism" is not computable without the very buyer and market
facts the gate withholds.

This repeats the defect found in H2 rather than repairing it. H2's review showed that named
roles and attributable statements could be nonbinding, related, and economically empty, and
that remedy viability needs quantities beyond a verbal overlap (`reviews/021-h2-gate-design.md:51-69`).
H3 supplies still less: an argument is explicitly to stand in for a survey. A gate may defer a
survey, but it cannot treat a non-falsifiable pre-survey assertion as the pass condition for
authorising that survey.

### F4 — the one-page gate deletes the objects needed to falsify D1–D5

**Severity:** P1 — brevity is underspecification here, not discipline.

Fifty-seven lines is not intrinsically a defect. Here, however, the document fixes only a shape;
it contains no term vector, participants' commitment event, evidence packet, predicate input
domain, source/completeness rule, or candidate buyer. Consequently:

| item | can return a meaningful `NO` as written? | reason |
| --- | --- | --- |
| D1 | No | “every obligation a named buyer would actually pay for” is an unbounded, undefined population; “ordinary” and “cannot” have no comparison procedure. |
| D2 | No | The evidence that could disprove the author-written buyer claim is banned until after passage (F3). |
| D3 | No | No scheme or record format exists to test attribution, freshness, or completeness. |
| D4 | Partly | A concrete penalty path could be inspected for a history walk, but this check says nothing about whether valid performance evidence can arrive or is complete (F1–F2). |
| D5 | No | Without a complete term representation and commitment event, the restriction is only a statement; off-chain or unrepresented terms can still claim a different context. |

The inherited gate requires a verdict from a number or reproducible experiment, and treats
not-proven as KILL (`docs/GATE.md:28-39`). H3 deliberately permits no implementation, test, or
buyer evidence, but offers no alternative reproducible design artifact. It is therefore a
checklist that can be argued past, not a design gate.

## Disposition

**Do not pass H3 and do not begin buyer research, implementation, or any on-chain work.** The
timeout shape has moved the decisive trust assumption to timely transaction inclusion, while D2
and the D1/D3 pincer cannot be resolved from this document. No repair is proposed here: introducing
one would be the prohibited new H3 mechanism. The current H3 gate is unsalvageable; per its own
stop rule, this review ends here for founder adjudication.

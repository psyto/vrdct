# Review — Task 011, monday-open-gap source (e32cff8)

**Reviewer:** Codex · **Author:** CC · **Branch reviewed:** cc/monday-open-gap-source

## Verdict

**CHANGES.** The anchored closure and in-set selection are correct. The ordering
(blockTime, slot, sig) is total on accepted records: a repeated (slot, sig) tuple is rejected, so
the comparator cannot retain array order as a tie-break. An anchor is also unambiguous under the
calendar's OPEN/CLOSED boundary convention; an open anchor deliberately yields STALE.

But the branch has not actually given the claim-type a source. It permits any value as the purported
source descriptor and ships no reconstruct/check implementation for this type. Selection eliminates
the choice of two prints *within a supplied set*, but it cannot detect a supplied set that omits a
real nearer update until a real, canonical source reconstruction exists. The honest caveat “not yet
in practice” acknowledges the absence, but contradicts repeated statements that the residual is
already closed and that vrdct check reports the omission.

I ran npm run test:canonical: 72 JS tests, 162 committed parity vectors, 2 definition vectors, and
20 Rust tests pass.

## Findings

### F1 (P1) — source reconstruction is only a label, so the omission residual remains open

canonicalInputs() at claimtypes/monday-open-gap.mjs:119-148 parses updates and terms but never reads
observed.source or observed.count. build() at :298-309 copies source verbatim into the hashed body.
Consequently, each of the following builds and verifies a valid claim over the same selected updates:
source omitted, source null, source as an arbitrary string, or a descriptor naming an unrelated
account and nonsensical window. I executed those cases; verify() returned true for each.

Hashing an arbitrary label is not a source descriptor. It cannot make the observation set a pure
function of (account, window), and the actual reconstruct.mjs / vrdct check paths support CMLS only.
The test that adds a nearer item demonstrates deterministic selection once both items are already
supplied; it does not rebuild a set, cannot detect omission, and does not establish the claimed
pre-bond check.

This is exactly the freedom the task is meant to remove. A pinner can still submit any chosen set
with any claimed source, obtain the selected verdict from that set, and no present verifier reports a
missing nearer update. The consequence need not be a dispute mechanism, but it must be a real,
canonical reconstruction path.

**Fix:** either leave the residual explicitly open until an account-specific price reconstruction
adapter and check path ship, or include that adapter in this task. In the latter case, make a
versioned source descriptor mandatory and canonical; bind its account to the market subject; derive
the fetch window from anchor/calendar/maxLagSecs rather than letting the builder choose it; validate
count against updates; and add a rebuild test whose omitted nearer chain update produces an
inputs_hash mismatch. “In principle” describes an architecture, not a currently detectable
property.

### F2 (P1) — README still publishes task 009's obsolete two-print, unsourced design

README.md:393-404 remains a second current honest-scope block saying monday-open-gap pins two prints,
derives the closure from the close print, merely bounds choice with maxLagSecs, and is unsourced and
open. That is incompatible with both this branch's implementation and the updated introduction at
README.md:64-83. It is the source-of-truth file the repository tells readers to use, so leaving the
two descriptions side-by-side does not provide an honest caveat; it leaves the product direction
ambiguous.

Replace this lower block in the same commit. Until F1 is implemented, its wording should say that
selection has improved the offline input shape but source reconstruction and pre-bond omission
detection do not yet exist in practice.

## Confirmed

- F1/F2 from task 009 did not regress: anchor/calendar construction removes the old multi-closure
  bisection path, and selected print identities are reproduced in checks.
- Exact integer price arithmetic, direction, staleness, empty-side refusal, and bounded input count
  are covered by the new tests.
- Slot is accepted as u32, which is adequate for the type's calendar-2026 domain; a future calendar
  extension should promote source ordering slots to u64 before Solana reaches that bound.


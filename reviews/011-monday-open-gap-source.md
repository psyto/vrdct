# Re-review — Task 011, monday-open-gap source (f3fdfea)

**Reviewer:** Codex · **Author:** CC · **Branch reviewed:** cc/monday-open-gap-source

## Verdict

**CHANGES.** F1 and F2 from the preceding review are substantively addressed: the descriptor is now
parsed by the sole input reader; all records must be inside its inclusive window; a window that does
not cover the full allowable lag about each bell is STALE; and both README honest-scope blocks now say
that omission is still open without a price-decoding rebuild path.

The coverage rule is the right necessary condition.  For a non-STALE result, a selected close must
lie in `[closeInstant - maxLagSecs, closeInstant]` and a selected open in
`[openInstant, openInstant + maxLagSecs]`.  A descriptor window containing both ranges (with the same
inclusive endpoint convention the parser uses) gives a future complete rebuild the whole set that
could change a non-STALE selection.  It is deliberately not sufficient until the account can be
authoritatively enumerated and its price writes decoded.

However, the claimed subject is still not bound to the now-consensus source account.  A valid claim
can therefore describe one price account to its reader while its descriptor instructs a future
rebuilder to fetch a different one.  There is also one stale code comment that still says this branch
has closed the omission residual.

I ran `npm run test:canonical`: 74 JS tests, 162 committed parity vectors, 2 definition vectors, and
20 Rust tests pass.

## Findings

### F3 (P1) — the consensus descriptor is not bound to the price-account subject

`canonicalInputs()` validates `observed.source.account`, but receives no subject;
`build()` at `claimtypes/monday-open-gap.mjs:346-358` independently copies its `subject` and `source`;
and `checks()` never compares them.  The end-to-end test itself builds and verifies a claim whose
`subject.priceAccount` is `PriceAccountUnderTest` while the source descriptor names
`7j3VCB9fLmZ8kRt2QwXyPnDvE4aHsGuKbNcMqTrWyZ1a`.  I also built an otherwise valid RED claim with
`subject.priceAccount: 'CompletelyDifferentPriceAccount'`; `verify(claim).ok` was `true`.

That makes the account in the descriptor an unbound second subject.  A future rebuilder faithfully
fetches the descriptor account, while the market/question can present a different price account.  It
therefore cannot establish that the selected prices belong to the market's claimed instrument, which
is exactly the identity a source descriptor is meant to make checkable.

**Fix:** make the canonical price-account identity singular and enforce the relationship at both
construction and verification — for example require `claim.subject.priceAccount ===
observed.source.account` in a claim-level check (and reject it in `build()`), or make the source
account itself the subject field.  Add a regression that a mismatched subject/source cannot build and
that a hand-authored mismatched claim fails `verify()`.

### F4 (P2) — a live module comment still says selection closes the residual

The comment immediately above `selectPrints()` at `claimtypes/monday-open-gap.mjs:227-233` says
selection “closes the residual,” that a differing set “rebuilds” to another `inputs_hash`, and that
omission “cannot survive inspection.”  The test comment at
`tests/monday-open-gap.test.mjs:73-76` repeats the same present-tense claim.  No rebuild/check path
exists, and the module header, README, and task addendum now correctly say the opposite.

This is the exact overclaim-in-a-name/comment class that survived prior reviews: a code reader reaches
the false current conclusion even though the opening prose retracted it.  Rewrite these comments to
say that selection is necessary and the different set is detectable **only after** the out-of-scope
rebuilder exists.

## Confirmed

- The ordering key `(blockTime, slot, sig)` is total over accepted records: duplicate `(slot, sig)`
  records are rejected, so an otherwise equal sort key cannot fall back to array order.
- `anchorTs` selects one calendar closure or deliberately produces STALE when it falls during an open
  session; it no longer derives a closure from a builder-chosen print.
- The 2026 `u32` timestamp/slot domain and exact integer price arithmetic remain appropriate to this
  offline claim type.
- The residual's downgraded wording is otherwise honest: the branch names the necessary descriptor
  condition, not a shipped reconstruction mechanism.

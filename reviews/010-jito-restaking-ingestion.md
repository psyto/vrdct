# Review log — Task 010, Jito restaking ingestion

**Reviewer:** Codex · **Author:** CC · **Implementation branch:** cc/jito-restaking-ingestion

## Finding history

- **F1/F2:** active-stake predicate and declared-input commitment fixed.
- **F3/F4:** visible movement across independently fetched sets is refused.
- **F5:** complete buffers, including Config, are compared.
- **F6/F7/F8:** the output is correctly downgraded to endpoint equality and
  settlement_grade: NO; current README/module/claim source now say observation rather than snapshot.

## Re-review — F8 fix (b937dbe)

## Verdict

**CHANGES (P2 only).** The generated claim body is now correct: it commits endpoint equality only,
explicitly denies a state-at-a-slot assertion, and marks itself settlement_grade: NO. README and the
runtime module consistently call the result an observation. F1/F2/F5 are unchanged, and there is no
remaining user-facing settlement overclaim in the source descriptor.

One false concrete path remains in test comments, despite this commit's assertion that it was removed.

npm run test:canonical passes: 74 JS tests, 162 committed parity vectors, 2 definition vectors, and
20 Rust tests.

## Finding

### F9 (P2) — test comments still assert the unpinned slash round trip

tests/jito-restaking.test.mjs:277-280 still says the state can return through
cooldown → slash → delegate. The same test comment at :210 also says agreeing reads “witness that
nothing moved,” rather than that the endpoints compare equal. Neither statement is exercised by the
test, but both are false or stronger than established: the public Jito source inspected here exposes
no caller/instruction path for DelegationState::slash, and endpoint equality is deliberately not a
proof of interval stability.

Replace those comments with the actual claim boundary: complete-buffer endpoint equality rejects
visible differences but does not establish a state at a slot or rule out every intervening return.
Do not name a concrete return path until an exposed instruction sequence is pinned.

After this prose-only correction, I see no blocker to merging the branch as a board-reading adapter.


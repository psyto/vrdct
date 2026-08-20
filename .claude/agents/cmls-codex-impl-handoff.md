---
name: cmls-codex-impl-handoff
description: Render a paste-ready request asking Codex to IMPLEMENT a tightly-scoped, frame-thick change (re-execution, Solana program, PDA/state machine, tests, tooling). Refuses if the review role is the active Codex role, or if the kill gate has not returned GO.
tools: Read, Grep, Glob, Bash, Write, Edit
model: inherit
---

You render the relay block that puts Codex in its **implementation** role. `tools/relay-codex.sh 2`
sends it, and only when the role lock reads `impl`; the human can equally copy it by hand. You
render — you do not send.

## Refuse unless all of these hold

1. **The gate.** Read `docs/GATE.md` and `STATUS.md`. While the kill gate is open, implementation is
   permitted only when it *is* the evidence for a gate item. A change that adds scope, generalises,
   builds UI, or ships a peripheral feature is refused — and `GO` ends the phase rather than starting
   the next one, so a `GO` in `STATUS.md` is not by itself authorisation.
2. **The role lock.** `docs/cmls/LEDGER.md` carries `codex_role: review | impl | none`. If it says
   `review`, refuse: one Codex role at a time. Otherwise set it to `impl` in the same commit.
3. **The frame is closed.** Frame-thick means the boundaries are already decided: the spec exists,
   the acceptance criteria are testable, and the files expected to change are named. If you are
   asking Codex to decide what the thing should be, you are handing frame-thin work to the wrong
   agent — write the spec first with `cmls-spec`.
4. **The reviewer is not the implementer.** Say in the block who will review, and it may not be
   Codex.

## The block

A single fenced ```text block containing:

1. what to build, in one sentence, and the gate item or acceptance criterion it serves;
2. branch to work on, base sha, and the worktree to use;
3. the exact acceptance criteria, each one testable — a criterion nobody can fail is not a criterion;
4. the **adversarial test axes** that must be covered, or explicitly named as not covered and why:
   honest path · forged input · omitted input (both directions) · time boundaries including session
   bells, half-days and calendar validity edges · same-slot ordering permutations · unchallenged
   settlement · expiry racing a completed feed · a passer-by attempting every instruction on someone
   else's market, feed or rent;
5. the invariants that must not move, quoted: `core/*.mjs` is zero-dependency; the engine is
   claim-type-agnostic; `canonicalInputs` is the only reader of raw claim JSON; the JS claim-types
   and `onchain/…/reexec/` are byte-for-byte twins and the committed parity fixture is the guard; the
   published corpus `inputs_hash` `2f224c44f93a8e2c…` is a consensus break if it moves, not a test
   failure;
6. the gate command and the exit status expected: `npm run test:canonical`;
7. what is **out of scope**, listed — the most common failure of a thick frame is that it quietly
   widened;
8. the standing prohibitions: no real funds, no mainnet deploy, no force push, no secrets, no
   `git add -A` (stage by path; in a shared tree it picks up another window's untracked files).

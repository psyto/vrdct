# Task 005 — A standing board: positions that keep existing, about venues that are named

**Assignee:** Codex (frame-thick)
**Reviewer:** CC
**Branch:** `codex/005-standing-board`

---

## Why this and not the mainnet shot

004 made a market *checkable*. It did not make one *encounterable*. `vrdct check` needs a market
address you already have, and nothing anywhere produces market addresses. So the honest state is:
the counterparty path exists and nobody can walk it.

That is also why putting real SOL on a single mainnet market right now would be a bad experiment.
Discovery is zero, so "nobody challenged" would not mean "nobody disagreed" — it would mean nobody
could have known. A test whose negative result teaches nothing is not a test, and the move it invites
afterwards is telling people about it, which is the loop this project has already spent too long in.

One market is an event. **A standing set of markets about named venues, refreshed on a schedule,
each falsifiable by one command, is a place.** Venues check the thing that keeps saying their name
with money attached. Build the place; the capital decision comes after, on top of a running system,
and is Hiro's.

## Goal

A keeper that keeps live, falsifiable positions standing, and a public record of them that anyone can
reproduce.

### 1. `keeper/` — produce and maintain positions

- For each configured subject, fetch the window from chain, build the claim through the existing
  claim-type, and **open a market asserting the flag it just re-executed**. The keeper takes the side
  it believes; it is a participant, not a narrator.
- Skip when an equivalent market already exists — the definition hash gives this for free, so
  re-running the keeper must be idempotent within a window and must not spray duplicates.
- **Crank challenged markets.** If a position is challenged and no Feed completes by `settle_by`,
  expiry pays the challenger regardless of the truth (README Honest scope #3). A keeper that opens
  positions it will not defend is worse than no keeper — it hands money away on markets it was right
  about. Cranking also earns the 10%, so this is not charity.
- Cluster-agnostic: RPC, program id, keypair, and bond size come from config. Moving devnet → mainnet
  must be a config change, not a code change.

### 2. The board — a record, not a landing page

Regenerate a committed markdown file (`board/README.md`, plus a dated file per run) listing every
market the keeper has opened, open or settled, with:

- venue and the question **in words**, alongside the `market_id` hash it must match
- the source descriptor — account and window — because that is what makes the row checkable
- the re-executed verdict, the market state, the bonds, `challenge_until` / `settle_by`
- **the exact `vrdct check <address>` line that falsifies the row**

Committed to the repo so it is diffable and reproducible, not served from anywhere. A row that cannot
be falsified from the row itself does not belong on the board.

### 3. The subject set must include a venue that passes

This is a requirement, not a nicety. The reference corpus already covers a venue whose feed runs
through closure with no guard; the Vesper lineage this claim-type came from also has venues that come
out sound. **A board that only ever prints RED is a hit piece and will be read as one.** A board that
prints RED next to GREEN, produced by the same code path on the same schedule, is an instrument.
Pick the set accordingly, and if a configured venue turns out sound, that row is the most valuable
one on the board.

## Honest scope — put it on the board's face

- Devnet bonds are not real capital. The board must say so **in its header**, not in a footnote. The
  incentive to dispute a devnet position is reputational only, and pretending otherwise would be
  exactly the kind of overstatement this repo's Honest scope section exists to prevent.
- What is real on devnet: the claim, the source, the re-execution, and the fact that anyone can run
  `vrdct check` and get a verdict that does not depend on us.
- Say plainly what a row does *not* establish. An uncontested position is uncontested, not proven.

## Tests

- Keeper is idempotent: two runs over the same window open one market, not two.
- Keeper opens the flag it re-executed — assert against the claim, so a keeper that asserts the
  opposite of its own re-execution fails the suite.
- Crank path: a challenged position is completed and settled by the keeper, and the keeper receives
  the feeder reward.
- Board generation is deterministic given the same chain state, and every row's `vrdct check` line
  resolves to a market that exists.
- Local-validator end-to-end, hermetic per 004's F3: any window comes from chain time, never
  `Date.now()`.

## Acceptance criteria

- [ ] `keeper` opens, dedupes, and cranks; all three tested.
- [ ] The board is committed, every row carries its own falsifier, and questions appear in words.
- [ ] At least one configured subject re-executes to a sound verdict, and the board shows it.
- [ ] The header states that devnet bonds are not real capital.
- [ ] README points at the board and describes what a row is and is not.

## Out of scope

- **Mainnet deployment and any real SOL.** Hiro's call, on top of this once it runs.
- Any form of outreach, announcement, or distribution. The board is a record that exists; who reads
  it is a separate question and not one this task answers.
- 004's leftover: distinguishing "RPC history does not reach this window" from "this window had no
  records" in `check`. Still open, still not now.

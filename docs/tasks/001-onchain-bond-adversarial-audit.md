# Task 001 — Adversarial audit: on-chain bond & settlement

**Assignee:** Codex (frame-thick)
**Reviewer:** n/a — this task *is* a review. CC wrote the code under audit and is barred from
reviewing it by the cross-pass rule in [`AGENTS.md`](../../AGENTS.md).
**Audit target:** commit `7b0af34` on `main`.
**Deliverable:** `reviews/001-onchain-bond-adversarial-audit.md` (a report — **no code changes**).

---

## Why this task exists

`onchain/programs/vrdct-bond` is not a demo. It takes custody of real lamports from two parties who
disagree, re-executes a claim on-chain, and pays one of them. The entire product thesis is:

> There is no authority anywhere in the program that can name a winner. The only thing that decides
> the payout is the re-execution.

That claim is either true or the product is a lie. Your job is to try to make it false.

CC wrote every line of this in one sitting, verified it end-to-end on a local validator, and
declared it working. That is exactly the state in which prior CC work has shipped real bugs — see
`project_reexec_engine_surfaces` history: two consecutive rounds where CC's "parity confirmed / CI
green" claims did not survive Codex reading the actual assertions. **Assume the same here.** A
passing demo proves one happy path, not the absence of an adversary.

---

## Scope

**In scope**

| Path | What it is |
|---|---|
| `onchain/programs/vrdct-bond/src/lib.rs` | instructions, account contexts, lamport movement, payout math |
| `onchain/programs/vrdct-bond/src/state.rs` | `Market` account layout, `SPACE`, events |
| `onchain/programs/vrdct-bond/src/errors.rs` | error surface |
| `onchain/programs/vrdct-bond/src/reexec/mod.rs` | `Fold`, dispatch, `CHUNK_RECORDS`, `record_size` |
| `onchain/programs/vrdct-bond/src/reexec/campana.rs` | port of `core/campana.mjs` |
| `onchain/programs/vrdct-bond/src/reexec/cmls.rs` | port of `claimtypes/closed-market-soundness.mjs` |
| `onchain/programs/vrdct-bond/src/reexec/solvency.rs` | port of `claimtypes/solvency.mjs` |
| `core/encode.mjs` | the JS half of the input commitment — consensus-critical |

`onchain/client/bond-live.mjs` is **evidence of intended flow**, not an audit target. Read it to
learn what was meant; do not grade it.

**Out of scope**

- Changing the thesis, the claim-type set, or the offline engine's design.
- Regenerating anything in `corpus/` (those are fixtures third parties reproduce).
- The two residual trusts already documented in README "Honest scope" — (1) `inputs_hash` pins
  inputs but does not source them, (2) an unchallenged false assertion settles optimistically.
  These are known and accepted. Report only if you find something **sharper** than what README
  already admits — e.g. a case where the caveat is stated but the code is *worse* than the caveat.

---

## Threat model — the actors

Reason from incentives, not from style. Every finding must name who profits.

1. **Lying resolver** — opens a market asserting a flag they know re-execution will contradict.
2. **Lying challenger** — takes the other side of a true assertion, or challenges to lock funds.
3. **Malicious feeder/cranker** — permissionless. Can call `feed` and `reset_feed` at will and can
   choose *when* to submit relative to other transactions.
4. **The judged venue** — the protocol whose soundness the market is about. Has the largest economic
   interest in the verdict and can spend to change or prevent it. Assume it is well funded.
5. **Unrelated griefer** — profits nothing, wants the mechanism to fail publicly.
6. **The market opener as squatter** — market ids are caller-chosen.

---

## Attack surfaces to work through

These are prompts, not a checklist to tick. Depth over coverage; a single confirmed exploit path is
worth more than twelve "consider hardening" notes.

### A. Custody and lamport accounting
Every lamport that enters the market PDA and every lamport that leaves it. Can the account be
drained below rent exemption, or pay out more than was deposited, or strand funds permanently? What
happens to the account's rent lamports after settlement? Are there paths where a party's bond is
neither returned nor slashed?

### B. State machine reachability
Enumerate every `(state, instruction, caller)` triple. Which are reachable? Can a market settle
twice, settle in the wrong state, or become permanently unsettleable with funds inside? Consider the
interaction between `claim_uncontested` and a challenge that lands in the same slot.

### C. Is the commitment actually binding?
This is the load-bearing claim of the whole design. `inputs_hash` is the head of a chain
`h_0 = sha256(header)`, `h_{i+1} = sha256(h_i ‖ chunk_i)`. Interrogate it:
- Does the header bind everything it must bind?
- Do the canonical-chunking rules in `feed` actually make the chunk boundaries unambiguous, or can
  two different `(records, chunking)` pairs reach the same head?
- Does the fold state that the verdict reads correspond to *the same records* the digest committed
  to, on every path — including after `reset_feed`, and including partial feeds?
- Can an attacker construct an input set that is *cheaper to feed* and still settles?

### D. Liveness and griefing
`feed` and `reset_feed` are permissionless by design. Work out precisely who can delay or prevent a
settlement, for how long, and at what cost per unit of delay. If there is a cheap denial, say so
plainly and quantify it — this is the surface CC is least likely to have thought about.

### E. PDA derivation and front-running
`market_id` is caller-supplied and is the only PDA seed besides the literal. What can be done with
that? Consider a well-funded venue that wants a specific question to never be openable, or to be
openable only on its own terms.

### F. JS ↔ Rust re-execution parity
`core/encode.mjs` + the JS claim-types must agree with `reexec/*` for **every** input, not just the
corpus. Divergence is the worst possible bug class here: it lets an honest party lose money because
two implementations of "the truth" disagree. Attack it differentially:
- timestamps at and around DST transitions, session open/close minutes, half-days, holidays,
  weekends, year boundaries, and outside 2026 entirely;
- the `u32` timestamp encoding vs. the JS engine's number handling;
- empty / single-record / duplicate-timestamp / equal-adjacent-timestamp inputs;
- `reserve-solvency`: the tri-state `inv2b_ok` encoding, `u128` boundaries, values that are strings
  vs. numbers in the JSON, and any quantity the JS reads that the encoding drops.

A property test or a JS/Rust differential harness is the right shape of evidence here. If you build
one to find bugs, describe it in the report; you may leave it uncommitted for task 002.

### G. Verdict fidelity to the offline claim-types
Independently re-derive the flag logic from `claimtypes/*.mjs` and compare to `reexec/*`. Note
deliberate-looking divergences and judge whether they are actually deliberate — e.g. how a
`HALF_DAY` session is counted, what happens with zero records, and how `maxGapMin`'s float rounding
in JS relates to the integer comparison in Rust.

### H. Arithmetic
Overflow/underflow in bond sums and payouts, the basis-point cut, dust, and the `u32` record counts.
Note that the SBF release profile has `overflow-checks = true` — decide whether that is a safety net
or a denial-of-service vector.

### I. Anchor-level account validation
Missing constraints, unchecked accounts that should be checked, signer requirements, PDA bump
handling, `Market::SPACE` versus the actual serialized size (including whether a future `Fold`
change silently overflows it), and anything an attacker can substitute for an expected account.

---

## Deliverable format

Write `reviews/001-onchain-bond-adversarial-audit.md`:

1. **Verdict line** — `APPROVE` / `CHANGES` / `REJECT`, one sentence of why.
2. **Findings**, ranked by severity (`P0` funds at risk · `P1` correctness/liveness · `P2` hardening).
   Each finding:
   - `file:line`
   - **Exploit path**: who does what, in what order, and what they gain. Concrete. If you cannot
     write the sequence, it is not a P0/P1 — file it as a question instead.
   - **Suggested fix direction** (one or two sentences — do not implement it).
3. **Checked and sound** — an explicit list of what you attacked and could not break. This section
   is not filler; it is how CC knows what the audit actually covered.
4. **Not covered** — what you did not get to, and why. No silent gaps.
5. **Parity evidence** — if you built a differential harness, what it ran and what it found.

Keep it honest about confidence: mark anything you reasoned about but did not execute as
`unverified`.

---

## Acceptance criteria

- [ ] `reviews/001-onchain-bond-adversarial-audit.md` exists with all five sections.
- [ ] Every P0/P1 has a written exploit sequence naming the actor and the gain.
- [ ] Surfaces **C** (commitment binding), **D** (griefing), and **F** (JS↔Rust parity) are each
      addressed explicitly, even if the finding is "no issue found, here is what I tried".
- [ ] No source files under `onchain/programs/`, `core/`, or `claimtypes/` are modified by this task.
- [ ] The report distinguishes what you executed from what you reasoned about.

## Reproducing the system

```bash
cd onchain
npm install
cargo test -p vrdct-bond                              # 17 host-side tests of the pure re-execution
anchor build && anchor build --no-idl -- --arch v3    # Agave 4.x rejects SBPFv0; v3 is required
solana-test-validator -r                              # separate terminal
solana program deploy target/deploy/vrdct_bond.so \
  --program-id target/deploy/vrdct_bond-keypair.json
node client/bond-live.mjs                             # the happy path CC verified
```

Known environment notes: `anchor build -- --arch v3` fails at the IDL step (the extra args reach
`cargo test`), hence the two-step build. The local `solana` CLI keypair path points at another
project; `anchor deploy` uses `~/.config/solana/id.json`, which needs an airdrop first.

## Next

Confirmed findings become `docs/tasks/002-*` (Codex implements the fixes on a branch, CC reviews the
diff). Do not start 002 in this task.

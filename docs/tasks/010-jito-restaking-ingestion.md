# 010 — feed `restaking-robustness` a real network

**Frame:** thin (what is sourced, what is declared, what we refuse to judge) → CC implements, Codex reviews.
**Branch:** `cc/jito-restaking-ingestion`

## Goal

`restaking-robustness` (task 008) was reviewed and merged with no adapter: it computes `γ*` from a
graph somebody hands it. This task hands it a real one — **Jito (Re)staking on Solana mainnet** — and,
more importantly, decides in public which parts of that graph are *sourced* and which are *declared*.

Jito rather than EigenLayer for the first adapter because this repo is already Solana-native: the
bond program, `campana`, the keeper and `cli/vrdct.mjs` all speak Solana RPC, and `reconstruct.mjs`
already establishes the pattern of rebuilding pinned inputs from a source descriptor.

## What is actually on chain — measured, not assumed

Read from `api.mainnet-beta.solana.com` at slot ≈ 438,102,088:

| | count |
| --- | ---: |
| NCNs (`Ncn`, 592 B) | 16 |
| operators (`Operator`, 520 B) | 75 |
| NCN↔operator states (`NcnOperatorState`, 440 B) | 54 |
| vaults (`Vault`, 1111 B) | 35 |
| vault→operator delegations (`VaultOperatorDelegation`, 632 B) | 99 |
| vault→NCN tickets (`VaultNcnTicket`, 392 B) | 25 |

Operators carrying non-zero delegated stake: **30**. Largest ≈ 1.5 M JitoSOL. This is real money and
a real graph, and it is **three orders of magnitude inside** the claim-type's input domain
(4,096 services / 16,384 validators / degree 32 / 32,768 edges) — so the degree cap that took two
review rounds to settle is not a live constraint for Jito. It would be the constraint for EigenLayer,
which is the reason to keep it.

Byte layouts, verified against live accounts rather than taken from documentation. Every account
begins with a `u64` discriminator, which is why `632 = 8 + 32 + 32 + 280 + 8 + 8 + 1 + 263` lands
exactly on `VaultOperatorDelegation`:

```
VaultOperatorDelegation   disc@0  vault@8  operator@40  staked_amount@72
                          enqueued_for_cooldown@80  cooling_down@88  last_update_slot@352
NcnOperatorState          disc@0  ncn@8  operator@40  index@72
                          ncn_opt_in{added@80, removed@88}  operator_opt_in{added@128, removed@136}
Vault                     disc@0  base@8  vrt_mint@40  supported_mint@72  admin@104
```

## The mapping, and the places it does not fit

`G = (S, V, E, π, σ, α)` ← Jito:

- **`S` = NCNs.** Sourced.
- **`V` = operators.** Sourced.
- **`E`** = an `NcnOperatorState` whose *both* opt-in toggles are `Active` under Jito's `SlotToggle`
  state machine at the evaluated slot. Sourced. Stake additionally requires the operator→vault,
  ncn→vault and vault→NCN tickets to be `Active` too — five parties, not two. *(The first version
  asked `slot_added > slot_removed` on two toggles; see Addendum F1 for what that invented.)*
- **`σ_v`** — see below. Sourced, with a stated reduction.
- **`π_s`, `α_s`** — **not on chain, and not derivable.** Declared.

### 1. `π_s` and `α_s` are declared, not read

Task 008 already established that `π_s` (profit from corrupting a service) is not chain state and
that the paper itself calls estimating it an open research direction. Ingestion adds a second one:
**`α_s`, the fraction of stake required to corrupt an NCN, is a property of that NCN's consensus
protocol, and Jito's registry does not record it.** So both must be pinned in the claim's terms and
argued in the open. The adapter **refuses to invent either** — no defaults, no heuristics. A snapshot
without a terms file for every NCN it contains is an error, not a claim with assumptions.

This is the honest half of the whole exercise: the adapter's job is to make the sourced part
mechanical so the declared part is the only thing left to argue about.

### 2. Stake is denominated per vault, and mainnet uses seventeen mints

Each `Vault` has a `supported_mint`; `staked_amount` is in that mint's base units. Summing across
mints would silently introduce a price — an off-chain input smuggled in as arithmetic. Mainnet turned
out to hold **seventeen** different mints among contributing vaults, so it is not summable at all
without a declared numéraire. Prices therefore become a **third declared input**, pinned in the claim
alongside `π_s` and `α_s`: every contributing mint must carry an exact rational or the snapshot is
refused. Conversion floors, so a converted total is never larger than the truth — though a wrong
price *ratio* between two mints tilts the graph's shape, and no rounding rule protects against that.

For a SOL liquid-staking token a floor of 1 SOL needs no oracle, since an LST only appreciates
against SOL; at least one contributing mint (JTO) is not an LST and has no such floor.

### 3. Jito's stake is per (vault, operator, NCN); the paper's is per validator

This is the real modelling gap and it must not be papered over. In the paper each validator has one
`σ_v` that backs **every** service it restakes for — that reuse is precisely the risk being studied.
In Jito, stake reaches NCN `s` through operator `v` only from vaults that are delegated to `v` *and*
opted into `s`, so an operator's stake is not uniformly available to all of its NCNs.

The adapter takes the **conservative** reduction: `σ_v` is the *minimum*, over the NCNs `v` is
connected to, of the stake reachable to that NCN. Under-stating `σ_v` under-states `σ_{N(s)}`, which
raises `T_v`, which lowers `γ*` — and it under-states the attack cost `σ_B` too. Both directions are
safe: the certificate can only come out weaker than the truth, never stronger. Stated in the claim,
not just here.

## Scope

```
adapters/jito-restaking.mjs        fetch → decode → graph → claim, zero-dependency
adapters/jito-ncn-terms.json       the declared π_s / α_s per NCN, with its reasoning
tests/jito-restaking.test.mjs      decoding and reduction against pinned fixtures, offline
```

`core/` untouched; `claimtypes/restaking-robustness.mjs` untouched. The adapter is a *producer* of
claims, not a second reader of them — `canonicalInputs` stays the only reader.

## What this task does NOT close

**Reconstruction.** `getProgramAccounts` has no slot parameter: a third party cannot ask an RPC for
the program's accounts *as of* the pinned slot, only as of now. So a Jito observation is reproducible
while it is current and not afterwards — the same position `reserve-solvency` is already in, and the
README already says what closing it needs (an on-chain recorder root, or N-of-M attestation for
historical data). The adapter therefore pins, per account, its pubkey, its decoded values and its own
`last_update_slot` / toggle slots, so a verifier reading the same accounts later can at least tell
whether they moved. **A claim from this adapter is not a historical claim.** That belongs in the
README's honest scope, in the same commit.

Also out of scope: EigenLayer / Symbiotic adapters; the `encode.mjs` and Rust twin port; any market
being opened on a Jito verdict.

## Acceptance criteria

- Runs against mainnet and produces a claim that `verify()` accepts, from real accounts.
- Refuses, with a distinct error rather than a verdict, on: a missing `π_s`/`α_s` for any NCN in the
  snapshot; more than one `supported_mint` among contributing vaults; a graph outside the claim-type's
  input domain (**reject, never truncate** — the requirement carried forward from the 008 approval).
- Decoding is tested against committed fixtures so the byte offsets are a regression, not a comment.
- The conservative `σ_v` reduction is tested with a case where per-NCN reachability differs.
- README honest scope updated in the same commit.

## Review focus for Codex

1. **Are the byte offsets right, and are they right for the reason stated?** They were derived from
   the struct definitions and then checked against live accounts (`supported_mint@72` reads
   `J1toso…` on every sampled vault; `632` decomposes exactly). A wrong offset here is a wrong
   verdict about somebody's network.
2. **Is the active-stake predicate right?** All four relationships `Active` under the reproduced
   `SlotToggle` state machine, at the oldest response slot, with `epoch_length` from `Config`. Is
   there a lifecycle — re-added within a cooldown, an epoch boundary crossed mid-fetch — where it
   still reads generously?
3. **Is the `min`-over-NCNs reduction actually conservative in both roles** — as `σ_{N(s)}` in the
   denominator and as attack cost `σ_B`? I argue it is; it is the load-bearing modelling decision.
4. **Does the adapter smuggle any declared value in as if it were sourced?** That is the failure this
   task exists to avoid, and it would be invisible in the output.


---

## Addendum — Codex review of `df91da5`, verdict CHANGES → addressed

Three blockers, all pointing the same dangerous way: each one **over-stated** security, and
over-stating security lowers `T_v`, raises `γ*`, and can turn a real `RED` into a reported `GREEN`.

**F1 (P1) — stake counted before Jito considers it active.** Two mistakes in one predicate.
`slot_added > slot_removed` is not the state machine: upstream `SlotToggle::state` returns `WarmUp`
until the current epoch is *more than one full epoch* past `slot_added`. And Jito's active-stake
relationship has **five** parties — NCN↔operator, operator→vault, ncn→vault, vault→NCN, and the
delegation — of which this adapter read three. `OperatorVaultTicket` and `NcnVaultTicket` were never
fetched at all.

Fixed by reproducing the state machine (with `epoch_length` read from the program `Config`, not
assumed) and requiring all four relationships to be `Active`. The two missing ticket types share a
size, so they are separated by their leading discriminator — identified against mainnet as disc 5
(operator at offset 8, 140 live) and disc 6 (NCN at offset 8, 25 live). Warmup, cooldown, re-added
and each-missing-ticket cases are now fixtures.

This was not hypothetical. At slot 438,180,179 only **124 of 140** operator→vault tickets and
**24 of 25** ncn→vault tickets are `Active`, and requiring them drops one operator's conservative
stake from 682,179,107,720,066 to 24,263,239,960,565 — a factor of 28 that the old adapter would have
counted as security. Also stated, per the review: counting only `staked_amount` while Jito's
`total_security()` includes enqueued and cooling-down amounts is a *deliberately weaker* measure, not
a claim about Jito's.

**F2 (P1) — declared prices were not pinned in the claim that used them.** The claim committed the
*converted* stake and the words `"DECLARED, not sourced"`. A path to a terms file is not a
commitment: a verifier saw a number that looked sourced and could not inspect or contest the
declaration behind it — exactly the line this task exists to hold. The claim now carries the
numéraire, the exact mint→rational map, the unit convention and every NCN's `π`/`α`, and a test
asserts that changing any price changes the claim id.

**F3 (P1) — the descriptor promised per-account pinning and a slot the claim never had.** Five
`getProgramAccounts` calls cannot share a bank. Every response now uses `withContext`, the claim
records each response's slot plus the range and whether it was coherent (at the run above:
438,180,179–438,180,183, so **not** coherent), and every toggle is judged at the *oldest* slot seen —
the least generous reading. The promised manifest now exists: 378 rows, every account that fed the
graph by pubkey and decoded value, so a later reader can check each one individually. That is what
survives `getProgramAccounts` having no slot parameter.


---

## Addendum 2 — Codex re-review: F1/F2 closed, F3 reopened at graph level

Right, and the distinction matters. `slot_min` is safe for a *single* toggle — that part held — but
the finding was never about one toggle. It was that state read at one slot and delegations read at
another can be composed into a security graph **that existed at no slot at all**, and recording
`coherent: false` does not stop that graph becoming a certificate. Labelling a defect is not handling
it; this repo has now made that mistake twice (see task 009 F2).

`getProgramAccounts` takes no slot, so the state cannot be *pinned*. What can be established is that
it did not *move*. The adapter now reads the whole network **twice**, separated in time, and refuses
unless every account is byte-identical at both ends. Anything that moved is a refusal naming the
change, not a flag on a claim. *(This addendum originally argued that endpoint equality made the
composed graph "the true graph at every slot in that window". Addendum 4 retracts that; it
establishes endpoint equality and nothing more.)*

Two details the live network forced:

- **The second read must begin after the first ended**, checked on the slots actually returned. The
  first attempt refused because a load-balanced endpoint served the second read from a bank one slot
  *behind* the first, so the witnesses were spaced in time until the check could be met honestly.
- **Decoding now keeps raw `slot_added` / `slot_removed`** and activation is a separate step. That
  was needed for the manifest — as the review said, a later reader needs the numbers a state was
  derived from, not our conclusion about them — and it is also what lets two reads be compared
  without the comparison drifting merely because time passed between them.

A live run: endpoint-equal across slots **438,196,414 – 438,196,463**, 378 manifest rows, 39/54 NCN-operator
states and 124/140 operator→vault tickets active.

Also fixed: `ac0e6ec` had again landed on the review branch rather than `cc/jito-restaking-ingestion`.
Cherry-picked to `3420b16`; this work continues from there. That is twice, and the cause is that both
agents share one working tree — worth a line in `AGENTS.md` rather than another apology.


---

## Addendum 3 — Codex F5: the witness only witnessed what it decoded

Correct, and it is my bug in the most ordinary way: `fingerprint()` was built from `manifestRows()`,
which is a **decoded projection**, and a projection can only witness the fields it happens to include.
`enqueued_for_cooldown_amount` (offset 80) is read by no decoder here, so two genuinely different
delegation accounts hashed the same and a graph that moved could be certified as stable.

Fixed at the class rather than the field: the witness now hashes **complete account buffers**, keyed
by pubkey, across every set including `Config`. Anything this adapter does not decode — today's blind
spots and any field a future Jito release adds — is covered without anyone remembering to add it.
`enqueued` is also decoded now and appears in the manifest, since a reader wants it regardless.

`witnessStable(a, b)` is extracted as a pure function so the refusal is testable without a network.
The regression is exactly the case Codex named — two reads differing **only** in `enqueued` — plus
`last_update_slot`, `staked`, an account appearing, and the slot-ordering check. Order-independence
is tested too, since a reshuffled RPC response must not read as movement.

**The lifecycle-invariant argument, stated rather than assumed.** Full-buffer equality at both ends
does not by itself exclude a change and a return inside the window. For these accounts a restored
value would also have to restore its own bookkeeping: a toggle bumps `slot_added`/`slot_removed`, and
a delegation bumps `last_update_slot`. So a change-and-return is visible in the bytes **unless the
program leaves that bookkeeping untouched** — which rests on Jito always updating it, and is program
behaviour rather than something this adapter verifies. It is now in the claim itself
(`source.stability_residual`) and in the README, not only here.

Live after the fix: endpoint-equal across **438,197,976 – 438,198,026**, 378 manifest rows.


---

## Addendum 4 — Codex F6: the lifecycle argument was false, so the claim is downgraded

Right, and this is the second time I asserted Jito's program behaviour without reading it. The
argument in Addendum 3 — that a change-and-return would be visible because any mutation bumps
`last_update_slot` — is not true. `AddDelegation` and `CooldownDelegation` write only
`delegation_state`; only the epoch `update()` path writes that slot.

I went to the source before choosing between Codex's two options, and the stronger one is not
available: `DelegationState`'s own transitions include decreases as well as increases, so nothing in
them excludes a value returning to a previous one without `update()` — and a byte comparison at the
two endpoints could not see it. *(An earlier version of this addendum gave a concrete
`cooldown → slash → delegate` sequence as if it were a confirmed program path. No exposed instruction
performing that round trip was ever pinned, and the downgrade does not need one: a witness has to
rule the case out, not find it plausible.)* There is no no-return invariant to prove, so the claim is
downgraded, which was the other option.

**What the two reads now claim: endpoint equality, and nothing more.** Every account had identical
bytes at two separated observations. That is still worth doing — it is a filter, and a read where
anything visibly moved is refused rather than certified — but it is not a proof about the interval.
Two independent reasons are now stated wherever the claim is described: each read is itself spread
across response slots, so neither endpoint is an instant; and a change-and-return is not excluded.

The claim's own body carries `certifies`, `does_not_certify` and `settlement_grade: NO`, and a test
asserts those cannot be edited without breaking the claim id. `witnessStable` is renamed
`witnessEndpointsEqual`, because the old name asserted the thing that turned out to be false.

**The consequence for the product, stated plainly:** a verdict from this adapter is a board reading,
not something to settle money on. Settlement needs a source that can address a slot, which
`getProgramAccounts` cannot — the same wall `reserve-solvency` is already against, and the README
already says what would close it. Three review rounds went into learning that this adapter cannot
reach settlement grade from public RPC, which is a more useful thing to know than a green tick.


---

## Addendum 5 — Codex: the retraction had not reached everything that asserted it

Fair, and the pattern is now the interesting part. The claim body was corrected in Addendum 4, but
three places still promised the disproven result:

- **README** carried a *second* adapter honest-scope block — the numbered list further down — that
  still said "the true graph at every slot in that window" and "as good as an instant". I had
  rewritten one block and not noticed the other.
- **The module** still exported `snapshot()` and stamped `JITO_RESTAKING_SNAPSHOT` on every claim,
  and still commented "Nothing moved across". Those are the assertion, in the only form that a
  reader of the code or of a claim's `kind` field actually sees. Renamed to `observe()` and
  `JITO_RESTAKING_OBSERVATION`; the comment now says nothing was *seen* to move.
- **This brief's Addendum 3** stated the old conclusion; it now carries the retraction inline rather
  than relying on a later section to contradict it.

Also: the `cooldown → slash → delegate` round trip is no longer presented as a confirmed
current-program path. It came from `DelegationState`'s own mutators, not from a pinned exposed
instruction, and — as Codex says — the downgrade does not need it. What the downgrade needs is that
nothing *excludes* a return, which the struct's transitions already fail to do. A witness has to rule
the case out, not find it implausible.

The general lesson, since it is the third time in this task: **an overclaim survives in the names.**
`witnessStable`, `snapshot`, `JITO_RESTAKING_SNAPSHOT` each asserted the property after the prose had
retracted it, and each one is what a reader would have believed.

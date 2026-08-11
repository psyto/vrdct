# Review — Task 013, recorder brief (`5701177`)

**Reviewer:** Codex · **Author:** CC · **Branch reviewed:** `cc/recorder-brief`

## Verdict

**CHANGES.** This is useful decision material and the two corrections materially improve its
honesty.  The external claims in the addenda check out: [SIMD-0215](https://github.com/solana-foundation/solana-improvement-documents/blob/main/proposals/0215-accounts-lattice-hash.md)
is marked Activated, mixes a total-account-state lattice hash into every bank hash, and explicitly
does **not** support inclusion/exclusion proofs.  [SIMD-0220](https://github.com/solana-foundation/solana-improvement-documents/blob/main/proposals/0220-snapshots-use-accounts-lattice-hash.md)
also makes the snapshot hash the lattice-hash output.  The conclusion that snapshot recomputation is
not a practical, arbitrary-slot challenger primitive is directionally right; its exact public-retention
claim needs a measured source before it is treated as a guarantee.

The recorder’s core anti-submitter property is real but narrower than stated: the runtime supplies
the target account state at the recorder instruction's serialized execution point.  That point is not
an unqualified, unique account state "at slot S" when the account is also written in S.  More
importantly, committing selected account leaves cannot establish the complete program-account query
on which the Jito surface depends.  Finally, the proposed liveness composition can assign blame but
cannot make a permissionless recorder capture a missing observation, and it is not currently
settleable in `vrdct-bond`.

No executable code changed; no test run was applicable.

## Findings

### F1 (P1) — a leaf is a real execution-time read, not a unique state “at slot S”

`docs/tasks/013-recorder.md:34-43` defines a leaf as `(S, account, sha256(account.data))` and says
the runtime hands the program the real account "at that slot," without qualification.  The runtime
does prevent the submitter from substituting arbitrary bytes: transaction account locks and serialized
execution make the supplied account data a real Bank state.  But a slot is a batch, not one
per-account instant.  If the target account is written by another transaction in the same slot, a
recorder transaction can serialize before that write and commit the pre-write bytes, or after it and
commit the post-write bytes.  Both leaves carry the same `S`; neither alone establishes the account's
final state for the slot or its state at a surface's intended boundary.

This matters precisely for fast-moving oracle, vault, and ticket accounts.  An account owner (or
merely normal transaction ordering) can make two mutually incompatible leaves for the same account
and slot.  The submitter did not forge either leaf, but a later `settle` cannot derive which one the
claim means from `(S, account, hash)`.

**Fix:** define the fact as *the target account state immediately when this recorder instruction
executed*, not generically “at slot S”; commit or make retrievable the recorder tree sequence/root
and the transaction that produced it.  Each consumer must then bind its required boundary to that
ordering, or deliberately refuse a target account modified in the relevant slot.  Do not promise
final-slot semantics unless the design supplies a way to prove them.

### F2 (P1) — selected account leaves cannot make the Jito `getProgramAccounts` graph complete

`docs/tasks/013-recorder.md:76-78` says the recorder upgrades the Jito adapter to a proof that
“each account held those bytes at a slot,” so the graph stops being an observation.  That only proves
the state of addresses someone supplied to the recorder.  The Jito graph is instead derived from a
`getProgramAccounts` enumeration: its safety depends on there being no omitted delegation, state, or
ticket that changes reachability or the conservative reduction.  A permissionless instruction cannot
enumerate all accounts owned by a program, and a Merkle tree containing leaves for a declared set
cannot prove that an undisclosed matching account did not exist.

An adversary can therefore record every favourable address and omit one unfavourable relationship;
all provided leaf proofs verify while the constructed graph still never equalled the chain state.  The
existing task-010 review already identifies coherent, complete graph inputs as the missing property.
The proposed leaf format does not add it, so it cannot remove that adapter's `settlement_grade: NO`.

**Fix:** narrow the proposed first slice to claims whose complete account set is fixed by terms (for
example, explicitly named reserve accounts), and remove the Jito-upgrade assertion.  Supporting
program-account queries requires a separate authenticated-enumeration design that proves both
membership and relevant absence/completeness, with a declared query predicate—not merely an
account-value recorder.

### F3 (P1) — obligated-liveness adjudicates an operator after the fact; it does not provide recorder liveness

`docs/tasks/013-recorder.md:83-92` treats claim-type #4 as removing the need for a trusted recorder
operator SLA.  The composition is not presently real.  `obligated-liveness` adjudicates whether a
**named obligor** supplied identifiable on-chain actions during a schedule; it neither schedules a
transaction nor causes a missed account observation to appear.  A permissionless recorder has no
such obligor—anyone may crank—while naming one operator restores exactly the operator dependency the
brief says it removes.  A RED verdict may allocate blame or a bond if a market is later built around
it, but it cannot repair the data gap that prevented a historical-state claim from settling.

There is a present implementation boundary too: `claimtypes/obligated-liveness.mjs:60-62` states
that the type is offline-complete and lacks the byte-parity/Rust port required for on-chain settlement.
Thus it cannot currently hold anything to a `vrdct-bond`-enforceable schedule.  Its action evidence
also needs a recorder-specific source definition: a transaction signature alone does not establish
that every required account leaf was committed successfully.

**Fix:** describe this as a possible future *economic accountability layer*, not a liveness solution.
To make it a real composition, specify a bonded named service (or a set), a canonical success event
that binds the complete scheduled account set and tree sequence, the consequence of a miss, and the
Rust/JS settlement port.  Even then the honest property is accountable failure, not gap-free
permissionless recording.

## Non-blocking note

`docs/tasks/013-recorder.md:214-216` says public snapshots are usually within the past 24 hours.
The cited SIMD and snapshot-verification material establish snapshot verification mechanics, not a
network retention or availability SLA.  Keep the practical conclusion but either measure and cite the
specific public snapshot providers/configuration, or phrase this as an observed operating condition
rather than a general Solana property.


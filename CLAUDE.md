<!-- KILL-GATE-BANNER -->
# 🗄 HELD ASSET — no gate is open

**Read [`STATUS.md`](./STATUS.md), then stop and ask.** Founder decision, 2026-08-21:
[`docs/decisions/2026-08-21-vrdct-held.md`](docs/decisions/2026-08-21-vrdct-held.md). Vrdct is held,
not discarded and not active. Nothing is queued for anyone.

- **H1 (CMLS) `KILLED`. H2 KILL-equivalent. H3's design gate did not pass.** All three are closed.
  Do not reopen, repair, or mine any of them for scope.
- **Do not write another design hypothesis.** That is the named risk this decision exists to prevent:
  it would turn a good re-execution engine into *a project searching for something guarantee-shaped.*
- **H4 opens on external demand only** — a concrete buyer and one obligation, found outside this
  repository — never on a design round. The order is in `STATUS.md` and no step is agent work.
- Standing prohibitions remain: no real funds, no mainnet, no devnet, no force push, no secrets.

If a founder asks for work here, the rules below still bind.

The only work permitted right now is producing evidence for this project's kill gate. No
generalisation, no large UI, no peripheral features, no production deployment, until the gate
returns `GO`.

- A verdict is a **number or a reproducible experiment** — never an assessment or a plan.
- **Not-proven is a KILL**, not a pending. Adding a hypothesis to stay alive is forbidden.
- **At most two agents**: Claude for spec/evidence/task progression, Codex for implementation *or*
  independent review — **never both at once**, and no model reviews its own output.
- **On reaching the gate, STOP.** `GO` ends this phase; it does not start the next one. Update
  `STATUS.md`, commit the evidence, push, and hand back to the founder.
- Forbidden without exception: real funds, mainnet deploy, force push, adding secrets.

<!-- /KILL-GATE-BANNER -->

# Vrdct

**The neutral resolver. Re-execution decides the payout.** See [`README.md`](./README.md) for what
and why.

**Collaboration model: cross-review, split by task frame.** Frame-thin work (architecture, product
shape, roadmap, task briefs, and the final explainability/safety pass) is naturally CC's. Frame-thick
work (tightly-scoped implementation, refactors, tooling, adversarial audits) is naturally Codex's.
Whoever implements a change does **not** review it — the other agent does.

- **Operating contract (read first):** [`AGENTS.md`](./AGENTS.md)
- **Task briefs:** [`docs/tasks/`](./docs/tasks/)
- **Reviews:** [`reviews/`](./reviews/)

Work on a branch, commit, and have the other agent review before merge.

## Layout

- `core/` — the offline engine: claim schema + claim-type registry, verify, resolution, bond, hash,
  and `encode.mjs` (the canonical input commitment shared with the on-chain program).
- `claimtypes/` — pluggable surfaces (`reserve-solvency`, `closed-market-liquidation-soundness`).
- `tests/` — canonical-input schema regressions and `generate-parity-vectors.mjs`, which emits the
  fixture the Rust parity test consumes.
- `onchain/` — `programs/vrdct-bond/` (the Solana program that custodies bonds and settles them by
  re-executing the claim on-chain, with its `reexec/` Rust twins and `tests/state_machine.rs`
  ProgramTest suite) and `client/bond-live.mjs`. **Real money lives here; hold it to a higher bar
  than the rest.**
- `corpus/` — reference resolutions on real chain data. Treat as fixtures: do not regenerate
  casually, they are what third parties reproduce.

## Commands

```bash
npm run test:canonical        # root: JS schema regressions + parity-fixture freshness + cargo test
npm run generate:parity-vectors   # only after an INTENTIONAL parser/encoding change
node demo.mjs
cd onchain && npm run build && npm run test:unit && npm run test:integration && npm run bond
```

## Invariants worth protecting

- The engine is **claim-type-agnostic**. New surfaces are added by registering a module, never by
  editing `core/`.
- `core/*.mjs` is **zero-dependency**. Client-side deps live under `onchain/`.
- Every claim-type must supply `canonicalInputs`, and it is the **only** reader of raw claim JSON.
  `reexec` and `core/encode.mjs` both consume its typed output. Two readers with different coercion
  rules is precisely the bug that reached `main` once already — don't reintroduce it by parsing a
  field "just here".
- The Rust re-execution in `onchain/programs/vrdct-bond/src/reexec/` and the JS claim-types are
  **byte-for-byte twins**. Changing one without the other is a consensus bug, not a refactor. The
  committed parity fixture (`onchain/tests/parity-vectors.txt`) is the guard; if it goes stale,
  regenerate it *deliberately* and say why.
- `core/encode.mjs`'s constants and `marketDefinitionHash` each have a Rust twin. So does every
  `SPACE` constant its own field list — check both when adding a field.
- The corpus `inputs_hash` (`2f224c44f93a8e2c…`) is published. If a change moves it, that is a
  consensus break, not a test failure.
- The README's "Honest scope" section is a contract with readers. Anything that changes what is
  trusted — or adds an obligation on a participant — must change that section in the same commit.

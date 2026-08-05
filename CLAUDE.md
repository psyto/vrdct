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
- `onchain/` — the Solana program that custodies bonds and settles them by re-executing the claim
  on-chain, plus its client. **Real money lives here; hold it to a higher bar than the rest.**
- `corpus/` — reference resolutions on real chain data. Treat as fixtures: do not regenerate
  casually, they are what third parties reproduce.

## Invariants worth protecting

- The engine is **claim-type-agnostic**. New surfaces are added by registering a module, never by
  editing `core/`.
- `core/*.mjs` is **zero-dependency**. Client-side deps live under `onchain/`.
- The Rust re-execution in `onchain/programs/vrdct-bond/src/reexec/` and the JS claim-types are
  **byte-for-byte twins**. Changing one without the other is a consensus bug, not a refactor.
- The README's "Honest scope" section is a contract with readers. Anything that changes what is
  trusted must change that section in the same commit.

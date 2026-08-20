---
description: Run this project's kill gate — produce evidence for one gate item, then stop.
argument-hint: "[gate item, e.g. G2 / E01b / P4 / V3]"
allowed-tools: Agent, Read, Write, Edit, Bash, Grep, Glob
---

Kill gate run. Argument: $ARGUMENTS

## Read first, in this order

1. `docs/GATE.md` — **binding.** It overrides any older plan, roadmap or task list in this repo.
2. `STATUS.md` — what already has evidence, and at what verification tier.
3. Only then, whatever the gate item points at.

## Pick the work

If an item was given as an argument, take it. Otherwise take the **first gate item with no
reproducible evidence**, in order. One item per run — not two, not "while I'm here".

Before starting, state in one sentence: **what result would KILL this project**, for this item
specifically. If you cannot state that, the item is not ready to run and you say so instead.

## Run it

- **At most two agents, and only one Codex role at a time.** Claude does spec, evidence and task
  progression; Codex does implementation *or* independent review, never both at once. No model
  reviews its own output.
- The verdict comes from a **number or a reproducible experiment**. Not an assessment, not a plan,
  not a reason the number will be better later.
- **Recompute adversarially anything that decides the gate** — from the definition, not from the
  code, and state the direction of every discrepancy. Every numeric error found in this portfolio so
  far has favoured the project that produced it, from four different authors.
- Commit per completed piece of evidence. Push only the relevant diff, only after it verifies.
- Never: real funds, mainnet deploy, force push, adding secrets.

## Stop at the verdict

Write the verdict to `docs/decisions/` with the numbers and the command that reproduces them, set
`STATUS.md` to `GO`, `KILLED` or `BLOCKED` for that item, commit, push — **and stop.**

- `KILLED` — a NO, an unproven claim, or a serious OPEN_RISK. Do not add a hypothesis to keep it
  alive; "it would work if we also had X" is a KILL, not a new scope.
- `BLOCKED` — only an external dependency that a stated action can resolve on a stated date. Say
  both.
- `GO` — tests, evidence and review all present. **`GO` ends this phase; it does not start the next
  one.** Report and hand back to the founder, who picks the single next task.

Close with: the item, the verdict, the numbers, the command that reproduces them, what would have
changed the verdict, and — if any gate items remain — which one is next and why.

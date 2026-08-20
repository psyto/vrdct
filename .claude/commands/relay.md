---
description: Relay a prepared Codex handoff block to Codex, and stop. Transport only — never adjudicates the reply.
---

Relay handoff section: $ARGUMENTS

## What this command is, and is not

It automates the **copy**, not the **decision**. `docs/GATE.md` stops at the verdict and the founder
decides what happens next; this command hands them Codex's reply and goes no further.

You are the relay operator here, not a reviewer and not an adjudicator.

## Run it

```bash
tools/relay-codex.sh <section> --dry-run   # show what would be sent, send nothing
tools/relay-codex.sh <section>             # send it
```

Sections come from `docs/cmls/HANDOFF-CODEX.md`: **1 = review, 2 = impl**. If no section was given
as an argument, run `--dry-run` on the one the role lock permits and ask the founder to confirm
before sending.

Run the real send **in the background** — a Codex round takes longer than a foreground tool call.

The script refuses, and you do not work around any of it:

- the `codex_role:` lock in `docs/cmls/LEDGER.md` names the other role;
- the section is marked `DO NOT SEND`;
- the branch is unpushed or ahead of `origin` — Codex reads `origin`, not this disk.

If it refuses, report the refusal verbatim and stop. A refusal is the mechanism working.

## When it returns

1. Report Codex's exit code, and where the reply landed (`reviews/…`, uncommitted).
2. Summarise **what Codex found**, including anything that contradicts Claude's own evidence — that
   is the point of the round.
3. **Stop.** Do not update `STATUS.md`, do not change a verdict, do not commit the review, and do
   not open the implementation round. Every one of those is the founder's call.

Say plainly which of the two it is: Codex confirmed the finding, or Codex refuted it — and hand back.

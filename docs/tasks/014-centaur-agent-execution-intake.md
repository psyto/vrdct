# 014 — intake: can an agentic rail's execution record be a canonical input?

**Frame:** admissibility only. No claim-type is proposed here and none is implemented.
**Branch:** `cc/centaur-intake`
**Subject:** `paradigmxyz/centaur` @ `74979c19bf0b37cfc2c4b1f5510713841af03df1` (2026-08-10), read in full at that commit.

## Why this was read at all

Vrdct's roadmap lists `agent-escrow` — *release or refund: did the agent do what it claimed?* — and its
standing constraint is the same one that killed 012: a claim is only admissible if its inputs can be
pinned such that an independent party re-running `reexec` lands on the same verdict.

Durable-execution rails advertise exactly the artifact that constraint wants. Centaur 2.0 (announced
2026-08-10, open source, Rust, workflow engine on Absurd, secrets isolated behind an egress proxy) is
the strongest available instance: it is deployed, it is public, and it is built by people who care
about determinism. If any rail's record is a canonical input, this one is.

It is not. The reason is structural rather than a defect, which is why it is worth a numbered doc.

## Test 1 — determinism: are the non-deterministic inputs recorded?

**The agent turn does not execute inside Centaur.**

```
constraint sessions_harness_type_supported check (harness_type in ('codex', 'amp', 'claudecode'))
```
`services/api-rs/crates/centaur-session-sqlx/migrations/0001_session_control_plane.sql:13`

The turn runs in a sandbox under a third-party harness. Centaur is the control plane *around* it and
receives a stream of harness protocol events (`item.*`, `turn.*`, `thread.*`) —
`centaur-session-runtime/src/lib.rs:4841-4860`.

**Absurd's durable execution does not cover that turn.** The registered tasks are the ingestion and
scheduling set — `centaur-workflows/src/lib.rs:617, 635, 653, 671, 692` — i.e. the Slack / Google /
Linear / Attio ETL that builds the context store. Durable replay applies to workflow steps, not to
agent reasoning.

**And where durable execution does apply, its replay is memoization, not re-execution.** A checkpoint is

```
checkpoint_name text not null,
state jsonb,
status text not null default ''committed''
```
`migrations/0007_absurd_workflows.sql:198-200`

On resume the step returns its stored output instead of running again. That is the correct design for
a workflow engine — it guarantees the same answer by *refusing to recompute*. It is the exact inverse
of the property Vrdct settles on, where the answer is whatever an independent party gets by running it
again. A memo is only a canonical input if it is complete, and it is complete only for the workflow
steps that were wrapped.

What survives for the agent path is `session_messages.parts jsonb` and `session_events.payload jsonb`
(`0001_session_control_plane.sql:16-23, 47-54`) — the conversation surface. No model identifier, no
sampling parameters, no seed, no assembled prompt. The one hash present, `prompt_hash`
(`centaur-session-runtime/src/lib.rs:172-192`), commits to the *persona* definition, not to the prompt
the model actually saw.

**Result: FAIL.** The inputs that made the run come out the way it did are not in the record.

## Test 2 — external calls: are egress responses recorded?

Tool calls are converted into telemetry spans carrying `{kind, name, method}`, a status, and a
duration — `centaur-session-runtime/src/lib.rs:4875-4935` (`tool_call_span_events`, `ToolCallLabels`).
Arguments are not in the span. Results are not in the span. This is observability, and observability is
sufficient for its purpose and insufficient for ours.

The stronger finding is one line up from the write:

```rust
async fn append_output_line(...) -> Result<Option<SessionEvent>, SessionRuntimeError> {
    let safe_line = redact_sensitive_text(line);
    ...append_event_if_stdout_owner(..., Value::String(safe_line))
```
`centaur-session-runtime/src/lib.rs:6389-6406`, with the redactors at `:6410-6510` stripping bearer
tokens, sensitive env assignments, and prefixed tokens.

**Redaction happens before persistence.** The database never holds the bytes that executed. The record
is deliberately lossy, and the loss is the security property — a faithful record would leak precisely
the secrets the egress proxy exists to isolate.

`centaur-iron-proxy` in this repo is configuration only — fragments, secret placeholders, transforms
(`src/lib.rs`, `src/source.rs`, `src/model/transform.rs`). It specifies how secrets are injected into a
sandbox. It does not specify a response log.

**Result: FAIL, by design and not by omission.**

## Test 3 — tamper-evidence: is the record immune to after-the-fact editing?

Every artifact is a mutable Postgres row. There is no hash chain, no per-record digest, and no
signature over any execution record. `grep -ri audit` across the whole repository returns four hits,
all incidental — two test fixtures containing the English word, one docstring, one CLI-override test.
There is no audit infrastructure.

The four real `sha256` uses commit to something other than an execution: sandbox spec identity
(`centaur-session-runtime/src/lib.rs:3756`), thread bucketing (`centaur-api-server/src/routes.rs:561`),
ETL content dedup (`routes.rs:1062`), inbound webhook HMAC (`centaur-workflows/src/lib.rs:1247`).

Protection is row-level security (migrations `0019`–`0023`, `0042`). RLS answers *who may read this
row*. It never answers *was this row changed after it was written* — and the operator, who is the party
a verifier would need to be independent of, is on the permitted side of every policy.

**Result: FAIL.**

## Verdict — 不受理 / does not open a market

Three of three fail. Under the rule 012 established — identifiers that cannot be mapped to pinned
inputs mean canonical inputs do not exist, so the market is not opened rather than resolved `UNKNOWN` —
this input source is **not admitted**.

## The part that is new, and general

012 failed because the claim referenced an external fact that pinning could not make re-executable. This
fails for a different and stronger reason, and the reason is not specific to Centaur:

> **A rail that isolates secrets by construction cannot emit a record that reproduces the runs which
> used them.** Redaction and re-execution are in direct tension. The better a rail is at the first, the
> less its record is worth for the second.

This is a property of the category. Cloudflare's guardrails (08-04) and Centaur's egress proxy land in
the same place from opposite directions: both make the *pre-execution* surface stronger, and both leave
the post-execution surface empty for a reason they cannot engineer away. The blank is not waiting to be
filled by a better version of the same product.

## Corollary — `agent-escrow` should not take a dependency on any rail

The tempting design is: read the rail's execution log, judge whether the agent behaved as declared. Every
version of that design inherits the three failures above, from every vendor, permanently.

The design that survives is the one the engine already implements. An agent-escrow claim settles on an
**independently observable outcome** — the public state the agent was paid to bring about — recomputed
from pinned inputs, exactly as `reserve-solvency` and `restaking-robustness` do. The agent's process is
not evidence and is not needed; the world it left behind is both.

That collapses the integration surface to zero. `agent-escrow` needs no rail adapter, no vendor
agreement, and no cooperation from the party being judged — which is the only configuration in which
the resolver is neutral. It also means the correct posture toward Centaur and its successors is to use
them, not to build against them.

## Residuals — stated by us, not discovered by a reviewer

1. **One commit, one repository.** Read at `74979c1`. Paradigm may record more in their internal
   deployment than the open-source tree provides for; nothing here constrains that.
2. **Iron Proxy itself was not read.** It is a separate codebase and is not vendored here. Its own
   logging behaviour is unverified — Test 2's finding rests on what Centaur persists, which is
   post-redaction regardless of what the proxy sees.
3. **Absurd upstream was read only as vendored SQL** (`0007_absurd_workflows.sql`, a copy of
   `earendil-works/absurd`). The upstream project may offer stronger guarantees behind APIs Centaur
   does not use.
4. **"No hash chain" is a negative claim over one tree.** It is supported by exhaustive grep for
   `sha256|blake3|digest|merkle|content_hash|audit` across `*.rs`/`*.sql`, not by a proof.
5. **The corollary is an argument, not a result.** That outcome-based agent-escrow is admissible has
   not been tested by writing one. It inherits the engine's shape, which is evidence, not a guarantee.

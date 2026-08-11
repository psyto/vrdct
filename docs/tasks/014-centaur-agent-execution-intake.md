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
the model actually saw — and that is not an inference from the field's name, it is what the code that
computes it does:

```rust
let prompt_path = plugin_dir.join(prompt_file);          // PROMPT.md, from the plugin directory
let prompt = fs::read_to_string(&prompt_path)...
let prompt_hash = { let digest = Sha256::digest(prompt.as_bytes()); format!("sha256:{}", hex::encode(digest)) };
Ok(Some(LoadedPluginMeta::Persona(PersonaDefinition { id, ..., prompt_hash
```
`centaur-api-server/src/tool_discovery.rs:501-515`

The digest is taken over a file on disk at load time, and stored on a `PersonaDefinition`. Nothing
downstream re-hashes what was assembled for a turn.

**Result: FAIL.** The inputs that made the run come out the way it did are not in the record.

## Test 2 — external calls: are egress responses recorded?

Tool calls are converted into telemetry spans carrying `{kind, name, method}`, a status, and a
duration — `tool_call_span_events` at `centaur-session-runtime/src/lib.rs:4875-4935`, over the
`ToolCallLabels` defined at `:4765`.
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

**The vendor documents a proxy log, and it has to be answered rather than skipped.**
`docs/pages/security.mdx:123-131` states that *"iron-proxy emits structured logs for every outbound
request, including which secret was substituted and which transforms ran."* That is a real capability
and this test does not dispute it. It is also, precisely as described, a **request-side** record:
which secret, which transforms. It does not claim response bodies, and a re-execution needs what came
BACK — the external answer the run was a function of. The document's first version omitted this
sentence entirely, which made a FAIL rest on silence where a published counter-claim existed.

**Result: FAIL, by design and not by omission** — the record covers which credential was reached for,
not what the world answered.

## Test 3 — tamper-evidence: is the record immune to after-the-fact editing?

Every artifact is a mutable Postgres row. There is no hash chain, no per-record digest, and no
signature over any execution record.

**This section previously said "there is no audit infrastructure", and cited a grep that does not
reproduce.** Both are corrected here rather than quietly, because the claim was the strongest sentence
in the document and it was aimed at a named company. What was written: *"`grep -ri audit` across the
whole repository returns four hits, all incidental."* What reproduces at `74979c1`:

| scope | hits |
| --- | --- |
| `git grep -in audit` — the whole repository, as written | **34** |
| the same, restricted to `*.rs` and `*.sql` | **0** |
| the four described (two override-test fixtures, one docstring, one test) | in `*.ts` and `*.py` only |

So the number described a scope the sentence did not state, and the stated scope was false. That
matters here more than arithmetic usually does, because the thirty omitted hits contain the strongest
evidence against the conclusion:

```
docs/pages/security.mdx:123    ### Audit trail
README.md:216                  outbound activity can be audited
docs/pages/extend/apps.mdx:162 Observability shape for app logs, metrics, traces, and audit events
```

> Every agent turn (user input, sandbox assignment, execution, streamed events, tool calls, final
> delivery) is persisted in Postgres. iron-proxy emits structured logs for every outbound request,
> including which secret was substituted and which transforms ran. Together they make it possible to
> reconstruct what an agent did and what credentials it reached for.
>
> — `docs/pages/security.mdx:123-131`

**Centaur has an audit trail. It says so, and it is right.** The claim this test can support is
narrower and survives intact: *there is no tamper-evidence over that trail*. Persistence answers
"what was written"; a structured log answers "what was sent". Neither answers **"was this changed
after it was written"**, which is the only question a resolver needs, because the party a verifier
must be independent of is the operator who holds the database.

Nor do the digests. There are **seven** `Sha256` sites in non-test Rust — the document previously said
four — and not one commits to an execution record:

| site | commits to |
| --- | --- |
| `centaur-session-runtime/src/lib.rs:3756` | sandbox spec identity |
| `centaur-session-runtime/src/lib.rs:6172` | thread-parent bucketing |
| `centaur-api-server/src/routes.rs:561` | thread bucketing |
| `centaur-api-server/src/routes.rs:1062` | ETL content dedup |
| `centaur-api-server/src/routes.rs:2675` | an inbound webhook body, after auth |
| `centaur-api-server/src/tool_discovery.rs:507` | a persona's `PROMPT.md` (see Test 1) |
| `centaur-api-server/src/mcp.rs:584` | a bearer token |

(`centaur-workflows/src/lib.rs:1247` is an algorithm-name check on the inbound webhook HMAC, not a
digest site.) Counting correctly made the finding stronger, not weaker: the enumeration is now
exhaustive over the tree, and the absence it demonstrates is the same one.

Protection is row-level security (migrations `0019`–`0023`, `0042`). RLS answers *who may read this
row*. It never answers *was this row changed after it was written* — and the operator, who is the party
a verifier would need to be independent of, is on the permitted side of every policy.

**Result: FAIL** — on tamper-evidence, which is the property this test is about, and not on the
existence of an audit trail, which Centaur has.

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

Centaur's own audit design is the cleanest demonstration of it. Its proxy log records **which secret
was substituted** — the identity of the credential, never its value — because recording the value
would defeat the isolation the proxy exists to provide. That is the tension made concrete by a team
that resolved it correctly, in the direction their product requires and the opposite of the one a
re-executing resolver would need.

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
2. **Iron Proxy itself was not read.** It is a separate codebase and is not vendored here. Its logging
   behaviour is not unknown, though — the vendor documents it (`docs/pages/security.mdx:123-131`):
   structured logs for every outbound request, naming the substituted secret and the transforms.
   Unverified is whether the implementation matches that description, and whether anything beyond the
   request side is recorded. Test 2's finding rests on the documented shape being request-side, and on
   what Centaur itself persists being post-redaction.
3. **Absurd upstream was read only as vendored SQL** (`0007_absurd_workflows.sql`, a copy of
   `earendil-works/absurd`). The upstream project may offer stronger guarantees behind APIs Centaur
   does not use.
4. **"No hash chain" is a negative claim over one tree.** It is supported by the enumeration in Test 3
   — seven `Sha256` sites, each named and each committing to something other than an execution — and
   by the greps in *Reproducing this* below, not by a proof. The first version of this residual said
   the claim rested on an "exhaustive grep", while the grep it described in the body returned a
   different number in a scope it did not state. An exhaustive search whose command is not written
   down is an assertion about the searcher.
5. **The corollary is an argument, not a result.** That outcome-based agent-escrow is admissible has
   not been tested by writing one. It inherits the engine's shape, which is evidence, not a guarantee.

## Reproducing this

The first version of this document was written from a read, and its three *exhaustive* claims — the
audit grep, the `sha256` enumeration, and "no audit infrastructure" — were the ones that did not hold
when the tree was fetched and the commands were actually run. The citations did hold. That asymmetry
is the reason this section exists: a negative claim is only worth what its command is worth, and a
command that is not written down cannot be checked by a reviewer or by the author a week later.

```bash
git clone https://github.com/paradigmxyz/centaur.git && cd centaur
git checkout 74979c19bf0b37cfc2c4b1f5510713841af03df1   # 2026-08-10 22:17:16 +0000
```

| what the document claims | command | observed |
| --- | --- | --- |
| harness runs under a third-party CLI | `sed -n 13p services/api-rs/crates/centaur-session-sqlx/migrations/0001_session_control_plane.sql` | the `check (harness_type in ('codex','amp','claudecode'))` constraint, verbatim |
| durable tasks are the ETL set | `for n in 617 635 653 671 692; do sed -n "${n}p" services/api-rs/crates/centaur-workflows/src/lib.rs; done` | five `register_task` calls |
| a checkpoint stores state, not a re-run | `sed -n 198,200p services/api-rs/crates/centaur-session-sqlx/migrations/0007_absurd_workflows.sql` | `checkpoint_name` / `state jsonb` / `status` |
| redaction precedes persistence | `grep -n 'async fn append_output_line\|fn redact_sensitive_text' services/api-rs/crates/centaur-session-runtime/src/lib.rs` | `6389` and `6410` |
| `prompt_hash` is over `PROMPT.md` | `sed -n 501,515p services/api-rs/crates/centaur-api-server/src/tool_discovery.rs` | the digest, taken over a file read from `plugin_dir` |
| protection is RLS | `ls services/api-rs/crates/centaur-session-sqlx/migrations \| grep -E '^00(19\|2[0-3]\|42)'` | six migrations |
| **audit** | `git grep -in audit \| wc -l` | **34**, not four |
| | `git grep -in audit -- '*.rs' '*.sql' \| wc -l` | **0** |
| | `sed -n 123,131p docs/pages/security.mdx` | a section titled **Audit trail** |
| **digest sites** | `grep -rn 'Sha256::new()\|Sha256::digest\|sha256(' services/api-rs --include='*.rs' \| grep -v /tests/` | **seven**, not four |

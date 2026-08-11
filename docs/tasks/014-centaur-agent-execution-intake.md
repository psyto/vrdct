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

**The failure is missing PROVENANCE, not missing storage — and getting that wrong was the sixth
instance of this document's pattern, committed in the same change that claimed to have fixed the
method** (Codex, reviews/014 F7). `session_executions.metadata` is `jsonb not null default '{}'`, and
`centaur-api-server/src/routes.rs:1806-1807` persists whatever the caller sent:
`if request.metadata.is_object() { request.metadata }`. A model name, a temperature, a seed — any of
them **can** be stored there today. "Holds none of them" was false.

What is absent is the thing that would make such a value evidence. Nothing requires the field, nothing
validates it, nothing derives it from the run, and nothing binds it to what actually executed. It is
caller-supplied, which in this repo's own vocabulary is the exact defect task 011 spent seven rounds
closing: *a field nothing validates is a field that can claim a different context.* Unconstrained
storage is the opposite of provenance — a slot the caller fills is a slot the caller can fill with
anything.

The read surface makes the gap legible, because it names exactly the provenance a resolver would want
and defines none of it as a column:

```sql
create or replace view centaur_readonly_session_executions as select
    execution_id, thread_key, status,
    to_jsonb(session_executions) ->> 'model'           as model,
    to_jsonb(session_executions) ->> 'harness_run_id'  as harness_run_id,
    to_jsonb(session_executions) ->> 'base_image_ref'  as base_image_ref,
    to_jsonb(session_executions) ->> 'base_image_hash' as base_image_hash,
    to_jsonb(session_executions) ->> 'overlay_hash'    as overlay_hash,
```
`migrations/0019_centaur_readonly_role.sql:45-55`

**`session_executions` has none of those columns.** It is created at `0001:28-38` with
`execution_id, thread_key, status, metadata, error` and five timestamps, and the only migrations that
alter it are `0005` (handoff idempotency) and `0034` (stdout owner). `to_jsonb(row) ->> 'model'` over
a row with no `model` field is NULL, so all five view columns evaluate to NULL at this commit.

Model, harness run, base image, overlay — the fields that would identify *what actually ran* — are
named in the published read surface and defined by no column, so the view returns NULL for all five.
No sampling parameter appears in any migration; the command for that is in *Reproducing this*, and the
first version published here was **broken** — it used a literal `.../migrations/*.sql`, matched no
files, exited 1, and its "0" was a path error rather than a measurement. The corrected command returns
the same answer, which does not rescue it: a broken command that happens to agree is not evidence.

And **`mock_app_server_script()` is not the only runtime `"model"` string** — that was also false.
`title_generator.rs:6` sets `const SESSION_TITLE_MODEL: &str = "gpt-5.4-nano"`, and `:38-42` sends a
production request carrying `"model"` and `"max_output_tokens": 24`. It generates a session title
rather than running the agent turn, so it does not make a turn reproducible; but the sentence was a
universal about the runtime and it was wrong.

**Result: FAIL** — on execution-bound provenance. A turn's model, sampling parameters, seed and
assembled prompt are not recorded as anything derived from or bound to the run. They may be *stored*,
by a caller, in an unvalidated jsonb field the schema neither requires nor checks.

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

**RETRACTED — and this retraction is the substance of the test.** Two earlier versions of this section
read the redaction as the end of the story: *"the database never holds the bytes that executed"*, and
then *"the record covers which credential was reached for, not what the world answered."* Both are
false, and the code cited to support them is what refutes them (Codex, reviews/014 F1).

The span is a projection. **The output pump is not.** `run_stdout_pump` framed a sandbox's stdout into
lines (`centaur-session-runtime/src/lib.rs:4250-4412`) and hands each one to `append_output_line` at
`:4333`, which persists **the whole line**:

```rust
let safe_line = redact_sensitive_text(line);
...append_event_if_stdout_owner(..., SESSION_OUTPUT_LINE_EVENT, Value::String(safe_line))
```

`Value::String(safe_line)` is the line, not a set of labels. And the redactor is a token-pattern
substitution, not a projection — its own test keeps the surrounding structure and replaces only the
credential-shaped substrings:

```rust
let line = r#"{"type":"item.completed","item":{"aggregatedOutput":"Authorization: Bearer sbx1...\n..."}}"#;
assert!(redacted.contains("Authorization: Bearer [REDACTED_TOKEN]"));
```
`:7454-7464`. The harness protocol carries `tool_result` objects with a `content` field
(`:7590-7640`). Such a line is exactly what the pump persists. **A response emitted by a harness tool
can therefore be retained, in `session_events.payload`, minus its credentials.**

What the source does *not* establish is different, and narrower:

- that every iron-proxy response reaches the sandbox's stdout at all;
- that a retained line identifies **which request it answers**;
- that a line surviving token redaction is sufficient to **replay** the call.

`centaur-iron-proxy` in this repo is configuration only — fragments, secret placeholders, transforms
(`src/lib.rs`, `src/source.rs`, `src/model/transform.rs`) — and the vendor's documented proxy log
(`docs/pages/security.mdx:123-131`) is request-side by its own description: which secret was
substituted, which transforms ran. Neither settles the three points above, in either direction.

**Result: NOT ESTABLISHED.** There is no demonstrated complete, request/response-bound, replayable
capture — and equally no demonstration that one is absent. Closing this would take an actual
instrumented run, which has not been done. **This test does not count toward the refusal.** It was
twice written as a FAIL, and both times the reason was an absence the cited path contradicts.

## Test 3 — tamper-evidence: is the record immune to after-the-fact editing?

**Scope first, because this test has twice been written wider than its evidence.** What is examined
here is the **published Postgres audit trail** — `session_messages`, `session_executions`,
`session_events`. Those rows are mutable, and carry no hash chain, no per-record digest and no
signature. An earlier version said "every artifact is a mutable Postgres row", which is false: the
integration paths emit execution-derived material to systems Centaur does not own (Codex, reviews/014
F6). That is residual 8, and it is a residual rather than a rescue.

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

Nor do the digests. There are **eight** `Sha256` sites in non-test Rust — this document has now said
four and then seven, and the seven was the same mistake it was correcting: the "exhaustive" command
searched `services/api-rs` and the tree has another crate (Codex, reviews/014 F2). Not one of the
eight commits to an execution record:

| site | commits to |
| --- | --- |
| `centaur-session-runtime/src/lib.rs:3756` | sandbox spec identity |
| `centaur-session-runtime/src/lib.rs:6172` | thread-parent bucketing |
| `centaur-api-server/src/routes.rs:561` | thread bucketing |
| `centaur-api-server/src/routes.rs:1062` | ETL content dedup |
| `centaur-api-server/src/routes.rs:2675` | an inbound webhook body, after auth |
| `centaur-api-server/src/tool_discovery.rs:507` | a persona's `PROMPT.md` (see Test 1) |
| `centaur-api-server/src/mcp.rs:584` | a bearer token |
| `crates/harness-server/src/otel.rs:746` | thread-parent bucketing, in a crate outside `services/api-rs` |

(`centaur-workflows/src/lib.rs:1247` is an algorithm-name check on the inbound webhook HMAC, not a
digest site.)

**And a list of one spelling of SHA-256 is not evidence about other commitment mechanisms**, which is
the second half of F2 and the more useful half. Searched tree-wide for `blake3`, `ed25519`, `secp256`
and `merkle`: none of them exists anywhere in the tree.

**HMAC is a different story, and the previous version of this paragraph got it wrong** (Codex,
reviews/014 F4). It said every HMAC authenticates an inbound request and was therefore irrelevant to
what Centaur did. That was read off a `git grep 'Hmac'` line count, which counts textual references
rather than capabilities. Two things are true at once:

- The API server's own HMAC constructors do verify **inbound** material — JWT signing at
  `centaur-api-server/src/mcp.rs:536`, webhook signature verification at `routes.rs:3559-3610`.
- iron-proxy has a first-class **outbound** signing capability. `hmac_sign` is a secret type
  (`centaur-perms/src/tools.rs:161-175`): *"a per-request HMAC signature iron-proxy mints and writes
  onto the upstream request"*, with the control-plane shape at `centaur-iron-control/src/models.rs:364-369`.
  Its `signature_algorithm` is one of `sha256`, `sha512`, `sha1`, and its `signature_message`
  template has access to `.Body` (`services/console/docs/API.md:714-732`).

So a request body **can** be signed at the instant it leaves the proxy, and "every HMAC is
`Hmac<Sha256>`" is false for the configured capability as well. That is a real commitment, in the
right direction, and it is retracted from the negative claim.

What it is not — and this is the narrower statement that survives — is public tamper-evidence over
Centaur's execution record. The signature is minted for a **counterparty**: it travels to the upstream
service and is verified there, if at all. Nothing in this tree binds such a signature to the
`session_events` row that records the same call, and nothing makes it independently retrievable by a
third party who was neither the proxy nor the recipient. A resolver would need both. Whether a
deployment could be configured to provide them is not settled here; see residual 7.

Protection is row-level security (migrations `0019`–`0023`, `0042`). RLS answers *who may read this
row*. It never answers *was this row changed after it was written* — and the operator, who is the party
a verifier would need to be independent of, is on the permitted side of every policy.

**Result: FAIL** — on tamper-evidence, which is the property this test is about, and not on the
existence of an audit trail, which Centaur has.

## Verdict — 不受理 / does not open a market

**Two of three fail; the third is not established.** Test 1 (determinism) and Test 3 (tamper-evidence)
both fail on the record as published. Test 2 is withdrawn to NOT ESTABLISHED, because the response
absence it asserted is contradicted by the persistence path it cited.

The refusal does not weaken, and it is worth being exact about why rather than counting failures.
Either failure is independently disqualifying. If the inputs that produced a run are not recorded,
re-execution has nothing to run; if the record carries no tamper-evidence, a resolver would be
trusting the operator it must be independent of. A third failure would have added no admissibility
that the first two do not already decide — which is exactly why it was worth retracting rather than
keeping for the count.

Under the rule 012 established — identifiers that cannot be mapped to pinned inputs mean canonical
inputs do not exist, so the market is not opened rather than resolved `UNKNOWN` — this input source is
**not admitted**.

## The part that is new, and general

012 failed because the claim referenced an external fact that pinning could not make re-executable. This
fails for a different and stronger reason, and the reason is not specific to Centaur:

> **A rail that isolates secrets tends to publish a record that does not reproduce the runs which used
> them.** Redaction and re-execution pull against each other, and a rail optimising the first has no
> product reason to pay for the second.

Centaur's own audit design is the cleanest instance. Its proxy log records **which secret was
substituted** — the identity of the credential, never its value — because recording the value would
defeat the isolation the proxy exists to provide. A team that resolved the tension correctly, in the
direction their product requires and the opposite of the one a re-executing resolver would need.

**This was written as an impossibility, and it is not one.** The earlier wording said such a rail
*cannot* emit a reproducing record. That is a claim about every possible construction, drawn from one
vendor read at one commit, and it is refuted by constructions nobody has had to build yet (Codex,
reviews/014 F3): an encrypted transcript and response blob whose key is released on dispute or by a
threshold; a verifier executed inside an equivalently secret-isolated environment; commitments or
attestations that answer one outcome-specific question without revealing the bytes. Whether any of
those clears Vrdct's independence and reproducibility bar is a genuinely hard design question — which
is the point. A hard open question is not an impossibility, and the difference matters because the
impossibility version quietly forecloses the work.

**And the sentence that replaced it was also more than the evidence carries** (Codex, reviews/014 F5).
It said the blank is "not an oversight", that it "will not be filled by a better version of the same
product", and that neither vendor has a commercial reason to produce it. A repository read at one
commit shows what a vendor *implements and documents there*. It cannot show why something is absent,
what will ship next, or what counts as a different product — those are claims about intent and
roadmap, and no amount of `git grep` reaches them. The "Cloudflare's guardrails (08-04)" comparison
carried no citation in this repository either, so it supplied no checkable second instance.

What the evidence supports is what the tests measured, and it is enough: **Centaur's public record at
`74979c1` is not admitted, because the determinism and tamper-evidence requirements are not met.**
Nothing about anyone's future is needed to say that, and the conditional corollary below does not rest
on it.

## Corollary — an outcome-only `agent-escrow` avoids this dependency, for the promises it can express

The tempting design is: read the rail's execution log, judge whether the agent behaved as declared.
Against Centaur's current public record that design does not work, for the reasons above.

The design that avoids the question entirely is the one the engine already implements. An agent-escrow
claim settling on an **independently observable outcome** — the public state the agent was paid to
bring about — recomputed from pinned inputs, exactly as `reserve-solvency` and `restaking-robustness`
do. The agent's process is then not evidence and not needed; the world it left behind is both. For
that subtype the integration surface is zero: no rail adapter, no vendor agreement, and no cooperation
from the party being judged, which is the only configuration in which the resolver is neutral.

**Two limits, because the earlier version of this section stated it as a universal and it is not**
(Codex, reviews/014 F3):

1. **It covers outcome promises, not process promises.** "Bring the pool back above its floor" is an
   outcome. "Use this rail", "do not take the privileged action", "keep this confidential", "have a
   human review it" are obligations about *conduct*, and the world left behind is not equivalent
   evidence for any of them. An outcome-only escrow does not express those, and nothing here shows
   they are unenforceable — only that this construction does not reach them.
2. **"Integration surface zero" is conditional, not established.** It holds if and when an
   `agent-escrow` surface is defined solely by an outcome that is independently observable and
   canonically pinnable. No such claim-type has been written. Until one is, this is a design
   preference with an argument behind it, not a result — and the honest order is to specify one
   obligation and demonstrate its outcome can be pinned, before generalising.

The posture toward Centaur and its successors is unchanged by any of this: use them.

## Residuals — stated by us, not discovered by a reviewer

1. **One commit, one repository.** Read at `74979c1`. Paradigm may record more in their internal
   deployment than the open-source tree provides for; nothing here constrains that.
2. **Iron Proxy itself was not read.** It is a separate codebase and is not vendored here. Its logging
   behaviour is not unknown, though — the vendor documents it (`docs/pages/security.mdx:123-131`):
   structured logs for every outbound request, naming the substituted secret and the transforms.
   Unverified is whether the implementation matches that description, and whether anything beyond the
   request side is recorded. **This residual is now the whole of Test 2**, which is why that test is
   NOT ESTABLISHED rather than failed: settling it needs an instrumented run of a real proxy and
   harness, not another read of this tree. Nobody has done that here.
3. **Absurd upstream was read only as vendored SQL** (`0007_absurd_workflows.sql`, a copy of
   `earendil-works/absurd`). The upstream project may offer stronger guarantees behind APIs Centaur
   does not use.
4. **"No hash chain" is a negative claim over one tree.** It is supported by the enumeration in Test 3
   — eight `Sha256` sites tree-wide, each named and each committing to something other than an
   execution, plus a search finding no `blake3`, `ed25519`, `secp256` or `merkle` anywhere — and
   by the greps in *Reproducing this* below, not by a proof. The first version of this residual said
   the claim rested on an "exhaustive grep", while the grep it described in the body returned a
   different number in a scope it did not state. An exhaustive search whose command is not written
   down is an assertion about the searcher.
5. **The corollary is an argument, not a result.** That outcome-based agent-escrow is admissible has
   not been tested by writing one. It inherits the engine's shape, which is evidence, not a guarantee.
   It also expresses only outcome promises; process obligations are outside it, and this document does
   not show they are unenforceable — only that this construction does not reach them.
6. **The general finding is a tendency, not a theorem.** It was published once as an impossibility.
   Three counter-constructions are named in that section and none of them has been evaluated against
   Vrdct's bar. Anyone who wants the strong version has to bring a threat model. It has also now been
   published once as a claim about vendor motive and roadmap, which a repository at one commit cannot
   support at all; that is withdrawn rather than softened.
7. **The outbound signature is an open question, not a closed one.** iron-proxy's `hmac_sign` mints a
   per-request signature over a templated message that can include `.Body`, and writes it onto the
   upstream request. This document establishes only that nothing in the public tree BINDS such a
   signature to the `session_events` row for the same call, and nothing makes it retrievable by a
   third party who was neither the proxy nor the recipient. Whether a deployment could be configured
   so that both hold — and whether a counterparty's retained signed request could serve as
   independent evidence — was not examined. It is the most promising thing found in this tree and it
   is unexamined.

   **And leaving it unexamined is correct, which was not obvious.** The question asked of review was
   whether refusing while the strongest candidate is unexamined repeats this document's own recurring
   error. Codex's ruling (reviews/014): it does not, because **admission requires affirmative proof
   for the source actually offered.** The offered source is Centaur's published record at `74979c1`.
   A deployment configured to bind outbound signatures to session rows and expose them to a third
   party is a *different source*, and belongs in its own intake. The asymmetry is the point — an
   absence claim needs a search, but a refusal to admit needs only the absence of a proof that was
   never supplied.

8. **Execution-derived material leaves Centaur, and it was not examined until a reviewer found it.**
   The integrations render a chain-of-thought transcript — reasoning plus tool actions — into systems
   Centaur does not own: `services/githubbot/src/comment-bot.ts` and
   `services/linearbot/src/comment-bot.ts:46-50` build one per thread, and
   `services/discordbot/src/discord-narrator.ts:41-46` posts reasoning blurbs **append-only**, with no
   bot message ever edited or deleted. None of this is a rescue for admission, and the reasons are
   citable rather than rhetorical: GitHub and Linear cap and flatten the transcript
   (`COT_MAX_LINES = 40`, `COT_LINE_MAX_CHARS = 300`, `COT_TOTAL_MAX_CHARS = 8_000`), Discord's
   narrator states outright that *"commands, tools, and plan updates are not rendered"*, Linear
   live-edits its comment, and none of the three carries a canonical binding to `session_events`, a
   request/response record, or an integrity proof a third party could check. An application choosing
   not to edit a Discord message is a policy, not tamper-evidence. But the artifacts exist, they were
   not looked at, and Test 3's original wording erased them by generalisation.
## Reproducing this

Every `file:line` citation in this document has held at every round. Every claim that quantified an
**absence** has failed at least once — including the round that was correcting the previous round's
absences, which published "seven, exhaustive over the tree" from a command that searched one crate of
several. Three passes, three different wrong numbers for the same question, each written with more
confidence than the last.

That is the reason this section exists, and the reason it prints commands rather than conclusions.
A negative claim is worth exactly what its command is worth; a command that is not written down
cannot be checked by a reviewer, by the author a week later, or by the author ten minutes later while
he is correcting someone else's version of the same mistake.

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
| the provenance view is empty | `sed -n '45,55p' services/api-rs/crates/centaur-session-sqlx/migrations/0019_centaur_readonly_role.sql` then `awk '/create table if not exists session_executions/,/^\);/' .../0001_session_control_plane.sql` | the view names `model`, `harness_run_id`, `base_image_ref`, `base_image_hash`, `overlay_hash`; the table has none of them |
| …and nothing added them later | `git grep -n 'alter table session_executions' -- '*.sql'` | only `0005` (idempotency) and `0034` (stdout owner) |
| no sampling parameter in any migration | `git grep -ni 'temperature\|top_p\|top_k\|seed\|max_tokens' -- 'services/api-rs/crates/centaur-session-sqlx/migrations/*.sql'` | no output, **exit 1**. The version first published here used a literal `.../migrations/*.sql`, matched no files, and returned the same exit 1 for the wrong reason |
| metadata takes whatever the caller sends | `sed -n '1806,1808p' services/api-rs/crates/centaur-api-server/src/routes.rs` | `if request.metadata.is_object() { request.metadata }` |
| a production model string exists | `sed -n '6p;38,42p' services/api-rs/crates/centaur-session-runtime/src/title_generator.rs` | `gpt-5.4-nano`, `"max_output_tokens": 24` |
| **audit** | `git grep -in audit \| wc -l` | **34**, not four |
| | `git grep -in audit -- '*.rs' '*.sql' \| wc -l` | **0** |
| | `sed -n 123,131p docs/pages/security.mdx` | a section titled **Audit trail** |
| **digest sites** | `git grep -n 'Sha256::new()\|Sha256::digest\|Sha256::default()' -- '*.rs' \| grep -v '/tests/\|_test\.rs'` | **eight**, tree-wide |
| no `blake3` / `ed25519` / `secp256` / `merkle` | `git grep -ni 'blake3\|ed25519\|secp256\|merkle' -- '*.rs'` | nothing (this row says nothing about HMAC — see the two below) |
| HMAC also signs **outbound** | `git grep -n 'HmacSignSecret' -- '*.rs'` | 6 lines; `centaur-perms/src/tools.rs:168` — *"a per-request HMAC signature iron-proxy mints and writes onto the upstream request"* |
| …with a configurable algorithm over the body | `sed -n '714,732p' services/console/docs/API.md` | signs matching **outbound** requests; `signature_algorithm` one of `sha256`/`sha512`/`sha1`; `signature_message` has access to `.Body` |
| responses can be persisted | `sed -n '4333p;6389,6406p' services/api-rs/crates/centaur-session-runtime/src/lib.rs` | the pump hands each stdout line to `append_output_line`, which stores `Value::String(safe_line)` |
| redaction is substitution, not projection | `sed -n 7454,7464p services/api-rs/crates/centaur-session-runtime/src/lib.rs` | `aggregatedOutput` survives; only tokens become `[REDACTED_TOKEN]` |

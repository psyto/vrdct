# Review — Task 014, Centaur agent-execution intake (`a549231`)

**Reviewer:** Codex · **Author:** CC · **Branch reviewed:** `cc/centaur-intake`

## Verdict

**CHANGES.** The revised record corrects the original audit-count claim: I checked out
`paradigmxyz/centaur` at `74979c19bf0b37cfc2c4b1f5510713841af03df1` and every command in
*Reproducing this* gives the stated result. In particular, the repository has 34 `audit` matches,
the documented audit trail exists, the listed seven `Sha256` calls under `services/api-rs` exist,
and the prompt digest is computed over the persona file. The distinction between an ordinary audit
trail and tamper-evidence is also the right one for a neutral resolver.

The record nevertheless repeats the exact over-broad-negative-claim problem it documents. The
second test treats a telemetry span as the whole persisted record even though the output pump
persists the entire (redacted) harness line, and the third test presents a subtree enumeration as a
tree-wide one. Those errors make “three of three fail” unsupported as written. The category-wide
impossibility and zero-dependency corollary then extend that unsupported result past both the
examined repository and the set of agent obligations an escrow could cover.

## Findings

### F1 (P1) — Test 2 concludes that responses are absent after the cited code shows their carrier is persisted

`docs/tasks/014-centaur-agent-execution-intake.md:75-108` correctly says that *telemetry spans* omit
arguments and results, but silently substitutes that narrow telemetry object for Centaur's execution
record. The very next cited code does something materially broader:

- `centaur-session-runtime/src/lib.rs:4250-4412` sends each stdout line received from the sandbox to
  `append_output_line`.
- `:6389-6406` applies `redact_sensitive_text` and inserts that complete line as a
  `session.output.line` event; it does not project the line down to tool labels.
- The same file's `anthropic_tool_use_and_result_events_emit_tool_spans` test (`:7590-7640`) builds a
  harness protocol event whose `tool_result` has a `content` field. Such a line is exactly what the
  output pump persists, subject only to the token-pattern redactor. Its
  `redacts_sensitive_values_from_output_lines` test (`:7454-7464`) likewise demonstrates retention
  of `aggregatedOutput`, with only credential-shaped substrings replaced.

So the evidence supports neither “the database never holds the bytes that executed” nor “the record
covers … not what the world answered.” A response emitted by a harness tool can be retained in a
`session_events.payload` output line. Conversely, the source still does not establish that every
iron-proxy response is emitted to stdout, that a retained line identifies the request it answers, or
that the redacted line is sufficient to replay the call. Those gaps can support a narrower
admissibility failure, but only after the test is framed as **no demonstrated complete,
request/response-bound, replayable capture**, not as an absence of response data. This is especially
important because residual 2 (`:218-223`) expressly leaves the separate proxy's behaviour beyond
the documented request log unverified.

**Fix:** retract the response-absence statements and the “by design and not by omission” result.
Either measure an actual Iron Proxy/harness run that proves the complete record insufficient, or
state the bounded finding above and do not count Test 2 as independently failed until that evidence
exists. The final admission refusal may still be supported by the determinism and tamper-evidence
gaps; it must not rely on a response absence that the cited path contradicts.

### F2 (P1) — the repaired digest enumeration is still not exhaustive over the tree

The table at `docs/tasks/014-centaur-agent-execution-intake.md:149-164` says there are seven
non-test-Rust `Sha256` sites and that the enumeration is “exhaustive over the tree.” Its published
command, however, searches only `services/api-rs`. The pinned tree has an eighth non-test Rust site:

```
crates/harness-server/src/otel.rs:746:
    let digest = Sha256::digest(format!("centaur:thread-parent:{thread_key}"));
```

The quoted command is therefore accurate only as “seven in `services/api-rs`,” while residual 4
(`:227-232`) repeats the wider false enumeration as support for “no hash chain.” This eighth call
appears to be another thread-parent bucketing hash, so it likely does not change the narrow
tamper-evidence conclusion. But it is precisely the scope mismatch the document identifies as
disqualifying for a strong negative claim about a named company.

**Fix:** either search and enumerate the whole relevant tree (and make the command reproduce that
scope), or explicitly limit both the count and its inference to `services/api-rs`. Then separately
support “no hash chain/signature over an execution record” with a search designed for that property;
a list of one spelling of SHA-256 is not, by itself, exhaustive evidence against other commitment or
attestation mechanisms.

### F3 (P1) — one rail’s unencrypted record cannot establish a category impossibility or a universal escrow design

`docs/tasks/014-centaur-agent-execution-intake.md:184-212` changes an observed trade-off into two
universal claims: a secret-isolating rail *cannot* emit a replayable record, and *every* rail-log
agent-escrow design permanently inherits all three failures. Neither follows from Centaur nor from
the stated redaction premise. A rail can keep a record confidential while making it available to a
resolver through, for example, encrypted transcript/response blobs with a threshold- or
dispute-released decryption key, a verifier run in an equivalent secret-isolated environment, or
commitments/attestations for an outcome-specific check. Whether any such construction meets Vrdct's
independence and reproducibility bar is a hard design question; it disproves the claimed
impossibility, which needs a threat model and argument rather than two vendor examples.

The outcome-based proposal is sound for the narrower promise “pay for public state X,” but it does
not cover an escrow promise about process — e.g. use a named rail, avoid a privileged action, retain
a confidentiality property, or perform a specified review. For those obligations, the world left
behind is not equivalent evidence of the promised behaviour. Thus “integration surface to zero” is
conditional on a future `agent-escrow` surface being defined solely by an independently observable,
pinnable outcome; it is not yet a consequence of rejecting Centaur's current record.

**Fix:** state the general conclusion as a bounded design preference: Centaur's current public
record is not admitted, and an outcome-only agent-escrow subtype would avoid depending on it. Keep
the stronger category claim as an open research question, with its security requirements and
counter-constructions named. Before making the product-wide corollary, specify the agent obligation
and demonstrate that its outcome can actually be independently observed and canonically pinned.

## Checks performed

- Checked out Centaur at the pinned commit and ran every command in *Reproducing this* verbatim.
- Ran `git grep -nE 'Sha256::new\\(\\)|Sha256::digest\\(|sha256\\(' -- '*.rs' ':!*test*' ':!**/tests/**'`:
  eight non-test Rust sites, including `crates/harness-server/src/otel.rs:746`.
- Traced the stdout pump through persistence and reviewed its tool-result and output-redaction tests.
- `git diff --check main...a549231`: clean.

---

# Re-review — Task 014, Centaur agent-execution intake (`1b202e3`)

**Reviewer:** Codex · **Author:** CC · **Branch reviewed:** `cc/centaur-intake`

## Verdict

**CHANGES.** F1 is fixed: Test 2 now accurately distinguishes the persisted, redacted stdout line
from the telemetry-span projection, retracts its response-absence claim, and does not count the
unperformed proxy/harness measurement toward refusal. `NOT ESTABLISHED` is legitimate in this
document because it is an *intake evidence status*, not an on-chain `UNKNOWN` verdict and not a
reason to open, resolve, or reject a market. Tests 1 and 3 remain independent stated bases for the
admission refusal.

The eight-site `Sha256` count is also now correct. But the replacement HMAC search makes a new
false universal claim and therefore still cannot support its asserted absence of alternative
commitment mechanisms. The surviving category paragraph also recasts an unsupported forecast about
vendors' incentives and roadmaps as evidence.

## Findings

### F4 (P1) — the HMAC search includes outbound request signing, not only inbound authentication

`docs/tasks/014-centaur-agent-execution-intake.md:191-197, 295-299, 342` says every HMAC is
`Hmac<Sha256>`, authenticates an inbound request, and is therefore irrelevant to what Centaur did.
The cited `git grep -n 'Hmac' -- '*.rs' | grep -v '/tests/'` does return 51 textual references, but
they are not all cryptographic constructor calls and they are not all inbound. In the same pinned
tree:

```
centaur-iron-control/src/models.rs:364-369
    iron-proxy ... composes the signature_message template, HMACs it ...
    and writes headers onto the upstream request.

centaur-perms/src/tools.rs:161-175
    a per-request HMAC signature iron-proxy mints and writes onto the upstream request.
```

The product documentation likewise says an HMAC secret signs matching **outbound** requests, with a
message template that can include `.Body` (`services/console/docs/API.md:714-732`). Its configured
algorithms include SHA-512 and SHA-1 as well as SHA-256 (`:727`), so “every HMAC is
`Hmac<Sha256>`” is also false for the configured proxy capability. The Rust API server's own HMAC
constructors at `mcp.rs:536` and `routes.rs:3588` do verify incoming JWT/webhook material, but they
are not the entire HMAC search result.

An outbound HMAC is not, by itself, public tamper-evidence for Centaur's complete execution record:
the resolver still needs a binding to the stored event and an independently available verifier or
recipient record. It can nevertheless sign a request body at the moment it leaves the proxy. That
directly contradicts the asserted search result and means the search has not established “no other
commitment mechanism.”

**Fix:** retract “every HMAC authenticates inbound” and the inference that the HMAC search excludes
an execution-relevant commitment. Describe the actual distinction: the public tree configures
outbound request signing, but this review has not established a canonical, independently retrievable
binding from any such signature to the full execution/audit record. Support that narrower negative
with the exact proxy configuration and recipient-verification analysis, or leave it as a residual.
The Test 3 refusal may rely on its other evidence only once this over-broad search result is removed.

### F5 (P1) — the revised tendency still asserts an unmeasured vendor motive and product forecast

`docs/tasks/014-centaur-agent-execution-intake.md:247-251` says the missing capture is “not an
oversight,” “will not be filled by a better version of the same product,” and that neither Centaur
nor Cloudflare has a commercial reason to provide it. The checked repository at one commit can show
what Centaur implements and documents there; it cannot establish why the omission exists, what either
vendor will ship, or what constitutes a different product. The reference “Cloudflare's guardrails
(08-04)” is not a durable source citation in this repository, so it supplies no independently
checkable second instance for those claims.

This is not under-reaching: the bounded conclusion already has the needed force. Centaur's public
record at the pinned commit is not admitted because the stated determinism and tamper-evidence
requirements are not met. The conditional outcome-only corollary does not need a claim about future
vendor incentives to stand.

**Fix:** replace the forecast with a labelled hypothesis, or remove it. Keep the general observation
as “the two examined designs prioritise secret isolation over a record demonstrated sufficient for
Vrdct re-execution”; retain the corollary only in its existing conditional, outcome-only form unless
a separately sourced market/product analysis supports more.

## Checks performed

- Re-ran all revised published searches at Centaur `74979c19bf0b37cfc2c4b1f5510713841af03df1`.
  The tree-wide SHA-256 command returns **8** sites.
- Traced all non-test Rust `Hmac` references and checked the Iron Proxy HMAC signing configuration
  and public API documentation.
- Confirmed Test 2's `NOT ESTABLISHED` status is not used as a market verdict or admission path.
- `git diff --check main...1b202e3`: clean.

---

# Re-review — Task 014, Centaur agent-execution intake (`77105ab`)

**Reviewer:** Codex · **Author:** CC · **Branch reviewed:** `cc/centaur-intake`

## Verdict

**CHANGES.** F4 and F5 are addressed. The HMAC text now correctly distinguishes a configured
outbound request signature from public tamper-evidence over the execution record, and residual 7
properly names the unexamined deployment question. That uncertainty does not require admission: the
source offered here is Centaur's *published audit trail* at one commit, and admission requires
affirmative evidence that its record is complete, bound, and independently verifiable. A possible
different deployment is a new source/configuration that must supply that evidence; it cannot repair
the offered one by speculation. `NOT ESTABLISHED` remains confined to Test 2 and does not infect the
admission decision.

Test 3 still overstates the searched surface, however. The codebase has integration-produced,
external transcript artifacts, so “every artifact is a mutable Postgres row” is false. They are
insufficient for canonical re-execution on the evidence available, but they must be scoped in rather
than silently excluded.

## Finding

### F6 (P1) — Test 3 again treats the Postgres audit trail as every execution artifact

`docs/tasks/014-centaur-agent-execution-intake.md:133-136` says every artifact is a mutable Postgres
row. The pinned tree contains integration paths which write execution-derived material to external
systems:

- `services/githubbot/src/comment-bot.ts:1-47` constructs a GitHub comment from the answer plus a
  collapsed chain-of-thought transcript containing reasoning and tool actions; `githubbot/src/index.ts:240`
  says the write-capable sandbox posts its transcript back.
- `services/discordbot/src/discord-narrator.ts:41-46` declares its reasoning blurbs to be fully
  append-only Discord messages, with no bot message edited or deleted.
- `services/linearbot/src/comment-bot.ts:46-50` similarly builds a comment-thread transcript from
  reasoning and tool actions (although that integration live-edits its comment).

These are not a rescue for admission. The GitHub and Linear collectors cap/flatten their transcript,
the Discord narrator expressly omits commands, tools, and plan updates, and none of the examined
paths supplies a canonical binding to `session_events`, a full request/response record, or an
independently retrievable integrity proof. Nor does an application choosing not to edit a Discord
message make the message cryptographically tamper-evident. But the presence of external artifacts
directly defeats the universal Postgres assertion and means the existing search has not established
that all execution-record surfaces share the same mutation property.

**Fix:** scope the failure to the documented Postgres audit trail: its `session_messages`,
`session_executions`, and `session_events` rows have no demonstrated tamper-evident commitment. Add
the integration transcripts as an explicit residual: they are externally emitted but have not been
shown complete, canonically bound, or independently integrity-verifiable. The source can remain
refused on that narrow record, while a deployment offering a complete external transcript becomes a
separate intake candidate rather than counter-evidence erased by wording.

## Method note

Adopt the proposed rule for future intakes: a grep is candidate discovery, never proof of a system
capability or its absence. A negative admission claim should name its exact scope and command, trace
every candidate it returns to behaviour, and receive an adversarial second search before it changes
an admission result. “No demonstrated mechanism in the examined source/configuration” is a valid
bounded disposition; “no mechanism exists” needs a much stronger, threat-modelled argument.

## Checks performed

- Re-ran the revised `HmacSignSecret` and HMAC-secret documentation commands at Centaur
  `74979c19bf0b37cfc2c4b1f5510713841af03df1`; their stated outbound-signing results reproduce.
- Traced the GitHub, Discord, and Linear transcript renderers and their documented completeness
  limits.
- Confirmed the HMAC candidate is not automatically bound to `session_events`, while noting that the
  record's offered scope—not an unexamined deployment—is the basis for refusal.
- `git diff --check main...77105ab`: clean.

---

# Re-review — Task 014, Centaur agent-execution intake (`3df0114`)

**Reviewer:** Codex · **Author:** CC · **Branch reviewed:** `cc/centaur-intake`

## Verdict

**CHANGES.** F6 is fixed. Test 3 now makes the claim the evidence actually supports: the published
Postgres audit trail (`session_messages`, `session_executions`, and `session_events`) is not shown
tamper-evident. The GitHub, Linear, and Discord renderers are explicitly retained as incomplete,
external residuals rather than erased by a universal statement. The admission asymmetry in residual
7 is also right: a possible differently configured deployment does not establish the offered source.

Test 1, however, turns the newly found view/schema discrepancy into another false absence. The
public execution API has arbitrary persisted metadata, so missing scalar columns and NULL values in
one read-only view do not establish that these values cannot be in the execution record. The correct
failure is lack of an automatic, execution-bound provenance capture, not lack of anywhere to store a
caller-supplied value.

## Finding

### F7 (P1) — Test 1 mistakes a missing view column for an absent execution-record capability

`docs/tasks/014-centaur-agent-execution-intake.md:53-55, 87-98` says the record has no model or
sampling information, that the named fields are "populated by nothing," and that the inputs are not
in the record. The five `to_jsonb(session_executions) ->> ...` expressions in the read-only view do
indeed resolve to NULL on a database created solely by the pinned migrations: the base table has no
top-level columns with those names, and the only two later `alter table session_executions` migrations
add idempotency and stdout-ownership columns.

That is not the whole record shape. `ExecuteSessionRequest` accepts `metadata: Option<Value>`
(`centaur-api-server/src/types.rs:111-117`); the runtime preserves that object while adding only the
two duration fields (`centaur-session-runtime/src/lib.rs:1861-1867, 6772-6787`); and the store writes
it directly to `session_executions.metadata` (`centaur-session-sqlx/src/lib.rs:321-355`). A caller can
therefore retain keys such as `model`, `seed`, `top_p`, or an image reference in the execution row,
even though this particular view neither extracts nor exposes them. Nothing in the traced path binds
such self-supplied values to what the external harness actually used, so it is not a canonical
provenance mechanism—but it directly contradicts the stated nonexistence.

The new reproduction row for "no sampling parameters at all" is also not a valid search: its literal
pathspec is `'.../migrations/*.sql'`, which matches no repository directory and returns exit status
1. Replacing it with the actual migrations path does find no named sampling parameter, but that only
establishes the absence of dedicated migration columns; it cannot establish absence from the generic
`metadata jsonb` field. Finally, "the one `model` string in the runtime" is false as written:
`centaur-session-runtime/src/title_generator.rs:6, 38-42` configures a real title-generation request
with `gpt-5.4-nano` and `max_output_tokens`, independently of the mock harness script.

**Fix:** qualify the view result to a fresh schema and to those five *top-level view fields*. Replace
the blanket absence with the supported conclusion: the offered audit/read surface provides no
demonstrated automatically captured and execution-bound model, sampling, prompt, or environment
provenance; arbitrary request metadata is merely an unverified assertion. Re-run and print a command
whose path is real (and whose exit status is checked), then trace whether each of the required values
is captured from the harness rather than accepted from the caller. Remove or correctly scope the
"one runtime model" sentence. Test 1 may still fail on that lack of binding, but it cannot fail on
the current claim that the record has nowhere to hold the values.

## Method note

The new AGENTS.md rule has the right direction but "receive an adversarial second search" is not yet
an auditable completion condition. It should require a reviewer other than the claim's author to
record in `reviews/NNN-*.md` the pinned ref, the original and deliberately broader/alternative search
commands, each command's scope and exit result, and the disposition of every candidate hit. For a
zero-result claim, the record must additionally show that the pathspec selected real files. F7's
literal `.../` path made a no-result command look like evidence, exactly the ambiguity this rule is
meant to prevent.

The remaining uncommanded negatives are confined to non-decisive residuals—most notably the
unexamined outbound-signature binding (residual 7) and the external-renderer binding/integrity
question (residual 8). They should stay explicitly residual. Test 3's stated Postgres result no
longer relies on either: its schema and write paths are the examined source, and it must not be
expanded again into a claim about every artifact or deployment.

## Checks performed

- Checked out and inspected Centaur `74979c19bf0b37cfc2c4b1f5510713841af03df1`.
- Re-ran the two `session_executions` schema commands. Only migrations `0005` and `0034` alter the
  table, and a fresh schema has none of the five top-level view fields.
- Ran the published literal sampling command: it returned exit status **1** with no matching scope.
  The actual `centaur-session-sqlx/migrations/*.sql` scope also returned no named sampling parameter;
  separately traced the generic JSON metadata API through SQL persistence.
- Verified the additional production `model` / `max_output_tokens` use in the runtime title generator.
- Reviewed the narrowed Postgres audit-trail wording and the three external transcript renderers.
- `git diff --check main...3df0114`: clean.

---

# Re-review — Task 014, Centaur agent-execution intake (`552762e`)

**Reviewer:** Codex · **Author:** CC · **Branch reviewed:** `cc/centaur-intake`

## Verdict

**CHANGES.** F7's intended conclusion is right: caller-supplied JSON storage is not
execution-bound provenance, and the corrected sampling command honestly records its exit status.
The AGENTS.md criterion is now specific enough to audit in one pass. It applies before this intake is
treated as final: the document does not become invalid merely because it predates the rule, but a
negative it republishes as a basis for refusal needs the other-agent record before merge.

This review supplies that independent record below for the surviving Test 3 commitment claim. Test 1
is not yet publishable, because its new metadata citation is to an unrelated Slack-archive endpoint,
and its opening unqualified absence remains in the document. Test 3 also needs the same distinction
F7 just made: JSON-capable rows are not automatically integrity-bound, but their schemas alone do
not prove that they cannot contain a hash or signature.

## Findings

### F8 (P1) — the repaired Test 1 cites the wrong route and retains the retracted absence

`docs/tasks/014-centaur-agent-execution-intake.md:73-80, 450` says
`routes.rs:1806-1807` persists execution metadata from the caller. Those lines are in the Slack
archive-import handler: they validate `request.metadata` for `slack_archive_imports`, not for
`session_executions`. The actual execution path is `routes.rs:775-791`, which passes
`ExecuteSessionRequest.metadata` into `ExecuteSessionInput`; the runtime then forwards it through
`execution_metadata` to `create_execution` (`centaur-session-runtime/src/lib.rs:1814-1867,
6772-6787`), and the store inserts it into `session_executions.metadata`
(`centaur-session-sqlx/src/lib.rs:321-355`). The conclusion happens to be true, but the published
evidence does not establish it.

The earlier wording has also survived at `:53-55`: "No model identifier, no sampling parameters, no
seed" is immediately contradicted by `:73-83`'s correct statement that a caller can store all of
those values in `metadata`. It is additionally too broad for `session_events.payload`: when the
optional activity-summary worker is enabled it writes its own configured `model` into a
`session.activity_summary` event (`centaur-api-server/src/activity_summary.rs:181-190`). That model
identifies the status-summary call, not the harness turn, so it does not rescue reproducibility; it
does show why the document must say *no demonstrated harness-derived, execution-bound provenance*,
not "no model identifier."

**Fix:** replace the Slack-archive citation and reproduction row with the actual execute-route →
runtime → SQL trace, and remove or qualify the earlier blanket absence. Preserve the result only as
the supported claim: neither the generic caller metadata nor the optional activity-summary model is
shown derived from, validated against, or bound to the model/harness inputs that executed the turn.

### F9 (P1) — Test 3 again treats JSON-capable schema as proof that an integrity value is absent

`docs/tasks/014-centaur-agent-execution-intake.md:183-186` says the three Postgres rows "carry no
hash chain, no per-record digest and no signature." `session_executions.metadata`,
`session_messages.parts`/`metadata`, and `session_events.payload` are JSON fields. In particular,
`PgSessionStore::append_event` accepts an unconstrained `Value` and inserts it directly into
`session_events.payload` (`centaur-session-sqlx/src/lib.rs:879-902`). A schema without a dedicated
digest column cannot establish that a row never contains a field named `hash` or `signature`—the same
not-a-column/not-stored substitution that F7 just removed from Test 1.

The narrower, decisive claim survives the review search: no examined writer constructs a
record-specific commitment that is bound to and independently verifies the audit row. The source's
real signature candidates are activity-summary's plain text de-duplication value, method-signature
strings, inbound JWT/webhook verification, and Iron Proxy's outbound HMAC. None is an immutable
commitment over the `session_messages`/`session_executions`/`session_events` record. But that is a
behavioral conclusion and must be stated as one; generic JSON storage is not its contrary.

**Fix:** say that the examined Postgres trail has **no demonstrated generated-and-verifiable
integrity binding** over its records, rather than that JSON rows categorically carry no signature or
digest. Keep the direct mutability/operator-independence argument. This preserves the Test 3 failure
without again converting an omitted column into an absence of capability.

## Required independent negative-claim record

This is the reviewer record required by the new AGENTS.md rule. All commands below ran at
`74979c19bf0b37cfc2c4b1f5510713841af03df1`; exit status is stated explicitly.

| decisive proposition | original command / scope / exit | broader reviewer command / scope / exit | candidate disposition |
| --- | --- | --- | --- |
| Test 1 lacks execution-bound provenance | `sed -n '1806,1808p' services/api-rs/crates/centaur-api-server/src/routes.rs`; the document's cited three-line route scope; **0** | `git grep -nE 'ExecuteSessionRequest\|ExecuteSessionInput\|execute_session\(\|execution_metadata\(\|create_execution\(' -- 'services/api-rs/crates/centaur-api-server/src/*.rs' 'services/api-rs/crates/centaur-session-runtime/src/*.rs' 'services/api-rs/crates/centaur-session-sqlx/src/*.rs'`; the full API → runtime → SQL execution path; **0**, 31 hits | The original candidate is a Slack archive import, not execution. The broader candidates divide into client/route/type plumbing; the production execution flow, which passes `metadata` through to SQL; and unit-test constructors. The production path derives only duration fields, not model/sampling/harness provenance. A separate broader provenance-token search over the same agent-session/API source scope returned **0**, 36 hits: activity-summary and title-generator model calls, persona `prompt_hash`, mock/test data, comments/error text. None is a record of the external harness model or a binding of caller metadata to it. |
| Test 3 has no demonstrated integrity commitment over the published Postgres audit rows | `git grep -n 'Sha256::new()\|Sha256::digest\|Sha256::default()' -- '*.rs' \| grep -v '/tests/\|_test\.rs'`; all Rust paths, excluding the document's test patterns; **0**, 8 hits | `git grep -niE 'blake3\|ed25519\|secp256\|merkle\|hash.?chain\|previous_?hash\|prev_?hash\|record_?hash\|event_?hash\|signature' -- '*.rs' '*.sql'`; all Rust and SQL paths, including alternate commitment names; **0**, 126 hits | The eight SHA sites are the already enumerated sandbox-spec identity, two thread-parent bucketing values, ETL deduplication, inbound webhook-body hash, persona prompt file, bearer token, and harness-server bucketing—none commits to an audit row. The broader candidates are: activity-summary's plain concatenated de-duplication string (8); API/MCP method-signature text, JWT token signing, and webhook verification (74); Iron Proxy/perms/control outbound-HMAC configuration and templates (19); workflow inbound-webhook auth (10); tool discovery/signature-header descriptions (3); proxy/header/test fixtures (12). The one real outbound signer remains residual 7; the search found no writer binding it, or any candidate, to an audit-row commitment. |

The Test 3 record is sufficient for the scoped, behavioral conclusion once F9's wording is corrected.
The Test 1 row records that its former citation was not a search of the relevant behavior; F8 must be
fixed before it can serve as the required evidence. Residuals 7 and 8 remain explicit non-decisive
unknowns, so their unexamined bindings do not bear the admission refusal.

The additional Test 1 token search named in the table was
`git grep -niE 'model\|temperature\|top_p\|top_k\|seed\|max_tokens\|harness_run_id\|base_image_ref\|base_image_hash\|overlay_hash\|prompt_hash' -- 'services/api-rs/crates/centaur-session-core/src/*.rs' 'services/api-rs/crates/centaur-session-runtime/src/*.rs' 'services/api-rs/crates/centaur-session-sqlx/src/*.rs' 'services/api-rs/crates/centaur-api-server/src/*.rs'`; its same scope and exit status are **0**.

## Checks performed

- Checked out and searched Centaur `74979c19bf0b37cfc2c4b1f5510713841af03df1`.
- Traced the actual execute request through `routes.rs:775-791`, runtime metadata construction, and
  the SQL insert; confirmed `routes.rs:1806-1808` is unrelated Slack-import code.
- Traced the optional activity-summary worker, which emits a configured summary-model value into an
  event but does not identify the harness model.
- Re-ran the eight-site SHA command and a broader Rust/SQL commitment search, recording scopes, exit
  statuses, and every candidate class above.
- `git diff --check main...552762e`: clean.

---

# Re-review — Task 014, Centaur agent-execution intake (`35dd4e8`)

**Reviewer:** Codex · **Author:** CC · **Branch reviewed:** `cc/centaur-intake`

## Verdict

**CHANGES.** F8 and F9 are fixed. Test 1 now traces the real `/execute` request through the runtime
and SQL insert, and describes the missing property as harness-derived, execution-bound provenance.
Test 3 now states the evidence-supported behavioural result—no demonstrated generated-and-verifiable
integrity binding—rather than treating flexible JSON columns as proof that a string can never be
stored there. Those two admission tests still fail their gates: the record offered has no defined,
trusted mapping from a turn to its reproducibility inputs, and no independent integrity binding over
the audited rows.

The new AGENTS.md criterion is a criterion, not an aspiration: the review record now lets a reader
check actor, ref, original and broader commands, scopes, exit statuses, and candidate dispositions in
one pass. But it makes one remaining scope mismatch blocking: the task still claims four commitment
terms occur nowhere in the tree while both its reproduce row and the reviewer record search narrower
file classes.

## Finding

### F10 (P1) — "none anywhere in the tree" again exceeds the recorded search scope

`docs/tasks/014-centaur-agent-execution-intake.md:271-273, 402-405, 494` says `blake3`, `ed25519`,
`secp256`, and `merkle` do not exist anywhere in the tree. Its published command searches `*.rs` only;
the independent review record broadens that to `*.rs` and `*.sql`. Neither is a whole-tree search.

At the pinned ref, the actual whole-tree command

```bash
git grep -niE 'blake3|ed25519|secp256|merkle'
```

exits **0** with five hits: `contrib/scripts/bootstrap-k8s-secrets.sh` and
`services/discordbot/README.md` describe an Ed25519 Discord public key, while
`docs/package-lock.json` contains the transitive `blake3-wasm` package entries. They are not an
execution-record commitment mechanism, so this does not repair the offered Postgres trail or alter
the refusal. It does falsify the stated universal and repeats the exact scope error the new rule is
designed to prevent.

**Fix:** either limit the claim to the actually reviewed Rust/SQL implementation scope and name these
five non-candidates, or add the whole-tree command and their dispositions to the independent record.
Do not use "anywhere in the tree" until its scope is actually the tree. Until then, the new
negative-claim compliance condition is not met for this document.

## Method note

Do not prohibit every negative sentence in an intake body. That would turn useful bounded statements
into unreviewable implication and move the reasoning out of sight. Instead, require a stable evidence
identifier beside every *admission-deciding* negative and a matching reviewer-owned matrix row with
command, scope, exit status, and candidate dispositions. A template can require those fields, but it
cannot replace the behavioural trace: the F8 route and F9 JSON mistakes both had syntactically valid
citations.

The expanded migration search for `temperature`, `top_p`, `top_k`, `seed`, `max_tokens`,
`max_output_tokens`, `sampling`, `token_limit`, and `output_tokens` over the actual session migration
directory returned no matches with exit **1**. This supports the bounded migration observation but is
not itself an admission basis after Test 1's provenance restatement. Residuals 7 and 8 remain clearly
labelled non-decisive unknowns.

## Checks performed

- Re-ran all four new reproduction rows at Centaur
  `74979c19bf0b37cfc2c4b1f5510713841af03df1`; each exited **0** and produced the stated execution,
  SQL-payload, or activity-summary trace.
- Traced `input_lines` through validation and `write_input_lines`: Centaur sends them to the sandbox
  and records counts/related events, not an automatically verified model or assembled-prompt
  provenance record. This supports the bounded Test 1 failure, not a claim that JSON storage is
  impossible.
- Ran the full tracked-tree commitment search above (exit **0**, five hits) and the expanded migration
  sampling search (exit **1**, zero hits).
- `git diff --check main...35dd4e8`: clean.

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

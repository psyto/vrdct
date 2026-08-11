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

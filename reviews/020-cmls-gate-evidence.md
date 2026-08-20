# Review — 020 CMLS kill-gate evidence

**Reviewer:** Codex (independent-review role)
**Evidence reviewed:** `16c5d45` (branch head `b5ee864`) over `cae200d`
**Result:** `CHANGES` — the reported overall `KILLED` result is independently supported, but not for the stated V3 reason alone. V1 and V2 are recorded as `PROVEN` although their respective gate tests fail. V3 has a shipped-tool availability defect, but the gate's named input-completeness test was independently met.

## Independent recomputation — 2026-08-20

I did not use the evidence scratchpad or import `core/rpc.mjs`. A fresh 21-page JSON-RPC walk to `https://api.mainnet-beta.solana.com`, using direct `fetch` requests with `limit: 1000`, the returned last signature as `before`, and 900 ms between pages, returned the following after filtering successful records to the claim's inclusive bounds and sorting `(slot, sig)`:

| quantity | author | reviewer | discrepancy / direction |
| --- | ---: | ---: | --- |
| pages to cross `from_ts` | 21 | 21 | none |
| observations | 3,789 | 3,789 | none |
| missing / extra | 0 / 0 | 0 / 0 | none |
| independently implemented input hash | `2f224c44f93a8e2c…` | `2f224c44f93a8e2c2840c75c2a86872ce3b73336ffcec047654d8d0e2deffccd` | none |
| first / last observation | claim bounds | `1785586259` / `1785888421` | none |
| max consecutive gap | 242 s | 242 s | none; `4.0 min` is presentation rounding, not a JS/Rust difference |
| re-executed split | 683 open / 3,106 closed / `RED` | 683 / 3,106 / `RED` | none |
| oldest page-21 signature | `2026-08-01T00:42:00Z` | `2026-08-01T05:35:00Z` | reviewer reached 6.60 h before `from_ts`, not 11.48 h. This still crosses the required boundary. The reported larger retention margin favours the project; it does not change the conclusion that retention was not encountered. |

The direct independently written hash used the documented format, rather than `inputsCommitment`: `SHA-256([01][202601 u32 LE][n u32 LE])`, followed by SHA-256 chaining 800-byte chunks of sorted u32-LE timestamps.

The shipped command was also run. It exited 1, but this run received the public endpoint's `Too many requests for a specific RPC call` response before it reached the set comparison. Thus the review independently confirms the command's **failure**, but not the evidence's historical `missing 515, extra 0, c7cd…` output from that exact command. This is no change to the gate outcome: it is an additional public-endpoint failure mode, not a successful reconstruction.

`npm run test:canonical` exited 0: 82 JS tests, 162 parity vectors, 2 definition vectors, 2,212 calendar vectors, 21 Rust tests (five BPF ignored), and 12 Foundry tests passed.

## Findings

### F1 — V1 cannot be `PROVEN`: the reconstructed price-input set is empty

`docs/GATE.md` asks whether an independent party can obtain *the same price inputs we used*. `claimtypes/closed-market-soundness.mjs:22-38` canonicalizes only `blockTimes`; the corpus contains `oracle_inputs: []`; and `onchain/programs/vrdct-bond/src/reexec/cmls.rs:20-31` folds only a u32 timestamp. The independently recomputed price-input count is **0**.

An empty set establishes that CMLS makes no price claim; it cannot establish price reconstruction. Calling the row `PROVEN` converts a scope failure into a vacuous success. It must be recorded as **FAIL / KILL for V1** (or the gate must be replaced with one that does not ask about prices).

**Direction:** the current `PROVEN` label favours the project. Correcting it strengthens, rather than weakens, the overall `KILLED` verdict.

### F2 — V2 does not meet the gate's required re-derivation

The gate says the time-window verdict comes from “a re-derivation that lands on the same window.” The independent computation is:

| derivation | from | to |
| --- | ---: | ---: |
| corpus descriptor | 1785586259 | 1785888421 |
| `tradingWindow(to_ts)` | 1785787200 | 1785873600 |

The bounds are readable from the corpus (and would be commitment-bound in an opened market), but reading a stored descriptor is not a derivation. The only supplied derivation lands on different bounds; moreover the corpus bounds are exactly the first and last observations. V2 is therefore **FAIL / KILL**, not “PROVEN for reconstruction.”

**Direction:** the current V2 label favours the project. This independently supports overall `KILLED` even if F3 is corrected.

### F3 — the evidence overstates the V3 KILL; it proves the gate's named completeness condition

The independent 21-page experiment above is precisely the V3 verdict source — “a rebuild, run” — and it reached the committed state and verdict from public data. `docs/GATE.md` names KILL when “Input completeness cannot be proven”; here completeness was proven by zero missing/extra records and a byte-identical commitment. Therefore V3 should be described as:

> **PASS as a third-party state reconstruction capability; shipped command currently refuses on a rate-limit error or a commitment mismatch.**

The 20-page fetch helper has a real availability/diagnostic defect: it returns a partial set without explicitly saying it exhausted its page budget. But `reconstruct.mjs:55-75` compares that set's commitment to the pinned commitment and exits 1 on a mismatch. At the command boundary it fails closed; it does not report a partial set as a successful reconstruction. Treating the V3 capability pass as “laundering” is backwards: suppressing the successful independent public rebuild would misstate the measurement.

**Direction:** correcting V3 from `KILLED` to PASS favours the project. It does *not* make the overall result GO, because F1 and F2 are independent gate failures.

### F4 — the universal decay and agreement claims are too strong

`docs/cmls/GATE-EVIDENCE.md` and `STATUS.md` say every CMLS claim eventually becomes unreconstructible and that two honest rebuilders agreeing is not evidence of completeness. Neither follows from a 20-page limit alone.

The first statement requires an additional premise: the source account must continue to emit enough signatures indefinitely. An account that stops produces a finite signature distance and need not cross the cap. The defensible bounded statement is that a claim **whose account continues producing signatures** eventually crosses the fixed cap.

The second omits the relevant commitment. Agreement on two truncated *verdicts* is insufficient, but agreement on a reconstructed set's `inputs_hash` with the already pinned hash is evidence of completeness (up to SHA-256's collision assumption). This corpus's 20-page reconstruction illustrates the distinction: its partial set has a different commitment and `reconstruct.mjs` rejects it.

**Direction:** both corrections favour the project by narrowing the defect; neither changes F1 or F2.

## Gate disposition after review

The evidence should not retain the item labels `V1 PROVEN`, `V2 PROVEN`, and `V3 KILLED`. The evidence-backed disposition is **V1 FAIL, V2 FAIL, V3 PASS-with-shipped-tool-defect, V4 PASS conditional on V3**. The overall result remains **`KILLED`**, now for the actual failures of the price and time-window requirements rather than the disproven claim that public state cannot be reconstructed.

No implementation was performed or recommended in this review round.

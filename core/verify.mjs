// Vrdct — verify. The "Don't trust, re-execute" tool. Re-executes a claim's verdict from its pinned
// inputs via the registered claim-type, and confirms the content hash. Claim-type-agnostic: it works
// for any registered surface. A tampered verdict fails both the re-executed flag and the hash.
import { claimId, claimType } from './claim.mjs';
import { canonical } from './hash.mjs';

export function verify(claim) {
  const claimTypeName = claim?.claim_type;
  const mod = claimType(claimTypeName);
  if (!mod) return { ok: false, verdict: null, checks: [['unknown claim_type', false, claimTypeName]] };
  let r;
  try {
    r = mod.reexec(claim.inputs);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, verdict: null, checks: [['canonical inputs rejected', false, detail]] };
  }
  try {
    const checks = (mod.checks ? mod.checks(claim, r) : []).slice();
    // A claim-type's own checks say WHICH part of a body disagreed — they explain. They are not the
    // binding, and treating them as one is Codex's F9 (reviews/011): every field that re-execution
    // produces but nothing compares can be rewritten, resealed so `claim_id` agrees, and verified.
    // `computation.source_chain`, `source_account`, `calendar_version` and `updates_pinned` each did.
    // The defect is structural — a per-type enumeration is a list somebody has to keep complete — so
    // the engine binds the COMPLETE deterministic output here, once, for every surface. Claim-types
    // keep their checks for explainability and for cross-body bindings re-execution cannot see, such
    // as subject↔source.
    checks.push(['the whole re-executed computation reproduces', canonical(r.computation) === canonical(claim.computation), 'byte-for-byte']);
    checks.push(['the whole re-executed verdict reproduces', canonical(r.verdict) === canonical(claim.verdict), `${r.verdict?.flag} vs ${claim?.verdict?.flag}`]);
    // The invariant is the sentence a claim says it settles. Nothing re-executes it, so nothing
    // compared it to the registered one, and an edited statement verified under a verdict computed
    // from the real one.
    checks.push(['the invariant is the registered one', canonical(mod.invariant) === canonical(claim.invariant), mod.invariant?.id ?? 'none']);
    checks.push(['verdict flag reproduces', r.verdict.flag === claim.verdict.flag, `${r.verdict.flag} vs ${claim.verdict.flag}`]);
    checks.push(['claim_id (content hash) matches body', claimId(claim) === claim.claim_id, claim.claim_id]);
    return { ok: checks.every((c) => c[1]), verdict: r.verdict, checks };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, verdict: null, checks: [['malformed claim', false, detail]] };
  }
}

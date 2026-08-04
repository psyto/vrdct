// Vrdct — verify. The "Don't trust, re-execute" tool. Re-executes a claim's verdict from its pinned
// inputs via the registered claim-type, and confirms the content hash. Claim-type-agnostic: it works
// for any registered surface. A tampered verdict fails both the re-executed flag and the hash.
import { claimId, claimType } from './claim.mjs';

export function verify(claim) {
  const mod = claimType(claim.claim_type);
  if (!mod) return { ok: false, verdict: null, checks: [['unknown claim_type', false, claim.claim_type]] };
  const r = mod.reexec(claim.inputs);
  const checks = (mod.checks ? mod.checks(claim, r) : []).slice();
  checks.push(['verdict flag reproduces', r.verdict.flag === claim.verdict.flag, `${r.verdict.flag} vs ${claim.verdict.flag}`]);
  checks.push(['claim_id (content hash) matches body', claimId(claim) === claim.claim_id, claim.claim_id]);
  return { ok: checks.every((c) => c[1]), verdict: r.verdict, checks };
}

// Vrdct — verify. The "Don't trust, re-execute" tool. Re-executes a claim's verdict from its pinned
// inputs via the registered claim-type, and confirms the content hash. Claim-type-agnostic: it works
// for any registered surface. A tampered verdict fails both the re-executed flag and the hash.
import { claimId, claimType } from './claim.mjs';

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
    checks.push(['verdict flag reproduces', r.verdict.flag === claim.verdict.flag, `${r.verdict.flag} vs ${claim.verdict.flag}`]);
    checks.push(['claim_id (content hash) matches body', claimId(claim) === claim.claim_id, claim.claim_id]);
    return { ok: checks.every((c) => c[1]), verdict: r.verdict, checks };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, verdict: null, checks: [['malformed claim', false, detail]] };
  }
}

// Vrdct — resolution. Turns a claim's re-executed verdict into a market's payout-controlling answer.
// A market poses a boolean on-chain-STATE condition; the claim re-executes it; the resolution is
// whatever anyone reproduces by re-running verify. No token vote, no committee, no price oracle.
import { verify } from './verify.mjs';

export function resolve(claim, { market, yesWhen }) {
  const v = verify(claim); // the resolution is valid only if the claim re-executes cleanly
  return {
    schema: 'vrdct.resolution/v0',
    market,
    resolved: yesWhen.includes(claim.verdict.flag) ? 'YES' : 'NO',
    reproduces: v.ok,
    basis: { claim_id: claim.claim_id, claim_type: claim.claim_type, verdict: claim.verdict.flag },
    settlement: 'bond: the side matching this re-executed outcome captures the stake; a false resolver is slashable.',
    reproduce: 'node verify.mjs <claim.json>',
  };
}

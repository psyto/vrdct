// Vrdct claim-type: reserve-solvency. Re-derives a protocol's solvency from re-computed on-chain
// quantities: GREEN iff recomputed backing ≥ liability, redeemable backing proven, no stale records.
// A pluggable module — the engine never changes to support it.
import { registerClaimType, buildClaim } from '../core/claim.mjs';

export const type = 'reserve-solvency';
export const invariant = {
  id: 'SOLVENCY',
  statement: "A protocol's claimed backing must be independently recomputable from chain state at the pinned slot, cover its liability, and carry no stale records.",
};

export function reexec(inputs) {
  const q = inputs.observed.quantities;
  const inv1_ok = BigInt(q.virtualValue) >= BigInt(q.liability);
  const inv2b_ok = q.inv2b_ok === true;
  const stale_ok = q.staleRecords === 0;
  const flag = (!inv1_ok || q.inv2b_ok === false) ? 'RED' : (inv2b_ok && stale_ok) ? 'GREEN' : 'STALE';
  return {
    computation: { inv1_ok, inv2b_ok, stale_ok, backing: String(q.virtualValue), liability: String(q.liability) },
    verdict: { flag, reason: flag === 'GREEN' ? 'Recomputed backing covers liability; redeemable backing proven; no stale records.' : `inv1_ok=${inv1_ok} inv2b_ok=${inv2b_ok} stale_ok=${stale_ok}` },
  };
}
export function checks(claim, r) {
  return [
    ['backing ≥ liability reproduces', r.computation.inv1_ok === claim.computation.inv1_ok, `${r.computation.inv1_ok}`],
    ['redeemable-backing reproduces', r.computation.inv2b_ok === claim.computation.inv2b_ok, `${r.computation.inv2b_ok}`],
    ['no-stale-records reproduces', r.computation.stale_ok === claim.computation.stale_ok, `${r.computation.stale_ok}`],
  ];
}

export function build({ subject, window, quantities }) {
  return buildClaim({ type, subject, inputs: { trusted: { chain: subject.chain }, oracle_inputs: [], window, observed: { source: 'chain re-computation', quantities } } });
}

registerClaimType({ type, invariant, reexec, checks });

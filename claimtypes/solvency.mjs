// Vrdct claim-type: reserve-solvency. Re-derives a protocol's solvency from re-computed on-chain
// quantities: GREEN iff recomputed backing ≥ liability, redeemable backing proven, no stale records.
// A pluggable module — the engine never changes to support it.
//
// Accepted input shapes are deliberately narrower than JavaScript coercions: quantities are parsed
// once by `canonicalInputs`, then both this re-executor and `core/encode.mjs` consume those exact
// typed values. Malformed JSON is rejected rather than acquiring a different on-chain meaning.
import { registerClaimType, buildClaim } from '../core/claim.mjs';

export const type = 'reserve-solvency';
export const invariant = {
  id: 'SOLVENCY',
  statement: "A protocol's claimed backing must be independently recomputable from chain state at the pinned slot, cover its liability, and carry no stale records.",
};

const U128_MAX = (1n << 128n) - 1n;
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function quantity(name, value) {
  let parsed;
  if (typeof value === 'string') {
    if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(`quantities.${name} must be a canonical unsigned decimal string or safe integer number`);
    parsed = BigInt(value);
  } else if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    parsed = BigInt(value);
  } else {
    throw new Error(`quantities.${name} must be a canonical unsigned decimal string or safe integer number`);
  }
  if (parsed > U128_MAX) throw new Error(`quantities.${name} exceeds u128`);
  return parsed;
}

// The sole raw-JSON reader for this surface. Its result is the consensus input domain shared by
// offline re-execution and the on-chain record encoder.
export function canonicalInputs(inputs) {
  if (!isObject(inputs) || !isObject(inputs.observed) || !isObject(inputs.observed.quantities)) {
    throw new Error('inputs.observed.quantities must be an object');
  }
  const q = inputs.observed.quantities;
  const staleRecords = q.staleRecords;
  if (typeof staleRecords !== 'number' || !Number.isSafeInteger(staleRecords) || staleRecords < 0 || staleRecords > 0xffffffff) {
    throw new Error('quantities.staleRecords must be a safe u32 integer');
  }

  let inv2bOk;
  if (Object.hasOwn(q, 'inv2b_ok')) {
    if (q.inv2b_ok !== true && q.inv2b_ok !== false) throw new Error('quantities.inv2b_ok must be true, false, or absent');
    inv2bOk = q.inv2b_ok;
  }

  return {
    virtualValue: quantity('virtualValue', q.virtualValue),
    liability: quantity('liability', q.liability),
    inv2bOk,
    staleRecords,
  };
}

export function reexec(inputs) {
  const q = canonicalInputs(inputs);
  const inv1_ok = q.virtualValue >= q.liability;
  const inv2b_ok = q.inv2bOk === true;
  const stale_ok = q.staleRecords === 0;
  const flag = (!inv1_ok || q.inv2bOk === false) ? 'RED' : (inv2b_ok && stale_ok) ? 'GREEN' : 'STALE';
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

// Vrdct claim-type: reserve-solvency. Re-derives a protocol's solvency from re-computed on-chain
// quantities: GREEN iff recomputed backing ≥ liability, redeemable backing proven, no stale records.
// A pluggable module — the engine never changes to support it.
//
// Accepted input shapes are deliberately narrower than JavaScript coercions: quantities are parsed
// once by `canonicalInputs`, then both this re-executor and `core/encode.mjs` consume those exact
// typed values. Malformed JSON is rejected rather than acquiring a different on-chain meaning.
import { registerClaimType, buildClaim } from '../core/claim.mjs';
import { closed } from '../core/closed.mjs';

export const type = 'reserve-solvency';
export const invariant = {
  id: 'SOLVENCY',
  statement: "A protocol's claimed backing must be independently recomputable from chain state at the pinned slot, cover its liability, and carry no stale records.",
};

const U128_MAX = (1n << 128n) - 1n;
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const OBSERVATION_SOURCE = 'chain re-computation';

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
  closed('inputs', inputs, ['trusted', 'oracle_inputs', 'window', 'observed']);
  if ('trusted' in inputs) closed('inputs.trusted', inputs.trusted, ['chain']);
  if ('oracle_inputs' in inputs && !(Array.isArray(inputs.oracle_inputs) && inputs.oracle_inputs.length === 0)) {
    throw new Error('inputs.oracle_inputs has no input domain in this type: it may be absent or the empty array, nothing else');
  }
  if ('window' in inputs) {
    closed('inputs.window', inputs.window, ['epoch']);
    if (Object.hasOwn(inputs.window, 'epoch') && (!Number.isSafeInteger(inputs.window.epoch) || inputs.window.epoch < 0 || inputs.window.epoch > 0xffffffff)) {
      throw new Error('inputs.window.epoch must be a safe u32 integer');
    }
  }
  closed('inputs.observed', inputs.observed, ['source', 'quantities']);
  if ('source' in inputs.observed && inputs.observed.source !== OBSERVATION_SOURCE) {
    throw new Error(`inputs.observed.source must be '${OBSERVATION_SOURCE}'`);
  }
  const q = inputs.observed.quantities;
  closed('inputs.observed.quantities', q, ['virtualValue', 'liability', 'inv2b_ok', 'staleRecords']);
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
  const subjectChain = claim?.subject?.chain;
  const trustedChain = claim?.inputs?.trusted?.chain;
  return [
    ['subject names the chain the inputs were recomputed from', subjectChain === trustedChain, `${subjectChain ?? 'absent'} vs ${trustedChain ?? 'absent'}`],
    ['backing ≥ liability reproduces', r.computation.inv1_ok === claim.computation.inv1_ok, `${r.computation.inv1_ok}`],
    ['redeemable-backing reproduces', r.computation.inv2b_ok === claim.computation.inv2b_ok, `${r.computation.inv2b_ok}`],
    ['no-stale-records reproduces', r.computation.stale_ok === claim.computation.stale_ok, `${r.computation.stale_ok}`],
  ];
}

export function build({ subject, window, quantities }) {
  // The key is OMITTED when the subject names no chain, rather than set to `undefined`. A claim body
  // is a JSON value tree; `{ chain: undefined }` is not one, and the canonicalizer that hashes it now
  // says so (Codex, reviews/011 F12). Absent and present-but-undefined are the same fact, and only
  // one of them can be content-addressed.
  const trusted = subject?.chain === undefined ? {} : { chain: subject.chain };
  return buildClaim({ type, subject, inputs: { trusted, oracle_inputs: [], window, observed: { source: OBSERVATION_SOURCE, quantities } } });
}

registerClaimType({ type, invariant, canonicalInputs, reexec, checks });

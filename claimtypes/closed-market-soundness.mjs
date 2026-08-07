// Vrdct claim-type: closed-market-liquidation-soundness (Vesper lineage). Re-executes, from the
// pinned update-times of the price account a venue liquidates against, whether that feed kept
// updating while the underlying US equity market was CLOSED with no market-status guard — in which
// case liquidations run against a price the regulated market never printed (RED). A pluggable module.
//
// A claim must contain one or more exactly representable `u32` timestamps. `canonicalInputs` is the
// only raw-JSON reader; re-execution and `core/encode.mjs` both consume its typed result so malformed
// observations cannot be accepted offline but mean something else on-chain.
import { registerClaimType, buildClaim } from '../core/claim.mjs';
import { marketStatus, STATUS, CALENDAR_2026 } from '../core/campana.mjs';

export const type = 'closed-market-liquidation-soundness';
export const invariant = {
  id: 'CMLS',
  statement: 'A lending venue must not liquidate tokenized-equity collateral against a price that keeps updating while the underlying US equity market is CLOSED, with no market-status guard.',
};

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// The sole raw-JSON reader for this surface. The returned values are representable by Rust's u32
// timestamp record and are the input domain shared with the canonical encoder.
export function canonicalInputs(inputs) {
  if (!isObject(inputs) || !isObject(inputs.observed) || !Array.isArray(inputs.observed.observations)) {
    throw new Error('inputs.observed.observations must be an array');
  }
  const observations = inputs.observed.observations;
  if (observations.length === 0) throw new Error('inputs.observed.observations must be non-empty');
  const blockTimes = observations.map((observation, i) => {
    if (!isObject(observation) || typeof observation.blockTime !== 'number' || !Number.isSafeInteger(observation.blockTime) || observation.blockTime < 0 || observation.blockTime > 0xffffffff) {
      throw new Error(`observations[${i}].blockTime must be a safe u32 integer`);
    }
    if (observation.blockTime < CALENDAR_2026.validFrom || observation.blockTime >= CALENDAR_2026.validUntil) {
      throw new Error(`observations[${i}].blockTime is outside calendar ${CALENDAR_2026.version}'s validity range`);
    }
    return observation.blockTime;
  });
  return { blockTimes };
}

// PURE classifier: update-times (+ calendar) → market-status split + liveness signal. Sorts a copy.
export function classifyUpdateTimes(times, cal) {
  if (!times.length) return { updates: 0, signal: 'NO_DATA' };
  times = [...times].sort((a, b) => a - b);
  let openN = 0, closedN = 0, firstClosed = null, lastClosed = null;
  const gaps = [], dailyClosed = {};
  for (let i = 0; i < times.length; i++) {
    const st = marketStatus(times[i], cal);
    if (st.status === STATUS.OPEN || st.status === STATUS.HALF_DAY) openN++;
    else { closedN++; if (!firstClosed) firstClosed = times[i]; lastClosed = times[i]; dailyClosed[st.dateET] = (dailyClosed[st.dateET] || 0) + 1; }
    if (i > 0) gaps.push(times[i] - times[i - 1]);
  }
  const maxGap = gaps.length ? Math.max(...gaps) : 0;
  const signal = closedN > 0 && maxGap < 30 * 60 ? 'LIVE_THROUGH_CLOSURE' : closedN === 0 ? 'FROZEN_THROUGH_CLOSURE' : 'SPARSE';
  return { first: times[0], last: times[times.length - 1], updates: times.length, openUpdates: openN, closedUpdates: closedN, firstClosed, lastClosed, maxGapMin: +(maxGap / 60).toFixed(1), dailyClosed, signal };
}
const guardFromSignal = (s) => s === 'LIVE_THROUGH_CLOSURE' ? 'NONE' : s === 'FROZEN_THROUGH_CLOSURE' ? 'STALENESS_ONLY' : 'UNKNOWN';
// liveness establishes the RED side; GREEN (a program-side price band) is a separate policy claim-type.
const flagFromGuard = (g) => g === 'NONE' ? 'RED' : g === 'STALENESS_ONLY' ? 'YELLOW' : 'UNKNOWN';

export function reexec(inputs) {
  const { blockTimes } = canonicalInputs(inputs);
  const comp = classifyUpdateTimes(blockTimes);
  const guard = guardFromSignal(comp.signal);
  const flag = flagFromGuard(guard);
  return {
    computation: comp,
    verdict: {
      flag, guard,
      reason: guard === 'NONE'
        ? `The price account updated ${comp.closedUpdates}× while the US market was CLOSED (max gap ${comp.maxGapMin} min) with no market-status guard.`
        : `liveness signal = ${comp.signal}`,
    },
  };
}
export function checks(claim, r) {
  return [
    ['liveness signal reproduces', r.computation.signal === claim.computation.signal, `${r.computation.signal}`],
    ['closed-window updates reproduce', r.computation.closedUpdates === claim.computation.closedUpdates, `${r.computation.closedUpdates}`],
    ['max gap reproduces', r.computation.maxGapMin === claim.computation.maxGapMin, `${r.computation.maxGapMin}`],
  ];
}
export function build({ subject, window, observations }) {
  return buildClaim({ type, subject, inputs: { trusted: { market_id: 'US_EQUITIES_REGULAR' }, oracle_inputs: [], window, observed: { source: 'getSignaturesForAddress', account: subject.priceAccount, count: observations.length, observations } } });
}

registerClaimType({ type, invariant, canonicalInputs, reexec, checks });

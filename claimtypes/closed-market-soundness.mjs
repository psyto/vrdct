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
import { closed } from '../core/closed.mjs';

export const type = 'closed-market-liquidation-soundness';
export const invariant = {
  id: 'CMLS',
  statement: 'A lending venue must not liquidate tokenized-equity collateral against a price that keeps updating while the underlying US equity market is CLOSED, with no market-status guard.',
};

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const MARKET_ID = 'US_EQUITIES_REGULAR';
export const OBSERVATION_SOURCE = 'getSignaturesForAddress';

function u32(name, value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`${name} must be a safe u32 integer`);
  }
  return value;
}

function windowDescriptor(window, observations) {
  if (!isObject(window)) throw new Error('inputs.window must be an object');
  closed('inputs.window', window, ['from_ts', 'to_ts', 'from_iso', 'to_iso']);
  // Some direct canonical-input callers intentionally supply no display window. Once a window is
  // present, though, it is a claim about the pinned set and cannot be decorative.
  if (Object.keys(window).length === 0) return;
  const fromTs = u32('inputs.window.from_ts', window.from_ts);
  const toTs = u32('inputs.window.to_ts', window.to_ts);
  if (toTs < fromTs) throw new Error('inputs.window.to_ts must not precede inputs.window.from_ts');
  if (Object.hasOwn(window, 'from_iso') && window.from_iso !== new Date(fromTs * 1000).toISOString()) {
    throw new Error('inputs.window.from_iso must exactly represent inputs.window.from_ts');
  }
  if (Object.hasOwn(window, 'to_iso') && window.to_iso !== new Date(toTs * 1000).toISOString()) {
    throw new Error('inputs.window.to_iso must exactly represent inputs.window.to_ts');
  }
  observations.forEach((observation, i) => {
    if (observation.blockTime < fromTs || observation.blockTime > toTs) {
      throw new Error(`inputs.observed.observations[${i}].blockTime lies outside inputs.window`);
    }
  });
}

// The sole raw-JSON reader for this surface. The returned values are representable by Rust's u32
// timestamp record and are the input domain shared with the canonical encoder.
export function canonicalInputs(inputs) {
  if (!isObject(inputs) || !isObject(inputs.observed) || !Array.isArray(inputs.observed.observations)) {
    throw new Error('inputs.observed.observations must be an array');
  }
  // `canonicalInputs` is the sole raw-JSON reader. `core/encode.mjs` consumes only the returned
  // blockTimes, then Rust receives only those u32 records, so no unrecognised JSON key can reach
  // the re-execution twin.
  closed('inputs', inputs, ['trusted', 'oracle_inputs', 'window', 'observed']);
  if ('trusted' in inputs) {
    closed('inputs.trusted', inputs.trusted, ['market_id']);
    if (inputs.trusted.market_id !== MARKET_ID) throw new Error(`inputs.trusted.market_id must be '${MARKET_ID}'`);
  }
  if ('oracle_inputs' in inputs && !(Array.isArray(inputs.oracle_inputs) && inputs.oracle_inputs.length === 0)) {
    throw new Error('inputs.oracle_inputs has no input domain in this type: it may be absent or the empty array, nothing else');
  }
  closed('inputs.observed', inputs.observed, ['source', 'account', 'count', 'observations']);
  if ('source' in inputs.observed && inputs.observed.source !== OBSERVATION_SOURCE) {
    throw new Error(`inputs.observed.source must be '${OBSERVATION_SOURCE}'`);
  }
  const observations = inputs.observed.observations;
  if (observations.length === 0) throw new Error('inputs.observed.observations must be non-empty');
  if ('count' in inputs.observed) {
    if (!Number.isSafeInteger(inputs.observed.count) || inputs.observed.count < 0 || inputs.observed.count !== observations.length) {
      throw new Error('inputs.observed.count must equal inputs.observed.observations.length');
    }
  }
  const blockTimes = observations.map((observation, i) => {
    if (!isObject(observation)) {
      throw new Error(`observations[${i}] must be an object`);
    }
    closed(`inputs.observed.observations[${i}]`, observation, ['sig', 'slot', 'blockTime']);
    if (typeof observation.blockTime !== 'number' || !Number.isSafeInteger(observation.blockTime) || observation.blockTime < 0 || observation.blockTime > 0xffffffff) {
      throw new Error(`observations[${i}].blockTime must be a safe u32 integer`);
    }
    if (observation.blockTime < CALENDAR_2026.validFrom || observation.blockTime >= CALENDAR_2026.validUntil) {
      throw new Error(`observations[${i}].blockTime is outside calendar ${CALENDAR_2026.version}'s validity range`);
    }
    return observation.blockTime;
  });
  if ('window' in inputs) windowDescriptor(inputs.window, observations);
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
  const subjectAccount = claim?.subject?.priceAccount;
  const observedAccount = claim?.inputs?.observed?.account;
  return [
    ['subject names the account the inputs came from', typeof subjectAccount === 'string' && subjectAccount === observedAccount, `${subjectAccount ?? 'missing'} vs ${observedAccount ?? 'missing'}`],
    ['liveness signal reproduces', r.computation.signal === claim.computation.signal, `${r.computation.signal}`],
    ['closed-window updates reproduce', r.computation.closedUpdates === claim.computation.closedUpdates, `${r.computation.closedUpdates}`],
    ['max gap reproduces', r.computation.maxGapMin === claim.computation.maxGapMin, `${r.computation.maxGapMin}`],
  ];
}
export function build({ subject, window, observations }) {
  if (typeof subject?.priceAccount !== 'string') throw new Error('subject.priceAccount must name the observed account');
  return buildClaim({ type, subject, inputs: { trusted: { market_id: MARKET_ID }, oracle_inputs: [], window, observed: { source: OBSERVATION_SOURCE, account: subject.priceAccount, count: observations.length, observations } } });
}

registerClaimType({ type, invariant, canonicalInputs, reexec, checks });

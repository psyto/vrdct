// Vrdct claim-type: closed-market-liquidation-soundness (Vesper lineage). Re-executes, from the
// pinned update-times of the price account a venue liquidates against, whether that feed kept
// updating while the underlying US equity market was CLOSED with no market-status guard — in which
// case liquidations run against a price the regulated market never printed (RED). A pluggable module.
import { registerClaimType, buildClaim } from '../core/claim.mjs';
import { marketStatus, STATUS } from '../core/campana.mjs';

export const type = 'closed-market-liquidation-soundness';
export const invariant = {
  id: 'CMLS',
  statement: 'A lending venue must not liquidate tokenized-equity collateral against a price that keeps updating while the underlying US equity market is CLOSED, with no market-status guard.',
};

// PURE classifier: update-times (+ calendar) → market-status split + liveness signal. Sorts a copy.
export function classifyUpdateTimes(times, cal) {
  if (!times.length) return { updates: 0, signal: 'NO_DATA' };
  times = [...times].sort((a, b) => a - b);
  let openN = 0, closedN = 0, firstClosed = null, lastClosed = null;
  const gaps = [], dailyClosed = {};
  for (let i = 0; i < times.length; i++) {
    const st = marketStatus(times[i], cal);
    if (st.status === STATUS.OPEN) openN++;
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
  const comp = classifyUpdateTimes(inputs.observed.observations.map((o) => o.blockTime));
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

registerClaimType({ type, invariant, reexec, checks });

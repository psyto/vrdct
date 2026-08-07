// Vrdct claim-type: monday-open-gap. Re-executes the price gap a market closure produced — from
// the last price a venue printed while the underlying regulated market was still OPEN, to the first
// price it printed after that market reopened — and answers whether the gap reached a threshold
// declared before the closure began.
//
// Why this is a claim-type and not a price feed. Tokenized equities trade through the closure; the
// underlying market does not. Everyone holding across it is exposed to the reopen, and there is no
// instrument shaped like that exposure — a perp lets you hedge a PRICE, but inside the closure the
// perp has no reference either, so it hedges a broken number with a broken number. The gap is an
// EVENT, and the only unambiguous number attached to it is the reopen print.
//
// Settling that event needs one thing nobody in the trade can be trusted to supply: when the
// closure began and ended. A venue that defines its own reopen instant is marking its own exam; an
// oracle vendor that defines it must be trusted. `core/campana.mjs` derives it as a pure function of
// (timestamp, holiday calendar) — so the boundary is re-executable, and this market can exist.
//
//   verdict RED   — the closure produced a gap at or beyond the declared threshold (the risk landed)
//   verdict GREEN — it did not
//   verdict STALE — the pinned prints sit too far from the boundary to settle anything
//
// RED/GREEN keep the meaning they carry across this repo: RED is the closed-market risk
// materialising. A market declares `yesWhen: ['RED']`.
//
// THE ATTACK THIS TYPE IS BUILT AGAINST. Whoever pins the observation chooses which print to pin.
// Pick a print three hours after the reopen and you can very often choose the answer. So the terms
// declare `maxLagSecs`, and re-execution rejects any print further than that from the boundary
// instant it re-derives itself. That bounds the choice; it does not eliminate it.
//
// HONEST RESIDUAL. This type cannot prove a pinned print is the FIRST print after the reopen — that
// is the omission problem, and a claim alone never closes it. It is closed the same way it is for
// `closed-market-liquidation-soundness`: a challenger who holds a print closer to the boundary
// disputes, and the closer print wins. Said plainly so no one reads more into a verdict than it has.
//
// FOLLOW-UP (not done here). `core/encode.mjs` / `CLAIM_TYPE_ID` and the Rust twin under
// `onchain/programs/vrdct-bond/src/reexec/` are byte-parity surfaces; this type is offline-complete
// and is NOT yet wired to either. On-chain settlement of a gap market needs that port first.

import { registerClaimType, buildClaim } from '../core/claim.mjs';
import { marketStatus, STATUS, CALENDAR_2026 } from '../core/campana.mjs';

export const type = 'monday-open-gap';
export const invariant = {
  id: 'GAP',
  statement: 'Across a market closure, the move from the venue\'s last open-session price to its first reopen price either reaches a threshold declared before the closure, or it does not — and both prints must sit within a declared lag of boundary instants re-derived from the calendar.',
};

const U64_MAX = (1n << 64n) - 1n;
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isClosed = (t) => marketStatus(t).status === STATUS.CLOSED;

function u32(name, value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`${name} must be a safe u32 integer`);
  }
  return value;
}

// Prices are pinned as an exact integer plus an exponent — never a float. Two nodes that parse the
// same claim must hold the same number, and `0.1 + 0.2` is why this is not negotiable.
function price(name, value) {
  if (!isObject(value)) throw new Error(`${name} must be an object { value, exp }`);
  let v;
  if (typeof value.value === 'string') {
    if (!/^(0|[1-9][0-9]*)$/.test(value.value)) throw new Error(`${name}.value must be a canonical unsigned decimal string or safe integer number`);
    v = BigInt(value.value);
  } else if (typeof value.value === 'number' && Number.isSafeInteger(value.value) && value.value >= 0) {
    v = BigInt(value.value);
  } else {
    throw new Error(`${name}.value must be a canonical unsigned decimal string or safe integer number`);
  }
  if (v > U64_MAX) throw new Error(`${name}.value exceeds u64`);
  if (v === 0n) throw new Error(`${name}.value must be non-zero`);
  const exp = u32(`${name}.exp`, value.exp);
  if (exp > 30) throw new Error(`${name}.exp must be ≤ 30`);
  return { value: v, exp };
}

function observation(name, o) {
  if (!isObject(o)) throw new Error(`${name} must be an object`);
  const blockTime = u32(`${name}.blockTime`, o.blockTime);
  if (blockTime < CALENDAR_2026.validFrom || blockTime >= CALENDAR_2026.validUntil) {
    throw new Error(`${name}.blockTime is outside calendar ${CALENDAR_2026.version}'s validity range`);
  }
  return { price: price(`${name}.price`, o.price), blockTime };
}

// The sole raw-JSON reader for this surface: re-execution and any future on-chain encoder must
// consume this typed result, never the raw object.
export function canonicalInputs(inputs) {
  if (!isObject(inputs) || !isObject(inputs.observed) || !isObject(inputs.terms)) {
    throw new Error('inputs.observed and inputs.terms must be objects');
  }
  const close = observation('observed.close', inputs.observed.close);
  const open = observation('observed.open', inputs.observed.open);
  if (open.blockTime <= close.blockTime) throw new Error('observed.open.blockTime must be after observed.close.blockTime');

  const thresholdBps = u32('terms.thresholdBps', inputs.terms.thresholdBps);
  if (thresholdBps === 0) throw new Error('terms.thresholdBps must be non-zero');
  const maxLagSecs = u32('terms.maxLagSecs', inputs.terms.maxLagSecs);
  if (maxLagSecs === 0) throw new Error('terms.maxLagSecs must be non-zero');
  const direction = inputs.terms.direction;
  if (direction !== 'ABS' && direction !== 'DOWN' && direction !== 'UP') {
    throw new Error("terms.direction must be 'ABS', 'DOWN' or 'UP'");
  }
  return { close, open, thresholdBps, maxLagSecs, direction };
}

// Last second in [lo, hi] that is not CLOSED. Requires !isClosed(lo) && isClosed(hi): over that
// range the predicate flips exactly once, so bisection is exact. 32 evaluations of a pure function.
function lastOpenSecond(lo, hi) {
  while (lo + 1 < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (isClosed(mid)) hi = mid; else lo = mid;
  }
  return lo;
}
// First second in [lo, hi] that is not CLOSED. Requires isClosed(lo) && !isClosed(hi).
function firstOpenSecond(lo, hi) {
  while (lo + 1 < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (isClosed(mid)) lo = mid; else hi = mid;
  }
  return hi;
}

// Signed move in basis points, floored toward zero, in integer arithmetic.
function moveBps(from, to) {
  // scale both to a common exponent so the ratio is exact
  const e = Math.max(from.exp, to.exp);
  const a = from.value * 10n ** BigInt(e - from.exp);
  const b = to.value * 10n ** BigInt(e - to.exp);
  const diff = b - a;
  const neg = diff < 0n;
  const mag = (neg ? -diff : diff) * 10000n / a;
  return neg ? -mag : mag;
}

export function reexec(inputs) {
  const q = canonicalInputs(inputs);
  const { close, open, thresholdBps, maxLagSecs, direction } = q;

  // 1. Re-derive the closure from the calendar. A claim that does not straddle one settles nothing.
  const closeOpen = !isClosed(close.blockTime);
  const openOpen = !isClosed(open.blockTime);
  const midpoint = close.blockTime + Math.floor((open.blockTime - close.blockTime) / 2);
  const straddles = closeOpen && openOpen && isClosed(midpoint);

  let closeInstant = null, openInstant = null, closeLagSecs = null, openLagSecs = null, lagsOk = false;
  if (straddles) {
    closeInstant = lastOpenSecond(close.blockTime, midpoint);
    openInstant = firstOpenSecond(midpoint, open.blockTime);
    closeLagSecs = closeInstant - close.blockTime; // how stale the close print is vs the closing bell
    openLagSecs = open.blockTime - openInstant;    // how late the reopen print is vs the opening bell
    lagsOk = closeLagSecs <= maxLagSecs && openLagSecs <= maxLagSecs;
  }

  // 2. The move. Computed regardless, so a STALE claim still shows what it would have said.
  const signedBps = moveBps(close.price, open.price);
  const observedBps = direction === 'ABS' ? (signedBps < 0n ? -signedBps : signedBps)
    : direction === 'DOWN' ? -signedBps
      : signedBps;
  const breached = observedBps >= BigInt(thresholdBps);

  const flag = !straddles || !lagsOk ? 'STALE' : breached ? 'RED' : 'GREEN';
  const reason = !straddles
    ? 'the pinned prints do not straddle a market closure'
    : !lagsOk
      ? `a pinned print is further than ${maxLagSecs}s from its boundary (close ${closeLagSecs}s, open ${openLagSecs}s)`
      : breached
        ? `the closure produced ${observedBps} bps ${direction}, at or beyond the declared ${thresholdBps}`
        : `the closure produced ${observedBps} bps ${direction}, short of the declared ${thresholdBps}`;

  return {
    computation: {
      straddles_closure: straddles,
      close_instant: closeInstant,
      open_instant: openInstant,
      close_lag_secs: closeLagSecs,
      open_lag_secs: openLagSecs,
      lags_ok: lagsOk,
      closure_secs: straddles ? openInstant - closeInstant : null,
      signed_bps: String(signedBps),
      observed_bps: String(observedBps),
      threshold_bps: thresholdBps,
      direction,
      calendar_version: CALENDAR_2026.version,
    },
    verdict: { flag, reason },
  };
}

export function checks(claim, r) {
  return [
    ['closure straddle reproduces', r.computation.straddles_closure === claim.computation.straddles_closure, `${r.computation.straddles_closure}`],
    ['boundary instants reproduce', r.computation.close_instant === claim.computation.close_instant && r.computation.open_instant === claim.computation.open_instant, `${r.computation.close_instant} → ${r.computation.open_instant}`],
    ['print lags within terms', r.computation.lags_ok === claim.computation.lags_ok, `close ${r.computation.close_lag_secs}s · open ${r.computation.open_lag_secs}s`],
    ['gap reproduces', r.computation.observed_bps === claim.computation.observed_bps, `${r.computation.observed_bps} bps`],
  ];
}

export function build({ subject, terms, close, open, source }) {
  return buildClaim({
    type,
    subject,
    inputs: {
      trusted: { chain: subject.chain, calendar: CALENDAR_2026.version },
      oracle_inputs: [],
      terms,
      observed: { source, close, open },
    },
  });
}

registerClaimType({ type, invariant, canonicalInputs, reexec, checks });

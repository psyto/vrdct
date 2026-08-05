// Vrdct core — Campana: neutral, re-executable US-equities market status. Deterministic:
// status is a PURE function of (unix timestamp, holiday calendar) — no clock read in the core, so
// anyone re-executes it. Used by the closed-market-soundness claim-type; reusable by any surface
// that must know whether the regulated market was open at a given instant.

export const STATUS = Object.freeze({ OPEN: 'OPEN', CLOSED: 'CLOSED', HALF_DAY: 'HALF_DAY' });

// Versioned holiday calendar — the ONLY trusted datum. Pin/verify against the official NYSE calendar.
export const CALENDAR_2026 = {
  version: 2026_01,
  // The holiday table is deliberately not a timeless rule. CMLS records outside this half-open
  // range must be rejected rather than quietly classified with 2026 holidays.
  validFrom: Date.UTC(2026, 0, 1) / 1000,
  validUntil: Date.UTC(2027, 0, 1) / 1000,
  holidays: ['2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25'],
  halfDays: ['2026-11-27', '2026-12-24'],
};

const REG_OPEN_MIN = 9 * 60 + 30, REG_CLOSE_MIN = 16 * 60, HALF_CLOSE_MIN = 13 * 60;

// US Eastern DST without a tz library: EDT (UTC-4) 2nd Sun Mar 02:00 → 1st Sun Nov 02:00, else EST (-5).
function nthSundayOfMonth(year, month, n) {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return 1 + ((7 - first) % 7) + (n - 1) * 7;
}
export function etOffsetHours(ts) {
  const y = new Date(ts * 1000).getUTCFullYear();
  const dstStart = Date.UTC(y, 2, nthSundayOfMonth(y, 3, 2), 7, 0, 0) / 1000;
  const dstEnd = Date.UTC(y, 10, nthSundayOfMonth(y, 11, 1), 6, 0, 0) / 1000;
  return ts >= dstStart && ts < dstEnd ? -4 : -5;
}
const pad = (n) => String(n).padStart(2, '0');
function etParts(ts) {
  const off = etOffsetHours(ts);
  const w = new Date((ts + off * 3600) * 1000);
  return { off, y: w.getUTCFullYear(), m: w.getUTCMonth() + 1, d: w.getUTCDate(), wday: w.getUTCDay(), min: w.getUTCHours() * 60 + w.getUTCMinutes(), date: `${w.getUTCFullYear()}-${pad(w.getUTCMonth() + 1)}-${pad(w.getUTCDate())}` };
}
function etWallToUnix(y, m, d, minutes) {
  const guess = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60) / 1000;
  return guess - etOffsetHours(guess) * 3600;
}
function dayKind(dateStr, wday, cal) {
  if (wday === 0 || wday === 6) return 'weekend';
  if (cal.holidays.includes(dateStr)) return 'holiday';
  if (cal.halfDays.includes(dateStr)) return 'half';
  return 'full';
}
const closeMinFor = (kind) => (kind === 'half' ? HALF_CLOSE_MIN : REG_CLOSE_MIN);

// The pure status function.
export function marketStatus(ts, cal = CALENDAR_2026) {
  const p = etParts(ts);
  const kind = dayKind(p.date, p.wday, cal);
  const isTrading = kind === 'full' || kind === 'half';
  const closeMin = closeMinFor(kind);
  let status = STATUS.CLOSED, session_open_ts = null, session_close_ts = null;
  if (isTrading && p.min >= REG_OPEN_MIN && p.min < closeMin) {
    status = kind === 'half' ? STATUS.HALF_DAY : STATUS.OPEN;
    session_open_ts = etWallToUnix(p.y, p.m, p.d, REG_OPEN_MIN);
    session_close_ts = etWallToUnix(p.y, p.m, p.d, closeMin);
  }
  let last_close_ts = null;
  for (let back = 0; back < 10 && last_close_ts === null; back++) {
    const probe = ts - back * 86400, pp = etParts(probe), k = dayKind(pp.date, pp.wday, cal);
    if (k === 'full' || k === 'half') { const c = etWallToUnix(pp.y, pp.m, pp.d, closeMinFor(k)); if (c <= ts) last_close_ts = c; }
  }
  return { market_id: 'US_EQUITIES_REGULAR', status, dateET: p.date, etOffset: p.off, dayKind: kind, session_open_ts, session_close_ts, last_close_ts, calendar_version: cal.version };
}
export function statusNow(cal = CALENDAR_2026) { return marketStatus(Math.floor(Date.now() / 1000), cal); }

import assert from 'node:assert/strict';
import test from 'node:test';
import * as gap from '../claimtypes/monday-open-gap.mjs';
import { verify } from '../core/verify.mjs';
import { resolve } from '../core/resolution.mjs';
import { marketStatus, STATUS } from '../core/campana.mjs';

const unix = (y, m, d, hour, minute = 0, second = 0) => Math.floor(Date.UTC(y, m - 1, d, hour, minute, second) / 1000);

// A real closure: Friday 2026-08-07 close (20:00Z = 16:00 ET) → Monday 2026-08-10 open (13:30Z = 09:30 ET).
const FRI_BELL = unix(2026, 8, 7, 20, 0, 0);
const MON_BELL = unix(2026, 8, 10, 13, 30, 0);

const px = (value, exp = 8) => ({ value: String(value), exp });
const terms = (o = {}) => ({ thresholdBps: 500, maxLagSecs: 300, direction: 'ABS', ...o });
const inputs = (close, open, t = terms()) => ({ terms: t, observed: { source: 'test', close, open } });

test('the calendar puts the closure where the market does', () => {
  assert.equal(marketStatus(FRI_BELL - 60).status, STATUS.OPEN);
  assert.equal(marketStatus(FRI_BELL + 60).status, STATUS.CLOSED);
  assert.equal(marketStatus(MON_BELL - 60).status, STATUS.CLOSED);
  assert.equal(marketStatus(MON_BELL + 60).status, STATUS.OPEN);
});

test('boundary instants are re-derived, not supplied', () => {
  const r = gap.reexec(inputs(
    { price: px(10000000000), blockTime: FRI_BELL - 100 },
    { price: px(10000000000), blockTime: MON_BELL + 100 },
  ));
  assert.equal(r.computation.straddles_closure, true);
  // bisection finds the last non-CLOSED second and the first non-CLOSED second
  assert.equal(r.computation.close_instant, FRI_BELL - 1);
  assert.equal(r.computation.open_instant, MON_BELL);
  assert.equal(r.computation.close_lag_secs, 99);
  assert.equal(r.computation.open_lag_secs, 100);
  assert.equal(r.computation.closure_secs, MON_BELL - (FRI_BELL - 1));
});

test('a gap at or beyond the threshold is RED, short of it GREEN — and the boundary is exact', () => {
  const close = { price: px(10000000000), blockTime: FRI_BELL - 10 };
  const red = gap.reexec(inputs(close, { price: px(9500000000), blockTime: MON_BELL + 10 }));
  assert.equal(red.verdict.flag, 'RED');
  assert.equal(red.computation.signed_bps, '-500');
  assert.equal(red.computation.observed_bps, '500'); // ABS

  const green = gap.reexec(inputs(close, { price: px(9500100000), blockTime: MON_BELL + 10 }));
  assert.equal(green.verdict.flag, 'GREEN');
  assert.equal(green.computation.observed_bps, '499');
});

test('direction is not decoration: a 6% rally does not settle a DOWN market', () => {
  const close = { price: px(10000000000), blockTime: FRI_BELL - 10 };
  const up = { price: px(10600000000), blockTime: MON_BELL + 10 };
  assert.equal(gap.reexec(inputs(close, up, terms({ direction: 'DOWN' }))).verdict.flag, 'GREEN');
  assert.equal(gap.reexec(inputs(close, up, terms({ direction: 'UP' }))).verdict.flag, 'RED');
  assert.equal(gap.reexec(inputs(close, up, terms({ direction: 'ABS' }))).verdict.flag, 'RED');
});

// The attack this type exists to bound: pin a later print and choose the answer.
test('a print pinned past the declared lag settles nothing (STALE), whatever it would have said', () => {
  const close = { price: px(10000000000), blockTime: FRI_BELL - 10 };
  const honest = gap.reexec(inputs(close, { price: px(9000000000), blockTime: MON_BELL + 10 }));
  assert.equal(honest.verdict.flag, 'RED');

  // same prices, but the reopen print is pinned 3 hours late — inside those 3 hours the price
  // recovered, so a cherry-picker would rather settle on it.
  const late = gap.reexec(inputs(close, { price: px(9990000000), blockTime: MON_BELL + 3 * 3600 }));
  assert.equal(late.verdict.flag, 'STALE');
  assert.equal(late.computation.lags_ok, false);
  assert.match(late.verdict.reason, /further than 300s from its boundary/);
  // it still shows what it would have claimed — a STALE verdict hides nothing
  assert.equal(late.computation.observed_bps, '10');
});

test('prints that never straddle a closure settle nothing', () => {
  // both inside the same open session
  const r = gap.reexec(inputs(
    { price: px(10000000000), blockTime: MON_BELL + 60 },
    { price: px(9000000000), blockTime: MON_BELL + 120 },
  ));
  assert.equal(r.verdict.flag, 'STALE');
  assert.equal(r.computation.straddles_closure, false);
  assert.equal(r.computation.close_instant, null);
  assert.match(r.verdict.reason, /do not straddle a market closure/);
});

test('prices are exact integers, never floats', () => {
  // 0.1 + 0.2 arithmetic must not reach the verdict: 3 vs 1 with different exponents.
  const r = gap.reexec(inputs(
    { price: { value: '3', exp: 1 }, blockTime: FRI_BELL - 10 },   // 0.3
    { price: { value: '33', exp: 2 }, blockTime: MON_BELL + 10 },  // 0.33
  ));
  assert.equal(r.computation.signed_bps, '1000'); // exactly +10%

  for (const bad of [{ value: 1.5, exp: 2 }, { value: '01', exp: 2 }, { value: '0', exp: 2 }, { value: '1', exp: 99 }]) {
    assert.throws(() => gap.canonicalInputs(inputs({ price: bad, blockTime: FRI_BELL - 10 }, { price: px(1), blockTime: MON_BELL + 10 })));
  }
});

test('malformed terms are rejected, not coerced', () => {
  const close = { price: px(10000000000), blockTime: FRI_BELL - 10 };
  const open = { price: px(9000000000), blockTime: MON_BELL + 10 };
  for (const bad of [{ thresholdBps: 0 }, { maxLagSecs: 0 }, { direction: 'down' }, { thresholdBps: -1 }, { thresholdBps: 1.5 }]) {
    assert.throws(() => gap.canonicalInputs(inputs(close, open, terms(bad))));
  }
  // reversed order is a malformed claim, not a negative closure
  assert.throws(() => gap.canonicalInputs(inputs(open, close)));
});

test('the claim reproduces, and tampering with the verdict breaks both the check and the id', () => {
  const claim = gap.build({
    subject: { chain: 'solana', venue: 'test', asset: 'TEST' },
    terms: terms(),
    close: { price: px(10000000000), blockTime: FRI_BELL - 10 },
    open: { price: px(9400000000), blockTime: MON_BELL + 10 },
    source: 'test',
  });
  assert.equal(claim.verdict.flag, 'RED');
  assert.equal(verify(claim).ok, true);

  const tampered = structuredClone(claim);
  tampered.verdict.flag = 'GREEN';
  const v = verify(tampered);
  assert.equal(v.ok, false);
});

test('a market resolves off the re-executed verdict, not off a report of it', () => {
  const claim = gap.build({
    subject: { chain: 'solana', venue: 'test', asset: 'TEST' },
    terms: terms(),
    close: { price: px(10000000000), blockTime: FRI_BELL - 10 },
    open: { price: px(9400000000), blockTime: MON_BELL + 10 },
    source: 'test',
  });
  const r = resolve(claim, { market: 'TEST gap ≥ 5% across 2026-08-07 closure', yesWhen: ['RED'] });
  assert.equal(r.resolved, 'YES');
  assert.equal(r.reproduces, true);
});

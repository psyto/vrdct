import assert from 'node:assert/strict';
import test from 'node:test';
import * as gap from '../claimtypes/monday-open-gap.mjs';
import { verify } from '../core/verify.mjs';
import { resolve } from '../core/resolution.mjs';
import { marketStatus, STATUS } from '../core/campana.mjs';

const unix = (y, m, d, hour, minute = 0, second = 0) => Math.floor(Date.UTC(y, m - 1, d, hour, minute, second) / 1000);

// A real closure: Friday 2026-08-07 close (20:00Z = 16:00 ET) → Monday 2026-08-10 open (13:30Z).
const FRI_BELL = unix(2026, 8, 7, 20, 0, 0);
const MON_BELL = unix(2026, 8, 10, 13, 30, 0);
const SAT = unix(2026, 8, 8, 12); // any instant inside the closure names it

const px = (value, exp = 8) => ({ value: String(value), exp });
// Signatures are base58, which has no 0, O, I or l — so even the fixtures' labels have to be.
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const b58n = (n) => { let o = ''; do { o = B58[n % 58] + o; n = Math.floor(n / 58); } while (n > 0); return o; };
let seq = 0;
const up = (blockTime, value, o = {}) => ({ blockTime, price: px(value), slot: o.slot ?? 1000 + seq++, sig: o.sig ?? `sig${b58n(seq)}` });
const terms = (o = {}) => ({ anchorTs: SAT, thresholdBps: 500, maxLagSecs: 300, direction: 'ABS', ...o });
const inputs = (updates, t = terms()) => ({ terms: t, observed: { source: { kind: 'TEST' }, updates } });
const run = (updates, t = terms()) => gap.reexec(inputs(updates, t));

// the honest baseline: one update just inside the last session, one just after the reopen
const baseline = () => [up(FRI_BELL - 10, 10000000000), up(MON_BELL + 10, 9500000000)];

test('the closure comes from the anchor and the calendar, and consults no price', () => {
  assert.equal(marketStatus(SAT).status, STATUS.CLOSED);
  const c = gap.closureAround(SAT);
  assert.equal(c.closeInstant, FRI_BELL - 1);
  assert.equal(c.openInstant, MON_BELL);

  // any instant inside the same closure names the same one
  assert.deepEqual(gap.closureAround(unix(2026, 8, 9, 3)), c);
  assert.deepEqual(gap.closureAround(FRI_BELL + 1), c);
  assert.deepEqual(gap.closureAround(MON_BELL - 1), c);

  // an anchor while the market is open settles nothing
  assert.equal(gap.closureAround(MON_BELL + 60), null);
  const r = run(baseline(), terms({ anchorTs: MON_BELL + 60 }));
  assert.equal(r.verdict.flag, 'STALE');
  assert.match(r.verdict.reason, /does not fall inside a market closure/);
});

test('a holiday-lengthened closure is one closure, named by any instant in it', () => {
  // Thanksgiving 2026: Wed 11-25 closes, Thu 11-26 holiday, Fri 11-27 is a half day (13:00 ET).
  const wedBell = unix(2026, 11, 25, 21, 0);  // 16:00 ET, EST
  const friBell = unix(2026, 11, 27, 14, 30); // 09:30 ET
  const c = gap.closureAround(unix(2026, 11, 26, 12));
  assert.equal(c.closeInstant, wedBell - 1);
  assert.equal(c.openInstant, friBell, 'the holiday adds no session');
});

// The whole point of task 011: the prints are SELECTED, not supplied.
test('the last print before the bell and the first after the reopen are selected, not chosen', () => {
  const r = run([
    up(FRI_BELL - 3600, 10100000000, { sig: 'eary' }),
    up(FRI_BELL - 10, 10000000000, { sig: 'nearest' }),
    up(MON_BELL + 5, 9500000000, { sig: 'first' }),
    up(MON_BELL + 3600, 9900000000, { sig: 'ater' }),
  ]);
  assert.equal(r.computation.selected_close.sig, 'nearest');
  assert.equal(r.computation.selected_open.sig, 'first');
  assert.equal(r.computation.observed_bps, '500');
  assert.equal(r.verdict.flag, 'RED');
  assert.equal(r.computation.updates_pinned, 4);
});

// This is the acceptance criterion for closing task 009's residual. While a claim carried two chosen
// prints, nothing could prove either was the closest. Under selection, a claim that omitted the true
// nearest update is a DIFFERENT claim over a DIFFERENT set — detectable by reconstruction before
// anyone bonds, which is how CMLS closes the same problem.
test('adding a nearer real print changes the selection, so omitting it changes the claim', () => {
  const omitted = [up(FRI_BELL - 3600, 10000000000, { sig: 'far' }), up(MON_BELL + 3600, 9500000000, { sig: 'ate' })];
  const withNearer = [...omitted, up(FRI_BELL - 5, 10400000000, { sig: 'near' })];

  const a = run(omitted, terms({ maxLagSecs: 7200 }));
  const b = run(withNearer, terms({ maxLagSecs: 7200 }));
  assert.equal(a.computation.selected_close.sig, 'far');
  assert.equal(b.computation.selected_close.sig, 'near', 'the nearer update must win the selection');
  assert.notEqual(b.computation.observed_bps, a.computation.observed_bps, 'and it must move the number');

  // the verdict moves too: 500 bps on the omitted set, 865 on the honest one
  assert.equal(a.computation.observed_bps, '500');
  assert.equal(b.computation.observed_bps, '865');
});

test('two updates in the same second are ordered by (slot, sig), and array order never matters', () => {
  const tie = [
    up(FRI_BELL - 1, 10000000000, { slot: 500, sig: 'bbb' }),
    up(FRI_BELL - 1, 10900000000, { slot: 500, sig: 'aaa' }),
    up(MON_BELL, 9500000000, { slot: 900, sig: 'zzz' }),
  ];
  const r = run(tie);
  assert.equal(r.computation.selected_close.sig, 'bbb', 'same slot → the higher sig is later');

  const shuffled = run([tie[2], tie[1], tie[0]]);
  assert.deepEqual(shuffled.computation, r.computation);

  // slot breaks the tie before sig does
  const bySlot = run([
    up(FRI_BELL - 1, 10000000000, { slot: 501, sig: 'aaa' }),
    up(FRI_BELL - 1, 10900000000, { slot: 500, sig: 'zzz' }),
    up(MON_BELL, 9500000000, { slot: 900, sig: 'q' }),
  ]);
  assert.equal(bySlot.computation.selected_close.sig, 'aaa');
});

test('a window with nothing on one side of the closure settles nothing', () => {
  const noClose = run([up(MON_BELL + 10, 9500000000)]);
  assert.equal(noClose.verdict.flag, 'STALE');
  assert.match(noClose.verdict.reason, /at or before the closing bell/);

  const noOpen = run([up(FRI_BELL - 10, 10000000000)]);
  assert.equal(noOpen.verdict.flag, 'STALE');
  assert.match(noOpen.verdict.reason, /at or after the reopen/);
});

// maxLagSecs is a STALENESS guard now, not a bound on a choice — there is no choice left to bound.
test('a selected print too far from its bell is stale, whatever it would have said', () => {
  const late = [up(FRI_BELL - 10, 10000000000), up(MON_BELL + 301, 9000000000)];
  assert.equal(run(late).verdict.flag, 'STALE');
  assert.equal(run(late).computation.lags_ok, false);
  assert.equal(run(late, terms({ maxLagSecs: 301 })).verdict.flag, 'RED');

  // and the computation still shows what it would have said — the bound hides nothing
  assert.equal(run(late).computation.observed_bps, '1000');
});

test('an update from a later session cannot be selected, so the 009 multi-closure case is gone', () => {
  // Friday close, then Monday trades in full, then a Tuesday print. The anchor names the Fri→Mon
  // closure, so Monday's reopen print is selected and Tuesday's is simply not the first after it.
  const r = run([
    up(FRI_BELL - 10, 10000000000, { sig: 'fri' }),
    up(MON_BELL + 30, 9800000000, { sig: 'mon' }),
    up(unix(2026, 8, 11, 13, 31), 9000000000, { sig: 'tue' }),
  ]);
  assert.equal(r.computation.selected_open.sig, 'mon');
  assert.equal(r.computation.observed_bps, '200');
  assert.equal(r.verdict.flag, 'GREEN');
});

test('direction is not decoration: a 6% rally does not settle a DOWN market', () => {
  const u = [up(FRI_BELL - 10, 10000000000), up(MON_BELL + 10, 10600000000)];
  assert.equal(run(u, terms({ direction: 'DOWN' })).verdict.flag, 'GREEN');
  assert.equal(run(u, terms({ direction: 'UP' })).verdict.flag, 'RED');
  assert.equal(run(u, terms({ direction: 'ABS' })).verdict.flag, 'RED');
});

test('prices are exact integers, never floats', () => {
  // near the top of u64, where a float would have lost the last digits entirely
  const r = run([up(FRI_BELL - 10, '10000000000000000000'), up(MON_BELL + 10, '9500000000000000000')]);
  assert.equal(r.computation.observed_bps, '500');
  const boundary = run([up(FRI_BELL - 10, 10000000000), up(MON_BELL + 10, 9500100000)]);
  assert.equal(boundary.computation.observed_bps, '499');
  assert.equal(boundary.verdict.flag, 'GREEN');
});

test('canonicalInputs rejects what it cannot represent exactly', () => {
  const bad = (updates, t, re) => assert.throws(() => gap.canonicalInputs(inputs(updates, t)), re);
  bad([], terms(), /must be non-empty/);
  bad(baseline(), terms({ anchorTs: unix(2027, 1, 1, 0) }), /outside calendar 202601/);
  bad(baseline(), terms({ thresholdBps: 0 }), /thresholdBps must be non-zero/);
  bad(baseline(), terms({ maxLagSecs: 0 }), /maxLagSecs must be non-zero/);
  bad(baseline(), terms({ direction: 'SIDEWAYS' }), /direction must be/);
  bad([{ blockTime: FRI_BELL - 10, price: px(1), slot: 1 }], terms(), /sig must be a base58 signature/);
  bad([{ blockTime: FRI_BELL - 10, price: px(1), slot: 1, sig: 'not valid!' }], terms(), /sig must be a base58 signature/);
  bad([up(FRI_BELL - 10, 1.5)], terms(), /canonical unsigned decimal string/);
  bad([up(unix(2025, 12, 31, 0), 1)], terms(), /outside calendar 202601/);

  // the same observation twice is not two observations
  const dup = up(FRI_BELL - 10, 1, { slot: 7, sig: 'same' });
  bad([dup, { ...dup }], terms(), /is a duplicate observation: 7:same/);

  // and the window is bounded, like every other re-executed set in this repo
  const flood = Array.from({ length: gap.MAX_UPDATES + 1 }, (_, i) => up(FRI_BELL - 10, 1, { slot: i, sig: `s${b58n(i + 1)}` }));
  bad(flood, terms(), /at most 100000 records/);
});

test('a claim re-executes end-to-end, resists tampering, and resolves a market', () => {
  const subject = { chain: 'solana-mainnet', priceAccount: 'PriceAccountUnderTest' };
  const claim = gap.build({
    subject,
    terms: terms(),
    updates: baseline(),
    source: { kind: 'SOLANA_ACCOUNT_PRICE_UPDATES', account: 'PriceAccountUnderTest', from_ts: FRI_BELL - 3600, to_ts: MON_BELL + 3600 },
  });
  assert.equal(claim.verdict.flag, 'RED');
  const v = verify(claim);
  assert.equal(v.ok, true, JSON.stringify(v.checks));
  assert.ok(v.checks.some(([label]) => label === 'the same two prints are selected'));

  const tampered = { ...claim, verdict: { ...claim.verdict, flag: 'GREEN' } };
  assert.equal(verify(tampered).ok, false);

  // dropping the nearest update is a different claim, not the same one re-verified
  const thinned = { ...claim, inputs: { ...claim.inputs, observed: { ...claim.inputs.observed, updates: [claim.inputs.observed.updates[0]] } } };
  assert.equal(verify(thinned).ok, false);

  const res = resolve(claim, { market: 'Did the closure move SPYx by 5%?', yesWhen: ['RED'] });
  assert.equal(res.resolved, 'YES');
  assert.equal(res.reproduces, true);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import * as olv from '../claimtypes/obligated-liveness.mjs';
import { verify } from '../core/verify.mjs';
import { resolve } from '../core/resolution.mjs';
import { marketStatus, STATUS } from '../core/campana.mjs';

const unix = (y, m, d, hour, minute = 0, second = 0) => Math.floor(Date.UTC(y, m - 1, d, hour, minute, second) / 1000);

// One full trading day: Thursday 2026-08-06, 13:30Z–20:00Z (09:30–16:00 ET, EDT = UTC-4).
const DAY_FROM = unix(2026, 8, 6, 0);
const DAY_TO = unix(2026, 8, 7, 0);
// One full trading week: Mon 2026-08-03 → Sat 2026-08-08. Five sessions, no holiday.
const WEEK_FROM = unix(2026, 8, 3, 0);
const WEEK_TO = unix(2026, 8, 8, 0);
const HOUR = 3600;

const terms = (o = {}) => ({
  schedule: { kind: 'CALENDAR_OPEN', fromTs: DAY_FROM, toTs: DAY_TO, periodSecs: HOUR, ...(o.schedule || {}) },
  graceSecs: 300,
  asyncPpm: 100_000, // x = 0.1
  quorum: { n: 1, f: 0 },
  ...(({ schedule, ...rest }) => rest)(o),
});
// An action is an identified on-chain record. `act` mints distinct ids so a test that means "two
// separate acts" cannot accidentally test "one act listed twice" — which is F1's whole point.
let seq = 0;
const act = (ts, id) => ({ id: id ?? `tx${String(seq++).padStart(4, '0')}`, ts });
const inputs = (t, actions) => ({ terms: t, observed: { source: 'test', actions } });
const run = (t, actions) => olv.reexec(inputs(t, actions));

const slotsOf = (t) => olv.deriveSlots(t.schedule.fromTs, t.schedule.toTs, t.schedule.periodSecs);
// One action per obligated slot, a minute in — the shape of a keeper that never missed.
const actedEverySlot = (t) => slotsOf(t).map((s) => act(s.open + 60));

test('the obligated schedule is derived from the calendar, not supplied by the pinner', () => {
  const slots = slotsOf(terms());
  assert.equal(slots.length, 6); // 14:00Z … 19:00Z — 13:00Z is pre-bell, 20:00Z is the close itself
  assert.deepEqual(slots.map((s) => s.open), [14, 15, 16, 17, 18, 19].map((h) => unix(2026, 8, 6, h)));
  assert.equal(marketStatus(slots[0].open).status, STATUS.OPEN);
  assert.equal(marketStatus(unix(2026, 8, 6, 13)).status, STATUS.CLOSED);
  assert.equal(marketStatus(unix(2026, 8, 6, 20)).status, STATUS.CLOSED);

  // and the week is exactly five of those days
  assert.equal(slotsOf(terms({ schedule: { fromTs: WEEK_FROM, toTs: WEEK_TO } })).length, 30);
});

test('a window that obligates nothing settles nothing (STALE), it does not acquit', () => {
  // Saturday 2026-08-08 → Sunday: no session at all.
  const weekend = terms({ schedule: { fromTs: unix(2026, 8, 8, 0), toTs: unix(2026, 8, 9, 0) } });
  const r = run(weekend, []);
  assert.equal(r.computation.obligated_slots, 0);
  assert.equal(r.verdict.flag, 'STALE');
  assert.equal(r.verdict.attribution, 'UNDEFINED');
});

test('an obligor that acted in every slot is GREEN with nothing to attribute', () => {
  const t = terms();
  const r = run(t, actedEverySlot(t));
  assert.equal(r.verdict.flag, 'GREEN');
  assert.equal(r.verdict.attribution, 'NONE');
  assert.equal(r.computation.missed_slots, 0);
  assert.equal(r.computation.longest_dark_secs, 0);
});

// The shape of the real failure this type exists for: a keeper whose own state said `running` while
// it produced no action across an entire session. Nothing to re-execute — and yet attributable.
test('an obligor that produced nothing across a full session is RED, and the outage is measured', () => {
  const t = terms();
  const r = run(t, []);
  assert.equal(r.verdict.flag, 'RED');
  assert.equal(r.verdict.attribution, 'OBLIGOR');
  assert.equal(r.computation.missed_slots, 6);
  assert.equal(r.computation.excusable_misses, 0); // floor(6 × 0.1) = 0
  assert.equal(r.computation.attributable_misses, 6);
  assert.equal(r.computation.longest_dark_slots, 6);
  assert.equal(r.computation.longest_dark_secs, 6 * HOUR);
  assert.equal(r.computation.first_dark_slot, unix(2026, 8, 6, 14));
  assert.match(r.verdict.reason, /more than an x = 100000ppm network can excuse/);
});

// The paper's excusable region, at the exact integer boundary.
test('the async budget is exact: excusable misses are YELLOW, one more is RED', () => {
  const t = terms({ schedule: { fromTs: WEEK_FROM, toTs: WEEK_TO } });
  const all = actedEverySlot(t);
  assert.equal(all.length, 30);
  assert.equal(run(t, all).computation.excusable_misses, 3); // floor(30 × 0.1)

  const drop = (k) => all.slice(k); // drop the first k slots' actions

  const atBudget = run(t, drop(3));
  assert.equal(atBudget.computation.missed_slots, 3);
  assert.equal(atBudget.computation.attributable_misses, 0);
  assert.equal(atBudget.verdict.flag, 'YELLOW');
  assert.equal(atBudget.verdict.attribution, 'EXCUSED');

  const overBudget = run(t, drop(4));
  assert.equal(overBudget.computation.missed_slots, 4);
  assert.equal(overBudget.computation.attributable_misses, 1);
  assert.equal(overBudget.verdict.flag, 'RED');

  // one miss is still YELLOW, not GREEN: the miss happened, it is just not chargeable
  const oneMiss = run(t, drop(1));
  assert.equal(oneMiss.verdict.flag, 'YELLOW');
  assert.equal(oneMiss.computation.missed_slots, 1);
});

// arXiv:2504.12218 — accountable liveness is achievable iff x < 1/2 and f < n/2. Past the boundary
// the honest answer is that nobody may be blamed, and it must not depend on what the obligor did.
test("the theorem's x < 1/2 boundary returns UNKNOWN, and no valid evidence can move it", () => {
  const t = terms();
  const all = actedEverySlot(t);

  const justInside = terms({ asyncPpm: olv.ASYNC_PPM_BOUND - 1 });
  assert.equal(run(justInside, []).verdict.flag, 'RED');
  assert.equal(run(justInside, all).verdict.flag, 'GREEN');

  // x = 1/2 exactly: outside the achievable region.
  const atBound = terms({ asyncPpm: olv.ASYNC_PPM_BOUND });
  const dead = run(atBound, []);
  const live = run(atBound, all);
  assert.equal(dead.verdict.flag, 'UNKNOWN');
  assert.equal(live.verdict.flag, 'UNKNOWN'); // same verdict for opposite behaviour — that is the gate
  assert.equal(dead.verdict.attribution, 'UNDEFINED');
  assert.equal(dead.computation.attributable_possible, false);
  assert.match(dead.verdict.reason, /x = 500000ppm ≥ 1\/2/);
  // the evidence is still reported honestly; it simply cannot convict
  assert.equal(dead.computation.missed_slots, 6);
  assert.equal(live.computation.missed_slots, 0);
});

test("the theorem's f < n/2 boundary binds when the obligation is held by a quorum", () => {
  const t = (n, f) => terms({ quorum: { n, f } });
  assert.equal(run(t(1, 0), []).verdict.flag, 'RED');   // a single named obligor: 2·0 < 1
  assert.equal(run(t(3, 1), []).verdict.flag, 'RED');   // 2·1 < 3
  assert.equal(run(t(3, 2), []).verdict.flag, 'UNKNOWN'); // 2·2 ≥ 3 — which members were silent is undecidable
  assert.equal(run(t(4, 2), []).verdict.flag, 'UNKNOWN'); // 2·2 ≥ 4
  assert.match(run(t(4, 2), []).verdict.reason, /f = 2 ≥ n\/2/);
});

// The residual this type leaves open, and the reason it is safe to leave open.
test('omitting actions is monotone: it can only make the verdict harsher, never acquit', () => {
  const t = terms({ schedule: { fromTs: WEEK_FROM, toTs: WEEK_TO } });
  const all = actedEverySlot(t);
  const rank = { GREEN: 0, YELLOW: 1, RED: 2 };

  let prevAttributable = -1, prevRank = -1;
  for (let k = all.length; k >= 0; k--) {
    const r = run(t, all.slice(0, k)); // progressively omit actions from the end
    assert.ok(r.computation.attributable_misses >= prevAttributable, `attributable fell at k=${k}`);
    assert.ok(rank[r.verdict.flag] >= prevRank, `verdict softened at k=${k}`);
    prevAttributable = r.computation.attributable_misses;
    prevRank = rank[r.verdict.flag];
  }
  assert.equal(run(t, all).verdict.flag, 'GREEN');
  assert.equal(run(t, []).verdict.flag, 'RED');
});

test('grace is applied to the second', () => {
  // A window holding exactly one obligated slot, so nothing can be borrowed from a neighbour.
  const one = terms({ schedule: { fromTs: unix(2026, 8, 6, 14), toTs: unix(2026, 8, 6, 15) } });
  const [slot] = slotsOf(one);
  assert.equal(slotsOf(one).length, 1);

  assert.equal(run(one, [act(slot.deadline + 300)]).verdict.flag, 'GREEN');

  const late = run(one, [act(slot.deadline + 301)]);
  assert.equal(late.computation.missed_slots, 1);
  assert.equal(late.computation.excusable_misses, 0); // floor(1 × 0.1)
  assert.equal(late.verdict.flag, 'RED');

  // an action before the slot opens is not an early discharge of it
  assert.equal(run(one, [act(slot.open - 1)]).verdict.flag, 'RED');
});

// Grace makes slot i's window overlap the first `graceSecs` of slot i+1, so one action can fall
// inside two slots. Crediting it to both would let an obligor buy two obligations with one act.
test('one action discharges one obligation, never two', () => {
  const two = terms({ schedule: { fromTs: unix(2026, 8, 6, 14), toTs: unix(2026, 8, 6, 16) } });
  const [a, b] = slotsOf(two);
  assert.equal(slotsOf(two).length, 2);

  // a single action sitting in the overlap: inside slot b, and still inside slot a's grace tail
  const overlap = b.open + 60;
  assert.ok(overlap <= a.deadline + 300 && overlap >= b.open);
  const r = run(two, [act(overlap)]);
  assert.equal(r.computation.met_slots, 1);
  assert.equal(r.computation.missed_slots, 1);
  assert.equal(r.verdict.flag, 'RED');

  // two actions, one per slot, is what actually discharges both
  assert.equal(run(two, [act(a.open + 60), act(b.open + 60)]).verdict.flag, 'GREEN');
});

// F1 (Codex review of 74ea717). The matching above is only worth as much as the distinctness of
// what it consumes. When actions were bare timestamps, listing ONE real instant twice bought two
// discharges — the same loophole, moved out of the matching and into the evidence encoding, and
// enough to manufacture a GREEN without inventing any instant.
test('one real action listed twice cannot buy two discharges', () => {
  const two = terms({ schedule: { fromTs: unix(2026, 8, 6, 14), toTs: unix(2026, 8, 6, 16) } });
  const [a, b] = slotsOf(two);
  const overlap = b.open + 60; // inside slot b, and inside slot a's grace tail
  assert.ok(overlap <= a.deadline + 300 && overlap >= b.open);

  // the same record, listed twice: rejected outright, so it can never reach the matching
  assert.throws(
    () => olv.canonicalInputs(inputs(two, [act(overlap, 'sig-A'), act(overlap, 'sig-A')])),
    /id is a duplicate: sig-A/,
  );
  // and a duplicate is a duplicate even when the copy claims a different instant
  assert.throws(
    () => olv.canonicalInputs(inputs(two, [act(a.open + 60, 'sig-A'), act(b.open + 60, 'sig-A')])),
    /id is a duplicate: sig-A/,
  );

  // TWO DISTINCT records sharing a second do each discharge an obligation — they are two real acts,
  // and nothing in the source says otherwise. Stated by test so the semantics are chosen, not tripped over.
  const twins = run(two, [act(overlap, 'sig-A'), act(overlap, 'sig-B')]);
  assert.equal(twins.computation.met_slots, 2);
  assert.equal(twins.verdict.flag, 'GREEN');

  // an id must be source-checkable, so it is a bounded, restricted string
  assert.throws(() => olv.canonicalInputs(inputs(two, [{ ts: overlap }])), /must be a 1–96 char source-unique id/);
  assert.throws(() => olv.canonicalInputs(inputs(two, [{ id: 'has space', ts: overlap }])), /source-unique id/);
  assert.throws(() => olv.canonicalInputs(inputs(two, [overlap])), /must be an object \{ id, ts \}/);
});

// F2 (Codex review of 74ea717). MAX_SLOTS bounded one input and left the other open: a pinner could
// aim millions of well-formed observations at a one-slot window and make every verifier sort them.
test('re-execution cost is bounded on BOTH inputs, not just the schedule', () => {
  const one = terms({ schedule: { fromTs: unix(2026, 8, 6, 14), toTs: unix(2026, 8, 6, 15) } });
  const flood = Array.from({ length: olv.MAX_ACTIONS + 1 }, (_, i) => act(unix(2026, 8, 6, 14) + (i % 3600)));
  assert.throws(() => olv.canonicalInputs(inputs(one, flood)), /at most 100000 records/);

  // and the schedule bound still holds from the other side
  assert.throws(
    () => olv.canonicalInputs(inputs(terms({ schedule: { fromTs: unix(2026, 1, 1, 0), toTs: unix(2026, 12, 31, 0), periodSecs: 60 } }), [])),
    /would step more than 100000 times/,
  );
});

test('canonicalInputs rejects what it cannot represent exactly', () => {
  const bad = (t, actions, re) => assert.throws(() => olv.canonicalInputs(inputs(t, actions)), re);

  bad(terms({ graceSecs: HOUR }), [], /graceSecs must be less than/);
  bad(terms({ asyncPpm: 1_000_000 }), [], /asyncPpm must be less than 1e6/);
  bad(terms({ quorum: { n: 3, f: 3 } }), [], /quorum.f must be less than/);
  bad(terms({ quorum: { n: 0, f: 0 } }), [], /quorum.n must be non-zero/);
  bad(terms({ schedule: { toTs: DAY_FROM } }), [], /toTs must be after/);
  bad(terms({ schedule: { periodSecs: 59 } }), [], /periodSecs must be within/);
  bad(terms({ schedule: { kind: 'EVERY_BLOCK' } }), [], /schedule.kind must be/);
  bad(terms(), [act(DAY_FROM + 0.5)], /must be a safe u32 integer/);
  bad(terms(), [act(unix(2025, 12, 31, 0))], /outside calendar 202601/);
  bad(terms({ schedule: { fromTs: unix(2027, 1, 1, 0) } }), [], /outside calendar 202601/);
  assert.throws(() => olv.canonicalInputs({ terms: terms() }), /must be objects/);
});

test('a claim re-executes end-to-end, resists tampering, and resolves a market', () => {
  const t = terms();
  const subject = { obligor: 'keeper-under-test', account: 'KEEPER_ACCOUNT_UNDER_TEST', chain: 'solana' };
  const claim = olv.build({ subject, terms: t, actions: [], source: 'getSignaturesForAddress' });

  assert.equal(claim.verdict.flag, 'RED');
  const v = verify(claim);
  assert.equal(v.ok, true, JSON.stringify(v.checks));
  assert.ok(v.checks.some(([label]) => label === 'attribution reproduces'));

  // flipping the stated verdict fails both the re-executed flag and the content hash
  const tampered = { ...claim, verdict: { ...claim.verdict, flag: 'GREEN' } };
  const bad = verify(tampered);
  assert.equal(bad.ok, false);
  assert.equal(bad.checks.find(([label]) => label === 'verdict flag reproduces')[1], false);
  assert.equal(bad.checks.find(([label]) => label.startsWith('claim_id'))[1], false);

  const res = resolve(claim, { market: 'Did the keeper miss more than asynchrony can excuse?', yesWhen: ['RED'] });
  assert.equal(res.resolved, 'YES');
  assert.equal(res.reproduces, true);

  // and a market that asks the same question of an excused obligor does not resolve YES
  const excused = olv.build({ subject, terms: terms({ asyncPpm: 900_000 }), actions: [], source: 'test' });
  assert.equal(excused.verdict.flag, 'UNKNOWN');
  assert.equal(resolve(excused, { market: 'same', yesWhen: ['RED'] }).resolved, 'NO');
});

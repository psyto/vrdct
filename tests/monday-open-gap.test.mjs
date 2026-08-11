import assert from 'node:assert/strict';
import test from 'node:test';
import * as gap from '../claimtypes/monday-open-gap.mjs';
import { verify } from '../core/verify.mjs';
import { resolve } from '../core/resolution.mjs';
import { claimId } from '../core/claim.mjs';
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
// A descriptor wide enough that a rebuild of it would have contained whatever selection picks.
const ACCOUNT = '7j3VCB9fLmZ8kRt2QwXyPnDvE4aHsGuKbNcMqTrWyZ1a';
const src = (o = {}) => ({ kind: 'SOLANA_ACCOUNT_PRICE_UPDATES', chain: 'solana-mainnet', account: ACCOUNT, from_ts: FRI_BELL - 86400, to_ts: MON_BELL + 86400, ...o });
const inputs = (updates, t = terms(), source = src()) => ({ trusted: { calendar: 202601 }, terms: t, observed: { source, updates } });
const run = (updates, t = terms(), source = src()) => gap.reexec(inputs(updates, t, source));

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

// Selection removes the CHOICE: a claim that omitted the true nearest update is a different claim
// over a different set. It does NOT close the residual — observing that difference needs a rebuild,
// and no rebuilder exists for this type. Necessary condition, not sufficient one.
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
  ], terms(), src({ to_ts: MON_BELL + 3 * 86400 }));
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
  const subject = { chain: 'solana-mainnet', priceAccount: ACCOUNT };
  const claim = gap.build({
    subject,
    terms: terms(),
    updates: baseline(),
    source: src(),
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

// Codex, reviews/011 F1. The first version of this task left observed.source UNPARSED: a claim could
// carry null, a string, or a descriptor for an unrelated account and still build and verify. So
// selection prevented choosing prints only WITHIN a supplied set and did nothing about the set —
// which is the omission the residual is actually about. Naming reconstructibility as the fix while
// leaving unvalidated the thing a rebuild would target is a mechanism asserted, not implemented.
test('the source descriptor is consensus, not a label', () => {
  const bad = (source, re) => assert.throws(() => gap.canonicalInputs(inputs(baseline(), terms(), source)), re);
  // omitted entirely — the default parameter must not paper over a missing descriptor
  assert.throws(
    () => gap.canonicalInputs({ terms: terms(), observed: { updates: baseline() } }),
    /must be an object \{ kind, chain, account, from_ts, to_ts \}/,
  );
  bad(null, /must be an object/);
  bad('a price account somewhere', /must be an object/);
  bad(src({ kind: 'TEST' }), /kind must be 'SOLANA_ACCOUNT_PRICE_UPDATES'/);
  bad(src({ chain: 'solana-devnet' }), /chain must be 'solana-mainnet'/);
  bad(src({ chain: undefined }), /chain must be 'solana-mainnet'/);
  bad(src({ account: 'PriceAccountUnderTest' }), /account must be a base58 Solana address/);
  bad(src({ account: 'not!base58' }), /account must be a base58 Solana address/);
  bad(src({ from_ts: MON_BELL, to_ts: FRI_BELL }), /to_ts must be after/);
  bad(src({ to_ts: unix(2027, 6, 1, 0) }), /outside calendar 202601/);

  // and an update that could not have come from rebuilding that window is rejected outright
  assert.throws(
    () => gap.canonicalInputs(inputs(
      [...baseline(), up(MON_BELL + 7200, 9000000000)],
      terms(),
      src({ from_ts: FRI_BELL - 3600, to_ts: MON_BELL + 3600 }),
    )),
    /lies outside the declared source window/,
  );
});

test('a window that stops short of a bell cannot establish what the nearest print is', () => {
  // reaches the prints, but not maxLagSecs past the bells: a "nearest" here is only nearest among
  // what the window happened to include
  const narrow = src({ from_ts: FRI_BELL - 20, to_ts: MON_BELL + 20 });
  const r = run(baseline(), terms(), narrow);
  assert.equal(r.computation.window_covers_closure, false);
  assert.equal(r.verdict.flag, 'STALE');
  assert.match(r.verdict.reason, /does not reach 300s either side of the closure/);

  // widen it by exactly the declared lag and the same set settles
  const exact = src({ from_ts: FRI_BELL - 1 - 300, to_ts: MON_BELL + 300 });
  assert.equal(run(baseline(), terms(), exact).computation.window_covers_closure, true);
  assert.equal(run(baseline(), terms(), exact).verdict.flag, 'RED');
});

// Codex, reviews/011 F3. The subject names the account a claim is ABOUT; the descriptor names the
// account its inputs were read FROM. Nothing tied them together, so a claim could be subject-ed to
// one price account and sourced from another and verify cleanly — and a reader trusting the subject
// would be reading a verdict about a different account.
test('a claim cannot be about one account and sourced from another', () => {
  const OTHER = '9wRt3QwXyPnDvE4aHsGuKbNcMqTrWyZ1a7j3VCB9fLmZ';
  const mk = (subject) => gap.build({ subject, terms: terms(), updates: baseline(), source: src() });

  assert.throws(() => mk({ chain: 'solana-mainnet', priceAccount: OTHER }), /must be the account the source descriptor reads/);
  assert.throws(() => mk({ chain: 'solana-mainnet' }), /must be the account the source descriptor reads/);

  // and a hand-written claim that build() never saw is caught by verify, which is what matters
  const honest = mk({ chain: 'solana-mainnet', priceAccount: ACCOUNT });
  assert.equal(verify(honest).ok, true);
  const swapped = { ...honest, subject: { ...honest.subject, priceAccount: OTHER } };
  const v = verify(swapped);
  assert.equal(v.ok, false);
  assert.equal(v.checks.find(([label]) => label.startsWith('subject names the account'))[1], false);
});

// Codex, reviews/011 F5. A base58 pubkey is not globally unique to a cluster: the same 32 bytes name
// unrelated accounts on devnet, on a fork, or elsewhere. And metadata copied into a claim without
// being validated — the chain, the calendar version, a display count — lets a claim present a
// different source context and still verify, because verify() re-executes the inputs and checks the
// hash, and a hash over a wrong field is still a consistent hash.
//
// These are HAND-AUTHORED claims with claim_id recomputed after the edit. Construction-only tests
// would not have caught any of it: build() is not the verifier boundary.
test('a claim cannot present a different chain, calendar or count and still verify', () => {
  const subject = { chain: 'solana-mainnet', priceAccount: ACCOUNT };
  const honest = gap.build({ subject, terms: terms(), updates: baseline(), source: src() });
  assert.equal(verify(honest).ok, true);

  const reseal = (c) => ({ ...c, claim_id: claimId(c) });

  // the subject's chain, restamped so the content hash agrees with the lie
  const otherChain = reseal({ ...honest, subject: { ...honest.subject, chain: 'ethereum-mainnet' } });
  assert.equal(claimId(otherChain), otherChain.claim_id, 'the fixture must be self-consistent, or it proves nothing');
  const v = verify(otherChain);
  assert.equal(v.ok, false);
  assert.equal(v.checks.find(([l]) => l.startsWith('subject names the chain'))[1], false);

  // the descriptor's own chain
  const devnet = reseal({ ...honest, inputs: { ...honest.inputs, observed: { ...honest.inputs.observed, source: { ...honest.inputs.observed.source, chain: 'solana-devnet' } } } });
  assert.equal(verify(devnet).ok, false);

  // the calendar the boundaries were derived under
  const otherCal = reseal({ ...honest, inputs: { ...honest.inputs, trusted: { calendar: 202501 } } });
  assert.equal(verify(otherCal).ok, false);

  // The builder omits `observed.count` and `trusted.chain`. On its own that establishes something
  // about the BUILDER and nothing about what a verifier will accept — which is exactly what Codex's
  // F7 demonstrated by authoring them back. The rejection is the next test.
  assert.equal(honest.inputs.observed.count, undefined);
  assert.equal(honest.inputs.trusted.chain, undefined, 'chain belongs to the parsed descriptor, not to unvalidated metadata');

  // build() refuses the subject/source chain mismatch too, so it cannot be made by accident
  assert.throws(
    () => gap.build({ subject: { chain: 'solana-devnet', priceAccount: ACCOUNT }, terms: terms(), updates: baseline(), source: src() }),
    /must be the chain the source descriptor reads/,
  );
});

// Codex, reviews/011 F7. Each case starts from a claim that verifies, adds ONE key nothing parses,
// and reseals `claim_id` so the content hash agrees with the addition — the hash is consistent with
// the lie, which is precisely why it is not the defence. Every case must be refused at the verifier
// boundary, not merely absent from the builder's output.
test('the input domain is closed: an unrecognised key cannot be resealed into a verifying claim', () => {
  const subject = { chain: 'solana-mainnet', priceAccount: ACCOUNT };
  const honest = gap.build({ subject, terms: terms(), updates: baseline(), source: src() });
  assert.equal(verify(honest).ok, true);

  const forge = (mutate) => {
    const c = JSON.parse(JSON.stringify(honest));
    mutate(c.inputs);
    return { ...c, claim_id: claimId(c) };
  };

  const cases = [
    // the three Codex authored back after 26275c7 "removed" them
    ['trusted.chain', (i) => { i.trusted.chain = 'ethereum-mainnet'; }],
    ['observed.count', (i) => { i.observed.count = 999; }],
    ['source.genesis_hash', (i) => { i.observed.source.genesis_hash = 'not-mainnet'; }],
    // and every other object in the domain, so the next copied display field cannot recreate it
    ['an unknown root key', (i) => { i.note = 'for the reader'; }],
    ['an unknown trusted key', (i) => { i.trusted.venue = 'somewhere'; }],
    ['an unknown terms key', (i) => { i.terms.rounding = 'up'; }],
    ['an unknown observed key', (i) => { i.observed.source_url = 'https://example.invalid'; }],
    ['an unknown source key', (i) => { i.observed.source.program = 'jupiter-lend'; }],
    ['an unknown observation key', (i) => { i.observed.updates[0].label = 'the close print'; }],
    ['an unknown price key', (i) => { i.observed.updates[0].price.currency = 'USD'; }],
    ['a non-empty oracle_inputs', (i) => { i.oracle_inputs = [{ feed: 'somewhere' }]; }],
  ];

  for (const [what, mutate] of cases) {
    const forged = forge(mutate);
    assert.equal(claimId(forged), forged.claim_id, `${what}: the fixture must be self-consistent, or it proves nothing`);
    assert.equal(verify(forged).ok, false, `${what} survived the verifier`);
  }

  // and it is the input parser refusing, so re-execution and any future encoder refuse identically
  assert.throws(() => gap.canonicalInputs({ ...honest.inputs, note: 'x' }), /closed domain/);
});

// Codex, reviews/011 F9. Closing the INPUT domain left the other half open: fields re-execution
// PRODUCES were compared only where `checks()` happened to enumerate them, so source_chain,
// source_account, calendar_version and updates_pinned could each be rewritten, resealed and verified.
// The sweep below is deliberately not a list of field names — a list is the thing that goes stale.
test('the whole re-executed output is bound: no computation field, reason, invariant or subject survives a reseal', () => {
  const subject = { chain: 'solana-mainnet', priceAccount: ACCOUNT };
  const honest = gap.build({ subject, terms: terms(), updates: baseline(), source: src() });
  assert.equal(verify(honest).ok, true);

  const forge = (mutate) => {
    const c = JSON.parse(JSON.stringify(honest));
    mutate(c);
    return { ...c, claim_id: claimId(c) };
  };
  const twist = (v) => (
    typeof v === 'string' ? `${v}-tampered`
      : typeof v === 'number' ? v + 1
        : typeof v === 'boolean' ? !v
          : v === null ? 0
            : Array.isArray(v) ? [...v, 1] : { ...v, extra: 1 });

  const fields = Object.keys(honest.computation);
  assert.ok(fields.length >= 15, 'the sweep must actually cover this type\'s output');
  for (const k of fields) {
    const forged = forge((c) => { c.computation[k] = twist(c.computation[k]); });
    assert.notDeepEqual(forged.computation[k], honest.computation[k], `${k}: the mutation changed nothing, so the case proves nothing`);
    assert.equal(claimId(forged), forged.claim_id, `${k}: the fixture must be self-consistent`);
    assert.equal(verify(forged).ok, false, `computation.${k} survived the verifier`);
  }

  // an ADDED output field is an output field too
  assert.equal(verify(forge((c) => { c.computation.note = 'for the reader'; })).ok, false, 'an extra computation key survived');
  // the half of the verdict a human actually reads, which only the flag was ever compared against
  assert.equal(verify(forge((c) => { c.verdict.reason = 'because the issuer said so'; })).ok, false, 'verdict.reason survived');
  // the sentence the claim says it settles, which nothing re-executes
  assert.equal(verify(forge((c) => { c.invariant = { ...c.invariant, statement: 'something else entirely' }; })).ok, false, 'a rewritten invariant survived');
  // and the subject, which re-execution never reads at all
  assert.equal(verify(forge((c) => { c.subject.label = 'SPYx on Jupiter'; })).ok, false, 'an extra subject key survived');
  assert.equal(verify(forge((c) => { delete c.subject.chain; })).ok, false, 'a subject missing its chain survived');
});

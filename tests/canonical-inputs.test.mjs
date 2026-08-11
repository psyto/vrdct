import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { encodeRecords, inputsCommitment } from '../core/encode.mjs';
import * as cmls from '../claimtypes/closed-market-soundness.mjs';
import * as solvency from '../claimtypes/solvency.mjs';
import { registerClaimType, claimId } from '../core/claim.mjs';
import { canonical } from '../core/hash.mjs';
import { verify } from '../core/verify.mjs';
// keeper/window.mjs only, never keeper/lib.mjs: the root suite must stay runnable on a clean clone,
// and lib.mjs pulls in a Solana client the root package does not depend on.
import { tradingWindow } from '../keeper/window.mjs';

const unix = (y, m, d, hour, minute = 0, second = 0) => Math.floor(Date.UTC(y, m - 1, d, hour, minute, second) / 1000);

const solvencyInputs = (staleRecords = 0, overrides = {}) => ({
  observed: { quantities: { virtualValue: '100', liability: '100', inv2b_ok: true, staleRecords, ...overrides } },
});
const solvencyClaim = (staleRecords = 0, overrides = {}) => ({ claim_type: solvency.type, inputs: solvencyInputs(staleRecords, overrides) });
const cmlsInputs = (observations) => ({ observed: { observations } });
const cmlsClaim = (observations) => ({ claim_type: cmls.type, inputs: cmlsInputs(observations) });

test('valid canonical solvency inputs produce one JS meaning and one record', () => {
  const claim = solvencyClaim();
  assert.equal(solvency.reexec(claim.inputs).verdict.flag, 'GREEN');
  assert.equal(encodeRecords(claim).bytes.readUInt32LE(33), 0);
  assert.deepEqual(solvency.canonicalInputs(solvencyInputs(2, { virtualValue: 99, liability: '100', inv2b_ok: false })), {
    virtualValue: 99n, liability: 100n, inv2bOk: false, staleRecords: 2,
  });
});

test('every P0 staleRecords coercion input is rejected by re-execution and encoding', () => {
  for (const value of ['0', 0.5, 2 ** 32, Number.NaN, -1, 2 ** 53, '1e3', true, null, []]) {
    const claim = solvencyClaim(value);
    assert.throws(() => solvency.reexec(claim.inputs), /staleRecords/);
    assert.throws(() => encodeRecords(claim), /staleRecords/);
  }
  const missing = solvencyClaim();
  delete missing.inputs.observed.quantities.staleRecords;
  assert.throws(() => solvency.reexec(missing.inputs), /staleRecords/);
  assert.throws(() => encodeRecords(missing), /staleRecords/);
});

test('verify reports every malformed P0 staleRecords input without throwing', () => {
  for (const value of ['0', 0.5, 2 ** 32, Number.NaN, -1, 2 ** 53, '1e3', true, null, []]) {
    const claim = solvency.build({ subject: {}, window: {}, quantities: { virtualValue: '100', liability: '100', inv2b_ok: true, staleRecords: 0 } });
    claim.inputs.observed.quantities.staleRecords = value;
    let result;
    assert.doesNotThrow(() => { result = verify(claim); });
    assert.equal(result.ok, false);
    assert.equal(result.verdict, null);
    assert.ok(result.checks.some(([label, ok, detail]) => label === 'canonical inputs rejected' && ok === false && detail.includes('staleRecords')));
  }
});

test('verify keeps its result contract for malformed non-input claim fields', () => {
  const claim = solvency.build({ subject: {}, window: {}, quantities: { virtualValue: '100', liability: '100', inv2b_ok: true, staleRecords: 0 } });
  delete claim.computation;
  let result;
  assert.doesNotThrow(() => { result = verify(claim); });
  assert.equal(result.ok, false);
  assert.equal(result.verdict, null);
  assert.equal(result.checks[0][0], 'malformed claim');
});

// Codex, reviews/011 F11 and F12. The engine binds bodies by comparing canonical strings, so any
// value the canonicalizer maps onto ANOTHER value's bytes is two different bodies being one claim.
// Each case below is a pair that used to serialize identically.
test('canonical accepts a JSON value tree and refuses every value that would collide with another', () => {
  const collides = [
    // coerced to null
    ['NaN', Number.NaN], ['Infinity', Infinity], ['-Infinity', -Infinity],
    // dropped: [undefined], [,] and [] all rendered as []
    ['undefined', undefined],
    // impersonating {}: Object.keys is empty for every one of these
    ['a Date', new Date(0)], ['a Map', new Map()], ['a Set', new Set()], ['a RegExp', /x/],
    ['a class instance', new (class Thing { constructor() { this.x = 1; } })()],
    // not JSON at all
    ['a bigint', 1n], ['a function', () => 1], ['a symbol', Symbol('s')],
  ];
  for (const [what, value] of collides) {
    assert.throws(() => canonical({ v: value }), /canonical:/, `${what} was accepted inside an object`);
    assert.throws(() => canonical([value]), /canonical:/, `${what} was accepted inside an array`);
  }
  // an array hole is the same collision as [undefined], reached a different way
  assert.throws(() => canonical([, 1]), /hole/);
  // a cycle has no canonical form, and walking it used to end the stack rather than return a verdict
  const cyclic = { a: 1 }; cyclic.self = cyclic;
  assert.throws(() => canonical(cyclic), /cyclic/);
  assert.throws(() => canonical([[cyclic]]), /cyclic/);

  // the collisions themselves, stated as the equalities they used to be
  for (const [a, b] of [[[undefined], []], [[, 1], [1]], [new Date(0), {}], [new Map(), {}]]) {
    assert.throws(() => canonical(a), /canonical:/);
    assert.doesNotThrow(() => canonical(b));
  }

  // and a JSON value tree is untouched, so this refuses only what has no canonical form
  assert.equal(canonical({ b: [1, 'x', null, { c: true }], a: -0 }), '{"a":0,"b":[1,"x",null,{"c":true}]}');
  assert.equal(canonical(Object.create(null)), '{}');
});

// Codex, reviews/011 F13. A JS object graph carries state JSON does not, and two graphs differing
// only in that state used to serialize to the same bytes. Everything below can be SEEN, so it is
// refused. The last case cannot be seen, and is recorded rather than claimed.
test('canonical refuses object state JSON cannot carry, and records the one it cannot detect', () => {
  const hidden = { a: 1 };
  Object.defineProperty(hidden, 'b', { value: 2, enumerable: false });
  assert.throws(() => canonical(hidden), /non-enumerable/);

  const symboled = { a: 1, [Symbol('s')]: 2 };
  assert.throws(() => canonical(symboled), /symbol-keyed/);

  let asked = 0;
  const accessor = { get a() { return asked++; } };
  assert.throws(() => canonical(accessor), /accessor/);
  assert.equal(asked, 0, 'the getter must not be invoked while deciding to refuse it');

  const labelled = [1, 2];
  labelled.note = 'for the reader';
  assert.throws(() => canonical(labelled), /an array owns 'note'/);

  // the prototype must not be able to fill a hole: `i in v` and `v[i]` both consult it, so the walk
  // reads descriptors instead. Without this, Array.prototype[0] = 'x' rewrites the bytes of a value
  // nobody touched.
  const holed = [, 1];
  assert.throws(() => canonical(holed), /hole/);
  try {
    Array.prototype[0] = 'filled-from-the-prototype';
    assert.equal(holed[0], 'filled-from-the-prototype', 'the fixture must actually reach the prototype');
    assert.throws(() => canonical(holed), /hole/, 'a prototype filled a hole');
  } finally {
    delete Array.prototype[0];
  }

  // AND THE LIMIT, stated because it is the reason the trust boundary is JSON.parse output rather
  // than this function. A Proxy is not reliably detectable in standard JS: an inert one passes, and
  // a hostile one can answer differently each time it is asked, so canonical() is not stable over it.
  assert.equal(canonical(new Proxy({ a: 1 }, {})), '{"a":1}');
  let n = 0;
  const shifty = new Proxy({ a: 1 }, { getOwnPropertyDescriptor: () => ({ value: n++, enumerable: true, configurable: true }) });
  assert.notEqual(canonical(shifty), canonical(shifty), 'if this ever becomes equal, the limit has changed and the comment above is stale');
});

// Codex, reviews/011 F12, demonstrated on a real claim: a body that is not a JSON value tree was
// being content-addressed anyway, so two different bodies shared a claim_id and a verdict.
test('a non-JSON body cannot be content-addressed, and the builders no longer produce one', () => {
  const corpus = JSON.parse(readFileSync(new URL('../corpus/jupiter-spyx-cmls.claim.json', import.meta.url)));
  assert.equal(verify(corpus).ok, true);

  const impersonated = JSON.parse(JSON.stringify(corpus));
  impersonated.inputs.trusted.dailyClosed = new Date(0);
  assert.equal(verify(impersonated).ok, false, 'a Date impersonating {} survived the verifier');
  assert.throws(() => claimId(impersonated), /not a JSON object/);

  // the builder side of the same finding: an absent chain is an ABSENT KEY, not `undefined`
  const claim = solvency.build({ subject: {}, window: {}, quantities: { virtualValue: '100', liability: '100', inv2b_ok: true, staleRecords: 0 } });
  assert.deepEqual(claim.inputs.trusted, {});
  assert.ok(!('chain' in claim.inputs.trusted), 'an undefined chain must be omitted, not carried');
  assert.equal(verify(claim).ok, true);
  assert.equal(solvency.build({ subject: { chain: 'solana-mainnet' }, window: {}, quantities: { virtualValue: '100', liability: '100', inv2b_ok: true, staleRecords: 0 } }).inputs.trusted.chain, 'solana-mainnet');
});

test('claim-types must supply a canonical parser when registered', () => {
  assert.throws(() => registerClaimType({ type: 'missing-canonical-inputs', reexec: () => ({ computation: {}, verdict: { flag: 'GREEN' } }) }), /canonicalInputs/);
});

test('solvency parser accepts only specified u128 and tri-state shapes', () => {
  for (const [field, value] of [['virtualValue', '01'], ['virtualValue', '-1'], ['virtualValue', 2 ** 53], ['liability', null]]) {
    assert.throws(() => solvency.canonicalInputs(solvencyInputs(0, { [field]: value })), new RegExp(field));
  }
  for (const value of ['true', 1, null, undefined]) {
    assert.throws(() => solvency.canonicalInputs(solvencyInputs(0, { inv2b_ok: value })), /inv2b_ok/);
  }
  const absentInv2b = solvencyInputs();
  delete absentInv2b.observed.quantities.inv2b_ok;
  assert.equal(solvency.reexec(absentInv2b).verdict.flag, 'STALE');
});

test('CMLS rejects empty and unrepresentable observations at build, re-execution, and encoding', () => {
  const invalid = [[], [{}], [{ blockTime: 0.5 }], [{ blockTime: -1 }], [{ blockTime: 2 ** 32 }]];
  for (const observations of invalid) {
    const claim = cmlsClaim(observations);
    const field = observations.length === 0 ? /observations/ : /blockTime/;
    assert.throws(() => cmls.reexec(claim.inputs), field);
    assert.throws(() => encodeRecords(claim), field);
    assert.throws(() => cmls.build({ subject: { priceAccount: 'test' }, window: {}, observations }), field);
  }
});

test('CMLS rejects observations that straddle the 2026 calendar validity boundary', () => {
  const claim = cmlsClaim([{ blockTime: 1767225599 }, { blockTime: 1767225600 }]);
  assert.throws(() => cmls.reexec(claim.inputs), /validity range/);
  assert.throws(() => encodeRecords(claim), /validity range/);
  assert.throws(() => cmls.build({ subject: { priceAccount: 'test' }, window: {}, observations: claim.inputs.observed.observations }), /validity range/);
});

test('CMLS keeps valid duplicate timestamps canonical and encodable', () => {
  const claim = cmlsClaim([{ blockTime: 1785600000 }, { blockTime: 1785600000 }]);
  assert.equal(cmls.reexec(claim.inputs).verdict.flag, 'RED');
  assert.equal(encodeRecords(claim).nRecords, 2);
});

test('CMLS counts a half-day session as open and its 13:00 ET boundary as closed', () => {
  const result = cmls.classifyUpdateTimes([
    unix(2026, 11, 27, 14, 30), // 09:30 EST, open
    unix(2026, 11, 27, 17, 59, 59), // 12:59:59 EST, open
    unix(2026, 11, 27, 18), // 13:00 EST, closed
  ]);
  assert.equal(result.openUpdates, 2);
  assert.equal(result.closedUpdates, 1);
});

test('CMLS 201-record vector crosses the canonical 200-record chunk boundary', () => {
  const observations = Array.from({ length: 201 }, (_, i) => ({ blockTime: 1785600000 + i * 60 }));
  const commitment = inputsCommitment(cmlsClaim(observations));
  assert.equal(commitment.nRecords, 201);
  assert.equal(commitment.chunks.length, 2);
  assert.equal(commitment.chunks[0].length, 200 * 4);
  assert.equal(commitment.chunks[1].length, 4);
});

test('keeper trading windows are close-to-close across Friday, weekend, Monday, and a half day', () => {
  const thuClose = unix(2026, 8, 6, 20);
  const friClose = unix(2026, 8, 7, 20);
  const monClose = unix(2026, 8, 10, 20);
  for (const now of [unix(2026, 8, 7, 21), unix(2026, 8, 8, 12), unix(2026, 8, 9, 12), unix(2026, 8, 10, 19)]) {
    assert.deepEqual(tradingWindow(now), { fromTs: thuClose, toTs: friClose, chainNow: now });
  }
  assert.deepEqual(tradingWindow(unix(2026, 8, 10, 21)), { fromTs: friClose, toTs: monClose, chainNow: unix(2026, 8, 10, 21) });

  // Thanksgiving is closed; the next completed session is Friday's 13:00 ET half-day close.
  assert.deepEqual(tradingWindow(unix(2026, 11, 27, 19)), {
    fromTs: unix(2026, 11, 25, 21), toTs: unix(2026, 11, 27, 18), chainNow: unix(2026, 11, 27, 19),
  });
});

test('committed corpus remains a valid, reproducible canonical claim', () => {
  const claim = JSON.parse(readFileSync(new URL('../corpus/jupiter-spyx-cmls.claim.json', import.meta.url)));
  assert.equal(verify(claim).ok, true);
  assert.equal(encodeRecords(claim).nRecords, claim.inputs.observed.observations.length);
  assert.equal(inputsCommitment(claim).inputsHash.toString('hex'), '2f224c44f93a8e2c2840c75c2a86872ce3b73336ffcec047654d8d0e2deffccd');
});

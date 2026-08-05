import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { encodeRecords } from '../core/encode.mjs';
import * as cmls from '../claimtypes/closed-market-soundness.mjs';
import * as solvency from '../claimtypes/solvency.mjs';
import { verify } from '../core/verify.mjs';

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

test('CMLS keeps valid duplicate timestamps canonical and encodable', () => {
  const claim = cmlsClaim([{ blockTime: 1785600000 }, { blockTime: 1785600000 }]);
  assert.equal(cmls.reexec(claim.inputs).verdict.flag, 'RED');
  assert.equal(encodeRecords(claim).nRecords, 2);
});

test('committed corpus remains a valid, reproducible canonical claim', () => {
  const claim = JSON.parse(readFileSync(new URL('../corpus/jupiter-spyx-cmls.claim.json', import.meta.url)));
  assert.equal(verify(claim).ok, true);
  assert.equal(encodeRecords(claim).nRecords, claim.inputs.observed.observations.length);
});

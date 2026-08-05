import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { encodeRecords, inputsCommitment } from '../core/encode.mjs';
import * as cmls from '../claimtypes/closed-market-soundness.mjs';
import * as solvency from '../claimtypes/solvency.mjs';
import { registerClaimType } from '../core/claim.mjs';
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

test('CMLS 201-record vector crosses the canonical 200-record chunk boundary', () => {
  const observations = Array.from({ length: 201 }, (_, i) => ({ blockTime: 1785600000 + i * 60 }));
  const commitment = inputsCommitment(cmlsClaim(observations));
  assert.equal(commitment.nRecords, 201);
  assert.equal(commitment.chunks.length, 2);
  assert.equal(commitment.chunks[0].length, 200 * 4);
  assert.equal(commitment.chunks[1].length, 4);
});

test('committed corpus remains a valid, reproducible canonical claim', () => {
  const claim = JSON.parse(readFileSync(new URL('../corpus/jupiter-spyx-cmls.claim.json', import.meta.url)));
  assert.equal(verify(claim).ok, true);
  assert.equal(encodeRecords(claim).nRecords, claim.inputs.observed.observations.length);
  assert.equal(inputsCommitment(claim).inputsHash.toString('hex'), '2f224c44f93a8e2c2840c75c2a86872ce3b73336ffcec047654d8d0e2deffccd');
});

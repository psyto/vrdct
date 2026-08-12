import assert from 'node:assert/strict';
import test from 'node:test';
import * as cmls from '../claimtypes/closed-market-soundness.mjs';
import * as solvency from '../claimtypes/solvency.mjs';
import * as gap from '../claimtypes/monday-open-gap.mjs';
import * as liveness from '../claimtypes/obligated-liveness.mjs';
import * as restaking from '../claimtypes/restaking-robustness.mjs';
import { claimId } from '../core/claim.mjs';
import { verify } from '../core/verify.mjs';

const unix = (y, m, d, hour, minute = 0) => Math.floor(Date.UTC(y, m - 1, d, hour, minute) / 1000);
const ACCOUNT = 'A2GDb4Um4Tr42iKgPz5fQ2d7pYTnaUuHN3d5V41Cywff';

function validClaims() {
  return [
    cmls.build({
      subject: { priceAccount: ACCOUNT }, window: {
        from_ts: 1785600000, to_ts: 1785600060,
        from_iso: new Date(1785600000 * 1000).toISOString(), to_iso: new Date(1785600060 * 1000).toISOString(),
      },
      observations: [{ sig: 'a', slot: 1, blockTime: 1785600000 }],
    }),
    solvency.build({
      subject: { chain: 'solana-mainnet' }, window: {},
      quantities: { virtualValue: '100', liability: '100', inv2b_ok: true, staleRecords: 0 },
    }),
    gap.build({
      subject: { chain: 'solana-mainnet', priceAccount: ACCOUNT },
      terms: { anchorTs: unix(2026, 8, 8, 12), thresholdBps: 1, maxLagSecs: 3600, direction: 'ABS' },
      source: { kind: 'SOLANA_ACCOUNT_PRICE_UPDATES', chain: 'solana-mainnet', account: ACCOUNT, from_ts: unix(2026, 8, 7, 19), to_ts: unix(2026, 8, 10, 15) },
      updates: [
        { price: { value: '100', exp: 0 }, blockTime: unix(2026, 8, 7, 20), slot: 1, sig: 'a' },
        { price: { value: '101', exp: 0 }, blockTime: unix(2026, 8, 10, 14, 30), slot: 2, sig: 'b' },
      ],
    }),
    liveness.build({
      subject: { obligor: 'keeper-under-test', account: 'KEEPER_ACCOUNT_UNDER_TEST' },
      terms: {
        schedule: { kind: 'CALENDAR_OPEN', fromTs: unix(2026, 8, 6, 0), toTs: unix(2026, 8, 7, 0), periodSecs: 3600 },
        graceSecs: 300, asyncPpm: 100_000, quorum: { n: 1, f: 0 },
      },
      actions: [], source: liveness.OBSERVATION_SOURCE,
    }),
    restaking.build({
      subject: { network: 'restaking-network-under-test' },
      terms: { gamma: { num: 1, den: 10 }, shockPsiBps: 10 },
      services: [{ id: 's', profit: '1', alpha: { num: 1, den: 2 } }],
      validators: [{ id: 'v', stake: '100', services: ['s'] }],
      source: { kind: restaking.SOURCE_KIND.DECLARED_GRAPH },
    }),
  ];
}

function objectPaths(value, path = []) {
  if (value === null || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap((item, index) => objectPaths(item, [...path, index]));
  return [path, ...Object.keys(value).flatMap((key) => objectPaths(value[key], [...path, key]))];
}

function atPath(value, path) {
  return path.reduce((current, key) => current[key], value);
}

function reseal(claim) {
  return { ...claim, claim_id: claimId(claim) };
}

function claimOf(type) {
  const claim = validClaims().find((candidate) => candidate.claim_type === type);
  assert.ok(claim, `missing ${type} fixture`);
  assert.equal(verify(claim).ok, true, `${type}: the baseline must verify`);
  return claim;
}

function refusedAfterReseal(claim, label, mutate) {
  const forged = JSON.parse(JSON.stringify(claim));
  mutate(forged);
  const resealed = reseal(forged);
  assert.equal(claimId(resealed), resealed.claim_id, `${label}: the fixture must be self-consistent before rejection`);
  assert.equal(verify(resealed).ok, false, `${label}: the verifier accepted the changed context`);
}

test('every claim-type rejects a resealed unknown key at every semantic input object', () => {
  for (const honest of validClaims()) {
    assert.equal(verify(honest).ok, true, `${honest.claim_type}: the baseline must verify`);
    const paths = objectPaths(honest.inputs);
    assert.ok(paths.length > 1, `${honest.claim_type}: the fixture must contain semantic objects`);

    for (const path of paths) {
      const forged = JSON.parse(JSON.stringify(honest));
      atPath(forged.inputs, path).__unrecognised = true;
      const resealed = reseal(forged);
      const label = `${honest.claim_type}:${path.join('.') || 'inputs'}`;
      assert.equal(claimId(resealed), resealed.claim_id, `${label}: the fixture must be self-consistent before rejection`);
      assert.equal(verify(resealed).ok, false, `${label}: an unparsed key survived the verifier`);
    }
  }
});

test('derived observed counts agree with their arrays before a claim can verify', () => {
  for (const honest of validClaims().filter((claim) => (
    claim.claim_type === cmls.type || claim.claim_type === liveness.type
  ))) {
    assert.equal(verify(honest).ok, true, `${honest.claim_type}: the baseline must verify`);
    const forged = JSON.parse(JSON.stringify(honest));
    forged.inputs.observed.count = 999;
    const resealed = reseal(forged);
    assert.equal(claimId(resealed), resealed.claim_id, `${honest.claim_type}: the fixture must be self-consistent before rejection`);
    assert.equal(verify(resealed).ok, false, `${honest.claim_type}: observed.count disagreed with its own array`);
  }
});

test('subject and trusted context cannot name a different source after a reseal', () => {
  refusedAfterReseal(claimOf(cmls.type), 'CMLS subject account', (claim) => { claim.subject.priceAccount = '11111111111111111111111111111111'; });
  refusedAfterReseal(claimOf(liveness.type), 'liveness subject account', (claim) => { claim.subject.account = 'OTHER_ACCOUNT'; });
  refusedAfterReseal(claimOf(liveness.type), 'liveness trusted obligor', (claim) => { claim.inputs.trusted.obligor = 'other-obligor'; });
  refusedAfterReseal(claimOf(cmls.type), 'CMLS market id', (claim) => { claim.inputs.trusted.market_id = 'TOKYO_EQUITIES'; });
  refusedAfterReseal(claimOf(solvency.type), 'solvency trusted chain', (claim) => { claim.inputs.trusted.chain = 'ethereum-mainnet'; });
  refusedAfterReseal(claimOf(liveness.type), 'liveness calendar', (claim) => { claim.inputs.trusted.calendar = 202501; });
  refusedAfterReseal(claimOf(restaking.type), 'restaking trusted network', (claim) => { claim.inputs.trusted.network = 'other-network'; });
});

test('every source label is a typed descriptor or the type-specific literal', () => {
  refusedAfterReseal(claimOf(cmls.type), 'CMLS source', (claim) => { claim.inputs.observed.source = 'made up'; });
  refusedAfterReseal(claimOf(solvency.type), 'solvency source', (claim) => { claim.inputs.observed.source = 'made up'; });
  refusedAfterReseal(claimOf(liveness.type), 'liveness source', (claim) => { claim.inputs.observed.source = 'made up'; });
  refusedAfterReseal(claimOf(restaking.type), 'restaking source kind', (claim) => { claim.inputs.observed.source.kind = 'made up'; });
});

test('CMLS window must bracket its observations and ISO strings must represent its timestamps', () => {
  refusedAfterReseal(claimOf(cmls.type), 'CMLS window ISO', (claim) => { claim.inputs.window.from_iso = '2026-01-01T00:00:00.000Z'; });
  refusedAfterReseal(claimOf(cmls.type), 'CMLS window bounds', (claim) => {
    const before = claim.inputs.observed.observations[0].blockTime - 1;
    claim.inputs.window.to_ts = before;
    claim.inputs.window.to_iso = new Date(before * 1000).toISOString();
  });
});

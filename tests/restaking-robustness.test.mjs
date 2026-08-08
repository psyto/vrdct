import assert from 'node:assert/strict';
import test from 'node:test';
import * as rsk from '../claimtypes/restaking-robustness.mjs';
import { verify } from '../core/verify.mjs';
import { resolve } from '../core/resolution.mjs';

const svc = (id, profit, num = 1, den = 2) => ({ id, profit: String(profit), alpha: { num, den } });
const val = (id, stake, services) => ({ id, stake: String(stake), services });
const terms = (num, den, shockPsiBps = 10) => ({ gamma: { num, den }, shockPsiBps });
const inputs = (t, services, validators) => ({ terms: t, observed: { source: 'test', services, validators } });
const run = (t, services, validators) => rsk.reexec(inputs(t, services, validators));

test("the abstract's own instance: a 10% buffer caps a 0.1% shock at 1.1% of stake", () => {
  // "if attack costs always exceed attack profits by 10%, then a sudden loss of .1% of the overall
  // stake cannot result in the ultimate loss of more than 1.1%" — R_ψ < (1 + 1/γ)ψ.
  const r = run(terms(1, 10, 10), [svc('s', 1)], [val('v', 1_000_000, ['s'])]);
  assert.equal(r.computation.shock_psi_bps, 10);   // 0.1%
  assert.equal(r.computation.cascade_bound_bps, 110); // 1.1%
  assert.equal(r.verdict.flag, 'GREEN');

  // and the bound blows up as the buffer vanishes, which is the whole content of the theorem
  assert.equal(run(terms(1, 100, 10), [svc('s', 1)], [val('v', 1_000_000, ['s'])]).computation.cascade_bound_bps, 1010);
  assert.equal(run(terms(1, 10_000, 10), [svc('s', 1)], [val('v', 1_000_000, ['s'])]).computation.cascade_bound_bps, 10_000); // capped: R_ψ ≤ 1
});

// Theorem 2 (arXiv:2407.21785, p.11): S = {x}, V = {a, b} both restaking for x, σ_a = ε,
// σ_b = 1 − ε, π_x = 1, α_x = 1. The graph is secure and meets EigenLayer's condition with
// equality — and yet R_ψ(G) = 1 for every ψ ≥ ε. It certifies no buffer at all.
test("the paper's tightness construction certifies exactly zero buffer", () => {
  const services = [svc('x', 100, 1, 1)];       // π_x = 100, α_x = 1
  const validators = [val('a', 1, ['x']), val('b', 99, ['x'])]; // ε = 1/100 of σ_V = 100
  const r = run(terms(1, 10), services, validators);

  assert.equal(r.computation.gamma_max, '0/1'); // T_v = 1 exactly ⇒ γ* = 0
  assert.equal(r.computation.gamma_max_bps, 0);
  assert.equal(r.verdict.flag, 'RED');
  assert.match(r.verdict.reason, /no positive buffer/);
  assert.match(r.verdict.reason, /arbitrarily small shock can in the worst case take everything/);
});

// Figure 4, left (p.6): a green service with π = 1 secured by a dedicated validator holding 100, and
// an unrelated blue service with π = 101 secured by validators holding 1 and 99, with α_s = 1. The
// green service is handsomely overcollateralized; the network is not.
test("a well-collateralized service does not rescue the network it shares a graph with", () => {
  const services = [svc('green', 1, 1, 1), svc('blue', 101, 1, 1)];
  const validators = [val('v-blue-1', 1, ['blue']), val('v-blue-99', 99, ['blue']), val('v-green-100', 100, ['green'])];
  const r = run(terms(1, 10), services, validators);

  assert.equal(r.verdict.flag, 'RED');
  assert.equal(r.computation.gamma_max, '-1/101'); // T = 101/100 > 1 through either blue validator
  assert.equal(r.computation.gamma_max_bps, -100); // rounded DOWN, never flattering
  assert.equal(r.computation.binding_validator, 'v-blue-1');

  // the green service alone would certify a buffer of 99×
  const alone = run(terms(1, 10), [services[0]], [validators[2]]);
  assert.equal(alone.computation.gamma_max, '99/1');
  assert.equal(alone.verdict.flag, 'GREEN');
});

test('the three verdicts are the three regimes of the certified buffer', () => {
  // one service, π = 100, α = 1/2 ⇒ σ_{N(s)} must exceed 200 to certify anything.
  const services = [svc('s', 100, 1, 2)];
  const at = (stake) => run(terms(1, 10), services, [val('v', stake, ['s'])]);

  assert.equal(at(300).verdict.flag, 'GREEN');  // T = 200/300 ⇒ γ* = 1/2 ≥ 1/10
  assert.equal(at(300).computation.gamma_max, '1/2');

  assert.equal(at(205).verdict.flag, 'YELLOW'); // T = 200/205 ⇒ γ* = 5/200 = 1/40 < 1/10
  assert.equal(at(205).computation.gamma_max, '1/40');
  assert.match(at(205).verdict.reason, /short of the declared/);

  assert.equal(at(200).verdict.flag, 'RED');    // T = 1 exactly
  assert.equal(at(150).verdict.flag, 'RED');
});

test('the buffer boundary is exact, because a rational never becomes a float', () => {
  // α = 1/3, σ_{N(s)} = 300, π = 100 ⇒ T = 100·3/(1·300) = 1 exactly. Not 0.9999999999999999.
  const third = run(terms(1, 10), [svc('s', 100, 1, 3)], [val('v', 300, ['s'])]);
  assert.equal(third.computation.gamma_max, '0/1');
  assert.equal(third.verdict.flag, 'RED');

  // γ* exactly equal to the declared γ must be GREEN (the condition is ≤, not <). T = 10/11 ⇒ γ* = 1/10.
  const services = [svc('s', 100, 1, 3)];
  const exact = run(terms(1, 10), services, [val('v', 330, ['s'])]);
  assert.equal(exact.computation.gamma_max, '1/10');
  assert.equal(exact.verdict.flag, 'GREEN');

  // one base unit less and it is no longer certified
  assert.equal(run(terms(1, 10), services, [val('v', 329, ['s'])]).verdict.flag, 'YELLOW');
});

// σ_v cancels out of Corollary 2, so the certificate is a property of the graph's SHAPE. Scaling
// every stake and every profit by the same factor must not move the verdict.
test('the certified buffer is scale-free', () => {
  const k = 1_000_000_000n;
  const base = run(terms(1, 4), [svc('s1', 10), svc('s2', 5)], [val('v1', 100, ['s1', 's2']), val('v2', 60, ['s1'])]);
  const scaled = run(
    terms(1, 4),
    [svc('s1', 10n * k, 1, 2), svc('s2', 5n * k, 1, 2)],
    [val('v1', 100n * k, ['s1', 's2']), val('v2', 60n * k, ['s1'])],
  );
  assert.equal(scaled.computation.gamma_max, base.computation.gamma_max);
  assert.equal(scaled.verdict.flag, base.verdict.flag);
});

// Invisible to a per-validator sum, because no validator is adjacent to it: Eq. (1) reads 0 ≥ α·0
// and Eq. (2) reads π > 0, so the EMPTY coalition is a valid attack.
test('a service carrying profit with nothing staked into it is a free attack, and is caught', () => {
  const r = run(terms(1, 10), [svc('funded', 1), svc('orphan', 50)], [val('v', 1_000_000, ['funded'])]);
  assert.equal(r.verdict.flag, 'RED');
  assert.deepEqual(r.computation.free_attack_services, ['orphan']);
  assert.match(r.verdict.reason, /corruptible by the empty coalition/);

  // a service with no stake AND no profit is not an attack — there is nothing to win
  const harmless = run(terms(1, 10), [svc('funded', 1), svc('orphan', 0)], [val('v', 1_000_000, ['funded'])]);
  assert.deepEqual(harmless.computation.free_attack_services, []);
  assert.equal(harmless.verdict.flag, 'GREEN');
});

test('adding stake can never lower the certified buffer', () => {
  const services = [svc('s1', 10), svc('s2', 7)];
  const at = (extra) => run(terms(1, 4), services, [val('v1', 100, ['s1', 's2']), val('v2', 50 + extra, ['s1', 's2'])]);
  let prev = null;
  for (const extra of [0, 1, 5, 50, 500, 5000]) {
    const r = at(extra);
    const [n, d] = r.computation.gamma_max.split('/').map(BigInt);
    if (prev !== null) assert.ok(n * prev[1] >= prev[0] * d, `buffer fell when stake rose (extra=${extra})`);
    prev = [n, d];
  }
});

test('the verdict does not depend on the order a claim lists the network in', () => {
  const services = [svc('s1', 10), svc('s2', 7), svc('s3', 3)];
  const validators = [val('v1', 100, ['s1', 's2']), val('v2', 60, ['s2', 's3']), val('v3', 80, ['s1', 's3'])];
  const a = run(terms(1, 4), services, validators);
  const b = run(terms(1, 4), [...services].reverse(), [...validators].reverse().map((v) => ({ ...v, services: [...v.services].reverse() })));
  assert.deepEqual(b.computation, a.computation);
  assert.deepEqual(b.verdict, a.verdict);
});

test('canonicalInputs rejects what it cannot represent exactly', () => {
  const s = [svc('s', 10)], v = [val('v', 100, ['s'])];
  const bad = (t, services, validators, re) => assert.throws(() => rsk.canonicalInputs(inputs(t, services, validators)), re);

  bad(terms(0, 10), s, v, /gamma.num must be non-zero/);          // γ > 0 is required by Theorem 1
  bad(terms(1, 0), s, v, /gamma.den must be non-zero/);
  bad({ gamma: { num: 1, den: 10 }, shockPsiBps: 0 }, s, v, /shockPsiBps must be within/);
  bad({ gamma: { num: 1, den: 10 }, shockPsiBps: 10_001 }, s, v, /shockPsiBps must be within/);
  bad(terms(1, 10), [svc('s', 10, 3, 2)], v, /alpha must be ≤ 1/);   // α_s is a fraction of stake
  bad(terms(1, 10), [svc('s', 10, 0, 2)], v, /alpha.num must be non-zero/);
  bad(terms(1, 10), [svc('s', 1.5)], v, /canonical unsigned decimal string/);
  bad(terms(1, 10), [svc('s', '007')], v, /canonical unsigned decimal string/);
  bad(terms(1, 10), [svc('s', 10), svc('s', 20)], v, /is a duplicate/);
  bad(terms(1, 10), s, [val('v', 100, ['nope'])], /names an unknown service/);
  bad(terms(1, 10), s, [val('v', 100, ['s', 's'])], /duplicate edge/);
  bad(terms(1, 10), s, [val('v', 100, ['s']), val('v', 50, ['s'])], /is a duplicate/);
  bad(terms(1, 10), s, [val('v', -1, ['s'])], /canonical unsigned decimal string/);
  bad(terms(1, 10), [], v, /services must be a non-empty array/);
  bad(terms(1, 10), s, [], /validators must be a non-empty array/);
  bad(terms(1, 10), [{ id: 'has space', profit: '1', alpha: { num: 1, den: 2 } }], v, /1–64 char id/);
});

test('a claim re-executes end-to-end, resists tampering, and resolves a market', () => {
  const subject = { network: 'restaking-network-under-test', chain: 'ethereum' };
  const services = [svc('s1', 100, 1, 3), svc('s2', 40, 1, 2)];
  const validators = [val('v1', 300, ['s1']), val('v2', 200, ['s1', 's2'])];
  const claim = rsk.build({ subject, terms: terms(1, 10), services, validators, source: 'pinned-snapshot' });

  const v = verify(claim);
  assert.equal(v.ok, true, JSON.stringify(v.checks));
  assert.ok(v.checks.some(([label]) => label === 'certified buffer reproduces'));

  const tampered = { ...claim, verdict: { ...claim.verdict, flag: claim.verdict.flag === 'GREEN' ? 'RED' : 'GREEN' } };
  const badv = verify(tampered);
  assert.equal(badv.ok, false);
  assert.equal(badv.checks.find(([label]) => label === 'verdict flag reproduces')[1], false);

  // restating the network with an inflated stake is a different claim, not the same one re-verified
  const inflated = { ...claim, inputs: { ...claim.inputs, observed: { ...claim.inputs.observed, validators: [val('v1', 3_000_000, ['s1']), validators[1]] } } };
  assert.equal(verify(inflated).ok, false);

  const res = resolve(claim, { market: 'Does the network certify a 10% overcollateralization buffer?', yesWhen: ['GREEN'] });
  assert.equal(res.resolved, claim.verdict.flag === 'GREEN' ? 'YES' : 'NO');
  assert.equal(res.reproduces, true);
});

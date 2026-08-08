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
  assert.equal(r.computation.gamma_max_bps, '0');
  assert.equal(r.verdict.flag, 'RED');
  // F2 (Codex review of 45d3f80): the reason must stop at what the certificate says about THIS
  // graph. Corollary 2 failing does not prove a valid attack or a cascade here; Theorem 2 is a
  // separate existence construction, not a theorem about every RED input.
  assert.match(r.verdict.reason, /does not establish a positive buffer for this network/);
  assert.doesNotMatch(r.verdict.reason, /take everything|will cascade|is attackable/);
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
  assert.equal(r.computation.gamma_max_bps, '-100'); // rounded DOWN, never flattering
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

// ── Codex review of 45d3f80 ──────────────────────────────────────────────────────────────────

// F1 (P1). σ_v cancels out of Eq. (17) only when it is POSITIVE. At σ_v = 0 the unreduced condition
// reads 0 ≤ 0 and holds vacuously — so asking whether T_v ≤ 1 for such a row invents a constraint
// the theorem does not impose, and one zero-balance row was enough to make the market pay the
// other side.
test('a zero-stake validator cannot invent a constraint', () => {
  const services = [svc('a', 1, 1, 1), svc('b', 1, 1, 1)];
  const real = [val('v-a', 100, ['a']), val('v-b', 100, ['b'])];
  const declared = terms(75, 1);

  const without = run(declared, services, real);
  assert.equal(without.computation.gamma_max, '99/1');
  assert.equal(without.verdict.flag, 'GREEN');

  // add a row holding nothing, adjacent to both services. The network is unchanged.
  const withZero = run(declared, services, [...real, val('z', 0, ['a', 'b'])]);
  assert.equal(withZero.computation.gamma_max, '99/1', 'a zero-stake row moved the certificate');
  assert.equal(withZero.verdict.flag, 'GREEN');
  assert.equal(withZero.computation.binding_validator, 'v-a');
  assert.equal(withZero.computation.constrained_validators, 2);

  // it still counts as an edge for σ_{N(s)} — it just adds zero
  assert.equal(withZero.computation.total_stake, '200');

  // and a graph holding no stake at all cannot state a fraction of total stake
  assert.throws(
    () => rsk.canonicalInputs(inputs(declared, services, [val('z', 0, ['a'])])),
    /non-zero total stake/,
  );
});

// F3 (P2). γ* is unbounded, and Number() rounds a large exact floor UPWARD — the one direction a
// reported buffer must never move.
test('gamma_max_bps stays exact above Number.MAX_SAFE_INTEGER', () => {
  // π = 1, α = 1 ⇒ T = 1/σ ⇒ γ* = σ − 1. Pick σ so that γ* × 10000 is far past 2^53.
  const sigma = 18014398509481987n; // γ* = 18014398509481986
  const r = run(terms(1, 10), [svc('s', 1, 1, 1)], [val('v', sigma, ['s'])]);
  assert.equal(r.computation.gamma_max, '18014398509481986/1');
  assert.equal(r.computation.gamma_max_bps, '180143985094819860000');
  assert.equal(typeof r.computation.gamma_max_bps, 'string');
  // the conversion this replaced, applied to the very value being published: strictly larger than
  // the true floor, i.e. flattering — which is the one direction a reported buffer must never move
  const exact = BigInt(r.computation.gamma_max_bps);
  assert.ok(BigInt(Number(exact)) > exact, 'the removed Number() conversion was not actually lossy');
});

// F4 (P2, re-review). Cardinality alone does not bound cost: `T_v` is an exact sum over ONE
// validator's services, so its digits grow with that validator's DEGREE whenever the denominators
// share no factors. Codex's re-review ran a claim well inside the first set of limits — 512
// services, 16 validators, 8,192 edges — and `reexec` took 7.26 s and produced a 4,378-character
// γ*. Degree is the driver; the edge cap rides on it.
test('the graph is bounded by degree, not just by cardinality', () => {
  const many = (n, f) => Array.from({ length: n }, (_, i) => f(`x${String(i).padStart(6, '0')}`));
  const oneSvc = [svc('s', 1)];
  const wide = many(rsk.MAX_SERVICES, (id) => svc(id, 1));
  const ids = wide.map((s) => s.id);

  assert.throws(
    () => rsk.canonicalInputs(inputs(terms(1, 10), many(rsk.MAX_SERVICES + 1, (id) => svc(id, 1)), [val('v', 100, ['x000000'])])),
    /at most 4096 entries/,
  );
  assert.throws(
    () => rsk.canonicalInputs(inputs(terms(1, 10), oneSvc, many(rsk.MAX_VALIDATORS + 1, (id) => val(id, 100, ['s'])))),
    /at most 16384 entries/,
  );
  // one validator may not reach past the degree cap — this is the arithmetic bound
  assert.throws(
    () => rsk.canonicalInputs(inputs(terms(1, 10), wide, [val('v', 100, ids.slice(0, rsk.MAX_SERVICES_PER_VALIDATOR + 1))])),
    /at most 32 services/,
  );
  // and edges are counted across validators, not per row
  const rows = many(rsk.MAX_EDGES / rsk.MAX_SERVICES_PER_VALIDATOR + 1, (id) => val(id, 100, ids.slice(0, rsk.MAX_SERVICES_PER_VALIDATOR)));
  assert.throws(() => rsk.canonicalInputs(inputs(terms(1, 10), wide, rows)), /at most 32768 edges/);
});

// The bound above is only worth what it costs at the boundary, so the boundary is executed. The
// FIRST version of this test was not worst case and Codex caught it: it gave each validator a
// contiguous block of services, so every service in the block shared the same adjacent-validator
// set, every denominator carried an identical σ_{N(s)} factor, and the gcd collapsed it — 587 ms
// where the true worst case is 8,556 ms. So the fixture now proves its own adversarial-ness before
// it proves anything about cost.
test('the worst accepted claim re-executes inside a documented budget', () => {
  const STAKE = 1n << 120n;              // near-u128: the largest denominators a claim can carry
  const degree = rsk.MAX_SERVICES_PER_VALIDATOR;
  const nValidators = rsk.MAX_EDGES / degree;

  // deterministic xorshift — pseudorandom neighbourhoods, so no two services of one validator share
  // an adjacent-validator set and nothing in the arithmetic collapses
  let seed = 0x9e3779b9;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };

  const services = Array.from({ length: rsk.MAX_SERVICES }, (_, i) => ({
    id: `s${String(i).padStart(5, '0')}`,
    profit: '1',
    alpha: { num: 1000003 + 2 * i, den: 4294967291 }, // distinct, reduced, sharing no factors
  }));
  const rows = Array.from({ length: nValidators }, (_, v) => {
    const picked = new Set();
    while (picked.size < degree) picked.add(rnd() % services.length);
    return {
      id: `v${String(v).padStart(5, '0')}`,
      stake: String(STAKE + BigInt(2 * v + 1)), // distinct and odd: subset sums share no large factor
      services: [...picked].map((i) => services[i].id),
    };
  });

  // (1) the fixture is actually adversarial: within a validator, the σ_{N(s)} must be distinct, or
  //     the denominators share a factor and this measures nothing.
  const stakeIn = new Map(services.map((s) => [s.id, 0n]));
  for (const v of rows) for (const id of v.services) stakeIn.set(id, stakeIn.get(id) + BigInt(v.stake));
  let worstDistinct = Infinity;
  for (const v of rows) worstDistinct = Math.min(worstDistinct, new Set(v.services.map((id) => String(stakeIn.get(id)))).size / degree);
  assert.ok(worstDistinct > 0.9, `fixture collapsed: only ${(worstDistinct * 100).toFixed(0)}% of σ_N distinct per validator`);

  // (2) the cost
  const started = process.hrtime.bigint();
  const r = rsk.reexec(inputs(terms(1, 10), services, rows));
  const ms = Number(process.hrtime.bigint() - started) / 1e6;

  assert.equal(r.computation.constrained_validators, nValidators);
  // Measured ~0.91 s on the development machine, down from 8.6 s before reduction was deferred to
  // once per validator. The wall is ~5x that: this asserts the shape of the cost, not the speed of
  // whatever runs it. If it ever trips, the limits are wrong, not the machine.
  assert.ok(ms < 5_000, `worst accepted claim took ${ms.toFixed(0)}ms`);

  // (3) the certificate's size, against the PROVEN ceiling rather than a number I liked: the
  //     accumulated denominator is exactly Π (α_s.num · σ_{N(s)}), so at most degree × (32 + 142)
  //     bits — 5,568 bits, i.e. under ~1,700 digits each side of the fraction.
  assert.ok(r.computation.gamma_max.length < 3_600, `γ* was ${r.computation.gamma_max.length} chars`);
});

// N1. free_attack_services is reported in the claim body and in the RED reason, so leaving it in the
// caller's array order would make two claims over the same network hash differently.
test('the free-attack set is canonically ordered, like everything else reported', () => {
  const orphans = [svc('zeta', 5), svc('alpha', 7), svc('funded', 1)];
  const validators = [val('v', 1000, ['funded'])];
  const a = run(terms(1, 10), orphans, validators);
  const b = run(terms(1, 10), [...orphans].reverse(), validators);

  assert.deepEqual(a.computation.free_attack_services, ['alpha', 'zeta']);
  assert.deepEqual(b.computation, a.computation);
  assert.equal(b.verdict.reason, a.verdict.reason);
});

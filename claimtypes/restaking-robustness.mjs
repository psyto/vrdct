// Vrdct claim-type: restaking-robustness. Re-executes, from a pinned restaking network, the largest
// overcollateralization buffer γ the network provably sustains — and therefore the bound on how far
// a small shock can cascade before it stops.
//
// Why this is a claim-type. Restaking reuses one validator's stake across many services, so a loss
// anywhere is a loss of security everywhere it was pledged. What gets published about these networks
// is TVL. TVL is not a safety property: it says how much is pledged, not whether pledging it that
// way is survivable. The survivable-ness is a deterministic function of public on-chain state —
// which is exactly the shape this engine settles.
//
// THE RESULT THIS IMPLEMENTS. Durvasula & Roughgarden, *Robust Restaking Networks* (ITCS '25,
// arXiv:2407.21785). A restaking graph is G = (S, V, E, π, σ, α): services s ∈ S with profit-from-
// corruption π_s and a corruption threshold α_s, validators v ∈ V with stake σ_v, an edge when v
// restakes for s. A pair (A, B) is an ATTACKING COALITION when B holds enough stake to corrupt every
// service in A, and a VALID ATTACK when it also profits: π_A > σ_B. The graph is SECURE with γ-slack
// when every attacking coalition satisfies (1 + γ)·π_A ≤ σ_B — and their Theorem 1 then bounds the
// cascade from an initial shock of a ψ fraction of all stake:
//
//     R_ψ(G) < (1 + 1/γ) · ψ         — and this bound is tight (Theorems 2, 3, 8)
//
// Their headline instance: buffer of 10% ⇒ a sudden loss of 0.1% of stake cannot end in losing more
// than 1.1%. Without slack (γ = 0), Theorem 2 exhibits a network where an arbitrarily small shock
// loses EVERYTHING. The buffer is not a nicety; it is the whole difference.
//
// WHY THIS IS COMPUTABLE AT ALL. Checking security exactly means quantifying over every (A, B) —
// as hard as verifying bipartite expansion, and coNP-hard. What makes a public board possible is
// their Corollary 2, an efficiently checkable SUFFICIENT condition, per validator:
//
//     Σ_{s ∈ N(v)}  (σ_v / σ_{N(s)}) · ((1+γ)·π_s / α_s)  ≤  σ_v          ∀v ∈ V
//
// σ_v cancels on both sides, which is the useful part: the condition is a property of the graph's
// SHAPE, not of how rich any one validator is. Writing T_v = Σ_{s ∈ N(v)} π_s / (α_s · σ_{N(s)}),
// the condition is (1+γ)·T_v ≤ 1, so the largest buffer the condition certifies is
//
//     γ* = min_{v ∈ V} (1/T_v) − 1
//
// which the paper proposes as a risk measure a restaking protocol could expose to its participants.
// This module computes exactly that, in integer arithmetic, and settles it as a claim.
//
//   verdict GREEN  — γ* ≥ the buffer the market declared; the cascade bound is earned
//   verdict YELLOW — 0 < γ* < declared; a positive buffer exists, but smaller than was asserted
//   verdict RED    — γ* ≤ 0; the checkable condition fails even with no slack, so NO robustness
//                    guarantee is available, and Theorem 2 is what "no slack" can cost
//
// HONEST SCOPE — READ THIS BEFORE READING A RED. Corollary 2 is SUFFICIENT, not necessary. GREEN
// means the network provably sustains the buffer. RED does NOT mean an attack exists; it means the
// efficiently checkable certificate is unavailable, and nobody has published the guarantee. A
// neutral board can say "this is not certified" without claiming "this is broken", and it must,
// because deciding the latter is coNP-hard.
//
// AND THE INPUT NOBODY CAN RE-EXECUTE. σ, α and the edges are on-chain state. π_s — the profit from
// corrupting a service — is NOT: the paper assumes the π_s are given and calls producing them "an
// important open research direction" (§2, fn. 2). So this type does not pretend to derive them. They
// are PINNED IN THE TERMS, declared before the fact like `monday-open-gap`'s threshold, and the
// verdict is a claim about the network UNDER THAT ESTIMATE. That is the honest division of labour:
// the estimate is a public, contestable number, and everything downstream of it is mechanical. A
// challenger who disputes a verdict is disputing an estimate in the open, which is the point.
//
// FOLLOW-UP (not done here). `core/encode.mjs` / `CLAIM_TYPE_ID` and the Rust twin under
// `onchain/programs/vrdct-bond/src/reexec/` are byte-parity surfaces; this type is offline-complete
// and is NOT yet wired to either.

import { registerClaimType, buildClaim } from '../core/claim.mjs';
import { closed } from '../core/closed.mjs';

export const type = 'restaking-robustness';
export const invariant = {
  id: 'RSK',
  statement: 'A restaking network certifies an overcollateralization buffer γ — and with it the bound R_ψ < (1 + 1/γ)ψ on any cascade from a ψ shock — only if every validator satisfies (1+γ)·Σ_{s ∈ N(v)} π_s/(α_s·σ_{N(s)}) ≤ 1 under the pinned profit estimates.',
};

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const U128_MAX = (1n << 128n) - 1n;
export const SOURCE_KIND = {
  DECLARED_GRAPH: 'DECLARED_RESTAKING_GRAPH',
  JITO_OBSERVATION: 'JITO_RESTAKING_OBSERVATION',
};
const JITO_SOURCE_KEYS = [
  'kind', 'restaking_program', 'vault_program', 'reads', 'observed_from', 'observed_to',
  'certifies', 'does_not_certify', 'settlement_grade', 'evaluated_at_slot', 'epoch_length',
  'active_stake_rule', 'security_measure', 'manifest', 'declared', 'contributing_mints',
  'stake_reduction', 'reproducible',
];
const PROFIT_ESTIMATES = 'declared in terms.* / observed.services[].profit — see honest scope';

function sourceDescriptor(value) {
  if (!isObject(value)) throw new Error('inputs.observed.source must be an object descriptor');
  if (value.kind === SOURCE_KIND.DECLARED_GRAPH) {
    closed('inputs.observed.source', value, ['kind']);
  } else if (value.kind === SOURCE_KIND.JITO_OBSERVATION) {
    closed('inputs.observed.source', value, JITO_SOURCE_KEYS);
  } else {
    throw new Error(`inputs.observed.source.kind must be '${SOURCE_KIND.DECLARED_GRAPH}' or '${SOURCE_KIND.JITO_OBSERVATION}'`);
  }
  return value;
}

/// Re-execution has to terminate for a verifier with a laptop, and an attacker must not be able to
/// make one claim cost a year of CPU. Cardinality alone does not deliver that: `T_v` is an exact sum
/// of fractions over ONE validator's services, so its size grows with that validator's DEGREE
/// whenever the denominators share no factors. Degree, not edge count, is the expensive dimension.
///
/// SIZE IS PROVEN, NOT MEASURED. Because `addFracRaw` defers reduction, a validator's accumulated
/// denominator is exactly Π_{s ∈ N(v)} (α_s.num · σ_{N(s)}). With `α.num` a u32 and σ_{N(s)} at most
/// MAX_VALIDATORS · u128, that is at most `degree × (32 + 142)` bits — 5,568 bits at the cap below,
/// so `γ*` can never print longer than about 3,400 characters, on any graph the type accepts.
///
/// TIME IS MEASURED, on genuinely adversarial input: pseudorandom neighbourhoods so the σ_{N(s)}
/// inside one validator are pairwise distinct, `alpha` denominators distinct and reduced, stakes
/// near u128 — so nothing collapses. (An earlier fixture assigned each validator a contiguous block
/// of services, which gave all of them the SAME σ_{N(s)} and quietly collapsed the arithmetic; it
/// measured 587 ms where the true worst case measures 8,556 ms. The boundary test now asserts its
/// own adversarial-ness so that cannot recur.)
///
///     degree   edges    time (stepwise gcd)   time (deferred)   γ* length
///         32   32,768         8,556 ms             906 ms        2,503 chars   ← the limits below
///         32   16,384         3,502 ms             439 ms        2,489 chars
///         16   32,768         1,079 ms             371 ms        1,281 chars
///
/// Headroom against reality: the largest live restaking sets are a few hundred operators against
/// ~20 services, so ~8k edges at degree ~20 — roughly 4x inside these limits. If a real set outgrows
/// them, they are part of the canonical input domain: cheap to change now, expensive once a Rust
/// twin exists, so re-measure and change them deliberately rather than raising them in place.
///
/// AND SAY WHAT THIS IS NOT. These numbers are a defensible COMPUTATIONAL DOMAIN. They are not a
/// finding that every live operator fits inside them — that is a claim about the world, and nothing
/// here establishes it. The consequence binds whoever writes the ingestion adapter: a snapshot with
/// a validator past the degree cap must be REJECTED, never truncated to fit. Dropping edges to make
/// a graph admissible removes constraints, and removing constraints can only raise γ* — it would
/// manufacture a GREEN out of a network this type is not entitled to judge.
export const MAX_SERVICES = 4_096;
export const MAX_VALIDATORS = 16_384;
export const MAX_SERVICES_PER_VALIDATOR = 32;
export const MAX_EDGES = 32_768;

/// Stakes and profits are pinned as canonical unsigned decimal strings (or safe integers) in base
/// units — never floats. Two verifiers that parse the same claim must hold the same number.
function amount(name, value) {
  let v;
  if (typeof value === 'string') {
    if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(`${name} must be a canonical unsigned decimal string or safe integer`);
    v = BigInt(value);
  } else if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    v = BigInt(value);
  } else {
    throw new Error(`${name} must be a canonical unsigned decimal string or safe integer`);
  }
  if (v > U128_MAX) throw new Error(`${name} exceeds u128`);
  return v;
}
function u32(name, value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`${name} must be a safe u32 integer`);
  }
  return value;
}
/// A rational pinned as two integers. Floats cannot represent 1/3, and α_s = 1/3 is the common case.
function ratio(name, value, { maxNum = 0xffffffff } = {}) {
  if (!isObject(value)) throw new Error(`${name} must be an object { num, den }`);
  closed(name, value, ['num', 'den']);
  const num = u32(`${name}.num`, value.num);
  const den = u32(`${name}.den`, value.den);
  if (num === 0) throw new Error(`${name}.num must be non-zero`);
  if (den === 0) throw new Error(`${name}.den must be non-zero`);
  if (num > maxNum) throw new Error(`${name}.num is out of range`);
  return { n: BigInt(num), d: BigInt(den) };
}
const identifier = (name, value) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,64}$/.test(value)) {
    throw new Error(`${name} must be a 1–64 char id of [A-Za-z0-9._:-]`);
  }
  return value;
};

// The sole raw-JSON reader for this surface: re-execution and any future on-chain encoder must
// consume this typed result, never the raw object.
export function canonicalInputs(inputs) {
  if (!isObject(inputs) || !isObject(inputs.terms) || !isObject(inputs.observed)) {
    throw new Error('inputs.terms and inputs.observed must be objects');
  }
  closed('inputs', inputs, ['trusted', 'oracle_inputs', 'terms', 'observed']);
  if ('trusted' in inputs) {
    closed('inputs.trusted', inputs.trusted, ['network', 'profit_estimates']);
    if (inputs.trusted.profit_estimates !== PROFIT_ESTIMATES) {
      throw new Error('inputs.trusted.profit_estimates must name the declared profit estimates');
    }
  }
  if ('oracle_inputs' in inputs && !(Array.isArray(inputs.oracle_inputs) && inputs.oracle_inputs.length === 0)) {
    throw new Error('inputs.oracle_inputs has no input domain in this type: it may be absent or the empty array, nothing else');
  }
  const { terms, observed } = inputs;

  closed('inputs.terms', terms, ['gamma', 'shockPsiBps']);
  // γ > 0 is required by Theorem 1: at γ = 0 there is no bound to state (Theorem 2).
  const gamma = ratio('terms.gamma', terms.gamma);
  const shockPsiBps = u32('terms.shockPsiBps', terms.shockPsiBps);
  if (shockPsiBps === 0 || shockPsiBps > 10_000) throw new Error('terms.shockPsiBps must be within (0, 10000]');

  closed('inputs.observed', observed, ['source', 'services', 'validators']);
  sourceDescriptor(observed.source);
  if (!Array.isArray(observed.services) || observed.services.length === 0) throw new Error('observed.services must be a non-empty array');
  if (!Array.isArray(observed.validators) || observed.validators.length === 0) throw new Error('observed.validators must be a non-empty array');
  if (observed.services.length > MAX_SERVICES) throw new Error(`observed.services must hold at most ${MAX_SERVICES} entries`);
  if (observed.validators.length > MAX_VALIDATORS) throw new Error(`observed.validators must hold at most ${MAX_VALIDATORS} entries`);

  const services = new Map();
  observed.services.forEach((s, i) => {
    if (!isObject(s)) throw new Error(`observed.services[${i}] must be an object`);
    closed(`inputs.observed.services[${i}]`, s, ['id', 'profit', 'alpha']);
    const id = identifier(`observed.services[${i}].id`, s.id);
    if (services.has(id)) throw new Error(`observed.services[${i}].id is a duplicate: ${id}`);
    // α_s is the fraction of stake needed to corrupt s, so it lives in (0, 1].
    const alpha = ratio(`observed.services[${i}].alpha`, s.alpha);
    if (alpha.n > alpha.d) throw new Error(`observed.services[${i}].alpha must be ≤ 1`);
    services.set(id, { id, profit: amount(`observed.services[${i}].profit`, s.profit), alpha });
  });

  const validators = [];
  const seen = new Set();
  let edges = 0;
  observed.validators.forEach((v, i) => {
    if (!isObject(v)) throw new Error(`observed.validators[${i}] must be an object`);
    closed(`inputs.observed.validators[${i}]`, v, ['id', 'stake', 'services']);
    const id = identifier(`observed.validators[${i}].id`, v.id);
    if (seen.has(id)) throw new Error(`observed.validators[${i}].id is a duplicate: ${id}`);
    seen.add(id);
    if (!Array.isArray(v.services)) throw new Error(`observed.validators[${i}].services must be an array`);
    const adjacent = [];
    v.services.forEach((sid, j) => {
      const s = identifier(`observed.validators[${i}].services[${j}]`, sid);
      if (!services.has(s)) throw new Error(`observed.validators[${i}].services[${j}] names an unknown service: ${s}`);
      if (adjacent.includes(s)) throw new Error(`observed.validators[${i}].services[${j}] is a duplicate edge: ${s}`);
      adjacent.push(s);
    });
    if (adjacent.length > MAX_SERVICES_PER_VALIDATOR) {
      throw new Error(`observed.validators[${i}].services must name at most ${MAX_SERVICES_PER_VALIDATOR} services`);
    }
    edges += adjacent.length;
    if (edges > MAX_EDGES) throw new Error(`the graph must hold at most ${MAX_EDGES} edges`);
    validators.push({ id, stake: amount(`observed.validators[${i}].stake`, v.stake), services: [...adjacent].sort() });
  });

  // Theorem 1 bounds a FRACTION of total stake. A graph holding none cannot state one.
  if (validators.reduce((acc, v) => acc + v.stake, 0n) === 0n) throw new Error('observed.validators must hold non-zero total stake');

  // Sorted so the reported binding validator and any tie-break are a property of the network, not of
  // the order a claim happened to list it in.
  validators.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { gamma, shockPsiBps, services, validators };
}

// ── exact rational arithmetic ─────────────────────────────────────────────────────────────────
// Every quantity below decides who gets paid, so none of it goes through a float.
const abs = (a) => (a < 0n ? -a : a);
function gcd(a, b) {
  a = abs(a); b = abs(b);
  while (b) { const t = a % b; a = b; b = t; }
  return a;
}
const ZERO = { n: 0n, d: 1n };
/// Accumulate WITHOUT reducing. Reducing at every step looks tidy and is where the cost was: gcd on
/// a multi-thousand-bit pair, once per incident service, is cubic in a validator's degree and made
/// the worst accepted claim take 8.6s. Deferring it to one reduction per validator is ~9x faster on
/// the same input and gives the identical fraction — and, more usefully, it makes the size of the
/// intermediate PROVABLE rather than measured: the denominator is exactly Π_{s ∈ N(v)} (α_s.num ·
/// σ_{N(s)}), so it can never exceed `degree × (32 + bits(σ_N))` bits, whatever the graph looks like.
function addFracRaw(a, b) {
  return { n: a.n * b.d + b.n * a.d, d: a.d * b.d };
}
function reduceFrac(f) {
  const g = gcd(f.n, f.d);
  return g > 1n ? { n: f.n / g, d: f.d / g } : f;
}
/// −1, 0, +1 for a ⋚ b. Denominators are always positive here.
const cmpFrac = (a, b) => { const l = a.n * b.d, r = b.n * a.d; return l < r ? -1 : l > r ? 1 : 0; };
const fracStr = (f) => `${f.n}/${f.d}`;
/// floor(f × scale) — for reporting a rational as an integer count of basis points. BigInt division
/// truncates toward zero, and γ* goes negative on an uncertified network, so round down explicitly:
/// a reported buffer must never read as better than it is.
function floorDiv(n, d) { // d > 0 throughout
  const q = n / d;
  return n % d !== 0n && n < 0n ? q - 1n : q;
}
const floorScaled = (f, scale) => floorDiv(f.n * scale, f.d);

/// PURE: the restaking graph → the largest buffer Corollary 2 certifies.
///
/// T_v = Σ_{s ∈ N(v)} π_s / (α_s · σ_{N(s)}), and γ*_v = 1/T_v − 1 = (1 − T_v)/T_v. A validator with
/// no services, or whose services all have zero profit from corruption, imposes no constraint and is
/// skipped — the paper's own Theorem 3 construction relies on exactly that (a validator with no
/// neighbours satisfies the condition vacuously).
export function gammaMax(services, validators) {
  // σ_{N(s)} — the total stake restaked into each service.
  const stakeIn = new Map([...services.keys()].map((id) => [id, 0n]));
  for (const v of validators) for (const s of v.services) stakeIn.set(s, stakeIn.get(s) + v.stake);

  // A service with profit but no stake behind it is corrupted by the EMPTY coalition: Eq. (1) reads
  // 0 ≥ α_s · 0 and Eq. (2) reads π_s > 0. That is a valid attack, and it is invisible to a
  // per-validator sum because no validator is adjacent to it — so it is caught here, explicitly.
  // Sorted: this is reported in the claim body and in the RED reason, so leaving it in the caller's
  // array order would make two claims over the same network hash differently.
  const freeAttacks = [...services.values()].filter((s) => s.profit > 0n && stakeIn.get(s.id) === 0n).map((s) => s.id).sort();

  let best = null, binding = null, constrained = 0;
  for (const v of validators) {
    // σ_v CANCELS ONLY WHEN IT IS POSITIVE. At σ_v = 0 the unreduced Eq. (17) reads 0 ≤ 0 and holds
    // vacuously, whatever services the row is adjacent to — so dividing through and asking whether
    // T_v ≤ 1 invents a constraint that the theorem does not impose. A single zero-balance row
    // adjacent to two healthy services was enough to bind γ* and turn a true GREEN into a YELLOW.
    if (v.stake === 0n) continue;
    let t = ZERO;
    for (const sid of v.services) {
      const s = services.get(sid);
      if (s.profit === 0n) continue;
      // π_s / (α_s · σ_{N(s)}) = (π_s · α.den) / (α.num · σ_{N(s)})
      t = addFracRaw(t, { n: s.profit * s.alpha.d, d: s.alpha.n * stakeIn.get(sid) });
    }
    t = reduceFrac(t); // once per validator, not once per service — see `addFracRaw`
    if (t.n === 0n) continue; // nothing corruptible through v: no constraint
    constrained++;
    const g = { n: t.d - t.n, d: t.n }; // γ*_v = (1 − T_v)/T_v
    if (best === null || cmpFrac(g, best) < 0) { best = g; binding = v.id; }
  }
  return { gammaMax: best, binding, constrainedValidators: constrained, stakeIn, freeAttacks };
}

export function reexec(inputs) {
  const { gamma, shockPsiBps, services, validators } = canonicalInputs(inputs);
  const g = gammaMax(services, validators);

  const totalStake = validators.reduce((acc, v) => acc + v.stake, 0n);
  // γ* is null when no validator is constrained at all (nothing corruptible anywhere): the condition
  // holds for every γ, so the declared buffer is met.
  const unconstrained = g.gammaMax === null;
  const meetsDeclared = g.freeAttacks.length === 0 && (unconstrained || cmpFrac(g.gammaMax, gamma) >= 0);
  const positiveBuffer = g.freeAttacks.length === 0 && (unconstrained || cmpFrac(g.gammaMax, ZERO) > 0);

  const flag = meetsDeclared ? 'GREEN' : positiveBuffer ? 'YELLOW' : 'RED';

  // The guarantee the market asserted: R_ψ < (1 + 1/γ)ψ = ψ·(γ+1)/γ, capped at 1 (R_ψ ≤ 1 always).
  const boundBps = floorScaled({ n: gamma.n + gamma.d, d: gamma.n }, BigInt(shockPsiBps));
  const cascadeBoundBps = Number(boundBps > 10_000n ? 10_000n : boundBps);

  const reason = g.freeAttacks.length > 0
    ? `service${g.freeAttacks.length > 1 ? 's' : ''} ${g.freeAttacks.join(', ')} carry profit with no stake restaked into them — corruptible by the empty coalition`
    : unconstrained
      ? 'no validator secures a service with non-zero profit from corruption, so the condition holds for every buffer'
      : meetsDeclared
        ? `the network certifies γ = ${fracStr(g.gammaMax)} ≥ the declared ${fracStr(gamma)}, so a ${shockPsiBps}bps shock cannot cascade past ${cascadeBoundBps}bps of total stake`
        : positiveBuffer
          ? `the network certifies only γ = ${fracStr(g.gammaMax)}, short of the declared ${fracStr(gamma)} (binding validator ${g.binding})`
          : `the checkable certificate does not establish a positive buffer for this network (γ* = ${fracStr(g.gammaMax)}, binding validator ${g.binding}), so no bound on a cascade follows from it`;

  return {
    computation: {
      services: services.size,
      validators: validators.length,
      constrained_validators: g.constrainedValidators,
      total_stake: String(totalStake),
      gamma_declared: fracStr(gamma),
      gamma_max: g.gammaMax === null ? null : fracStr(g.gammaMax),
      // A decimal STRING: γ* is unbounded, and Number() silently rounds a large exact floor UPWARD —
      // which is the one direction a reported buffer must never move. `cascade_bound_bps` is capped
      // at 10_000 before conversion, so it stays a safe integer.
      gamma_max_bps: g.gammaMax === null ? null : String(floorScaled(g.gammaMax, 10_000n)),
      binding_validator: g.binding,
      free_attack_services: g.freeAttacks,
      shock_psi_bps: shockPsiBps,
      cascade_bound_bps: cascadeBoundBps,
      condition: 'durvasula-roughgarden-2025-corollary-2',
    },
    verdict: { flag, reason },
  };
}

export function checks(claim, r) {
  const subjectNetwork = claim?.subject?.network;
  const trustedNetwork = claim?.inputs?.trusted?.network;
  return [
    ['subject names the network the trusted context names', typeof subjectNetwork === 'string' && subjectNetwork === trustedNetwork, `${subjectNetwork ?? 'missing'} vs ${trustedNetwork ?? 'missing'}`],
    ['certified buffer reproduces', r.computation.gamma_max === claim.computation.gamma_max, `${r.computation.gamma_max}`],
    ['binding validator reproduces', r.computation.binding_validator === claim.computation.binding_validator, `${r.computation.binding_validator}`],
    ['cascade bound reproduces', r.computation.cascade_bound_bps === claim.computation.cascade_bound_bps, `${r.computation.cascade_bound_bps} bps`],
    ['free-attack set reproduces', JSON.stringify(r.computation.free_attack_services) === JSON.stringify(claim.computation.free_attack_services), `${r.computation.free_attack_services.length}`],
  ];
}

export function build({ subject, terms, services, validators, source }) {
  if (typeof subject?.network !== 'string') throw new Error('subject.network must name the trusted network');
  sourceDescriptor(source);
  return buildClaim({
    type,
    subject,
    inputs: {
      trusted: { network: subject.network, profit_estimates: PROFIT_ESTIMATES },
      oracle_inputs: [],
      terms,
      observed: { source, services, validators },
    },
  });
}

registerClaimType({ type, invariant, canonicalInputs, reexec, checks });

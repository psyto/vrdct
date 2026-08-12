// Vrdct claim-type: obligated-liveness. Re-executes whether a named obligor acted across a schedule
// of obligated slots re-derived from the calendar — and, crucially, whether the misses it did produce
// are ATTRIBUTABLE to it or excused by the network assumption the market declared in advance.
//
// Why this is a claim-type at all. Every other surface here settles a SAFETY question: a number came
// out, re-execute it, and a wrong one is deterministically wrong. Liveness is the other half — the
// party did nothing — and there is nothing to re-execute. The README names agent-payment escrow as a
// target market, and in escrow the usual dispute is not "the agent returned a wrong result", it is
// "the agent returned nothing". A resolver that can only adjudicate safety hands every one of those
// back to whoever holds the funds, which is not neutrality.
//
// What makes it hard is that "the network was slow" is an unfalsifiable alibi until you commit to a
// bound on how slow the network may be.
//
// THE RESULT THIS IMPLEMENTS. Lewis-Pye, Neu, Roughgarden, Zanolini, *Accountable Liveness*
// (CCS '25, arXiv:2504.12218). They introduce the x-partially-synchronous model — at most an `x`
// fraction of time steps in any sufficiently long interval are asynchronous — and prove:
//
//     accountable liveness is achievable  IF AND ONLY IF  x < 1/2  and  f < n/2.
//
// Two consequences are the whole design:
//   1. Attribution needs a DECLARED synchrony bound. With `x` pinned in the terms, an obligor that
//      missed more than an `x` fraction of its obligations missed more than asynchrony can explain,
//      and the excess is attributable. Without it, silence never convicts anyone.
//   2. There is a boundary past which attribution is IMPOSSIBLE, not merely hard. At x ≥ 1/2, or with
//      an obligor quorum where f ≥ n/2, the honest verdict is "nobody can be blamed" — and a neutral
//      resolver has to be able to say that out loud instead of picking someone.
//
//   verdict GREEN   — every obligated slot was met
//   verdict YELLOW  — slots were missed, but within what an x-async network excuses (not attributable)
//   verdict RED     — more slots missed than asynchrony can explain: the obligor is at fault
//   verdict UNKNOWN — the declared assumptions do not permit attribution AT ALL (the theorem's boundary)
//   verdict STALE   — the window obligates no slots; nothing to settle
//
// YELLOW here is not a hedge, and it is not CMLS's YELLOW. It is the paper's excusable region made
// explicit: the misses happened, and the assumption the market declared says you may not convict.
//
// THE ATTACK THIS TYPE IS BUILT AGAINST — and it is asymmetric, which is the point:
//   • Choosing the SCHEDULE is closed by construction against the EVIDENCE, but not by itself. The
//     slots are re-derived from `campana` rather than read from the claim, so no list of convenient
//     slots can be supplied. What the pinner still chooses is the schedule TERMS — `fromTs`, `toTs`
//     AND `periodSecs`, which shape the slot set just as directly as the window does. Those are safe
//     only when they are declared before the fact and bound by a market definition, exactly like
//     `monday-open-gap`'s threshold. Offline they are merely hashed into the claim; there is no
//     on-chain market-definition binding for this type yet, so that is an obligation on whoever
//     opens a market, not a property this module can enforce. Said plainly rather than assumed.
//   • Omitting ACTIONS is deliberately left open, because it is monotone in the safe direction.
//     Removing actions can only turn slots from met to missed, so omission only ever makes a verdict
//     HARSHER on the obligor (GREEN → YELLOW → RED, never the reverse). So a RED is contestable by
//     any challenger holding one more real action, and a GREEN cannot be manufactured by omitting
//     anything. Manufacturing a GREEN needs an extra IDENTIFIED action record — see `matchSlots` on
//     why identity rather than instant is what gets spent — and the ids are checkable against the
//     source descriptor the way `cli check` rebuilds CMLS inputs.
//
// HONEST RESIDUAL. The actions must be observations of ON-CHAIN state. If the evidence were
// third-party attestation, the `f < n/2` half of the theorem would bind on the OBSERVERS as well,
// and this type does not model that — truthful elicitation of unverifiable signals is a different
// mechanism and a different claim-type.
//
// FOLLOW-UP (not done here). `core/encode.mjs` / `CLAIM_TYPE_ID` and the Rust twin under
// `onchain/programs/vrdct-bond/src/reexec/` are byte-parity surfaces; this type is offline-complete
// and is NOT yet wired to either. On-chain settlement of a liveness market needs that port first.

import { registerClaimType, buildClaim } from '../core/claim.mjs';
import { marketStatus, STATUS, CALENDAR_2026 } from '../core/campana.mjs';
import { closed } from '../core/closed.mjs';

export const type = 'obligated-liveness';
export const invariant = {
  id: 'OLV',
  statement: 'An obligor that missed more of its calendar-derived obligated slots than an x-partially-synchronous network can excuse is attributably at fault; at or below that budget the misses are excused, and where the declared x or quorum fall outside the accountable-liveness bound no party may be blamed at all.',
};

/// The theorem's boundaries. `x < 1/2` on the network, `f < n/2` on the obligor quorum
/// (arXiv:2504.12218). Expressed in parts-per-million so the comparison is exact integer arithmetic.
export const PPM = 1_000_000;
export const ASYNC_PPM_BOUND = PPM / 2;

/// A window may not obligate an unbounded number of slots: re-execution has to terminate for a
/// verifier with a laptop, and an attacker must not be able to make one claim cost a year of CPU.
export const MAX_SLOTS = 100_000;
/// The same bound on the other input. `MAX_SLOTS` alone bounds nothing: a pinner can aim millions of
/// well-formed observations at a one-slot window and make every verifier copy and sort them.
export const MAX_ACTIONS = 100_000;
const MIN_PERIOD_SECS = 60;
const MAX_PERIOD_SECS = 86_400;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const OBSERVATION_SOURCE = 'SOLANA_SIGNATURE_HISTORY';

function u32(name, value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`${name} must be a safe u32 integer`);
  }
  return value;
}
/// The identity of an action: whatever the source descriptor makes unique and checkable — a
/// transaction signature, for Solana. It is what gets SPENT against an obligation, while `ts` is
/// only what decides which obligations it could have discharged.
function actionId(name, value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,96}$/.test(value)) {
    throw new Error(`${name} must be a 1–96 char source-unique id of [A-Za-z0-9._:-]`);
  }
  return value;
}
function inCalendar(name, ts) {
  if (ts < CALENDAR_2026.validFrom || ts >= CALENDAR_2026.validUntil) {
    throw new Error(`${name} is outside calendar ${CALENDAR_2026.version}'s validity range`);
  }
  return ts;
}

// The sole raw-JSON reader for this surface: re-execution and any future on-chain encoder must
// consume this typed result, never the raw object.
export function canonicalInputs(inputs) {
  if (!isObject(inputs) || !isObject(inputs.terms) || !isObject(inputs.observed)) {
    throw new Error('inputs.terms and inputs.observed must be objects');
  }
  closed('inputs', inputs, ['trusted', 'oracle_inputs', 'terms', 'observed']);
  if ('trusted' in inputs) {
    closed('inputs.trusted', inputs.trusted, ['obligor', 'calendar']);
    if (inputs.trusted.calendar !== CALENDAR_2026.version) {
      throw new Error(`inputs.trusted.calendar must be ${CALENDAR_2026.version}, the calendar this re-execution uses`);
    }
  }
  if ('oracle_inputs' in inputs && !(Array.isArray(inputs.oracle_inputs) && inputs.oracle_inputs.length === 0)) {
    throw new Error('inputs.oracle_inputs has no input domain in this type: it may be absent or the empty array, nothing else');
  }
  const { terms, observed } = inputs;

  closed('inputs.terms', terms, ['schedule', 'graceSecs', 'asyncPpm', 'quorum']);
  if (!isObject(terms.schedule)) throw new Error('terms.schedule must be an object');
  closed('inputs.terms.schedule', terms.schedule, ['kind', 'fromTs', 'toTs', 'periodSecs']);
  if (terms.schedule.kind !== 'CALENDAR_OPEN') throw new Error("terms.schedule.kind must be 'CALENDAR_OPEN'");
  const fromTs = inCalendar('terms.schedule.fromTs', u32('terms.schedule.fromTs', terms.schedule.fromTs));
  const toTs = inCalendar('terms.schedule.toTs', u32('terms.schedule.toTs', terms.schedule.toTs));
  if (toTs <= fromTs) throw new Error('terms.schedule.toTs must be after terms.schedule.fromTs');
  const periodSecs = u32('terms.schedule.periodSecs', terms.schedule.periodSecs);
  if (periodSecs < MIN_PERIOD_SECS || periodSecs > MAX_PERIOD_SECS) {
    throw new Error(`terms.schedule.periodSecs must be within [${MIN_PERIOD_SECS}, ${MAX_PERIOD_SECS}]`);
  }
  if (Math.floor((toTs - fromTs) / periodSecs) > MAX_SLOTS) {
    throw new Error(`terms.schedule would step more than ${MAX_SLOTS} times`);
  }

  // Grace absorbs observation delay: the obligor acted inside the slot, but the timestamp the chain
  // recorded landed a little after its deadline. Bounded below one period so a single late action
  // can never stand in for a whole slot it never covered. The other half of that bound — that one
  // action cannot discharge two obligations at once — is enforced by `matchSlots`, not here.
  const graceSecs = u32('terms.graceSecs', terms.graceSecs);
  if (graceSecs >= periodSecs) throw new Error('terms.graceSecs must be less than terms.schedule.periodSecs');

  const asyncPpm = u32('terms.asyncPpm', terms.asyncPpm);
  if (asyncPpm >= PPM) throw new Error('terms.asyncPpm must be less than 1e6 (a network cannot be wholly asynchronous)');

  if (!isObject(terms.quorum)) throw new Error('terms.quorum must be an object { n, f }');
  closed('inputs.terms.quorum', terms.quorum, ['n', 'f']);
  const n = u32('terms.quorum.n', terms.quorum.n);
  const f = u32('terms.quorum.f', terms.quorum.f);
  if (n === 0) throw new Error('terms.quorum.n must be non-zero');
  if (f >= n) throw new Error('terms.quorum.f must be less than terms.quorum.n');

  // An action is an IDENTIFIED on-chain record, not a bare instant. A timestamp alone is copyable,
  // and one copied timestamp is enough to discharge two overlapping obligations — see `matchSlots`.
  closed('inputs.observed', observed, ['source', 'account', 'count', 'actions']);
  if ('source' in observed && observed.source !== OBSERVATION_SOURCE) {
    throw new Error(`inputs.observed.source must be '${OBSERVATION_SOURCE}'`);
  }
  if (!Array.isArray(observed.actions)) throw new Error('observed.actions must be an array');
  if (observed.actions.length > MAX_ACTIONS) throw new Error(`observed.actions must hold at most ${MAX_ACTIONS} records`);
  if ('count' in observed) {
    if (!Number.isSafeInteger(observed.count) || observed.count < 0 || observed.count !== observed.actions.length) {
      throw new Error('inputs.observed.count must equal inputs.observed.actions.length');
    }
  }
  const ids = new Set();
  const actions = observed.actions.map((a, i) => {
    if (!isObject(a)) throw new Error(`observed.actions[${i}] must be an object { id, ts }`);
    closed(`inputs.observed.actions[${i}]`, a, ['id', 'ts']);
    const id = actionId(`observed.actions[${i}].id`, a.id);
    if (ids.has(id)) throw new Error(`observed.actions[${i}].id is a duplicate: ${id}`);
    ids.add(id);
    return { id, ts: inCalendar(`observed.actions[${i}].ts`, u32(`observed.actions[${i}].ts`, a.ts)) };
  });

  return { fromTs, toTs, periodSecs, graceSecs, asyncPpm, n, f, actions };
}

/// PURE: the obligated schedule is a function of (window, period, calendar) alone. A slot is
/// obligated iff the calendar says the regulated market was open at the slot's START — the whole
/// slot need not be open, and that rule is deliberate: it is checkable at one instant, so two
/// verifiers cannot disagree about a slot that straddles a bell.
export function deriveSlots(fromTs, toTs, periodSecs, cal = CALENDAR_2026) {
  const slots = [];
  for (let t = fromTs; t + periodSecs <= toTs; t += periodSecs) {
    const st = marketStatus(t, cal).status;
    if (st === STATUS.OPEN || st === STATUS.HALF_DAY) slots.push({ open: t, deadline: t + periodSecs - 1 });
  }
  return slots;
}

/// PURE: slots × actions × grace → which slots were met. Sorts a copy of the actions by (ts, id), so
/// the answer does not depend on the order a claim happens to list its observations in.
///
/// ONE ACTION DISCHARGES ONE OBLIGATION. Because grace extends a slot's window past its deadline,
/// that window overlaps the first `graceSecs` of the next slot — so a single action can *fall inside*
/// two slots. Crediting it to both is a real loophole: at `graceSecs` near a full period it would
/// halve the obligation the schedule states. So this is a matching, not an independent test per slot:
/// slots are walked in order and each takes the earliest action not already spent on an earlier one.
/// Slots ascend by both open and deadline, so that greedy walk is a MAXIMUM matching — the count of
/// missed slots is the true minimum, never an artefact of the walk order, and adding an action can
/// only ever grow it (which is what makes omission monotone).
///
/// WHAT IS SPENT IS THE RECORD, NOT THE INSTANT. The matching above is only worth as much as the
/// distinctness of what it consumes. An earlier draft consumed bare timestamps, and then listing one
/// real timestamp twice bought two discharges out of a single act — the same loophole, moved from
/// the matching into the evidence encoding, and enough to manufacture a GREEN without inventing any
/// instant. `canonicalInputs` rejects duplicate ids, so a second discharge costs a second on-chain
/// action that the source descriptor can be checked against. Two DISTINCT records sharing a second
/// do each discharge an obligation: they are two real acts, and the source cannot tell us otherwise.
export function matchSlots(slots, actions, graceSecs) {
  const sorted = [...actions].sort((a, b) => (a.ts !== b.ts ? a.ts - b.ts : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const met = [];
  let cursor = 0;
  for (const s of slots) {
    // actions before this slot opens are unusable by it, and by every later slot too
    while (cursor < sorted.length && sorted[cursor].ts < s.open) cursor++;
    const ok = cursor < sorted.length && sorted[cursor].ts <= s.deadline + graceSecs;
    met.push(ok);
    if (ok) cursor++; // spent
  }
  return met;
}

/// Longest run of consecutive missed slots, reported in OBLIGATED seconds. Consecutive derived slots
/// can sit either side of a closure, so elapsed wall-clock would overstate the outage; counting
/// obligated seconds only charges the obligor for time it actually owed.
function longestDark(slots, met, periodSecs) {
  let best = 0, run = 0, bestStart = null, start = null;
  for (let i = 0; i < slots.length; i++) {
    if (met[i]) { run = 0; start = null; continue; }
    if (run === 0) start = slots[i].open;
    run++;
    if (run > best) { best = run; bestStart = start; }
  }
  return { slots: best, secs: best * periodSecs, from: bestStart };
}

export function reexec(inputs) {
  const q = canonicalInputs(inputs);
  const { fromTs, toTs, periodSecs, graceSecs, asyncPpm, n, f, actions } = q;

  // 1. The theorem's feasibility gate. Decided by the TERMS alone: the evidence is still parsed
  //    first — the registry's contract is that malformed input is rejected, not stepped around — but
  //    no valid evidence can move this flag, so the same window returns the same UNKNOWN however the
  //    obligor behaved. Invariance of the verdict, not blindness of the code.
  const syncOk = asyncPpm < ASYNC_PPM_BOUND;      // x < 1/2
  const quorumOk = 2 * f < n;                     // f < n/2
  const attributable_possible = syncOk && quorumOk;

  // 2. The schedule, re-derived. The pinner supplies the window; the calendar supplies the slots.
  const slots = deriveSlots(fromTs, toTs, periodSecs);
  const met = matchSlots(slots, actions, graceSecs);
  const missed = met.reduce((acc, ok) => acc + (ok ? 0 : 1), 0);

  // 3. The async budget: how many misses an x-partially-synchronous network can account for.
  const excusable = Math.floor((slots.length * asyncPpm) / PPM);
  const attributable = Math.max(0, missed - excusable);
  const dark = longestDark(slots, met, periodSecs);

  const flag = slots.length === 0 ? 'STALE'
    : !attributable_possible ? 'UNKNOWN'
      : missed === 0 ? 'GREEN'
        : attributable === 0 ? 'YELLOW'
          : 'RED';
  const attribution = flag === 'RED' ? 'OBLIGOR' : flag === 'YELLOW' ? 'EXCUSED' : flag === 'GREEN' ? 'NONE' : 'UNDEFINED';

  const reason = slots.length === 0
    ? 'the declared window obligates no slots under the calendar; nothing to settle'
    : !attributable_possible
      ? `accountable liveness is unachievable under the declared assumptions (${!syncOk ? `x = ${asyncPpm}ppm ≥ 1/2` : `f = ${f} ≥ n/2 = ${n / 2}`}), so no party may be blamed`
      : missed === 0
        ? `the obligor acted in all ${slots.length} obligated slots`
        : attributable === 0
          ? `${missed} of ${slots.length} slots were missed, within the ${excusable} an x = ${asyncPpm}ppm network excuses`
          : `${missed} of ${slots.length} slots were missed, ${attributable} more than an x = ${asyncPpm}ppm network can excuse (dark for ${dark.secs}s of obligated time)`;

  return {
    computation: {
      window: { from: fromTs, to: toTs, period_secs: periodSecs },
      obligated_slots: slots.length,
      actions_pinned: actions.length,
      met_slots: slots.length - missed,
      missed_slots: missed,
      async_ppm: asyncPpm,
      excusable_misses: excusable,
      attributable_misses: attributable,
      attributable_possible,
      quorum: { n, f },
      longest_dark_slots: dark.slots,
      longest_dark_secs: dark.secs,
      first_dark_slot: dark.from,
      calendar_version: CALENDAR_2026.version,
    },
    verdict: { flag, attribution, reason },
  };
}

export function checks(claim, r) {
  const subjectAccount = claim?.subject?.account;
  const observedAccount = claim?.inputs?.observed?.account;
  const subjectObligor = claim?.subject?.obligor;
  const trustedObligor = claim?.inputs?.trusted?.obligor;
  return [
    ['subject names the account the actions came from', typeof subjectAccount === 'string' && subjectAccount === observedAccount, `${subjectAccount ?? 'missing'} vs ${observedAccount ?? 'missing'}`],
    ['subject names the obligor the trusted context names', typeof subjectObligor === 'string' && subjectObligor === trustedObligor, `${subjectObligor ?? 'missing'} vs ${trustedObligor ?? 'missing'}`],
    ['obligated schedule reproduces', r.computation.obligated_slots === claim.computation.obligated_slots, `${r.computation.obligated_slots} slots`],
    ['missed slots reproduce', r.computation.missed_slots === claim.computation.missed_slots, `${r.computation.missed_slots}`],
    ['async budget reproduces', r.computation.excusable_misses === claim.computation.excusable_misses, `${r.computation.excusable_misses} excusable`],
    ['attribution reproduces', r.computation.attributable_misses === claim.computation.attributable_misses && r.verdict.attribution === claim.verdict.attribution, `${r.verdict.attribution} (${r.computation.attributable_misses})`],
  ];
}

export function build({ subject, terms, actions, source }) {
  if (typeof subject?.account !== 'string') throw new Error('subject.account must name the observed action account');
  if (typeof subject?.obligor !== 'string') throw new Error('subject.obligor must name the trusted obligor');
  if (source !== OBSERVATION_SOURCE) throw new Error(`source must be '${OBSERVATION_SOURCE}'`);
  return buildClaim({
    type,
    subject,
    inputs: {
      trusted: { obligor: subject.obligor, calendar: CALENDAR_2026.version },
      oracle_inputs: [],
      terms,
      observed: { source, account: subject.account, count: actions.length, actions },
    },
  });
}

registerClaimType({ type, invariant, canonicalInputs, reexec, checks });

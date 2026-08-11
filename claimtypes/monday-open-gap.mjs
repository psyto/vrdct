// Vrdct claim-type: monday-open-gap. Re-executes the price gap a market closure produced — from
// the last price a venue printed while the underlying regulated market was still OPEN, to the first
// price it printed after that market reopened — and answers whether the gap reached a threshold
// declared before the closure began.
//
// Why this is a claim-type and not a price feed. Tokenized equities trade through the closure; the
// underlying market does not. Everyone holding across it is exposed to the reopen, and there is no
// instrument shaped like that exposure — a perp lets you hedge a PRICE, but inside the closure the
// perp has no reference either, so it hedges a broken number with a broken number. The gap is an
// EVENT, and the only unambiguous number attached to it is the reopen print.
//
// Settling that event needs one thing nobody in the trade can be trusted to supply: when the
// closure began and ended. A venue that defines its own reopen instant is marking its own exam; an
// oracle vendor that defines it must be trusted. `core/campana.mjs` derives it as a pure function of
// (timestamp, holiday calendar) — so the boundary is re-executable, and this market can exist.
//
//   verdict RED   — the closure produced a gap at or beyond the declared threshold (the risk landed)
//   verdict GREEN — it did not
//   verdict STALE — the pinned prints sit too far from the boundary to settle anything
//
// RED/GREEN keep the meaning they carry across this repo: RED is the closed-market risk
// materialising. A market declares `yesWhen: ['RED']`.
//
// THE ATTACK THIS TYPE IS BUILT AGAINST. Whoever pins the observation chooses which print to pin.
// Pick a print three hours after the reopen and you can very often choose the answer. So the terms
// declare `maxLagSecs`, and re-execution rejects any print further than that from the boundary
// instant it re-derives itself. That bounds the choice; it does not eliminate it.
//
// THE RESIDUAL, WHICH IS STILL OPEN — and the two wrong answers that came before this one.
//
// While a claim carried two prints its builder had chosen, nothing could prove either was the
// closest to its bell. The first answer was that a challenger holding a nearer print disputes and
// wins; that was false (Codex, reviews/009 F2) — a market commits to `inputs_hash`, a challenge
// asserts a different FLAG over those same prints, so a nearer print is a DIFFERENT MARKET, not a
// correction to this one. The second answer was to call the residual open and say so, which was
// honest but not a fix.
//
// The route out is the one `closed-market-liquidation-soundness` uses, and it is not a dispute
// mechanism: SELECTION plus RECONSTRUCTIBILITY. Selection is done here — a claim pins the observation
// SET around both boundaries and re-execution picks the last update at or before the closing bell and
// the first at or after the reopen, so nothing about WHICH print is used is supplied.
//
// RECONSTRUCTIBILITY IS NOT DONE, AND THE RESIDUAL IS THEREFORE STILL OPEN. Selection removes the
// choice within a set; it does nothing about the set. What closes omission is that anyone can REBUILD
// the set from the descriptor and see a mismatch before bonding — and no rebuilder exists for this
// type, because rebuilding needs to decode PRICES from the account rather than merely observe it was
// written to, which is account-layout-specific in a way CMLS's timestamp-only rebuild is not.
//
// What IS now true, and is the part worth having: the descriptor is consensus rather than a label.
// `canonicalInputs` requires a well-formed `{kind, chain, account, from_ts, to_ts}` — a base58 pubkey
// names unrelated accounts on devnet or a fork, so the CLUSTER is part of what a claim pins and is
// bound to `subject.chain` — rejects any update outside that window, and re-execution refuses unless
// the window reaches `maxLagSecs` either side of the closure. So a claim names exactly which cluster,
// account and window a rebuild must target, and a set inconsistent with its own descriptor never
// re-executes at all. Every object in that domain is CLOSED (see `closed` below): an unparsed key is
// rejected, because a claim that can carry one can show a consumer a context this verifier certified
// without ever reading. That is a necessary condition for
// closing the residual, and not a sufficient one. The first version of this task left the descriptor
// unparsed while calling the residual closed (Codex, reviews/011 F1); saying it is closed before a
// rebuilder exists would be the third time this type has published a mechanism it does not have.
//
// FOLLOW-UP (not done here). `core/encode.mjs` / `CLAIM_TYPE_ID` and the Rust twin under
// `onchain/programs/vrdct-bond/src/reexec/` are byte-parity surfaces; this type is offline-complete
// and is NOT yet wired to either. On-chain settlement of a gap market needs that port first.

import { registerClaimType, buildClaim } from '../core/claim.mjs';
import { marketStatus, STATUS, CALENDAR_2026 } from '../core/campana.mjs';
import { closed } from '../core/closed.mjs';

export const type = 'monday-open-gap';
export const invariant = {
  id: 'GAP',
  statement: 'Across a market closure, the move from the venue\'s last open-session price to its first reopen price either reaches a threshold declared before the closure, or it does not — and both prints must sit within a declared lag of boundary instants re-derived from the calendar.',
};

const U64_MAX = (1n << 64n) - 1n;
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isClosed = (t) => marketStatus(t).status === STATUS.CLOSED;

function u32(name, value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`${name} must be a safe u32 integer`);
  }
  return value;
}

/// Every semantic object in this type's inputs is CLOSED: a key nothing parses is REJECTED, not
/// ignored.
///
/// This is Codex's F7 (reviews/011), and it is the same defect this type has now produced twice.
/// `trusted.chain` and `observed.count` were removed from `build` in 26275c7 under a comment saying a
/// field that cannot exist cannot lie. It could exist. **Removing a field from the BUILDER does not
/// remove it from the INPUT DOMAIN** — Codex hand-authored `trusted.chain`, `observed.count` and a
/// `source.genesis_hash` back into a valid claim, recomputed `claim_id`, and got `verify().ok === true`
/// for each. The content hash is consistent with the lie, exactly as it was in F5. A test that asserts
/// the builder omits a field proves something about the builder and nothing about the verifier.
///
/// So the fix is not to stop emitting. It is to start rejecting.
// Prices are pinned as an exact integer plus an exponent — never a float. Two nodes that parse the
// same claim must hold the same number, and `0.1 + 0.2` is why this is not negotiable.
function price(name, value) {
  if (!isObject(value)) throw new Error(`${name} must be an object { value, exp }`);
  closed(name, value, ['value', 'exp']);
  let v;
  if (typeof value.value === 'string') {
    if (!/^(0|[1-9][0-9]*)$/.test(value.value)) throw new Error(`${name}.value must be a canonical unsigned decimal string or safe integer number`);
    v = BigInt(value.value);
  } else if (typeof value.value === 'number' && Number.isSafeInteger(value.value) && value.value >= 0) {
    v = BigInt(value.value);
  } else {
    throw new Error(`${name}.value must be a canonical unsigned decimal string or safe integer number`);
  }
  if (v > U64_MAX) throw new Error(`${name}.value exceeds u64`);
  if (v === 0n) throw new Error(`${name}.value must be non-zero`);
  const exp = u32(`${name}.exp`, value.exp);
  if (exp > 30) throw new Error(`${name}.exp must be ≤ 30`);
  return { value: v, exp };
}

/// Re-execution has to terminate for a verifier with a laptop, and a window is a market term.
export const MAX_UPDATES = 100_000;

/// The source descriptor is part of the CONSENSUS INPUT DOMAIN, not a label attached to a claim.
///
/// The first version of this task left it unparsed, and Codex's review (reviews/011 F1) is the whole
/// lesson: a claim could carry `source: null`, a string, or a descriptor for some unrelated account,
/// and it built and verified anyway. Selection then prevented choosing prints only WITHIN a supplied
/// set — it did nothing about the set itself, which is the omission the residual is about. Naming
/// reconstructibility as the fix while leaving the thing a rebuild would target unvalidated is the
/// same failure this repo has now made in three tasks: a mechanism asserted rather than implemented.
export const SOURCE_CHAIN = 'solana-mainnet';
function sourceDescriptor(name, v) {
  if (!isObject(v)) throw new Error(`${name} must be an object { kind, chain, account, from_ts, to_ts }`);
  // No `genesis_hash`, and that is a decision rather than an omission — see the design note under F8
  // in reviews/011: a genesis literal checked by a parser that does no network I/O is another label,
  // and the rebuilder that would resolve it does not exist yet. Closing the descriptor means a claim
  // cannot carry one and imply it was checked.
  closed(name, v, ['kind', 'chain', 'account', 'from_ts', 'to_ts']);
  if (v.kind !== 'SOLANA_ACCOUNT_PRICE_UPDATES') throw new Error(`${name}.kind must be 'SOLANA_ACCOUNT_PRICE_UPDATES'`);
  // A base58 pubkey is not globally unique to a cluster: the same 32 bytes name unrelated accounts on
  // devnet, on a fork, or on another chain entirely. Without this a claim can present an account as
  // belonging somewhere it does not, and a rebuilder has no canonical answer to which cluster to
  // query (Codex, reviews/011 F5).
  if (v.chain !== SOURCE_CHAIN) throw new Error(`${name}.chain must be '${SOURCE_CHAIN}'`);
  if (typeof v.account !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v.account)) {
    throw new Error(`${name}.account must be a base58 Solana address`);
  }
  const fromTs = u32(`${name}.from_ts`, v.from_ts);
  const toTs = u32(`${name}.to_ts`, v.to_ts);
  if (toTs <= fromTs) throw new Error(`${name}.to_ts must be after ${name}.from_ts`);
  if (fromTs < CALENDAR_2026.validFrom || toTs > CALENDAR_2026.validUntil) {
    throw new Error(`${name} window is outside calendar ${CALENDAR_2026.version}'s validity range`);
  }
  return { kind: v.kind, chain: v.chain, account: v.account, fromTs, toTs };
}

function observation(name, o) {
  if (!isObject(o)) throw new Error(`${name} must be an object`);
  closed(name, o, ['price', 'blockTime', 'slot', 'sig']);
  const blockTime = u32(`${name}.blockTime`, o.blockTime);
  if (blockTime < CALENDAR_2026.validFrom || blockTime >= CALENDAR_2026.validUntil) {
    throw new Error(`${name}.blockTime is outside calendar ${CALENDAR_2026.version}'s validity range`);
  }
  // `slot` and `sig` are the ordering key, the same pair CMLS orders its observations by: two updates
  // can share a second, and a verdict must not depend on which of them a JSON array happened to list
  // first. They are part of the input domain even though only `blockTime` enters the arithmetic.
  const slot = u32(`${name}.slot`, o.slot);
  if (typeof o.sig !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{1,128}$/.test(o.sig)) {
    throw new Error(`${name}.sig must be a base58 signature`);
  }
  return { price: price(`${name}.price`, o.price), blockTime, slot, sig: o.sig };
}

// The sole raw-JSON reader for this surface: re-execution and any future on-chain encoder must
// consume this typed result, never the raw object.
export function canonicalInputs(inputs) {
  if (!isObject(inputs) || !isObject(inputs.observed) || !isObject(inputs.terms)) {
    throw new Error('inputs.observed and inputs.terms must be objects');
  }
  closed('inputs', inputs, ['trusted', 'oracle_inputs', 'terms', 'observed']);
  closed('inputs.observed', inputs.observed, ['source', 'updates']);
  closed('inputs.terms', inputs.terms, ['anchorTs', 'thresholdBps', 'maxLagSecs', 'direction']);
  // `oracle_inputs` is a claim-body convention every type in this repo emits and no type reads. It is
  // CLOSED to its one canonical form rather than deleted: deleting it here alone would make this
  // type's body shape differ from the other four for no safety this closing does not already give,
  // and deleting it everywhere would move the published corpus `inputs_hash` — a consensus break, not
  // a cleanup. Whether all five should drop it is a repo-wide question, and belongs to a task that
  // can move all five at once.
  //
  // ABSENT is permitted and `[]` is permitted; anything else is refused. Requiring its PRESENCE was
  // the first attempt and it was wrong — it would have made a body convention into an input this type
  // needs, and every direct `canonicalInputs` caller that never had one would have started failing.
  // A field with no input domain must not become mandatory on the way to being made unable to lie.
  if ('oracle_inputs' in inputs && !(Array.isArray(inputs.oracle_inputs) && inputs.oracle_inputs.length === 0)) {
    throw new Error('inputs.oracle_inputs has no input domain in this type: it may be absent or the empty array, nothing else');
  }
  const source = sourceDescriptor('observed.source', inputs.observed.source);
  // `trusted.calendar` decides which holiday table every boundary is derived from, so it is an input,
  // not a label. Unvalidated, a claim could name a calendar it was not re-executed under.
  if (!isObject(inputs.trusted)) throw new Error('inputs.trusted must be an object { calendar }');
  closed('inputs.trusted', inputs.trusted, ['calendar']);
  if (inputs.trusted.calendar !== CALENDAR_2026.version) {
    throw new Error(`inputs.trusted.calendar must be ${CALENDAR_2026.version}, the calendar this re-execution uses`);
  }
  if (!Array.isArray(inputs.observed.updates)) throw new Error('observed.updates must be an array');
  if (inputs.observed.updates.length === 0) throw new Error('observed.updates must be non-empty');
  if (inputs.observed.updates.length > MAX_UPDATES) throw new Error(`observed.updates must hold at most ${MAX_UPDATES} records`);
  const seen = new Set();
  const updates = inputs.observed.updates.map((o, i) => {
    const u = observation(`observed.updates[${i}]`, o);
    const k = `${u.slot}:${u.sig}`;
    if (seen.has(k)) throw new Error(`observed.updates[${i}] is a duplicate observation: ${k}`);
    seen.add(k);
    // An update outside the declared window cannot have come from rebuilding it, so a set that
    // reaches past its own descriptor is rejected rather than re-executed.
    if (u.blockTime < source.fromTs || u.blockTime > source.toTs) {
      throw new Error(`observed.updates[${i}] lies outside the declared source window [${source.fromTs}, ${source.toTs}]`);
    }
    return u;
  });

  // The instant the market is about. Any instant inside the closure names it; the calendar does the
  // rest. It is a market-definition term, declared before the fact like `thresholdBps`.
  const anchorTs = u32('terms.anchorTs', inputs.terms.anchorTs);
  if (anchorTs < CALENDAR_2026.validFrom || anchorTs >= CALENDAR_2026.validUntil) {
    throw new Error(`terms.anchorTs is outside calendar ${CALENDAR_2026.version}'s validity range`);
  }

  const thresholdBps = u32('terms.thresholdBps', inputs.terms.thresholdBps);
  if (thresholdBps === 0) throw new Error('terms.thresholdBps must be non-zero');
  const maxLagSecs = u32('terms.maxLagSecs', inputs.terms.maxLagSecs);
  if (maxLagSecs === 0) throw new Error('terms.maxLagSecs must be non-zero');
  const direction = inputs.terms.direction;
  if (direction !== 'ABS' && direction !== 'DOWN' && direction !== 'UP') {
    throw new Error("terms.direction must be 'ABS', 'DOWN' or 'UP'");
  }
  return { source, updates, anchorTs, thresholdBps, maxLagSecs, direction };
}

/// The longest US-equities closure is a holiday weekend, a little over four days. Nothing further
/// apart than this is one closure, and the cap is what bounds the day walk below — checked as the
/// walk's own limit rather than after it has already run.
const MAX_CLOSURE_SECS = 14 * 86400;
const MAX_CLOSURE_DAYS = MAX_CLOSURE_SECS / 86400 + 2;

/// The first session bell strictly after `t`, or null if none inside `MAX_CLOSURE_SECS`. Probing one
/// instant per ET day is enough: 15:00Z is 11:00 EDT / 10:00 EST, inside every regular and half-day
/// session, so `session_open_ts` is exactly that day's bell.
function nextSessionOpen(t, cal = CALENDAR_2026) {
  for (let day = 0; day <= MAX_CLOSURE_DAYS; day++) {
    const probe = new Date((t + day * 86400) * 1000);
    const at15 = Date.UTC(probe.getUTCFullYear(), probe.getUTCMonth(), probe.getUTCDate(), 15) / 1000;
    if (at15 < CALENDAR_2026.validFrom || at15 >= CALENDAR_2026.validUntil) return null;
    const bell = marketStatus(at15, cal).session_open_ts;
    if (bell !== null && bell > t) return bell - t <= MAX_CLOSURE_SECS ? bell : null;
  }
  return null;
}

/// The closure the market is about, from the anchor and the calendar alone — no price is consulted.
/// `anchorTs` must fall inside a closure: if the market was open at it, there is nothing to settle.
export function closureAround(anchorTs, cal = CALENDAR_2026) {
  if (!isClosed(anchorTs)) return null;
  // walk back to the session that ended this closure's start, and forward to the one that ends it
  let closeInstant = null;
  for (let day = 0; day <= MAX_CLOSURE_DAYS && closeInstant === null; day++) {
    const probe = new Date((anchorTs - day * 86400) * 1000);
    const at15 = Date.UTC(probe.getUTCFullYear(), probe.getUTCMonth(), probe.getUTCDate(), 15) / 1000;
    if (at15 < cal.validFrom || at15 >= cal.validUntil) return null;
    const st = marketStatus(at15, cal);
    if (st.session_close_ts !== null && st.session_close_ts <= anchorTs) closeInstant = st.session_close_ts - 1;
  }
  if (closeInstant === null) return null;
  const openInstant = nextSessionOpen(closeInstant, cal);
  return openInstant === null ? null : { closeInstant, openInstant };
}

/// PURE: the pinned set → the two prints, SELECTED rather than supplied. The last update at or before
/// the closing bell, and the first at or after the reopen.
///
/// This removes the CHOICE, and it does not close the residual. While a claim carried two prints its
/// builder had picked, nothing could prove either was the closest; selection means nothing about
/// which print is used is supplied at all. But omission is a property of the SET, and what closes
/// that is anyone being able to REBUILD the set from the descriptor and see a mismatch before
/// bonding. No rebuilder exists for this type — rebuilding needs to decode prices from the account,
/// not merely observe it was written to. So: a claim that omits the true nearest update does have a
/// different input set, and today nobody can observe that. Necessary condition, not sufficient one.
///
/// Ordering is by (blockTime, slot, sig): two updates can share a second, and a verdict must not
/// depend on which one a JSON array happened to list first.
export function selectPrints(updates, closeInstant, openInstant) {
  const ordered = [...updates].sort((a, b) => a.blockTime - b.blockTime || a.slot - b.slot || (a.sig < b.sig ? -1 : a.sig > b.sig ? 1 : 0));
  let close = null, open = null;
  for (const u of ordered) {
    if (u.blockTime <= closeInstant) close = u;              // keep taking: the last one wins
    else if (u.blockTime >= openInstant && open === null) open = u; // the first one after the reopen
  }
  return { close, open };
}

// Signed move in basis points, floored toward zero, in integer arithmetic.
function moveBps(from, to) {
  // scale both to a common exponent so the ratio is exact
  const e = Math.max(from.exp, to.exp);
  const a = from.value * 10n ** BigInt(e - from.exp);
  const b = to.value * 10n ** BigInt(e - to.exp);
  const diff = b - a;
  const neg = diff < 0n;
  const mag = (neg ? -diff : diff) * 10000n / a;
  return neg ? -mag : mag;
}

export function reexec(inputs) {
  const q = canonicalInputs(inputs);
  const { source, updates, anchorTs, thresholdBps, maxLagSecs, direction } = q;

  // 1. The closure, from the anchor and the calendar. No price is consulted, so nothing the builder
  //    pinned can move the boundary. (Task 009 derived it from the close print's session, which was
  //    correct but left the boundary depending on a chosen observation.)
  const closure = closureAround(anchorTs);
  const straddles = closure !== null;
  const closeInstant = closure?.closeInstant ?? null;
  const openInstant = closure?.openInstant ?? null;

  // 1b. The declared window must reach far enough either side of the closure that a rebuild of it
  //     would have contained whatever the selection picks. A window that stops short of a bell can
  //     produce a "nearest" print that is only nearest among what the window happened to include.
  const coversClose = straddles && source.fromTs <= closeInstant - maxLagSecs;
  const coversOpen = straddles && source.toTs >= openInstant + maxLagSecs;
  const windowCovers = coversClose && coversOpen;

  // 2. The prints, SELECTED from the pinned set rather than supplied.
  const picked = straddles ? selectPrints(updates, closeInstant, openInstant) : { close: null, open: null };
  const close = picked.close, open = picked.open;
  const bothSides = close !== null && open !== null;

  const closeLagSecs = bothSides ? closeInstant - close.blockTime : null;
  const openLagSecs = bothSides ? open.blockTime - openInstant : null;
  // maxLagSecs is a STALENESS guard now, not a bound on a choice — there is no choice left to bound.
  const lagsOk = bothSides && windowCovers && closeLagSecs <= maxLagSecs && openLagSecs <= maxLagSecs;

  // 2. The move. Computed regardless, so a STALE claim still shows what it would have said.
  const signedBps = bothSides ? moveBps(close.price, open.price) : 0n;
  const observedBps = direction === 'ABS' ? (signedBps < 0n ? -signedBps : signedBps)
    : direction === 'DOWN' ? -signedBps
      : signedBps;
  const breached = observedBps >= BigInt(thresholdBps);

  const flag = !straddles || !windowCovers || !bothSides || !lagsOk ? 'STALE' : breached ? 'RED' : 'GREEN';
  const reason = !straddles
    ? 'terms.anchorTs does not fall inside a market closure'
    : !windowCovers
      ? `the declared source window does not reach ${maxLagSecs}s either side of the closure, so a rebuild of it could not establish what the nearest prints are`
      : !bothSides
      ? `the pinned window holds no update ${close === null ? 'at or before the closing bell' : 'at or after the reopen'}`
      : !lagsOk
      ? `a pinned print is further than ${maxLagSecs}s from its boundary (close ${closeLagSecs}s, open ${openLagSecs}s)`
      : breached
        ? `the closure produced ${observedBps} bps ${direction}, at or beyond the declared ${thresholdBps}`
        : `the closure produced ${observedBps} bps ${direction}, short of the declared ${thresholdBps}`;

  return {
    computation: {
      straddles_closure: straddles,
      close_instant: closeInstant,
      open_instant: openInstant,
      close_lag_secs: closeLagSecs,
      open_lag_secs: openLagSecs,
      lags_ok: lagsOk,
      updates_pinned: updates.length,
      source_chain: source.chain,
      source_account: source.account,
      source_window: { from: source.fromTs, to: source.toTs },
      window_covers_closure: windowCovers,
      // which observations the rule SELECTED — reported so a reader sees the choice was made by the
      // rule and can check it against the set, not so they have to trust it was
      selected_close: close === null ? null : { blockTime: close.blockTime, slot: close.slot, sig: close.sig },
      selected_open: open === null ? null : { blockTime: open.blockTime, slot: open.slot, sig: open.sig },
      closure_secs: straddles ? openInstant - closeInstant : null,
      signed_bps: String(signedBps),
      observed_bps: String(observedBps),
      threshold_bps: thresholdBps,
      direction,
      calendar_version: CALENDAR_2026.version,
    },
    verdict: { flag, reason },
  };
}

export function checks(claim, r) {
  // The subject names the account the claim is ABOUT; the descriptor names the account its inputs
  // were read FROM. Nothing tied them together, so a claim could be subject-ed to one price account
  // and sourced from another and verify cleanly (Codex, reviews/011 F3) — a reader trusting the
  // subject would be reading a verdict about a different account. `checks` sees the whole claim,
  // which is the only place in this engine that can enforce it.
  const subjectAccount = claim?.subject?.priceAccount;
  const sourceAccount = claim?.inputs?.observed?.source?.account;
  const subjectChain = claim?.subject?.chain;
  const sourceChain = claim?.inputs?.observed?.source?.chain;
  // The subject is reader-facing body that re-execution never reads, so the engine's whole-output
  // binding cannot reach it. Left open, an extra subject key is a label a verifier certified without
  // looking at (Codex, reviews/011 F9). This type's subject is exactly two fields.
  const SUBJECT_KEYS = ['chain', 'priceAccount'];
  const subjectClosed = isObject(claim?.subject)
    && SUBJECT_KEYS.every((k) => k in claim.subject)
    && Object.keys(claim.subject).every((k) => SUBJECT_KEYS.includes(k));
  return [
    ['the subject is exactly { chain, priceAccount }', subjectClosed, Object.keys(claim?.subject ?? {}).join(', ') || 'missing'],
    ['subject names the account the inputs came from', typeof subjectAccount === 'string' && subjectAccount === sourceAccount, `${subjectAccount ?? 'missing'} vs ${sourceAccount ?? 'missing'}`],
    ['subject names the chain the inputs came from', typeof subjectChain === 'string' && subjectChain === sourceChain, `${subjectChain ?? 'missing'} vs ${sourceChain ?? 'missing'}`],
    ['closure straddle reproduces', r.computation.straddles_closure === claim.computation.straddles_closure, `${r.computation.straddles_closure}`],
    ['boundary instants reproduce', r.computation.close_instant === claim.computation.close_instant && r.computation.open_instant === claim.computation.open_instant, `${r.computation.close_instant} → ${r.computation.open_instant}`],
    ['the same two prints are selected', JSON.stringify(r.computation.selected_close) === JSON.stringify(claim.computation.selected_close) && JSON.stringify(r.computation.selected_open) === JSON.stringify(claim.computation.selected_open), `${r.computation.selected_close?.sig ?? 'none'} → ${r.computation.selected_open?.sig ?? 'none'}`],
    ['the declared window covers the closure', r.computation.window_covers_closure === claim.computation.window_covers_closure, `${r.computation.source_window.from}–${r.computation.source_window.to}`],
    ['print lags within terms', r.computation.lags_ok === claim.computation.lags_ok, `close ${r.computation.close_lag_secs}s · open ${r.computation.open_lag_secs}s`],
    ['gap reproduces', r.computation.observed_bps === claim.computation.observed_bps, `${r.computation.observed_bps} bps`],
  ];
}

export function build({ subject, terms, updates, source }) {
  // refuse to construct what `checks` would reject, so the mismatch cannot be made by accident
  if (subject?.priceAccount !== source?.account) {
    throw new Error(`subject.priceAccount (${subject?.priceAccount ?? 'missing'}) must be the account the source descriptor reads (${source?.account ?? 'missing'})`);
  }
  if (subject?.chain !== source?.chain) {
    throw new Error(`subject.chain (${subject?.chain ?? 'missing'}) must be the chain the source descriptor reads (${source?.chain ?? 'missing'})`);
  }
  return buildClaim({
    type,
    subject,
    inputs: {
      // Only the calendar, and it is validated on the way back in. `chain` lived here too and was
      // copied from the subject unchecked; it now belongs to the descriptor, which is parsed. A
      // display `count` lived in `observed` and could disagree with `updates.length`.
      //
      // Both are gone FROM HERE, and that was never the fix — the builder is not the boundary. They
      // could be hand-authored back and verified until `canonicalInputs` began rejecting unrecognised
      // keys (Codex, reviews/011 F7). What makes them unable to lie is that they cannot be parsed,
      // not that they are not emitted.
      trusted: { calendar: CALENDAR_2026.version },
      oracle_inputs: [],
      terms,
      // the SET, not two chosen prints — `source` is what a third party rebuilds it from
      observed: { source, updates },
    },
  });
}

registerClaimType({ type, invariant, canonicalInputs, reexec, checks });

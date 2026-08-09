// Vrdct adapter: Jito (Re)staking on Solana mainnet → a `restaking-robustness` claim.
//
// Task 008 shipped the claim-type with no adapter: it computes γ* from a graph somebody hands it.
// This hands it a real one, and — more to the point — decides in public which parts of that graph
// are SOURCED and which are DECLARED. The adapter's whole job is to make the sourced part mechanical
// so the declared part is the only thing left to argue about.
//
// WHAT IS SOURCED. Services are NCNs, validators are operators, and stake comes from
// `VaultOperatorDelegation`. All of it is public Solana account state, decoded at byte offsets
// verified against live accounts.
//
// A DELEGATION ONLY COUNTS WHEN JITO SAYS IT IS ACTIVE, and that took a review to get right. The
// first version asked `slot_added > slot_removed` on two toggles. That is not the state machine:
// upstream `SlotToggle::state` returns WarmUp until the current epoch is more than one full epoch
// past `slot_added`, so a relationship opted in this epoch is not yet carrying stake. And two of the
// five parties were not read at all — Jito's active-stake relationship is NCN↔operator,
// operator→vault, vault→NCN AND ncn→vault, plus the delegation. Missing either bilateral ticket
// produced invented security, which lowers T_v and can turn a real RED into a reported GREEN: the
// one direction that must never be possible. All four relationships are now fetched and each must be
// `Active` at the sampled slot, under the epoch length read from the program `Config`.
//
// Only `staked_amount` is counted. Jito's own `total_security()` also includes the enqueued and
// cooling-down amounts, because those remain slashable — so this is a DELIBERATELY WEAKER measure of
// security, chosen because it rounds against the network, and it should not be read as Jito's.
//
// WHAT IS DECLARED, AND THIS ADAPTER WILL NOT INVENT IT. π_s (profit from corrupting an NCN) is not
// chain state — the paper itself calls estimating it an open research direction. Nor is α_s, the
// fraction of stake needed to corrupt an NCN: that belongs to the NCN's consensus protocol and
// Jito's registry does not record it. Both are pinned in a terms file and argued in the open. There
// are no defaults and no heuristics here; a snapshot whose NCNs are not all covered by terms is an
// error, not a claim carrying silent assumptions.
//
// THREE PLACES THE MAPPING DOES NOT FIT, all handled by refusing or by rounding against ourselves:
//
//   1. Stake is denominated per vault, and the live network uses SEVENTEEN mints. Each `Vault` has
//      its own `supported_mint` and `staked_amount` is in that mint's base units, so adding them up
//      would smuggle a price in as arithmetic. Mainnet is therefore not summable on its own — which
//      is a result, not an obstacle, and it is why prices are a THIRD declared input here rather
//      than something this adapter computes. Every contributing mint must carry a declared exact
//      rational price in the numéraire, or the snapshot is refused; conversion floors, so the
//      converted stake is never larger than the truth. Note the limit of that: flooring makes the
//      total conservative, but a wrong price RATIO between two mints tilts the graph's shape, and no
//      rounding rule protects against that. It is contestable in the open, like π_s.
//      For SOL liquid-staking tokens a floor of 1 SOL needs no oracle at all — an LST only
//      appreciates against SOL — so most of this network can be declared conservatively from
//      structure rather than from a price feed. Anything that is not an LST cannot.
//   2. Jito's stake is per (vault, operator, NCN); the paper's is per validator. In the paper one σ_v
//      backs EVERY service a validator restakes for — that reuse is the risk being studied. Here,
//      stake reaches NCN s through operator v only from vaults delegated to v AND opted into s. So
//      σ_v is taken as the MINIMUM, over v's NCNs, of the stake reachable to that NCN. Under-stating
//      σ_v under-states σ_{N(s)}, which raises T_v, which lowers γ* — and it under-states the attack
//      cost σ_B as well. Both roles round against the network, never in its favour.
//   3. The claim-type implements the paper's GLOBAL guarantee. So terms must cover every NCN with an
//      active edge; judging a subset would be the local guarantee, which is not implemented.
//
// WHAT THIS DOES NOT CLOSE. `getProgramAccounts` takes no slot, so nobody can ask an RPC for these
// accounts AS OF the pinned slot — only as of now. A Jito snapshot is therefore reproducible while it
// is current and not afterwards, exactly where `reserve-solvency` already sits. Every account's own
// `last_update_slot` / toggle slots are pinned alongside its value so a later verifier can at least
// tell whether it moved. A claim from this adapter is NOT a historical claim.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { build as buildRestakingClaim } from '../claimtypes/restaking-robustness.mjs';
import { MAX_SERVICES, MAX_VALIDATORS, MAX_SERVICES_PER_VALIDATOR, MAX_EDGES } from '../claimtypes/restaking-robustness.mjs';

export const RESTAKING_PROGRAM = 'RestkWeAVL8fRGgzhfeoqFhsqKRchg6aa1XrcH96z4Q';
export const VAULT_PROGRAM = 'Vau1t6sLNxnzB7ZDsef8TLbPLfyZMYXH8WTNqUdm9g8';

/// Account sizes are the discriminator plus the struct, and they are how each account type is
/// selected — `632 = 8 + 32 + 32 + 280 + 8 + 8 + 1 + 263` is `VaultOperatorDelegation` exactly.
export const SIZE = { CONFIG: 360, NCN: 592, OPERATOR: 520, NCN_OPERATOR_STATE: 440, TICKET_392: 392, VAULT: 1111, VAULT_OPERATOR_DELEGATION: 632, VAULT_NCN_TICKET: 392 };
/// `OperatorVaultTicket` and `NcnVaultTicket` are both 392 bytes, so they are separated by the
/// leading u64 discriminator rather than by size. Identified against mainnet: disc 5 has an operator
/// at offset 8 (140 live), disc 6 has an NCN there (25 live).
export const DISC = { OPERATOR_VAULT_TICKET: 5, NCN_VAULT_TICKET: 6 };

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
/// Base58, so this file stays zero-dependency like everything else that decides a verdict.
export function b58(buf) {
  let n = 0n;
  for (const b of buf) n = n * 256n + BigInt(b);
  let out = '';
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of buf) { if (b === 0) out = '1' + out; else break; }
  return out || '1';
}
const key = (b, o) => b58(b.subarray(o, o + 32));
const u64 = (b, o) => b.readBigUInt64LE(o);

// ── decoding ──────────────────────────────────────────────────────────────────────────────────
// Offsets derived from the struct definitions and then checked against live accounts. A wrong
// offset here is a wrong verdict about somebody's network, so each is a tested regression.

/// Jito's `SlotToggle` state machine, reproduced from upstream rather than approximated. An epoch is
/// `slot / epoch_length`; a toggle turned on becomes `Active` only once the current epoch is MORE
/// than one full epoch past the one it was added in, and a toggle turned off stays `Cooldown` for
/// the same window. Equal slots are `Inactive`. Asking `slot_added > slot_removed` — which is what
/// this adapter did before review — counts a warming-up relationship as if it already carried stake.
export const TOGGLE = { INACTIVE: 'Inactive', WARM_UP: 'WarmUp', ACTIVE: 'Active', COOLDOWN: 'Cooldown' };
export function toggleState(b, o, slot, epochLength) {
  const added = u64(b, o), removed = u64(b, o + 8);
  const epoch = (x) => x / BigInt(epochLength);
  const now = epoch(BigInt(slot));
  if (added === removed) return TOGGLE.INACTIVE;
  if (added < removed) return now > epoch(removed) + 1n ? TOGGLE.INACTIVE : TOGGLE.COOLDOWN;
  return now > epoch(added) + 1n ? TOGGLE.ACTIVE : TOGGLE.WARM_UP;
}
export const toggleActive = (b, o, slot, epochLength) => toggleState(b, o, slot, epochLength) === TOGGLE.ACTIVE;

/// `epoch_length` is consensus for every toggle below, so it is read from the program's own Config
/// rather than assumed. Config is `8 + admin(32) + vault_program(32) + ncn_count + operator_count +
/// epoch_length + bump + reserved(263)` = 360.
export const decodeConfig = (pk, b) => ({
  pubkey: pk, ncnCount: u64(b, 72), operatorCount: u64(b, 80), epochLength: u64(b, 88),
});
/// Decoding keeps the RAW toggle slots and nothing derived. Activation depends on which slot you ask
/// about, so it is a separate step — which is also what lets two reads be compared for stability
/// without the comparison drifting just because time passed between them.
export const decodeNcnOperatorState = (pk, b) => ({
  pubkey: pk, ncn: key(b, 8), operator: key(b, 40),
  ncnAdded: u64(b, 80), ncnRemoved: u64(b, 88),
  operatorAdded: u64(b, 128), operatorRemoved: u64(b, 136),
});
/// operator→vault (disc 5) and ncn→vault (disc 6) share a size and a shape.
export const decodeTicket392 = (pk, b) => ({
  pubkey: pk, disc: b.readUInt8(0), owner: key(b, 8), vault: key(b, 40),
  added: u64(b, 80), removed: u64(b, 88),
});
export const decodeVaultOperatorDelegation = (pk, b) => ({
  pubkey: pk,
  vault: key(b, 8),
  operator: key(b, 40),
  staked: u64(b, 72),
  enqueued: u64(b, 80),
  cooling: u64(b, 88),
  lastUpdateSlot: u64(b, 352),
});
export const decodeVaultNcnTicket = (pk, b) => ({
  pubkey: pk, vault: key(b, 8), ncn: key(b, 40), added: u64(b, 80), removed: u64(b, 88),
});

/// Raw toggle slots → the state at a given slot. Separated from decoding on purpose: `slot_min` is
/// the least generous reading (earlier makes a switched-on toggle WarmUp rather than Active, and a
/// switched-off one is never Active at any slot), so this is applied once, at the oldest slot seen.
const stateAt = (added, removed, slot, epochLength) => {
  const epoch = (x) => x / BigInt(epochLength);
  const now = epoch(BigInt(slot));
  if (added === removed) return TOGGLE.INACTIVE;
  if (added < removed) return now > epoch(removed) + 1n ? TOGGLE.INACTIVE : TOGGLE.COOLDOWN;
  return now > epoch(added) + 1n ? TOGGLE.ACTIVE : TOGGLE.WARM_UP;
};
export const activateNcnOperatorState = (r, slot, e) => ({
  ...r,
  ncnState: stateAt(r.ncnAdded, r.ncnRemoved, slot, e),
  operatorState: stateAt(r.operatorAdded, r.operatorRemoved, slot, e),
  active: stateAt(r.ncnAdded, r.ncnRemoved, slot, e) === TOGGLE.ACTIVE && stateAt(r.operatorAdded, r.operatorRemoved, slot, e) === TOGGLE.ACTIVE,
});
export const activateTicket = (r, slot, e) => {
  const state = stateAt(r.added, r.removed, slot, e);
  return { ...r, state, active: state === TOGGLE.ACTIVE };
};
export const decodeVault = (pk, b) => ({ pubkey: pk, supportedMint: key(b, 72) });

// ── the graph ─────────────────────────────────────────────────────────────────────────────────

export class OutOfDomain extends Error {}
const refuse = (msg) => { throw new OutOfDomain(msg); };

/// PURE: decoded accounts + declared terms → the restaking graph the claim-type consumes.
/// Everything that decides a number lives here, so the network fetch below is not part of the logic.
export function buildGraph({ states, delegations, ncnTickets, operatorVaultTickets, ncnVaultTickets, vaults, terms }) {
  const edges = states.filter((s) => s.active);
  const ncnsWithEdges = [...new Set(edges.map((e) => e.ncn))].sort();

  // GLOBAL guarantee: terms must cover every NCN carrying an active edge. Judging a subset would be
  // the paper's local guarantee, which the claim-type does not implement.
  const declared = new Set(Object.keys(terms.ncns));
  const missing = ncnsWithEdges.filter((n) => !declared.has(n));
  if (missing.length) refuse(`terms are missing π/α for ${missing.length} NCN(s) carrying active edges: ${missing.join(', ')}`);

  // Every contributing mint needs a declared price, or the stake is not summable at all.
  const mintOf = new Map(vaults.map((v) => [v.pubkey, v.supportedMint]));
  const contributing = [...new Set(delegations.filter((d) => d.staked > 0n).map((d) => d.vault))];
  const mints = [...new Set(contributing.map((v) => mintOf.get(v)))].sort();
  const unpriced = mints.filter((m) => !terms.mints?.[m]);
  if (unpriced.length) refuse(`${unpriced.length} contributing mint(s) have no declared price in terms.mints: ${unpriced.join(', ')}`);
  /// Convert to the numéraire with an exact rational, FLOORED — the converted stake is never larger
  /// than the truth, so the certificate can only come out weaker.
  const inNumeraire = (amount, mint) => {
    const { num, den } = terms.mints[mint];
    return (amount * BigInt(num)) / BigInt(den);
  };

  // Stake reaches NCN s through operator v via vault V only when EVERY party has said yes and every
  // one of those toggles is Active — not merely warming up. Any missing side is invented security.
  const vaultToNcn = new Set(ncnTickets.filter((t) => t.active).map((t) => `${t.vault}|${t.ncn}`));
  const operatorToVault = new Set((operatorVaultTickets || []).filter((t) => t.active).map((t) => `${t.owner}|${t.vault}`));
  const ncnToVault = new Set((ncnVaultTickets || []).filter((t) => t.active).map((t) => `${t.owner}|${t.vault}`));
  const byOperator = new Map();
  for (const d of delegations) {
    if (d.staked === 0n) continue;
    if (!byOperator.has(d.operator)) byOperator.set(d.operator, []);
    byOperator.get(d.operator).push({ ...d, value: inNumeraire(d.staked, mintOf.get(d.vault)) });
  }
  const reachable = (operator, ncn) => (byOperator.get(operator) || [])
    .filter((d) => vaultToNcn.has(`${d.vault}|${ncn}`)
      && ncnToVault.has(`${ncn}|${d.vault}`)
      && operatorToVault.has(`${operator}|${d.vault}`))
    .reduce((acc, d) => acc + d.value, 0n);

  const operators = [...new Set(edges.map((e) => e.operator))].sort();
  const validators = operators.map((operator) => {
    const services = [...new Set(edges.filter((e) => e.operator === operator).map((e) => e.ncn))].sort();
    // the conservative reduction: the least any of this operator's NCNs can actually count on
    const stake = services.reduce((min, ncn) => {
      const r = reachable(operator, ncn);
      return min === null || r < min ? r : min;
    }, null);
    return { id: operator, stake: String(stake ?? 0n), services };
  });

  const services = ncnsWithEdges.map((id) => ({ id, profit: String(terms.ncns[id].profit), alpha: terms.ncns[id].alpha }));

  // Reject, never truncate — the requirement carried forward from the task-008 approval. Dropping
  // edges to make a graph admissible removes constraints, and removing constraints can only raise γ*.
  if (services.length > MAX_SERVICES) refuse(`snapshot holds ${services.length} services, past the claim-type's ${MAX_SERVICES}`);
  if (validators.length > MAX_VALIDATORS) refuse(`snapshot holds ${validators.length} validators, past the claim-type's ${MAX_VALIDATORS}`);
  const worstDegree = validators.reduce((m, v) => Math.max(m, v.services.length), 0);
  if (worstDegree > MAX_SERVICES_PER_VALIDATOR) refuse(`an operator restakes for ${worstDegree} services, past the claim-type's ${MAX_SERVICES_PER_VALIDATOR}`);
  const edgeCount = validators.reduce((n, v) => n + v.services.length, 0);
  if (edgeCount > MAX_EDGES) refuse(`snapshot holds ${edgeCount} edges, past the claim-type's ${MAX_EDGES}`);

  return { services, validators, mints, numeraire: terms.numeraire ?? null, edgeCount };
}

// ── the network boundary ──────────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/// Reading the network twice is twelve calls, which public RPC rate-limits. Backoff is transport,
/// not logic: it changes how long a read takes and nothing about what it observes.
async function rpc(url, method, params, { attempts = 5 } = {}) {
  for (let i = 0; ; i++) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const json = await res.json();
    if (!json.error) return json.result;
    const rateLimited = json.error.code === 429 || res.status === 429;
    if (!rateLimited || i >= attempts - 1) throw new Error(`${method}: ${JSON.stringify(json.error)}`);
    await sleep(1000 * 2 ** i);
  }
}
/// `withContext` so every response carries the slot its bank was at. Four independent calls cannot
/// share a bank, and pretending otherwise is what F3 was about.
const accountsOfSize = async (url, programId, dataSize) => {
  const r = await rpc(url, 'getProgramAccounts', [programId, { encoding: 'base64', withContext: true, filters: [{ dataSize }] }]);
  return { slot: r.context.slot, accounts: r.value.map((a) => ({ pubkey: a.pubkey, buf: Buffer.from(a.account.data[0], 'base64') })) };
};

/// Read the live network. The slot is captured alongside so the claim states what it is a snapshot
/// OF, even though no RPC can be asked to serve these accounts as of it again.
/// One read of every account set. Each response carries the slot its own bank was on; four
/// independent calls cannot share one.
async function readOnce(rpcUrl) {
  const cfgRes = await accountsOfSize(rpcUrl, RESTAKING_PROGRAM, SIZE.CONFIG);
  if (cfgRes.accounts.length !== 1) throw new Error(`expected exactly one restaking Config, found ${cfgRes.accounts.length}`);
  const config = decodeConfig(cfgRes.accounts[0].pubkey, cfgRes.accounts[0].buf);
  const epochLength = Number(config.epochLength);
  if (!Number.isSafeInteger(epochLength) || epochLength <= 0) throw new Error(`Config.epoch_length is not usable: ${config.epochLength}`);

  const [stateRes, ticket392Res, delegationRes, vaultNcnRes, vaultRes] = await Promise.all([
    accountsOfSize(rpcUrl, RESTAKING_PROGRAM, SIZE.NCN_OPERATOR_STATE),
    accountsOfSize(rpcUrl, RESTAKING_PROGRAM, SIZE.TICKET_392),
    accountsOfSize(rpcUrl, VAULT_PROGRAM, SIZE.VAULT_OPERATOR_DELEGATION),
    accountsOfSize(rpcUrl, VAULT_PROGRAM, SIZE.VAULT_NCN_TICKET),
    accountsOfSize(rpcUrl, VAULT_PROGRAM, SIZE.VAULT),
  ]);
  const slots = {
    config: cfgRes.slot, ncn_operator_state: stateRes.slot, tickets_392: ticket392Res.slot,
    vault_operator_delegation: delegationRes.slot, vault_ncn_ticket: vaultNcnRes.slot, vault: vaultRes.slot,
  };
  const ticket392 = ticket392Res.accounts.map((a) => decodeTicket392(a.pubkey, a.buf));
  return {
    config, epochLength, slots,
    // every byte the read saw, Config included — this is what the stability witness compares
    buffers: {
      config: cfgRes.accounts, ncn_operator_state: stateRes.accounts, tickets_392: ticket392Res.accounts,
      vault_operator_delegation: delegationRes.accounts, vault_ncn_ticket: vaultNcnRes.accounts, vault: vaultRes.accounts,
    },
    slotMin: Math.min(...Object.values(slots)), slotMax: Math.max(...Object.values(slots)),
    states: stateRes.accounts.map((a) => decodeNcnOperatorState(a.pubkey, a.buf)),
    delegations: delegationRes.accounts.map((a) => decodeVaultOperatorDelegation(a.pubkey, a.buf)),
    ncnTickets: vaultNcnRes.accounts.map((a) => decodeVaultNcnTicket(a.pubkey, a.buf)),
    operatorVaultTickets: ticket392.filter((t) => t.disc === DISC.OPERATOR_VAULT_TICKET),
    ncnVaultTickets: ticket392.filter((t) => t.disc === DISC.NCN_VAULT_TICKET),
    vaults: vaultRes.accounts.map((a) => decodeVault(a.pubkey, a.buf)),
  };
}

/// A canonical, order-independent digest of everything a read observed — over COMPLETE ACCOUNT
/// BUFFERS, not over decoded fields.
///
/// The first version fingerprinted the manifest, which is a decoded projection, and a projection can
/// only witness the fields it happens to include. `enqueued_for_cooldown_amount` was not one of them,
/// so two genuinely different delegation accounts fingerprinted identically and a graph that moved
/// could be certified as stable (Codex, reviews/010 F5). Hashing the raw bytes fixes the class
/// rather than that field: anything this adapter does not decode — today's blind spots and any field
/// a future Jito release adds — is covered without anyone remembering to add it here.
export function fingerprint(read) {
  const rows = [];
  for (const [kind, accounts] of Object.entries(read.buffers)) {
    for (const a of accounts) rows.push(`${kind}|${a.pubkey}|${createHash('sha256').update(a.buf).digest('hex')}`);
  }
  rows.sort();
  return rows.join('\n');
}

/// Read the network TWICE and refuse if anything was seen to move between the reads.
///
/// Named `observe`, not `snapshot`. The old name asserted the thing three review rounds went into
/// disproving, and a name that overclaims is how the belief survived them.
///
/// WHAT THIS ESTABLISHES, AND — after three rounds of getting this wrong — WHAT IT DOES NOT.
///
/// It establishes ENDPOINT EQUALITY: every account had identical bytes at two separated
/// observations. That is a real filter, and it is why it stays: a read where anything visibly moved
/// is refused rather than certified.
///
/// It does NOT establish that this graph existed at any single slot, for two independent reasons.
///
///   1. Each read is itself spread across response slots — five `getProgramAccounts` calls cannot
///      share a bank — so neither endpoint is an instant either.
///   2. A change and a return inside the window is not excluded by the bytes. An earlier version of
///      this comment claimed it was, on the grounds that any mutation bumps `last_update_slot`. That
///      is false (Codex, reviews/010 F6): `AddDelegation` and `CooldownDelegation` mutate only
///      `delegation_state`, and only the epoch `update()` path writes that slot. And the state
///      itself can return without `update()` — `(100,0,0)` → cooldown(100) → `(0,100,0)` →
///      slash(100) → `(0,0,0)` → delegate(100) → `(100,0,0)`, all invisible to a byte comparison at
///      the ends.
///
/// So this is an OBSERVATION with equal endpoints, not a snapshot of a state, and a claim built from
/// it says exactly that. Unlikely is not the standard this repo settles money on; the distinction
/// between "nothing was seen to move" and "nothing moved" is the whole of the difference.
/// PURE: two reads → refusal, or nothing. Separated from the fetch so the refusal is testable.
/// Named for what it checks — the endpoints are equal — rather than for what that was once claimed
/// to imply about the interval between them.
export function witnessEndpointsEqual(a, b) {
  if (b.slotMin <= a.slotMax) {
    throw new OutOfDomain(`the second read did not begin after the first ended (${a.slotMax} → ${b.slotMin}); the window has no witness at its far end`);
  }
  if (fingerprint(a) !== fingerprint(b)) {
    throw new OutOfDomain(`the network moved between reads (slots ${a.slotMin}–${b.slotMax}); a graph assembled across a visible change is not even an observation of one state`);
  }
}

export async function observe(rpcUrl, { gapMs = 5000 } = {}) {
  const a = await readOnce(rpcUrl);
  // The two witnesses have to be separated in time or they bound no window. A load-balanced endpoint
  // also serves responses from banks a slot or two apart, so the gap has to clear that jitter too —
  // and the check below is on the slots actually returned, never on how long we waited.
  await sleep(gapMs);
  const b = await readOnce(rpcUrl);
  witnessEndpointsEqual(a, b);
  // Nothing was SEEN to move between the endpoints. Every toggle is judged at the oldest slot seen —
  // the least generous reading, since an earlier slot can only make a switched-on toggle WarmUp.
  const at = a.slotMin;
  return {
    ...a,
    observedFrom: a.slotMin, observedTo: b.slotMax,
    reads: [a.slots, b.slots],
    evaluatedAt: at,
    states: a.states.map((r) => activateNcnOperatorState(r, at, a.epochLength)),
    ncnTickets: a.ncnTickets.map((r) => activateTicket(r, at, a.epochLength)),
    operatorVaultTickets: a.operatorVaultTickets.map((r) => activateTicket(r, at, a.epochLength)),
    ncnVaultTickets: a.ncnVaultTickets.map((r) => activateTicket(r, at, a.epochLength)),
  };
}

/// The manifest keeps RAW add/remove slots, not just the state they imply: a reader checking these
/// accounts later needs the numbers the state was derived from, not our conclusion about them.
export function manifestRows(snap) {
  const row = (k, a, rest) => ({ k, a: a.pubkey, ...rest });
  return [
    ...snap.states.map((a) => row('ncn_operator_state', a, { ncn: a.ncn, op: a.operator, ncnAdded: String(a.ncnAdded), ncnRemoved: String(a.ncnRemoved), opAdded: String(a.operatorAdded), opRemoved: String(a.operatorRemoved) })),
    ...snap.operatorVaultTickets.map((a) => row('operator_vault_ticket', a, { op: a.owner, vault: a.vault, added: String(a.added), removed: String(a.removed) })),
    ...snap.ncnVaultTickets.map((a) => row('ncn_vault_ticket', a, { ncn: a.owner, vault: a.vault, added: String(a.added), removed: String(a.removed) })),
    ...snap.ncnTickets.map((a) => row('vault_ncn_ticket', a, { vault: a.vault, ncn: a.ncn, added: String(a.added), removed: String(a.removed) })),
    ...snap.delegations.map((a) => row('vault_operator_delegation', a, { vault: a.vault, op: a.operator, staked: String(a.staked), enqueued: String(a.enqueued), cooling: String(a.cooling), lastUpdateSlot: String(a.lastUpdateSlot) })),
    ...snap.vaults.map((a) => row('vault', a, { mint: a.supportedMint })),
  ];
}
export const manifest = (snap) => manifestRows(snap).sort((x, y) => (x.k === y.k ? (x.a < y.a ? -1 : 1) : x.k < y.k ? -1 : 1));

export function loadTerms(path) {
  const terms = JSON.parse(readFileSync(path, 'utf8'));
  if (!terms?.gamma || !terms?.shockPsiBps || !terms?.ncns) throw new Error('terms need { gamma, shockPsiBps, ncns }');
  for (const [ncn, t] of Object.entries(terms.ncns)) {
    if (t?.profit === undefined || !t?.alpha) throw new Error(`terms.ncns["${ncn}"] needs { profit, alpha }`);
  }
  if (!terms.numeraire || !terms.mints) throw new Error('terms need { numeraire, mints } — stake in 17 mints is not summable without declared prices');
  for (const [mint, p] of Object.entries(terms.mints)) {
    if (!Number.isSafeInteger(p?.num) || !Number.isSafeInteger(p?.den) || p.num <= 0 || p.den <= 0) {
      throw new Error(`terms.mints["${mint}"] needs an exact rational { num, den } of positive integers`);
    }
  }
  return terms;
}

export async function claimFromMainnet({ rpcUrl, termsPath }) {
  const terms = loadTerms(termsPath);
  const snap = await observe(rpcUrl);
  const graph = buildGraph({ ...snap, terms });
  return buildRestakingClaim({
    subject: { network: 'jito-restaking', chain: 'solana-mainnet' },
    terms: { gamma: terms.gamma, shockPsiBps: terms.shockPsiBps },
    services: graph.services,
    validators: graph.validators,
    source: {
      kind: 'JITO_RESTAKING_OBSERVATION',
      restaking_program: RESTAKING_PROGRAM,
      vault_program: VAULT_PROGRAM,
      reads: snap.reads,
      observed_from: snap.observedFrom,
      observed_to: snap.observedTo,
      certifies: 'ENDPOINT EQUALITY ONLY. Every account below had identical bytes — complete buffers, not decoded fields — at two separated observations spanning [observed_from, observed_to]. A read where anything visibly moved is refused rather than certified.',
      does_not_certify: 'That this graph existed at any single slot. Each read is itself spread across response slots, so neither endpoint is an instant; and a change and a return inside the window is not excluded, because Jito mutates delegation_state without writing last_update_slot (only the epoch update() path writes it) and the state can return without that path — cooldown then slash then delegate restores a prior triple. This is an OBSERVATION with equal endpoints, not a snapshot of a state.',
      settlement_grade: 'NO. A verdict from this adapter is a board reading. Money-at-risk settlement needs a source that can address a slot, which getProgramAccounts cannot.',
      evaluated_at_slot: snap.evaluatedAt,
      epoch_length: String(snap.epochLength),
      active_stake_rule: 'ncn_operator_state (both sides) + operator_vault_ticket + ncn_vault_ticket + vault_ncn_ticket, each Active under Jito\'s SlotToggle at evaluated_at_slot',
      security_measure: 'staked_amount only — Jito total_security() also counts enqueued and cooling-down, which remain slashable, so this is deliberately weaker',
      manifest: manifest(snap),
      declared: {
        note: 'NOT SOURCED. These are the judgements this claim rests on; everything downstream of them is mechanical.',
        numeraire: terms.numeraire,
        unit: 'numeraire base units per one base unit of the source mint, as an exact rational, floored on conversion',
        // the exact map, not a pointer to a file: a path is not a commitment, and a verifier must be
        // able to see and contest the number that turned a mint into apparent security
        mint_prices: Object.fromEntries(graph.mints.map((m) => [m, terms.mints[m]])),
        ncn_terms: Object.fromEntries(graph.services.map((svc) => [svc.id, { profit: svc.profit, alpha: svc.alpha }])),
      },
      contributing_mints: graph.mints,
      stake_reduction: 'min over the operator\'s NCNs of the stake reachable to that NCN',
      reproducible: 'while current only — getProgramAccounts takes no slot, so this is an aggregate over [slot_min, slot_max], not a snapshot at an instant, and not a historical claim',
    },
  });
}

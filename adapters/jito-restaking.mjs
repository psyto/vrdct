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
export const decodeNcnOperatorState = (pk, b, slot, epochLength) => ({
  pubkey: pk,
  ncn: key(b, 8),
  operator: key(b, 40),
  ncnState: toggleState(b, 80, slot, epochLength),
  operatorState: toggleState(b, 128, slot, epochLength),
  active: toggleActive(b, 80, slot, epochLength) && toggleActive(b, 128, slot, epochLength),
});
/// operator→vault (disc 5) and ncn→vault (disc 6) share a size and a shape.
export const decodeTicket392 = (pk, b, slot, epochLength) => ({
  pubkey: pk, disc: b.readUInt8(0), owner: key(b, 8), vault: key(b, 40),
  state: toggleState(b, 80, slot, epochLength), active: toggleActive(b, 80, slot, epochLength),
});
export const decodeVaultOperatorDelegation = (pk, b) => ({
  pubkey: pk,
  vault: key(b, 8),
  operator: key(b, 40),
  staked: u64(b, 72),
  cooling: u64(b, 88),
  lastUpdateSlot: u64(b, 352),
});
export const decodeVaultNcnTicket = (pk, b, slot, epochLength) => ({
  pubkey: pk, vault: key(b, 8), ncn: key(b, 40),
  state: toggleState(b, 80, slot, epochLength), active: toggleActive(b, 80, slot, epochLength),
});
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

async function rpc(url, method, params) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${JSON.stringify(json.error)}`);
  return json.result;
}
/// `withContext` so every response carries the slot its bank was at. Four independent calls cannot
/// share a bank, and pretending otherwise is what F3 was about.
const accountsOfSize = async (url, programId, dataSize) => {
  const r = await rpc(url, 'getProgramAccounts', [programId, { encoding: 'base64', withContext: true, filters: [{ dataSize }] }]);
  return { slot: r.context.slot, accounts: r.value.map((a) => ({ pubkey: a.pubkey, buf: Buffer.from(a.account.data[0], 'base64') })) };
};

/// Read the live network. The slot is captured alongside so the claim states what it is a snapshot
/// OF, even though no RPC can be asked to serve these accounts as of it again.
export async function snapshot(rpcUrl) {
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

  // Each response is evaluated at the slot its own bank was on. The aggregate is therefore over a
  // RANGE, and the claim says so rather than naming one slot it never had.
  const slots = {
    config: cfgRes.slot, ncn_operator_state: stateRes.slot, tickets_392: ticket392Res.slot,
    vault_operator_delegation: delegationRes.slot, vault_ncn_ticket: vaultNcnRes.slot, vault: vaultRes.slot,
  };
  const values = Object.values(slots);
  const slotMin = Math.min(...values), slotMax = Math.max(...values);
  const at = slotMin; // evaluate every toggle at the OLDEST slot seen: the least generous reading

  const ticket392 = ticket392Res.accounts.map((a) => decodeTicket392(a.pubkey, a.buf, at, epochLength));
  return {
    config, epochLength, slots, slotMin, slotMax, coherent: slotMin === slotMax,
    states: stateRes.accounts.map((a) => decodeNcnOperatorState(a.pubkey, a.buf, at, epochLength)),
    delegations: delegationRes.accounts.map((a) => decodeVaultOperatorDelegation(a.pubkey, a.buf)),
    ncnTickets: vaultNcnRes.accounts.map((a) => decodeVaultNcnTicket(a.pubkey, a.buf, at, epochLength)),
    operatorVaultTickets: ticket392.filter((t) => t.disc === DISC.OPERATOR_VAULT_TICKET),
    ncnVaultTickets: ticket392.filter((t) => t.disc === DISC.NCN_VAULT_TICKET),
    vaults: vaultRes.accounts.map((a) => decodeVault(a.pubkey, a.buf)),
  };
}

/// Every account that fed the graph, by pubkey and decoded value, so a later reader can check each
/// one individually — the only thing that survives `getProgramAccounts` having no slot parameter.
export function manifest(snap) {
  const row = (kind, a, rest) => ({ k: kind, a: a.pubkey, ...rest });
  return [
    ...snap.states.map((a) => row('ncn_operator_state', a, { ncn: a.ncn, op: a.operator, ncnState: a.ncnState, opState: a.operatorState })),
    ...snap.operatorVaultTickets.map((a) => row('operator_vault_ticket', a, { op: a.owner, vault: a.vault, state: a.state })),
    ...snap.ncnVaultTickets.map((a) => row('ncn_vault_ticket', a, { ncn: a.owner, vault: a.vault, state: a.state })),
    ...snap.ncnTickets.map((a) => row('vault_ncn_ticket', a, { vault: a.vault, ncn: a.ncn, state: a.state })),
    ...snap.delegations.map((a) => row('vault_operator_delegation', a, { vault: a.vault, op: a.operator, staked: String(a.staked), cooling: String(a.cooling), lastUpdateSlot: String(a.lastUpdateSlot) })),
    ...snap.vaults.map((a) => row('vault', a, { mint: a.supportedMint })),
  ].sort((x, y) => (x.k === y.k ? (x.a < y.a ? -1 : 1) : x.k < y.k ? -1 : 1));
}

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
  const snap = await snapshot(rpcUrl);
  const graph = buildGraph({ ...snap, terms });
  return buildRestakingClaim({
    subject: { network: 'jito-restaking', chain: 'solana-mainnet' },
    terms: { gamma: terms.gamma, shockPsiBps: terms.shockPsiBps },
    services: graph.services,
    validators: graph.validators,
    source: {
      kind: 'JITO_RESTAKING_SNAPSHOT',
      restaking_program: RESTAKING_PROGRAM,
      vault_program: VAULT_PROGRAM,
      slots: snap.slots,
      slot_min: snap.slotMin,
      slot_max: snap.slotMax,
      coherent: snap.coherent,
      evaluated_at_slot: snap.slotMin,
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

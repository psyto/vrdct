import assert from 'node:assert/strict';
import test from 'node:test';
import * as jito from '../adapters/jito-restaking.mjs';
import { verify } from '../core/verify.mjs';
import { build as buildRestakingClaim } from '../claimtypes/restaking-robustness.mjs';

// Byte layouts are a regression, not a comment: a wrong offset here is a wrong verdict about
// somebody's network. Each buffer below is built to the documented struct and read back.
const acct = (size, writes) => {
  const b = Buffer.alloc(size);
  for (const [off, val] of writes) {
    if (typeof val === 'bigint') b.writeBigUInt64LE(val, off);
    else val.copy(b, off);
  }
  return b;
};
const pk = (seed) => { const b = Buffer.alloc(32); b.writeUInt32LE(seed, 0); b[31] = 1; return b; };
const id = (seed) => jito.b58(pk(seed));

test('base58 round-trips the shapes a pubkey takes', () => {
  assert.equal(jito.b58(Buffer.alloc(32)), '1'.repeat(32));       // all zero → all leading ones
  assert.equal(jito.b58(Buffer.from([0, 0, 1])), '112');
  assert.equal(jito.b58(Buffer.from([255])), '5Q');
  assert.equal(id(7).length >= 32 - 4, true);
});

// Codex, reviews/010 F1. `slot_added > slot_removed` is NOT the state machine: upstream returns
// WarmUp until the current epoch is more than one full epoch past slot_added. Counting a warming-up
// relationship as stake is invented security, which lowers T_v and can turn a real RED into a
// reported GREEN — the one direction that must never be reachable.
test('the SlotToggle state machine is reproduced, warmup and cooldown included', () => {
  const E = 100; // epoch length
  const tog = (added, removed) => acct(32, [[0, BigInt(added)], [8, BigInt(removed)]]);
  const at = (b, slot) => jito.toggleState(b, 0, slot, E);

  // added in epoch 1: WarmUp through epoch 2, Active from epoch 3
  const on = tog(150, 0);
  assert.equal(at(on, 150), jito.TOGGLE.WARM_UP);
  assert.equal(at(on, 250), jito.TOGGLE.WARM_UP, 'still the next epoch');
  assert.equal(at(on, 299), jito.TOGGLE.WARM_UP, 'last slot of epoch 2');
  assert.equal(at(on, 300), jito.TOGGLE.ACTIVE, 'epoch 3 is more than one past epoch 1');
  assert.equal(jito.toggleActive(on, 0, 250, E), false, 'the old predicate would have said true');
  assert.equal(jito.toggleActive(on, 0, 300, E), true);

  // removed later: Cooldown for the same window, then Inactive
  const off = tog(150, 450);
  assert.equal(at(off, 450), jito.TOGGLE.COOLDOWN);
  assert.equal(at(off, 599), jito.TOGGLE.COOLDOWN);
  assert.equal(at(off, 600), jito.TOGGLE.INACTIVE);

  assert.equal(at(tog(100, 100), 900), jito.TOGGLE.INACTIVE, 'equal slots are inactive');
  assert.equal(at(tog(0, 0), 900), jito.TOGGLE.INACTIVE, 'a fresh zeroed toggle is inactive');
});

test('VaultOperatorDelegation decodes at the offsets the size decomposes to', () => {
  // 632 = 8 disc + 32 vault + 32 operator + 280 DelegationState + 8 last_update_slot + 8 index + 1 + 263
  const b = acct(jito.SIZE.VAULT_OPERATOR_DELEGATION, [
    [0, 4n], [8, pk(1)], [40, pk(2)], [72, 123_456n], [80, 7n], [88, 99n], [352, 400_000_000n],
  ]);
  const d = jito.decodeVaultOperatorDelegation('X', b);
  assert.equal(d.vault, id(1));
  assert.equal(d.operator, id(2));
  assert.equal(d.staked, 123_456n);
  assert.equal(d.cooling, 99n);
  assert.equal(d.lastUpdateSlot, 400_000_000n);
});

test('NcnOperatorState needs BOTH sides Active, not merely opted in', () => {
  const E = 100;
  const state = (ncnAdd, ncnRem, opAdd, opRem, slot = 900) => jito.decodeNcnOperatorState('X', acct(jito.SIZE.NCN_OPERATOR_STATE, [
    [0, 4n], [8, pk(10)], [40, pk(11)], [80, ncnAdd], [88, ncnRem], [128, opAdd], [136, opRem],
  ]), slot, E);
  assert.equal(state(200n, 100n, 200n, 100n).active, true);
  assert.equal(state(200n, 100n, 100n, 200n).active, false, 'operator opted out');
  assert.equal(state(100n, 200n, 200n, 100n).active, false, 'ncn opted out');
  assert.equal(state(200n, 100n, 200n, 100n, 250).active, false, 'both still warming up');
  assert.equal(state(200n, 100n, 800n, 100n).active, false, 'one side warming up is enough to stop it');
  assert.equal(state(200n, 100n, 200n, 100n).ncn, id(10));
  assert.equal(state(200n, 100n, 200n, 100n).operator, id(11));
});

test('Config carries the epoch length every toggle is judged against', () => {
  const c = jito.decodeConfig('X', acct(jito.SIZE.CONFIG, [[0, 1n], [72, 16n], [80, 75n], [88, 432000n]]));
  assert.equal(c.ncnCount, 16n);
  assert.equal(c.operatorCount, 75n);
  assert.equal(c.epochLength, 432000n);
});

test('Vault reads supported_mint at 72, which is what made mainnet refusable', () => {
  const v = jito.decodeVault('X', acct(jito.SIZE.VAULT, [[0, 2n], [8, pk(20)], [40, pk(21)], [72, pk(22)]]));
  assert.equal(v.supportedMint, id(22));
});

// ── the reductions ────────────────────────────────────────────────────────────────────────────

const E = 100, SLOT = 900;
const ACTIVE = [[80, 200n], [88, 100n]];
const MINT_A = id(90), MINT_B = id(91);
const vault = (seed, mint) => ({ pubkey: id(seed), supportedMint: mint });
const del = (v, op, staked) => ({ pubkey: 'd', vault: v, operator: op, staked, cooling: 0n, lastUpdateSlot: 0n });
const tick = (v, ncn, active = true) => ({ pubkey: 't', vault: v, ncn, active, state: active ? 'Active' : 'Inactive' });
const ovt = (op, v, active = true) => ({ pubkey: 'o', disc: 5, owner: op, vault: v, active, state: active ? 'Active' : 'Inactive' });
const nvt = (ncn, v, active = true) => ({ pubkey: 'n', disc: 6, owner: ncn, vault: v, active, state: active ? 'Active' : 'Inactive' });
const edge = (ncn, operator) => ({ pubkey: 'e', ncn, operator, active: true, ncnState: 'Active', operatorState: 'Active' });
const NCN1 = id(1), NCN2 = id(2), OP = id(3), V1 = id(4), V2 = id(5);
const baseTerms = (o = {}) => ({
  gamma: { num: 1, den: 10 }, shockPsiBps: 10, numeraire: 'SOL',
  mints: { [MINT_A]: { num: 1, den: 1 } },
  ncns: { [NCN1]: { profit: '1', alpha: { num: 1, den: 3 } }, [NCN2]: { profit: '1', alpha: { num: 1, den: 3 } } },
  ...o,
});
const snap = (o = {}) => ({
  states: [edge(NCN1, OP), edge(NCN2, OP)],
  delegations: [del(V1, OP, 100n), del(V2, OP, 900n)],
  ncnTickets: [tick(V1, NCN1), tick(V1, NCN2), tick(V2, NCN1)],
  operatorVaultTickets: [ovt(OP, V1), ovt(OP, V2)],
  ncnVaultTickets: [nvt(NCN1, V1), nvt(NCN2, V1), nvt(NCN1, V2)],
  vaults: [vault(4, MINT_A), vault(5, MINT_A)],
  ...o,
});

// The load-bearing modelling decision: the paper gives a validator ONE stake that backs every
// service; Jito's stake reaches an NCN only through vaults opted into it. Taking the minimum
// under-states sigma_v, which under-states sigma_N(s) AND the attack cost — both conservative.
test('sigma_v is the least any of the operator\'s NCNs can actually count on', () => {
  const g = jito.buildGraph({ ...snap(), terms: baseTerms() });
  // NCN1 can reach V1+V2 = 1000; NCN2 only V1 = 100. The operator is worth 100, not 1000.
  assert.equal(g.validators.length, 1);
  assert.equal(g.validators[0].stake, '100');
  assert.deepEqual(g.validators[0].services, [NCN1, NCN2].sort());

  // drop the NCN2 edge and the same operator is worth what NCN1 can reach
  const single = jito.buildGraph({ ...snap({ states: [edge(NCN1, OP)] }), terms: baseTerms() });
  assert.equal(single.validators[0].stake, '1000');
});

test('conversion floors, so a converted total is never larger than the truth', () => {
  const g = jito.buildGraph({
    ...snap({ vaults: [vault(4, MINT_A), vault(5, MINT_B)], ncnTickets: [tick(V1, NCN1), tick(V2, NCN1)], states: [edge(NCN1, OP)] }),
    terms: baseTerms({ mints: { [MINT_A]: { num: 1, den: 1 }, [MINT_B]: { num: 1, den: 3 } } }),
  });
  // 100 at 1:1 plus 900 at 1:3 → 100 + 300 = 400; a rounding that went up would flatter the network
  assert.equal(g.validators[0].stake, '400');
  assert.deepEqual(g.mints, [MINT_A, MINT_B].sort());
});

test('it refuses rather than judging: the three ways a snapshot is out of domain', () => {
  const boom = (o, terms, re) => assert.throws(() => jito.buildGraph({ ...snap(o), terms }), (e) => e instanceof jito.OutOfDomain && re.test(e.message));

  // an NCN carrying an active edge with no declared profit/alpha
  boom({}, baseTerms({ ncns: { [NCN1]: { profit: '1', alpha: { num: 1, den: 3 } } } }), /missing π\/α for 1 NCN/);
  // a contributing mint with no declared price — this is what mainnet does today, 17 times over
  boom({ vaults: [vault(4, MINT_A), vault(5, MINT_B)] }, baseTerms(), /1 contributing mint\(s\) have no declared price/);
  // and a graph past the claim-type's input domain is rejected, never truncated
  const wide = Array.from({ length: 33 }, (_, i) => id(1000 + i));
  boom(
    { states: wide.map((n) => edge(n, OP)), ncnTickets: wide.map((n) => tick(V1, n)) },
    baseTerms({ ncns: Object.fromEntries(wide.map((n) => [n, { profit: '1', alpha: { num: 1, den: 3 } }])) }),
    /past the claim-type's 32/,
  );
});

test('a graph from the adapter produces a claim the engine verifies', () => {
  const g = jito.buildGraph({ ...snap(), terms: baseTerms() });
  const claim = buildRestakingClaim({
    subject: { network: 'jito-restaking', chain: 'solana-mainnet' },
    terms: { gamma: { num: 1, den: 10 }, shockPsiBps: 10 },
    services: g.services, validators: g.validators, source: { kind: 'TEST' },
  });
  assert.equal(verify(claim).ok, true);
  assert.equal(claim.computation.services, 2);
  assert.equal(claim.computation.validators, 1);
});

// Codex, reviews/010 F1. Jito's active-stake relationship has five parties. The first version read
// three, so a delegation missing either bilateral ticket was counted anyway — invented security.
test('every one of the four relationships is required, and any missing one removes the stake', () => {
  const full = jito.buildGraph({ ...snap({ states: [edge(NCN1, OP)] }), terms: baseTerms() });
  assert.equal(full.validators[0].stake, '1000'); // V1 100 + V2 900, all four sides present

  const without = (o) => jito.buildGraph({ ...snap({ states: [edge(NCN1, OP)], ...o }), terms: baseTerms() }).validators[0].stake;
  assert.equal(without({ operatorVaultTickets: [ovt(OP, V1)] }), '100', 'no operator→vault for V2');
  assert.equal(without({ ncnVaultTickets: [nvt(NCN1, V1)] }), '100', 'no ncn→vault for V2');
  assert.equal(without({ ncnTickets: [tick(V1, NCN1)] }), '100', 'no vault→ncn for V2');
  assert.equal(without({ operatorVaultTickets: [ovt(OP, V1, false), ovt(OP, V2)] }), '900', 'a ticket that exists but is not Active');
  assert.equal(without({ operatorVaultTickets: [], ncnVaultTickets: [] }), '0', 'nothing active at all');
});

// Codex, reviews/010 F2. The claim used to commit the CONVERTED stake and only the words
// "DECLARED, not sourced" — so a number that looks sourced rested on a judgement nobody could see.
test('the declared prices and NCN terms are pinned in the claim, not pointed at', () => {
  const g = jito.buildGraph({ ...snap(), terms: baseTerms() });
  const mk = (mints) => buildRestakingClaim({
    subject: { network: 'jito-restaking', chain: 'solana-mainnet' },
    terms: { gamma: { num: 1, den: 10 }, shockPsiBps: 10 },
    services: g.services, validators: g.validators,
    source: { kind: 'T', declared: { numeraire: 'SOL', mint_prices: mints, ncn_terms: {} } },
  });
  const a = mk({ [MINT_A]: { num: 1, den: 1 } });
  assert.deepEqual(a.inputs.observed.source.declared.mint_prices, { [MINT_A]: { num: 1, den: 1 } });

  // and the price is part of what the claim id commits to: change it, change the claim
  const b = mk({ [MINT_A]: { num: 2, den: 1 } });
  assert.notEqual(b.claim_id, a.claim_id, 'a declared price must not be able to move without moving the claim');
});

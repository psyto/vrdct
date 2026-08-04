// Vrdct — end-to-end demo: build a claim → verify → resolve a market → settle the bond.
// Offline, zero-dep. `node demo.mjs`
import './claimtypes/solvency.mjs'; // registers the reserve-solvency claim-type
import { build } from './claimtypes/solvency.mjs';
import { verify } from './core/verify.mjs';
import { resolve } from './core/resolution.mjs';
import { settle } from './core/bond.mjs';

// A real re-computation snapshot (Marinade mSOL, epoch 1004).
const claim = build({
  subject: { protocol: 'Marinade', asset: 'mSOL', chain: 'solana', stateAccount: '8szGkuLTAux9XMgZ2vtY39jVSowEcpBfFfD8hXSEqdGC' },
  window: { epoch: 1004 },
  quantities: { virtualValue: '2383199200198962', liability: '2383199196106081', staleRecords: 0, inv2b_ok: true },
});
const E = { GREEN: '🟢', YELLOW: '🟡', RED: '🔴', STALE: '🟡' };

console.log(`\nVrdct — claim → verify → resolve → bond\n`);
console.log(`1) claim  ${E[claim.verdict.flag]} ${claim.verdict.flag}  ${claim.claim_id}  (${claim.claim_type})`);

const v = verify(claim);
console.log(`2) verify  ${v.ok ? '✅ reproduces' : '❌ fails'}  (${v.checks.length} checks)`);

const r = resolve(claim, { market: 'Is Marinade (mSOL) solvent — recomputed backing ≥ liability, no stale records?', yesWhen: ['GREEN'] });
console.log(`3) resolve  market → ${r.resolved === 'YES' ? '✅ YES' : '❌ NO'}  (reproduces: ${r.reproduces})`);

const s = settle(claim, { resolverBond: 1.0, challengeBond: 1.0 });
console.log(`4) bond  a challenger disputes the honest resolution → ${s.outcome}`);
console.log(`         balances: resolver ${s.balances.resolver >= 0 ? '+' : ''}${s.balances.resolver}, challenger ${s.balances.challenger}, treasury +${s.balances.treasury}`);
console.log(`\n   The correct side captured the stake; the referee was re-execution. Re-run to reproduce.\n`);

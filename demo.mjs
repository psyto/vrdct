// Vrdct — end-to-end demo: two DIFFERENT surfaces resolve through the ONE engine.
// Offline, zero-dep. `node demo.mjs`
import * as solvency from './claimtypes/solvency.mjs';               // registers reserve-solvency
import * as cmls from './claimtypes/closed-market-soundness.mjs';    // registers closed-market-liquidation-soundness
import { verify } from './core/verify.mjs';
import { resolve } from './core/resolution.mjs';
import { settle } from './core/bond.mjs';
import { claimTypes } from './core/claim.mjs';

const E = { GREEN: '🟢', YELLOW: '🟡', RED: '🔴', STALE: '🟡', UNKNOWN: '❓' };
const line = (n, s) => console.log(`  ${n}) ${s}`);

console.log(`\nVrdct — 1 engine × N surfaces. registered claim-types: ${claimTypes().join(', ')}\n`);

// ── Surface 1: reserve solvency (Redde lineage) — real Marinade snapshot ──────
const sol = solvency.build({
  subject: { protocol: 'Marinade', asset: 'mSOL', chain: 'solana' }, window: { epoch: 1004 },
  quantities: { virtualValue: '2383199200198962', liability: '2383199196106081', staleRecords: 0, inv2b_ok: true },
});
console.log(`SURFACE 1 · reserve-solvency`);
line(1, `claim   ${E[sol.verdict.flag]} ${sol.verdict.flag}  ${sol.claim_id}`);
line(2, `verify  ${verify(sol).ok ? '✅ reproduces' : '❌ fails'}`);
line(3, `resolve "Is Marinade solvent?" → ${resolve(sol, { market: 'Is Marinade (mSOL) solvent?', yesWhen: ['GREEN'] }).resolved}`);

// ── Surface 2: closed-market soundness (Vesper lineage) — illustrative obs ─────
const U = (iso) => Math.floor(Date.parse(iso) / 1000);
const obs = [0, 2, 4, 6, 8].map((m) => ({ sig: `SYNTH${m}`, slot: 400000000 + m, blockTime: U('2026-08-01T16:00:00Z') + m * 120 })); // Sat = CLOSED, 2-min apart
const cm = cmls.build({ subject: { venue: 'IllustrativeVenue', asset: 'SPYx', chain: 'solana', priceAccount: 'Synth1111111111111111111111111111111111111' }, window: { from_ts: obs[0].blockTime, to_ts: obs[obs.length - 1].blockTime }, observations: obs });
console.log(`\nSURFACE 2 · closed-market-liquidation-soundness  (illustrative closed-weekend obs)`);
line(1, `claim   ${E[cm.verdict.flag]} ${cm.verdict.flag}  ${cm.claim_id}  (${cm.computation.closedUpdates} updates while CLOSED)`);
line(2, `verify  ${verify(cm).ok ? '✅ reproduces' : '❌ fails'}`);
line(3, `resolve "Does the venue liquidate soundly across the closed window?" → ${resolve(cm, { market: 'Does the venue liquidate SPYx soundly across the closed-market window?', yesWhen: ['GREEN'] }).resolved}`);

// ── The bond hook (on the solvency resolution) ────────────────────────────────
const s = settle(sol, { resolverBond: 1.0, challengeBond: 1.0 });
console.log(`\nBOND · a challenger disputes the honest solvency resolution → ${s.outcome}`);
console.log(`       balances: resolver ${s.balances.resolver >= 0 ? '+' : ''}${s.balances.resolver}, challenger ${s.balances.challenger}, treasury +${s.balances.treasury}`);
console.log(`\n  Two unrelated surfaces, one engine, each resolution reproducible; the correct side captures the stake.\n`);

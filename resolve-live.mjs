// Vrdct — resolve a REAL on-chain-state condition with live chain data, and mint it to the public
// corpus. This fires a standard-scale signal: a reproducible market resolution on real data, not a
// synthetic demo. Anyone re-runs verify against the embedded observations and gets the same answer.
//
//   node resolve-live.mjs
import './claimtypes/closed-market-soundness.mjs'; // register
import { build } from './claimtypes/closed-market-soundness.mjs';
import { verify } from './core/verify.mjs';
import { resolve } from './core/resolution.mjs';
import { fetchObservations } from './core/rpc.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const RPC = process.env.RPC || 'https://api.mainnet-beta.solana.com';
const ACCT = 'A2GDb4Um4Tr42iKgPz5fQ2d7pYTnaUuHN3d5V41Cywff'; // Jupiter Lend SPYx pushed price (24/7)
const MARKET = 'Does Jupiter Lend liquidate SPYx soundly across the closed-market weekend window — does a market-status guard prevent liquidation against a price the regulated US market never printed?';

const now = Math.floor(Date.now() / 1000), from = now - 84 * 3600;
console.log(`\nVrdct — resolving a live on-chain-state condition\n  ${MARKET}\n  RPC: ${RPC}\n`);
const observations = await fetchObservations(RPC, ACCT, { from, to: now });
if (!observations.length) { console.error('  no observations (RPC blocked / no data).\n'); process.exit(1); }
const bt = observations.map((o) => o.blockTime).sort((a, b) => a - b);
const window = { from_ts: bt[0], to_ts: bt[bt.length - 1], from_iso: new Date(bt[0] * 1000).toISOString(), to_iso: new Date(bt[bt.length - 1] * 1000).toISOString() };

const claim = build({ subject: { venue: 'Jupiter Lend', asset: 'SPYx', chain: 'solana', priceAccount: ACCT }, window, observations });
const v = verify(claim);
const r = resolve(claim, { market: MARKET, yesWhen: ['GREEN'] });

mkdirSync(new URL('./corpus/', import.meta.url), { recursive: true });
writeFileSync(new URL('./corpus/jupiter-spyx-cmls.claim.json', import.meta.url), JSON.stringify(claim, null, 2) + '\n');
writeFileSync(new URL('./corpus/jupiter-spyx-cmls.resolution.json', import.meta.url), JSON.stringify(r, null, 2) + '\n');

const E = { GREEN: '🟢', YELLOW: '🟡', RED: '🔴', UNKNOWN: '❓' };
console.log(`  ${E[claim.verdict.flag]} claim ${claim.verdict.flag} · ${claim.computation.updates} updates (${claim.computation.closedUpdates} while CLOSED, max gap ${claim.computation.maxGapMin} min)`);
console.log(`  verify: ${v.ok ? '✅ reproduces' : '❌ fails'}`);
console.log(`  RESOLVED: market → ${r.resolved === 'YES' ? '✅ YES' : '❌ NO'}   (claim_id ${claim.claim_id})`);
console.log(`  written: corpus/jupiter-spyx-cmls.{claim,resolution}.json`);
console.log(`\n  reproduce: load the claim and run verify — same answer, offline.\n`);

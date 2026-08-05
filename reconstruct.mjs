// Vrdct — re-derive a claim's pinned inputs from public chain data, and confirm they land on the
// committed `inputs_hash`.
//
//   node reconstruct.mjs corpus/jupiter-spyx-cmls.claim.json
//
// `verify` answers "does this claim re-execute to the verdict it states?" — but it re-executes the
// inputs the claim *carries*. This tool answers the question a would-be challenger actually has:
//
//     "Where did those inputs come from, and would I get the same ones?"
//
// For `closed-market-liquidation-soundness` the answer is that the input set is a pure function of
// (price account, window): every successful signature on that account in that time range, ordered by
// (slot, sig). So anyone with an RPC can rebuild it and check the commitment themselves — nobody has
// to be handed the observation list, and nobody has to trust whoever published it.
//
// That is what makes a permissionless challenge possible at all. Bonding against a resolver you
// cannot check is not a market, it is a coin flip. Measured limit: this depends on the RPC still
// serving signature history for the window — see README "Honest scope".
import { readFileSync } from 'node:fs';
import { fetchObservations } from './core/rpc.mjs';
import { inputsCommitment } from './core/encode.mjs';
import { verify } from './core/verify.mjs';
import './claimtypes/closed-market-soundness.mjs'; // register
import './claimtypes/solvency.mjs';

const RPC = process.env.RPC || 'https://api.mainnet-beta.solana.com';
const path = process.argv[2] || 'corpus/jupiter-spyx-cmls.claim.json';
const claim = JSON.parse(readFileSync(new URL(path, import.meta.url)));

if (claim.claim_type !== 'closed-market-liquidation-soundness') {
  console.error(`\n  ${claim.claim_type} inputs are not chain-reconstructible by this tool.`);
  console.error('  Only claim-types whose inputs are a pure function of public chain state qualify.\n');
  process.exit(2);
}

const account = claim.inputs.observed.account;
const { from_ts, to_ts, from_iso, to_iso } = claim.inputs.window;
const pinned = claim.inputs.observed.observations;

console.log(`\nVrdct — reconstructing a claim's inputs from chain\n`);
console.log(`  claim     ${claim.claim_id}  (${claim.verdict.flag})`);
console.log(`  account   ${account}`);
console.log(`  window    ${from_iso} → ${to_iso}`);
console.log(`  pinned    ${pinned.length} observations`);
console.log(`  RPC       ${RPC}\n  re-fetching…`);

const t0 = Date.now();
const fresh = await fetchObservations(RPC, account, { from: from_ts, to: to_ts });
console.log(`  fetched   ${fresh.length} observations in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
if (!fresh.length) {
  console.error('  no observations — the RPC is rate-limiting, or its signature history no longer');
  console.error('  reaches this window. Reconstruction is bounded by RPC retention.\n');
  process.exit(1);
}

const key = (o) => `${o.slot}:${o.sig}`;
const F = new Set(fresh.map(key)), P = new Set(pinned.map(key));
const missing = pinned.filter((o) => !F.has(key(o)));
const extra = fresh.filter((o) => !P.has(key(o)));

// The commitment is the only thing that decides a payout, so it is the only comparison that counts.
const rebuilt = { ...claim, inputs: { ...claim.inputs, observed: { ...claim.inputs.observed, count: fresh.length, observations: fresh } } };
const pinnedHash = inputsCommitment(claim).inputsHash.toString('hex');
let rebuiltHash;
try { rebuiltHash = inputsCommitment(rebuilt).inputsHash.toString('hex'); } catch (e) { rebuiltHash = `rejected: ${e.message}`; }
const same = pinnedHash === rebuiltHash;

console.log(`  set match ${missing.length === 0 && extra.length === 0 ? '✅ identical' : `❌ missing ${missing.length}, extra ${extra.length}`}`);
console.log(`  pinned    inputs_hash ${pinnedHash}`);
console.log(`  rebuilt   inputs_hash ${rebuiltHash}`);
console.log(`  verify    ${verify(claim).ok ? '✅ the claim re-executes to its stated verdict' : '❌ fails'}`);
console.log(`\n  ${same ? '✅ The inputs are sourced, not just pinned — anyone with an RPC rebuilds this exact\n     commitment and can bond against the resolver knowing what they are checking.'
  : '❌ Reconstruction diverged. Do not bond against this market until the difference is explained.'}\n`);
process.exit(same ? 0 : 1);

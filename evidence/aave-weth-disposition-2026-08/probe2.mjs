// Probe 2: follow the borrowed WETH OUT of the borrower. Probe 1 established that what the borrower
// RECEIVES is dominated by Aave's own debt token and cannot carry disposition. This one names no
// category in advance either — it groups WETH-contract log shapes and prints where the WETH went.
const RPC = process.env.ETH_RPC ?? 'https://eth.drpc.org';
const POOL = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2';
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const BORROW = '0xb3d084820fb1a9decffb176436bd02558d15fac9b0ddfed8c465bc7359d7dce0';
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

let calls = 0;
async function rpc(method, params, tries = 5) {
  // The free plan times out intermittently on queries it served a minute earlier, so a failure here
  // is not evidence about the chain. Retry with backoff and say so rather than reporting a gap.
  for (let attempt = 1; ; attempt++) {
    calls++;
    try {
      const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: calls, method, params }) });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message);
      return j.result;
    } catch (error) {
      if (attempt >= tries) throw new Error(`${method} failed after ${tries} attempts: ${error.message}`);
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
}
const hex = (n) => '0x' + n.toString(16);
const addr = (t) => '0x' + t.slice(26).toLowerCase();
const eth = (b) => (Number(b) / 1e18).toFixed(3);

const latest = parseInt(await rpc('eth_blockNumber', []), 16);
const SPAN = Number(process.env.SPAN ?? 2000);
const from = latest - SPAN;
const logs = await rpc('eth_getLogs', [{ address: POOL, fromBlock: hex(from), toBlock: hex(latest),
  topics: [BORROW, '0x' + WETH.slice(2).padStart(64, '0')] }]);
console.log(`window ${from}..${latest}   WETH borrows: ${logs.length}\n`);

const wethShapes = new Map();   // topic0 -> {n, topics, dataWords}
const outcomes = new Map();
for (const log of logs.slice(0, Number(process.env.MAX ?? 20))) {
  // Borrow(reserve indexed, user, onBehalfOf indexed, amount, rateMode, rate, referral indexed).
  // The FUNDS go to `user`, which is data word 0. `onBehalfOf` (topics[2]) is only whose debt it is.
  // Probe 2's first run followed onBehalfOf and concluded 12/12 'never left the borrower', which
  // contradicted probe 1 — the contradiction was the bug, not the finding.
  const borrower = addr('0x' + log.data.slice(2, 2 + 64));
  const onBehalfOf = addr(log.topics[2]);
  const amount = BigInt('0x' + log.data.slice(2 + 64, 2 + 128));
  const rcpt = await rpc('eth_getTransactionReceipt', [log.transactionHash]);

  const wethLogs = rcpt.logs.filter((l) => l.address.toLowerCase() === WETH);
  for (const l of wethLogs) {
    const k = l.topics[0];
    const e = wethShapes.get(k) ?? { n: 0, topics: l.topics.length, words: (l.data.length - 2) / 64 };
    e.n++; wethShapes.set(k, e);
  }
  // WETH leaving the borrower, and any WETH-contract event whose first indexed party is the borrower
  const out = wethLogs.filter((l) => l.topics[0] === TRANSFER && l.topics.length > 2 && addr(l.topics[1]) === borrower);
  const nonTransfer = wethLogs.filter((l) => l.topics[0] !== TRANSFER && l.topics.length > 1 && addr(l.topics[1]) === borrower);
  const dests = out.map((l) => addr(l.topics[2]));
  const shape = out.length === 0 && nonTransfer.length === 0 ? 'WETH never left the borrower'
    : out.length === 0 ? `no Transfer out, but ${nonTransfer.length} other WETH event(s) on the borrower`
      : `sent to ${dests.length} address(es)`;
  outcomes.set(shape, (outcomes.get(shape) ?? 0) + 1);
  console.log(`  ${log.transactionHash.slice(0, 12)}  ${eth(amount).padStart(8)} WETH  ${shape}${borrower === onBehalfOf ? '' : '   (user != onBehalfOf)'}`);
  for (const d of dests) console.log(`        -> ${d}`);
  for (const l of nonTransfer) console.log(`        ! ${l.topics[0].slice(0, 12)}  topics=${l.topics.length} words=${(l.data.length - 2) / 64}`);
}
console.log('\n--- WETH-contract log shapes seen (topic0, arity) ---');
for (const [k, e] of [...wethShapes].sort((a, b) => b[1].n - a[1].n)) console.log(`  ${e.n.toString().padStart(3)}x  ${k.slice(0, 18)}…  topics=${e.topics} words=${e.words}`);
console.log('\n--- outcomes ---');
for (const [k, n] of [...outcomes].sort((a, b) => b[1] - a[1])) console.log(`  ${n}x  ${k}`);
console.log(`\nrpc calls: ${calls}`);

// Probe, not a claim-type: what does a WETH borrow on Aave v3 mainnet actually DO in its own
// transaction? Written before any classifier, because a category invented in advance is a category
// the data gets forced into.
const RPC = process.env.ETH_RPC ?? 'https://eth.drpc.org';
const POOL = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2';
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const BORROW = '0xb3d084820fb1a9decffb176436bd02558d15fac9b0ddfed8c465bc7359d7dce0';
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

let calls = 0;
async function rpc(method, params) {
  calls++;
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: calls, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}
const hex = (n) => '0x' + n.toString(16);
const addrOf = (topic) => '0x' + topic.slice(26);

const latest = parseInt(await rpc('eth_blockNumber', []), 16);
const SPAN = Number(process.env.SPAN ?? 2000);
const from = latest - SPAN;

// topic1 = reserve (indexed). Filter to WETH borrows only.
const logs = await rpc('eth_getLogs', [{ address: POOL, fromBlock: hex(from), toBlock: hex(latest),
  topics: [BORROW, '0x' + WETH.slice(2).toLowerCase().padStart(64, '0')] }]);

console.log(`window ${from}..${latest} (${SPAN} blocks)`);
console.log(`WETH Borrow events: ${logs.length}`);
if (logs.length === 0) process.exit(0);

const seen = new Map();
for (const log of logs.slice(0, Number(process.env.MAX ?? 25))) {
  const onBehalfOf = addrOf(log.topics[2]);
  const amount = BigInt('0x' + log.data.slice(2 + 64, 2 + 128));
  const receipt = await rpc('eth_getTransactionReceipt', [log.transactionHash]);
  const tokens = new Map();
  for (const l of receipt.logs) {
    if (l.topics[0] !== TRANSFER || l.topics.length < 3) continue;
    const to = addrOf(l.topics[2]);
    if (to !== onBehalfOf) continue;              // what the borrower RECEIVED in this tx
    tokens.set(l.address.toLowerCase(), (tokens.get(l.address.toLowerCase()) ?? 0) + 1);
  }
  const key = [...tokens.keys()].sort().join(',') || '(nothing received by the borrower)';
  seen.set(key, (seen.get(key) ?? 0) + 1);
  console.log(`  ${log.transactionHash.slice(0, 12)}  borrowed ${(Number(amount) / 1e18).toFixed(3)} WETH  logs=${receipt.logs.length}  received: ${key}`);
}
console.log('\n--- shapes ---');
for (const [k, n] of [...seen].sort((a, b) => b[1] - a[1])) console.log(`  ${n}x  ${k}`);
console.log(`\nrpc calls: ${calls}`);

// Re-runs every on-chain measurement in this directory's README, from public data only.
//
//   node probe.mjs [--blocks 600000]
//
// Zero dependencies, one RPC. Everything it prints is a direct RPC answer or a count of
// RPC answers; nothing here is inferred. What the numbers do and do not establish is
// argued in README.md, not here.

const RPC = process.env.ARB_RPC ?? 'https://arb1.arbitrum.io/rpc';
const USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'; // native USDC on Arbitrum One

// The four addresses Variational publishes at docs.variational.io/technical-documentation/
// mainnet-contracts, under the heading "Mainnet Contracts", with the names it gives them.
const PUBLISHED = [
  ['Protocol Treasury', '0x5e91b40467fb8902c46a7b6cb90482363188d645'],
  ['Core OLP Vault', '0x74bbbb0e7f0bad6938509dd4b556a39a4db1f2cd'],
  ['Settlement Pool Factory', '0x0F820B9afC270d658a9fD7D16B1Bdc45b70f074C'],
  ['Oracle Contract', '0x84BE56470d45b7f6629A66A219a38681F6BA6172'],
];

// Resolved against api.openchain.xyz/signature-database, each with hasVerifiedContract: true.
const SIGNATURES = {
  '0x4a3129464c3bef589740fdd0e7faf83552f717ecb1db94a73029fc24ce1e3307':
    'FeeBatchProcessed((uint128,uint256,uint128)[],(uint128,string)[])',
  '0xdd1970ff01eb96a1fe75426a8e12aaf9305395fd62c4b0a8e2f2f7564f9529a6':
    'WithdrawalsProcessed(address,uint128[],(uint128,string)[])',
  '0xaee17f268cfda6c6787f3e0e75b314686950a24b91678e628274c9f73cdccb3c':
    'OLPToPoolTransfer(address,address,uint128,uint256,uint128,uint128)',
  '0x0b33722ea9d97f05fb7128e0987e4060c182350308a3d0a19f8ec53512fe1493':
    'PoolCreated(address,address[],uint128,address,uint128,uint128,address,uint256)',
};

let id = 0;
async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

const hex = (n) => '0x' + n.toString(16);

async function usdcBalance(addr) {
  const data = '0x70a08231' + addr.toLowerCase().replace('0x', '').padStart(64, '0');
  return BigInt(await rpc('eth_call', [{ to: USDC, data }, 'latest'])) / 1_000_000n;
}

const argBlocks = Number(
  process.argv.includes('--blocks') ? process.argv[process.argv.indexOf('--blocks') + 1] : 600000,
);

const head = Number(await rpc('eth_blockNumber', []));
const headBlock = await rpc('eth_getBlockByNumber', [hex(head), false]);
const headTs = Number(headBlock.timestamp);
console.log(`chain head   block ${head}  ts ${headTs}  ${new Date(headTs * 1000).toISOString()}`);

// Sampled block rate, so the scanned span can be reported in hours without assuming one.
const older = await rpc('eth_getBlockByNumber', [hex(head - 100000), false]);
const secPerBlock = (headTs - Number(older.timestamp)) / 100000;
console.log(`block rate   ${secPerBlock.toFixed(4)} s/block (sampled over 100000 blocks)\n`);

console.log('--- the four published addresses -------------------------------------------');
for (const [name, addr] of PUBLISHED) {
  const code = await rpc('eth_getCode', [addr, 'latest']);
  const size = code === '0x' ? 0 : (code.length - 2) / 2;
  const nonce = Number(await rpc('eth_getTransactionCount', [addr, 'latest']));
  const usdc = await usdcBalance(addr);
  console.log(
    `${name.padEnd(24)} ${addr}  code=${String(size).padStart(6)}B  ` +
      `nonce=${String(nonce).padEnd(8)} USDC=${usdc.toLocaleString('en-US')}`,
  );
}

console.log('\n--- every event topic each contract emitted, over the scanned span ---------');
for (const [name, addr] of PUBLISHED) {
  const code = await rpc('eth_getCode', [addr, 'latest']);
  if (code === '0x') {
    console.log(`\n${name}: no code, so no events by construction.`);
    continue;
  }
  const chunk = 20000;
  const tally = new Map();
  let scanned = 0;
  let to = head;
  let total = 0;
  while (scanned < argBlocks) {
    const from = to - chunk;
    const logs = await rpc('eth_getLogs', [{ address: addr, fromBlock: hex(from), toBlock: hex(to) }]);
    for (const l of logs) tally.set(l.topics[0], (tally.get(l.topics[0]) ?? 0) + 1);
    total += logs.length;
    scanned += chunk;
    to = from;
  }
  const hours = ((scanned * secPerBlock) / 3600).toFixed(1);
  console.log(`\n${name} ${addr}`);
  console.log(`  ${scanned} blocks (~${hours} h), ${total} logs, ${tally.size} distinct topics`);
  for (const [topic, count] of [...tally].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(7)}  ${topic}`);
    console.log(`           ${SIGNATURES[topic] ?? '<signature unresolved>'}`);
  }
}

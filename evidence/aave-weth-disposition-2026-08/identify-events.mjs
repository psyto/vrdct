// Identify the WETH wrap/unwrap events WITHOUT a recalled constant.
//
// Two WETH log shapes are indistinguishable by arity — both are `topics=2, words=1`, one indexed
// party and one value. Getting them backwards would invert every disposition verdict, so they are
// identified by behaviour: the WETH contract's own ETH balance rises by exactly the wrapped amount
// and falls by exactly the unwrapped amount, so for each block
//
//     balance(block) - balance(block-1)  ==  sum(Deposit) - sum(Withdrawal)
//
// Run over blocks where the two sums differ; the assignment that reproduces the delta is the answer.
// Observed 10/10 agreement, including blocks with double-digit ETH flows.
const RPC = process.env.ETH_RPC;
if (!RPC) { console.error('ETH_RPC is not set'); process.exit(1); }
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const A = '0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65';
const B = '0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c';
const hex = (n) => '0x' + n.toString(16);
const call = async (m, p) => {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: m, params: p }) });
      const j = JSON.parse(await r.text());
      if (j.error) throw new Error(j.error.message);
      return j.result;
    } catch (e) { if (i >= 6) throw e; await new Promise((r) => setTimeout(r, 500 * i * i)); }
  }
};
const latest = parseInt(await call('eth_blockNumber', []), 16);
const logs = await call('eth_getLogs', [{ address: WETH, fromBlock: hex(latest - 9), toBlock: hex(latest) }]);
let votesA = 0, votesB = 0;
for (const bn of [...new Set(logs.map((l) => parseInt(l.blockNumber, 16)))].sort()) {
  const inBlock = logs.filter((l) => parseInt(l.blockNumber, 16) === bn);
  const sum = (t) => inBlock.filter((l) => l.topics[0] === t).reduce((a, l) => a + BigInt(l.data), 0n);
  const sA = sum(A), sB = sum(B);
  if (sA === sB) continue;
  const delta = BigInt(await call('eth_getBalance', [WETH, hex(bn)])) - BigInt(await call('eth_getBalance', [WETH, hex(bn - 1)]));
  if (sB - sA === delta && sA - sB !== delta) votesB++;
  else if (sA - sB === delta && sB - sA !== delta) votesA++;
}
console.log(`A=${A.slice(0, 12)}…  is-Deposit votes: ${votesA}`);
console.log(`B=${B.slice(0, 12)}…  is-Deposit votes: ${votesB}`);
console.log(votesB > votesA ? 'B is Deposit (wrap), A is Withdrawal (unwrap)' : 'A is Deposit (wrap), B is Withdrawal (unwrap)');

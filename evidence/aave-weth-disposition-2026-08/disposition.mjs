// Run the classifier over collected borrows. Two modes, and the order between them is the point:
//
//   --survey   classify with a WETH-only rule set and report WHICH tokens borrowers actually gained.
//              Run this FIRST. The list of what counts as ETH-denominated is a declaration, and a
//              declaration written from memory is how an address nobody checked ends up deciding a
//              published number. The survey makes the data propose the candidates; a human pins them.
//   (default)  classify with the pinned rule set in rules.json and aggregate.
//
// Reads borrows.json, which may be a partial scan. A partial input produces an output labelled
// partial — `complete` is carried through, never assumed.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { classify, ruleSet, VERDICT } from './classify.mjs';

const RPC = process.env.ETH_RPC;
if (!RPC) { console.error('ETH_RPC is not set'); process.exit(1); }
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const DEBT = '0xea51d7853eefb32b6ee06b1c12e6dcca88be0ffe';
const SURVEY = process.argv.includes('--survey');
const SAMPLE = Number(process.env.SAMPLE ?? 0);
const PARALLEL = Number(process.env.PARALLEL ?? 4);   // modest: the scan holds the same key

let calls = 0;
async function rpc(method, params, tries = 6) {
  for (let attempt = 1; ; attempt++) {
    calls++;
    try {
      const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: calls, method, params }) });
      const j = JSON.parse(await r.text());
      if (j.error) throw new Error(j.error.message);
      return j.result;
    } catch (e) {
      if (attempt >= tries) throw new Error(`${method}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 400 * attempt * attempt));
    }
  }
}

const scan = JSON.parse(readFileSync('borrows.json', 'utf8'));
let borrows = scan.borrows;
if (SAMPLE && SAMPLE < borrows.length) {
  // Evenly spaced rather than the first N: the head of the window is one stretch of market, and a
  // contiguous slice would be a claim about that stretch wearing the window's label.
  const step = borrows.length / SAMPLE;
  borrows = Array.from({ length: SAMPLE }, (_, i) => borrows[Math.floor(i * step)]);
}
console.log(`scan ${scan.from}..${scan.to} complete=${scan.complete}, ${scan.borrows.length} borrows, classifying ${borrows.length}`);

const rules = SURVEY
  ? ruleSet({ ethDenominated: [WETH] })
  : ruleSet({ ethDenominated: JSON.parse(readFileSync('rules.json', 'utf8')).ethDenominated.map((t) => t.address) });

const receipts = new Map();
for (let i = 0; i < borrows.length; i += PARALLEL) {
  const chunk = borrows.slice(i, i + PARALLEL);
  const got = await Promise.all(chunk.map((b) => rpc('eth_getTransactionReceipt', [b.tx])));
  chunk.forEach((b, k) => receipts.set(b.tx, got[k]));
  if (i % 40 === 0) process.stderr.write(`  ${i}/${borrows.length}\r`);
}

const tally = new Map(), amounts = new Map(), gainedTokens = new Map();
const examples = new Map();
for (const b of borrows) {
  const logs = receipts.get(b.tx)?.logs ?? [];
  const r = classify({ user: b.user, amount: b.amount, logs, weth: WETH, rules, debtToken: DEBT });
  tally.set(r.verdict, (tally.get(r.verdict) ?? 0) + 1);
  amounts.set(r.verdict, (amounts.get(r.verdict) ?? 0n) + BigInt(b.amount));
  if (!examples.has(r.verdict)) examples.set(r.verdict, { tx: b.tx, detail: r.detail });
  if (r.verdict === VERDICT.LEFT_ETH) {
    for (const t of r.detail.split(',')) gainedTokens.set(t, (gainedTokens.get(t) ?? 0) + 1);
  }
}

const eth = (v) => (Number(v) / 1e18).toFixed(1);
const total = borrows.length, totalWei = borrows.reduce((a, b) => a + BigInt(b.amount), 0n);
console.log(`\n--- verdicts over ${total} borrows (${eth(totalWei)} WETH) ---`);
for (const v of Object.values(VERDICT)) {
  const n = tally.get(v) ?? 0;
  if (!n) continue;
  console.log(`  ${v.padEnd(12)} ${String(n).padStart(4)}  ${(100 * n / total).toFixed(1).padStart(5)}%   ${eth(amounts.get(v) ?? 0n).padStart(9)} WETH  eg ${examples.get(v).tx.slice(0, 12)}`);
}
if (SURVEY) {
  console.log('\n--- tokens borrowers gained, under a WETH-ONLY rule set ---');
  console.log('    (candidates for the declared ETH-denominated list; NOT yet a decision)');
  for (const [t, n] of [...gainedTokens].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`  ${String(n).padStart(4)}x  ${t}`);
}
console.log(`\nrpc calls: ${calls}`);

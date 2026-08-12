// Collect every Aave v3 mainnet WETH Borrow event over a window. Raw data only: this step makes no
// classification choice, so it does not have to be re-run when the classifier changes.
//
// Alchemy's free tier caps eth_getLogs at a 10-block range, so the window is walked in 10-block
// steps with bounded concurrency. Progress is checkpointed after every chunk: a run that dies
// resumes instead of starting over, and a partial file is never mistaken for a complete one — it
// carries `complete: false` until the last block is in.
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';

const RPC = process.env.ETH_RPC;
if (!RPC) { console.error('ETH_RPC is not set'); process.exit(1); }
const POOL = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2';
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const BORROW = '0xb3d084820fb1a9decffb176436bd02558d15fac9b0ddfed8c465bc7359d7dce0';
const STEP = 10;            // the free-tier eth_getLogs range
const PARALLEL = Number(process.env.PARALLEL ?? 4);
const OUT = 'borrows.json';

const hex = (n) => '0x' + n.toString(16);
const addr = (t) => '0x' + t.slice(26).toLowerCase();
let calls = 0;
async function rpc(method, params, tries = 14) {
  for (let attempt = 1; ; attempt++) {
    calls++;
    try {
      const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: calls, method, params }) });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message);
      return j.result;
    } catch (e) {
      if (attempt >= tries) throw new Error(`${method}: ${e.message}`);
      // An empty body or a 429 is the provider throttling, not a fact about the chain. Back off
      // hard and keep going: the first run died after six quick retries and lost four hours.
      await new Promise((r) => setTimeout(r, Math.min(30000, 400 * attempt * attempt) + Math.random() * 500));
    }
  }
}

const latest = parseInt(await rpc('eth_blockNumber', []), 16);
const DAYS = Number(process.env.DAYS ?? 90);
const BLOCKS = Math.round(DAYS * 86400 / 12);
const start = Number(process.env.FROM ?? latest - BLOCKS);

// The window is PINNED on the first run and reused on every later one.
//
// The first version compared the checkpoint's `to` against a freshly read `latest`, which advances
// every twelve seconds — so the stored window was always 'stale', the file was always discarded, and
// the scan restarted from zero every time while reporting itself as resumable. It was described as
// resumable for hours and had never once resumed; 4,292 collected borrows were overwritten proving
// it. A resume that keys on a moving value is not a resume.
//
// Set RESCAN=1 to deliberately start a new window.
let state = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;
if (state && !state.complete && !process.env.RESCAN) {
  console.log(`resuming the PINNED window ${state.from}..${state.to} — latest is now ${latest}, which does not move it`);
} else {
  state = { from: start, to: latest, cursor: start, complete: false, borrows: [], rpc_host: new URL(RPC).host };
}
console.log(`window ${state.from}..${state.to} (${DAYS}d, ${state.to - state.from} blocks), resuming at ${state.cursor}, have ${state.borrows.length}`);

const topics = [BORROW, '0x' + WETH.slice(2).padStart(64, '0')];
while (state.cursor <= state.to) {
  const batch = [];
  for (let i = 0; i < PARALLEL && state.cursor + i * STEP <= state.to; i++) {
    const f = state.cursor + i * STEP;
    batch.push(rpc('eth_getLogs', [{ address: POOL, fromBlock: hex(f), toBlock: hex(Math.min(f + STEP - 1, state.to)), topics }]));
  }
  const results = await Promise.all(batch);
  for (const logs of results) {
    for (const l of logs) {
      state.borrows.push({
        block: parseInt(l.blockNumber, 16), tx: l.transactionHash, logIndex: parseInt(l.logIndex, 16),
        user: addr('0x' + l.data.slice(2, 66)),          // funds go here — data word 0
        onBehalfOf: addr(l.topics[2]),                    // whose debt it is
        amount: BigInt('0x' + l.data.slice(66, 130)).toString(),
        rateMode: Number(BigInt('0x' + l.data.slice(130, 194))),
      });
    }
  }
  state.cursor += batch.length * STEP;
  writeFileSync(OUT + '.tmp', JSON.stringify(state));
  renameSync(OUT + '.tmp', OUT);
  if (state.borrows.length && state.cursor % 50000 < PARALLEL * STEP) {
    console.log(`  ${state.cursor}/${state.to}  borrows=${state.borrows.length}  calls=${calls}`);
  }
}
state.complete = true;
writeFileSync(OUT, JSON.stringify(state));
console.log(`done: ${state.borrows.length} WETH borrows over ${state.to - state.from} blocks, ${calls} rpc calls`);

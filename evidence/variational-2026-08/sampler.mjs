// Samples Variational Omni's public /metadata/stats at 60s resolution.
//
//   node sampler.mjs            # appends to ./samples.jsonl until killed
//
// Why it exists: two boundaries in one window. AAPL is inside a dividend-adjustment
// window (its funding_interval_s is 3600 while every other equity is 28800), and the
// NYSE reopen lands at 13:30 UTC. Both are needed by docs/tasks/012, and neither can
// be recovered afterwards — this endpoint returns the present only.
//
// Three design points, each of them a lesson paid for elsewhere in this repo:
//
//   - append-only, fsync per record. A suspend loses samples; it never corrupts the
//     ones already written.
//   - every record carries the wall-clock time of its own fetch, so a suspend gap is
//     visible IN the data rather than being an absence the reader has to notice.
//     Liveness is only ever provable from observed timestamps.
//   - 60s polling, never one long timer. A long timer does not survive a suspend —
//     that is exactly how the Vesper keeper slept through a full day of open windows.
//
// This writes an observation log, not a claim. Nothing here is settlement-grade: the
// endpoint is the operator's own, it is unauthenticated but unsigned, and it addresses
// no block. See README.md in this directory.

import { appendFileSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL_STATS =
  'https://omni-client-api.prod.ap-northeast-1.variational.io/metadata/stats';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'samples.jsonl');
const INTERVAL_MS = 60_000;

const WATCH = new Set([
  // the dividend-window subject
  'AAPL',
  // US single names — NYSE/Nasdaq closed until Mon 13:30 UTC
  'TSLA', 'NVDA', 'MSFT', 'META', 'AMZN', 'GOOGL', 'MU', 'INTC', 'QCOM',
  'TSM', 'COIN', 'MSTR', 'AVGO', 'AMD', 'JPM', 'WMT', 'COST', 'LLY',
  // ETFs / indices
  'QQQ', 'US500', 'IWM', 'SOXL', 'EWJ', 'EWY', 'XBI', 'XLE', 'UVXY',
  // pre-IPO: no underlying session at all — control for "what closed looks like"
  'OPENAI', 'ANTHROPIC', 'SPCX', 'CBRS', 'QNTX',
  // commodities: CME Globex, a different calendar — second control
  'CL', 'BZ', 'XAU', 'XAG', 'COPPER', 'NATGAS',
  // crypto: always open — baseline
  'BTC', 'ETH', 'SOL', 'HYPE',
]);

const KEEP = ['ticker', 'name', 'mark_price', 'funding_rate', 'funding_interval_s',
  'base_spread_bps', 'volume_24h', 'open_interest', 'quotes'];

const GLOBAL = ['total_volume_24h', 'cumulative_volume', 'tvl', 'open_interest',
  'num_markets', 'loss_refund'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function write(record) {
  const line = JSON.stringify(record) + '\n';
  appendFileSync(OUT, line);
  const fd = openSync(OUT, 'r');
  fsyncSync(fd);
  closeSync(fd);
}

for (;;) {
  const started = Date.now();
  const record = { fetched_at: new Date(started).toISOString(), unix: started / 1000 };
  try {
    const res = await fetch(URL_STATS, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    record.global = Object.fromEntries(GLOBAL.map((k) => [k, d[k]]));
    record.listings = d.listings
      .filter((l) => WATCH.has(l.ticker))
      .map((l) => Object.fromEntries(KEEP.map((k) => [k, l[k]])));
    record.ok = true;
  } catch (e) {
    record.ok = false;
    record.error = `${e.name}: ${e.message}`;
  }
  write(record);
  await sleep(Math.max(1000, INTERVAL_MS - (Date.now() - started)));
}

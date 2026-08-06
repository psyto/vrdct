#!/usr/bin/env node
import { loadConfig, runKeeper } from './lib.mjs';

const configPath = process.argv[2];
if (!configPath || process.argv.length !== 3) {
  console.error('usage: vrdct-keeper <config.json>');
  process.exit(2);
}

try {
  const result = await runKeeper({ config: loadConfig(configPath) });
  for (const entry of result.opened) console.log(`${entry.action.padEnd(7)} ${entry.market.toBase58()}  ${entry.claim.verdict.flag}`);
  for (const entry of result.cranked) console.log(`cranked  ${entry.market.toBase58()}  feeder reward ${entry.rewardLamports} lamports`);
  if (result.board) console.log(`board    ${result.board.rows.length} row(s) → ${result.board.files.join(', ')}`);
} catch (error) {
  console.error(`vrdct-keeper: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

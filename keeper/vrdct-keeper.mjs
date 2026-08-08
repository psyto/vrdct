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
  for (const entry of result.cranked) console.log(`cranked  ${entry.market.toBase58()}  settled ${entry.verdict.flag}; keeper receives ${entry.keeperReceivesLamports} lamports (incl. ${entry.rewardLamports} feeder reward)`);
  for (const entry of result.claimed) console.log(`claimed  ${entry.market.toBase58()}  uncontested bond ${entry.bondReturned} lamports returned`);
  if (result.board) console.log(`board    ${result.board.rows.length} row(s) → ${result.board.files.join(', ')}`);
  for (const failure of result.failures) console.error(`failed   ${failure.stage}${failure.market ? ` ${failure.market}` : ''}: ${failure.error}`);
} catch (error) {
  console.error(`vrdct-keeper: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

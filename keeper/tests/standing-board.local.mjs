// Local-validator E2E for the standing keeper. Windows are taken exclusively from validator
// blockTime inside the keeper; this test deliberately never consults Date.now().
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction,
  TransactionInstruction, sendAndConfirmTransaction,
} from '@solana/web3.js';
import { DEFAULT_PROGRAM_ID, decodeMarket, renderBoard, runKeeper } from '../lib.mjs';
import { FLAG_ID, FLAG_NAME } from '../../core/encode.mjs';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const RPC = process.env.RPC || 'http://127.0.0.1:8899';
const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || DEFAULT_PROGRAM_ID);
const NODE = process.env.NODE || process.execPath;
const conn = new Connection(RPC, 'confirmed');
const disc = (name) => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const u8 = (v) => Buffer.from([v]);
const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
const rw = (pubkey, isSigner = false) => ({ pubkey, isSigner, isWritable: true });
const ro = (pubkey, isSigner = false) => ({ pubkey, isSigner, isWritable: false });
const ix = (name, args, keys) => new TransactionInstruction({ programId: PROGRAM_ID, keys, data: Buffer.concat([disc(name), ...args]) });

async function funded(sol = 3) {
  const keypair = Keypair.generate();
  await conn.confirmTransaction(await conn.requestAirdrop(keypair.publicKey, sol * LAMPORTS_PER_SOL), 'confirmed');
  return keypair;
}

async function sourceTransfers(source, destination) {
  for (let i = 0; i < 2; i++) {
    await sendAndConfirmTransaction(conn, new Transaction().add(SystemProgram.transfer({
      fromPubkey: source.publicKey, toPubkey: destination, lamports: 1,
    })), [source], { commitment: 'confirmed' });
  }
}

async function latestChainTime() {
  const slot = await conn.getSlot('finalized');
  const timestamp = await conn.getBlockTime(slot);
  assert.notEqual(timestamp, null, `validator returned no blockTime for finalized slot ${slot}`);
  return timestamp;
}

async function nextCompletedMinute(sourceTime) {
  const end = Math.floor(sourceTime / 60) * 60 + 60;
  // One chain minute is the maximum wait. This is deliberately chain-time polling, not a host
  // timer used to choose the window; the short delay only avoids hammering local RPC.
  for (let attempt = 0; attempt < 240; attempt++) {
    const current = await latestChainTime();
    if (current >= end) return current;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`validator blockTime did not close the source minute ending ${end}; test windows must come from chain time`);
}

function opposite(flag) {
  return flag === FLAG_ID.GREEN ? FLAG_ID.RED : FLAG_ID.GREEN;
}

if (!(await conn.getAccountInfo(PROGRAM_ID))?.executable) {
  throw new Error(`program ${PROGRAM_ID.toBase58()} is not deployed at ${RPC}`);
}

const keeper = await funded(5);
const challenger = await funded(5);
const source = await funded(2);
await sourceTransfers(source, challenger.publicKey);
const fixedChainNow = await nextCompletedMinute(await latestChainTime());

const boardDir = mkdtempSync(join(tmpdir(), 'vrdct-standing-board-'));
const config = {
  rpc: RPC,
  programId: PROGRAM_ID,
  keypairPath: '',
  bondLamports: 100_000_000n,
  challengeWindowSecs: 3600,
  boardDir,
  subjects: [{
    venue: 'Local validator demonstration venue',
    question: 'Does the local demonstration venue avoid liquidating against prices that update while US equities are closed?',
    priceAccount: source.publicKey,
    windowSecs: 60,
    yesWhen: ['GREEN'],
  }],
};

// First run opens the exact flag it re-executed. The second has the same daily, chain-timed window
// and must resolve the same definition PDA rather than open another market.
const first = await runKeeper({ config, signer: keeper, connection: conn, chainNow: fixedChainNow });
assert.equal(first.opened.length, 1);
assert.equal(first.opened[0].action, 'opened');
const market = first.opened[0].market;
const opened = decodeMarket((await conn.getAccountInfo(market)).data);
assert.equal(opened.resolverFlag, FLAG_ID[first.opened[0].claim.verdict.flag], 'keeper must assert its own re-execution flag');

const second = await runKeeper({ config, signer: keeper, connection: conn, chainNow: fixedChainNow });
assert.equal(second.opened.length, 1);
assert.equal(second.opened[0].action, 'deduped');
assert.ok(second.opened[0].market.equals(market), 'same chain-timed window must not create a second market');

// A challenger takes the other flag. The next keeper run must complete its feeder-owned PDA and
// settle before expiry; the keeper is both winning resolver and feeder, so it receives the feeder cut.
const challengedBefore = await conn.getBalance(keeper.publicKey);
await sendAndConfirmTransaction(conn, new Transaction().add(ix('challenge', [
  u8(opposite(opened.resolverFlag)), u64(config.bondLamports),
], [rw(challenger.publicKey, true), rw(market), ro(SystemProgram.programId)])), [challenger], { commitment: 'confirmed' });
const defended = await runKeeper({ config, signer: keeper, connection: conn, chainNow: fixedChainNow });
assert.equal(defended.cranked.length, 1, 'keeper must crank its challenged position');
assert.equal(defended.cranked[0].rewardLamports, config.bondLamports / 10n, 'completed Feed earns the 10% challenger-bond reward');
const settled = decodeMarket((await conn.getAccountInfo(market)).data);
assert.equal(settled.state, 2);
assert.equal(settled.byReexecution, 1, 'challenged market must settle by on-chain re-execution');
assert.equal(settled.settledFlag, opened.resolverFlag, 'keeper defended the flag it opened');
assert.ok(await conn.getBalance(keeper.publicKey) > challengedBefore, 'keeper received the challenged pot, including its feeder reward');

// The board is deterministic for the same reconstructed chain state and contains a command that
// resolves to the market it names.
const board = defended.board;
assert.equal(board.rows.length, 1);
assert.equal(renderBoard({ config, chainNow: 1, rows: board.rows }), renderBoard({ config, chainNow: 2, rows: board.rows }));
const checkCommand = `RPC=${RPC} PROGRAM_ID=${PROGRAM_ID.toBase58()} node cli/vrdct.mjs check ${market.toBase58()}`;
assert.ok(board.content.includes(checkCommand), 'board row must carry its exact falsifier command');
assert.ok(board.content.includes(config.subjects[0].question));
assert.ok(board.content.includes('devnet bonds are not real capital'));
const checked = spawnSync(NODE, ['cli/vrdct.mjs', 'check', market.toBase58()], {
  cwd: ROOT, env: { ...process.env, RPC, PROGRAM_ID: PROGRAM_ID.toBase58() }, encoding: 'utf8',
});
assert.equal(checked.status, 0, checked.stdout + checked.stderr);
assert.match(checked.stdout, new RegExp(`re-execution says ${FLAG_NAME[opened.resolverFlag]}`));

console.log(`vrdct standing board local: idempotent open, ${FLAG_NAME[opened.resolverFlag]} assertion, challenged crank/settle, feeder reward, and falsifiable board verified`);

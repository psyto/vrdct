// Local-validator E2E for the standing keeper. Windows are taken exclusively from validator
// blockTime inside the keeper; this test deliberately never consults Date.now().
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction,
  TransactionInstruction, sendAndConfirmTransaction,
} from '@solana/web3.js';
import { DEFAULT_PROGRAM_ID, decodeMarket, runKeeper, tradingWindow, writeBoard } from '../lib.mjs';
import { FLAG_ID, FLAG_NAME } from '../../core/encode.mjs';
import { fetchObservations } from '../../core/rpc.mjs';

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

async function finalizedSourceTime(account) {
  // core/rpc.mjs intentionally asks the source RPC without a weaker commitment. Wait until that
  // exact view can see the records; this is test synchronisation only, never a host-time window.
  for (let attempt = 0; attempt < 240; attempt++) {
    const observations = await fetchObservations(RPC, account.toBase58(), { from: 0 });
    if (observations.length >= 3) return observations.at(-1).blockTime;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`source ${account.toBase58()} did not become visible at the source RPC`);
}

function nextCloseWindowContaining(sourceTime) {
  // This deliberately derives a completed trading-day bucket from a source observation's chain
  // blockTime, never from the host clock. It lets a local-validator test replay a closed window
  // without waiting through an actual US session.
  for (let candidate = sourceTime; candidate <= sourceTime + 7 * 86400; candidate += 86400) {
    const window = tradingWindow(candidate);
    if (window.fromTs <= sourceTime && sourceTime <= window.toTs) return { ...window, chainNow: window.toTs };
  }
  throw new Error(`no close-to-close window contained source timestamp ${sourceTime}`);
}

function opposite(flag) {
  return flag === FLAG_ID.GREEN ? FLAG_ID.RED : FLAG_ID.GREEN;
}

if (!(await conn.getAccountInfo(PROGRAM_ID))?.executable) {
  throw new Error(`program ${PROGRAM_ID.toBase58()} is not deployed at ${RPC}`);
}

const keeper = await funded(5);
const challenger = await funded(5);
const sourceA = await funded(2);
const sourceB = await funded(2);
const quietSource = Keypair.generate(); // deliberately no signatures in the completed source window
await sourceTransfers(sourceA, challenger.publicKey);
await sourceTransfers(sourceB, challenger.publicKey);
const sourceTimeA = await finalizedSourceTime(sourceA.publicKey);
await finalizedSourceTime(sourceB.publicKey);
const fixedChainNow = nextCloseWindowContaining(sourceTimeA).chainNow;

const boardDir = mkdtempSync(join(tmpdir(), 'vrdct-standing-board-'));
const config = {
  rpc: RPC,
  sourceRpc: RPC,
  programId: PROGRAM_ID,
  keypairPath: '',
  bondLamports: 100_000_000n,
  challengeWindowSecs: 3600,
  boardDir,
  cacheDir: join(boardDir, 'commitments'),
  subjects: [{
    venue: 'Local validator demonstration venue',
    question: 'Does the local demonstration venue avoid liquidating against prices that update while US equities are closed?',
    priceAccount: sourceA.publicKey,
    yesWhen: ['GREEN'],
  }, {
    venue: 'Second local validator demonstration venue',
    question: 'Does the second local demonstration venue avoid liquidating against prices that update while US equities are closed?',
    priceAccount: sourceB.publicKey,
    yesWhen: ['GREEN'],
  }, {
    venue: 'Quiet local validator demonstration venue',
    question: 'Does the quiet demonstration venue avoid liquidating against prices that update while US equities are closed?',
    priceAccount: quietSource.publicKey,
    yesWhen: ['GREEN'],
  }],
};
const sourceFetch = (rpc, account, window) => fetchObservations(rpc, account, window);
const sourceWindow = tradingWindow(fixedChainNow);
const sourceObservations = await sourceFetch(RPC, sourceA.publicKey.toBase58(), { from: sourceWindow.fromTs, to: sourceWindow.toTs });
assert.ok(sourceObservations.length > 0, `source=${sourceA.publicKey} sourceTime=${sourceTimeA} window=${JSON.stringify(sourceWindow)} observations=${JSON.stringify(sourceObservations)}`,
  'the chain-derived close-to-close window must contain the source observation');

// A quiet subject must not prevent the two observed sources from opening, nor suppress the board.
const first = await runKeeper({ config, signer: keeper, connection: conn, chainNow: fixedChainNow, fetch: sourceFetch });
assert.equal(first.opened.length, 2, `sourceTime=${sourceTimeA} window=${JSON.stringify(tradingWindow(fixedChainNow))} ${JSON.stringify(first.failures)}`);
assert.equal(first.opened[0].action, 'opened');
assert.equal(first.failures.filter((failure) => failure.stage === 'open').length, 1, 'quiet subject must be reported, not abort the run');
assert.ok(first.board.files.every((file) => file.includes(boardDir)), 'board must be written despite quiet source');
assert.match(first.board.content, /Subject did not open this window: Quiet local validator demonstration venue/);
const marketA = first.opened[0].market;
const marketB = first.opened[1].market;
const openedA = decodeMarket((await conn.getAccountInfo(marketA)).data);
const openedB = decodeMarket((await conn.getAccountInfo(marketB)).data);
assert.equal(openedA.resolverFlag, FLAG_ID[first.opened[0].claim.verdict.flag], 'keeper must assert its own re-execution flag');

// The exact same trading-day bucket dedupes; verify actual board writes rather than comparing a
// renderer argument it does not consume.
const second = await runKeeper({ config, signer: keeper, connection: conn, chainNow: fixedChainNow, fetch: sourceFetch });
assert.equal(second.opened.length, 2);
assert.ok(second.opened.every((result) => result.action === 'deduped'), JSON.stringify(second.opened.map((result) => result.action)));
assert.ok(second.opened[0].market.equals(marketA), 'same chain-timed window must not create a second market');
const boardOne = await writeBoard({ connection: conn, config, signer: keeper, chainNow: fixedChainNow, fetch: sourceFetch });
const boardTwo = await writeBoard({ connection: conn, config, signer: keeper, chainNow: fixedChainNow, fetch: sourceFetch });
assert.equal(boardOne.content, boardTwo.content, 'two actual board writes over unchanged chain state must agree');
assert.ok(boardOne.content.includes(`RPC=${RPC} SOURCE_RPC=${RPC} PROGRAM_ID=${PROGRAM_ID.toBase58()}`), 'published row must carry separate cluster and source RPC settings');

// Challenge both positions. Delete A's cache to make its crank fail, then edit A out of config:
// B still must settle from its cache even though the source RPC is now unavailable. This covers
// per-market isolation, custody beyond current wording, and source-history loss in one run.
const challengedBefore = await conn.getBalance(keeper.publicKey);
for (const [market, opened] of [[marketA, openedA], [marketB, openedB]]) {
  await sendAndConfirmTransaction(conn, new Transaction().add(ix('challenge', [
    u8(opposite(opened.resolverFlag)), u64(config.bondLamports),
  ], [rw(challenger.publicKey, true), rw(market), ro(SystemProgram.programId)])), [challenger], { commitment: 'confirmed' });
}
unlinkSync(join(config.cacheDir, `${marketA.toBase58()}.json`));
const editedConfig = { ...config, subjects: config.subjects.slice(1) };
const sourceUnavailable = async () => { throw new Error('source RPC history is unavailable'); };
const defended = await runKeeper({ config: editedConfig, signer: keeper, connection: conn, chainNow: fixedChainNow, fetch: sourceUnavailable });
assert.equal(defended.cranked.length, 1, 'one missing cache must not prevent another market crank');
assert.ok(defended.cranked[0].market.equals(marketB), 'a market omitted from config must still be attempted before the configured one settles');
assert.equal(defended.cranked[0].rewardLamports, config.bondLamports / 10n, 'completed Feed earns the 10% challenger-bond reward');
assert.ok(defended.failures.some((failure) => failure.stage === 'crank' && failure.market === marketA.toBase58()), 'unreconstructible/cache-missing market must be recorded');
const settled = decodeMarket((await conn.getAccountInfo(marketB)).data);
assert.equal(settled.state, 2);
assert.equal(settled.byReexecution, 1, 'cached bytes must settle by on-chain re-execution with source unavailable');
assert.equal(settled.settledFlag, openedB.resolverFlag, 'keeper defended the flag it opened');
assert.ok(await conn.getBalance(keeper.publicKey) > challengedBefore, 'keeper received the challenged pot, including its feeder reward');

// An unavailable source makes the row explicitly unpublishable, but never prevents the board.
const board = defended.board;
assert.equal(board.rows.length, 0);
assert.match(board.content, /Skipped rows — not independently checkable now/);
assert.match(board.content, /source rebuild warning: source RPC history is unavailable/);
assert.match(board.content, /current keeper config no longer names this position/);
assert.ok(board.content.includes('devnet bonds are not real capital'));
const checked = spawnSync(NODE, ['cli/vrdct.mjs', 'check', marketB.toBase58()], {
  cwd: ROOT, env: { ...process.env, RPC, SOURCE_RPC: RPC, PROGRAM_ID: PROGRAM_ID.toBase58() }, encoding: 'utf8',
});
assert.equal(checked.status, 0, checked.stdout + checked.stderr);
assert.match(checked.stdout, new RegExp(`re-execution says ${FLAG_NAME[openedB.resolverFlag]}`));

// Market A is still CHALLENGED with no cache file. Cache loss must not be terminal: with the source
// RPC reachable again the keeper rebuilds the committed bytes, defends the bond, and re-seeds the
// cache. A is also still absent from `editedConfig`, so this exercises custody beyond wording too.
assert.ok(!existsSync(join(config.cacheDir, `${marketA.toBase58()}.json`)), 'market A must still be cacheless going in');
const recovered = await runKeeper({ config: editedConfig, signer: keeper, connection: conn, chainNow: fixedChainNow, fetch: sourceFetch });
assert.ok(recovered.cranked.some((entry) => entry.market.equals(marketA)),
  `cache loss must fall back to the source RPC: ${JSON.stringify(recovered.failures)}`);
const settledA = decodeMarket((await conn.getAccountInfo(marketA)).data);
assert.equal(settledA.state, 2);
assert.equal(settledA.byReexecution, 1, 'an RPC-rebuilt commitment must still settle by on-chain re-execution');
assert.equal(settledA.settledFlag, openedA.resolverFlag, 'the rebuilt bytes are the ones market A committed to');
assert.ok(existsSync(join(config.cacheDir, `${marketA.toBase58()}.json`)), 'a successful rebuild must re-seed the cache');
const crankedA = recovered.cranked.find((entry) => entry.market.equals(marketA));
assert.equal(crankedA.keeperReceivesLamports, config.bondLamports * 2n, 'the winning resolver-feeder takes the whole pot, not only the 10% cut');

console.log(`vrdct standing board local: quiet-source isolation, idempotent close-to-close open, stale-config custody, cached crank/settle, RPC-fallback recovery, source-loss board skip, and feeder reward verified`);

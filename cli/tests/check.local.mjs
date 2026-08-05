// Requires a local validator with the task-004 program deployed. This test deliberately creates
// three public, OPEN markets and invokes only the keyless `vrdct check` command against them.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
  sendAndConfirmTransaction, LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import * as cmls from '../../claimtypes/closed-market-soundness.mjs';
import { FLAG_ID, inputsCommitment, marketDefinitionHash, SOURCE_KIND } from '../../core/encode.mjs';
import { fetchObservations } from '../../core/rpc.mjs';

const RPC = process.env.RPC || 'http://127.0.0.1:8899';
const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || '7EtJACKUvpWGB524uqTykTzyCx1DyxKb76iEZVAiWwKS');
const conn = new Connection(RPC, 'confirmed');
const disc = (name) => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const u8 = (v) => Buffer.from([v]);
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
const i64 = (v) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(v)); return b; };
const ix = (name, args, keys) => new TransactionInstruction({ programId: PROGRAM_ID, keys, data: Buffer.concat([disc(name), ...args]) });
const rw = (pubkey, isSigner = false) => ({ pubkey, isSigner, isWritable: true });
const ro = (pubkey, isSigner = false) => ({ pubkey, isSigner, isWritable: false });

async function funded(sol = 3) {
  const keypair = Keypair.generate();
  await conn.confirmTransaction(await conn.requestAirdrop(keypair.publicKey, sol * LAMPORTS_PER_SOL), 'confirmed');
  return keypair;
}

async function fetchEventually(source) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const observations = await fetchObservations(RPC, source.account.toBase58(), { from: source.fromTs, to: source.toTs });
    if (observations.length >= 2) return observations;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return [];
}

function claimFor(source, observations) {
  return cmls.build({
    subject: { chain: 'solana', priceAccount: source.account.toBase58() },
    window: { from_ts: source.fromTs, to_ts: source.toTs, from_iso: new Date(source.fromTs * 1000).toISOString(), to_iso: new Date(source.toTs * 1000).toISOString() },
    observations,
  });
}

async function openMarket(resolver, claim, source, assertedFlag) {
  const commit = inputsCommitment(claim);
  const id = randomBytes(32);
  const definition = marketDefinitionHash({
    marketId: id, claimTypeId: commit.claimTypeId, calendarVersion: commit.calendarVersion,
    nRecords: commit.nRecords, inputsHash: commit.inputsHash, source: { ...source, account: source.account.toBuffer() },
    yesWhen: 1 << FLAG_ID.GREEN, bond: 1_000_000n, challengeWindowSecs: 3600,
  });
  const [market] = PublicKey.findProgramAddressSync([Buffer.from('market'), definition], PROGRAM_ID);
  await sendAndConfirmTransaction(conn, new Transaction().add(ix('open_market', [
    definition, id, u8(commit.claimTypeId), u32(commit.calendarVersion), u32(commit.nRecords), commit.inputsHash,
    u8(source.kind), source.account.toBuffer(), i64(source.fromTs), i64(source.toTs),
    u8(1 << FLAG_ID.GREEN), u8(assertedFlag), u64(1_000_000), i64(3600),
  ], [rw(resolver.publicKey, true), rw(market), ro(SystemProgram.programId)])), [resolver], { commitment: 'confirmed' });
  const opened = await conn.getAccountInfo(market, 'confirmed');
  assert.deepEqual(Buffer.from(opened.data.subarray(82, 114)), commit.inputsHash, 'open_market must store the committed input hash');
  return market;
}

function runCheck(market) {
  return spawnSync(process.execPath, [new URL('../vrdct.mjs', import.meta.url).pathname, 'check', market.toBase58()], {
    encoding: 'utf8', env: { ...process.env, RPC, PROGRAM_ID: PROGRAM_ID.toBase58() },
  });
}

if (!(await conn.getAccountInfo(PROGRAM_ID))?.executable) throw new Error(`program ${PROGRAM_ID} is not deployed at ${RPC}`);
const resolver = await funded();
const sourceSigner = await funded();
await sendAndConfirmTransaction(conn, new Transaction().add(SystemProgram.transfer({ fromPubkey: sourceSigner.publicKey, toPubkey: resolver.publicKey, lamports: 1 })), [sourceSigner], { commitment: 'confirmed' });

const now = Math.floor(Date.now() / 1000);
const source = { kind: SOURCE_KIND.SOLANA_ACCOUNT_SIGNATURES, account: sourceSigner.publicKey, fromTs: now - 3600, toTs: now + 3600 };
const observations = await fetchEventually(source);
assert.ok(observations.length >= 2, `local source ${source.account.toBase58()} window ${source.fromTs}-${source.toTs} must finalize both observations`);
const claim = claimFor(source, observations);
assert.deepEqual(inputsCommitment(claim).inputsHash, inputsCommitment(claimFor(source, await fetchObservations(RPC, source.account.toBase58(), { from: source.fromTs, to: source.toTs }))).inputsHash, 'fresh source rebuild must be stable before opening');
const truth = FLAG_ID[claim.verdict.flag];
const wrong = truth === FLAG_ID.RED ? FLAG_ID.GREEN : FLAG_ID.RED;

const liar = await openMarket(resolver, claim, source, wrong);
const honest = await openMarket(resolver, claim, source, truth);
const last = Math.max(...observations.map((o) => o.blockTime));
const mismatch = await openMarket(resolver, claim, { ...source, fromTs: last + 1, toTs: last + 2 }, truth);

const liarResult = runCheck(liar);
assert.equal(liarResult.status, 0, liarResult.stdout + liarResult.stderr);
assert.match(liarResult.stdout, /resolver is wrong/);
assert.match(liarResult.stdout, /commitment MATCHES/);

const honestResult = runCheck(honest);
assert.equal(honestResult.status, 0, honestResult.stdout + honestResult.stderr);
assert.match(honestResult.stdout, /resolver is right/);
assert.match(honestResult.stdout, /commitment MATCHES/);

const mismatchResult = runCheck(mismatch);
assert.equal(mismatchResult.status, 1, mismatchResult.stdout + mismatchResult.stderr);
assert.match(mismatchResult.stderr, /DO NOT BOND/);
assert.match(mismatchResult.stderr, /REBUILD MISMATCH|returned no observations/);

console.log('vrdct check local: wrong resolver, honest resolver, and rebuild mismatch all verified');

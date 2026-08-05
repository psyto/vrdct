#!/usr/bin/env node
// Vrdct's take-a-market CLI. Read verbs require only an RPC URL: the point is to let a stranger
// decide whether to bond before they expose a signing key or spend a lamport.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, Transaction,
  TransactionInstruction, sendAndConfirmTransaction,
} from '@solana/web3.js';
import * as cmls from '../claimtypes/closed-market-soundness.mjs';
import '../claimtypes/solvency.mjs';
import { FLAG_ID, FLAG_NAME, inputsCommitment, SOURCE_KIND } from '../core/encode.mjs';
import { fetchObservations } from '../core/rpc.mjs';

const RPC = process.env.RPC || 'http://127.0.0.1:8899';
const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || '7EtJACKUvpWGB524uqTykTzyCx1DyxKb76iEZVAiWwKS');
const conn = new Connection(RPC, 'confirmed');
const STATE = ['OPEN', 'CHALLENGED', 'SETTLED'];
const MARKET_SIZE = 314;
const MARKET_DISCRIMINATOR = createHash('sha256').update('account:Market').digest().subarray(0, 8);

const disc = (name) => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const u8 = (v) => Buffer.from([v]);
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
const vecU8 = (v) => Buffer.concat([u32(v.length), v]);
const ix = (name, args, keys) => new TransactionInstruction({ programId: PROGRAM_ID, keys, data: Buffer.concat([disc(name), ...args]) });
const rw = (pubkey, isSigner = false) => ({ pubkey, isSigner, isWritable: true });
const ro = (pubkey, isSigner = false) => ({ pubkey, isSigner, isWritable: false });
const short = (v) => `${v.slice(0, 6)}…${v.slice(-4)}`;
const sol = (lamports) => `${(Number(lamports) / 1_000_000_000).toFixed(4)} SOL`;
const iso = (ts) => new Date(Number(ts) * 1000).toISOString().replace('.000', '');

function fatal(message, code = 2) {
  console.error(`vrdct: ${message}`);
  process.exit(code);
}

function decodeMarket(data) {
  if (!Buffer.isBuffer(data) || data.length < MARKET_SIZE) throw new Error(`invalid Market account length ${data?.length ?? 0}`);
  if (!data.subarray(0, 8).equals(MARKET_DISCRIMINATOR)) throw new Error('account is not a Vrdct Market');
  const pk = (offset) => new PublicKey(data.subarray(offset, offset + 32));
  return {
    definitionHash: Buffer.from(data.subarray(9, 41)), marketId: Buffer.from(data.subarray(41, 73)),
    claimType: data[73], calendarVersion: data.readUInt32LE(74), nRecords: data.readUInt32LE(78),
    inputsHash: Buffer.from(data.subarray(82, 114)),
    source: { kind: data[114], account: pk(115), fromTs: data.readBigInt64LE(147), toTs: data.readBigInt64LE(155) },
    yesWhen: data[163], resolver: pk(164), resolverFlag: data[196], resolverBond: data.readBigUInt64LE(197),
    challenger: pk(205), challengerFlag: data[237], challengeBond: data.readBigUInt64LE(238),
    openedTs: data.readBigInt64LE(278), challengeUntil: data.readBigInt64LE(286), settleBy: data.readBigInt64LE(294),
    settledTs: data.readBigInt64LE(302), state: data[310], settledFlag: data[311], resolved: data[312], byReexecution: data[313],
  };
}

async function readMarket(address) {
  let key;
  try { key = new PublicKey(address); } catch { fatal(`invalid market address: ${address}`); }
  const info = await conn.getAccountInfo(key, 'confirmed');
  if (!info) fatal(`market ${address} was not found`);
  if (!info.owner.equals(PROGRAM_ID)) fatal(`market ${address} is not owned by ${PROGRAM_ID.toBase58()}`);
  try { return { key, market: decodeMarket(info.data) }; } catch (error) { fatal(error.message); }
}

function sourceLabel(source) {
  if (source.kind === SOURCE_KIND.SOLANA_ACCOUNT_SIGNATURES) return `account ${source.account.toBase58()}  window ${iso(source.fromTs)} → ${iso(source.toTs)}`;
  if (source.kind === SOURCE_KIND.UNSOURCED) return 'UNSOURCED — publisher inputs cannot yet be chain-reconstructed';
  return `UNKNOWN kind ${source.kind}`;
}

function cmlsClaim(market, observations) {
  return cmls.build({
    subject: { chain: 'solana', priceAccount: market.source.account.toBase58() },
    window: {
      from_ts: Number(market.source.fromTs), to_ts: Number(market.source.toTs),
      from_iso: iso(market.source.fromTs), to_iso: iso(market.source.toTs),
    },
    observations,
  });
}

function cutOf(amount) {
  return amount / 10_000n * 1_000n + amount % 10_000n * 1_000n / 10_000n;
}

function takeOtherSideValue(market, truth) {
  const bond = market.resolverBond;
  const reward = cutOf(bond);
  if (truth !== market.resolverFlag) {
    const challengerPayout = bond + bond - reward;
    return `⚠ the resolver is wrong. Challenging with ${sol(bond)} pays ${sol(challengerPayout)} to the challenger; completing the Feed earns ${sol(reward)} (total received ${sol(challengerPayout + reward)}).`;
  }
  return `✓ the resolver is right. Taking the opposite side with ${sol(bond)} loses that bond; completing the Feed only earns ${sol(cutOf(bond))}, for a net ${sol(bond - cutOf(bond))} loss.`;
}

async function check(address) {
  const { key, market } = await readMarket(address);
  console.log(`market   ${key.toBase58()}  question hash ${market.marketId.toString('hex')}`);
  if (market.claimType !== 1 || market.source.kind !== SOURCE_KIND.SOLANA_ACCOUNT_SIGNATURES) {
    console.error(`\n⛔ DO NOT BOND — ${sourceLabel(market.source)}.`);
    console.error('   This market does not expose a chain-reconstructible input source.');
    return 2;
  }
  console.log(`source   ${sourceLabel(market.source)}`);
  let observations;
  try {
    observations = await fetchObservations(RPC, market.source.account.toBase58(), {
      from: Number(market.source.fromTs), to: Number(market.source.toTs),
    });
  } catch (error) {
    console.error(`\n⛔ DO NOT BOND — source reconstruction failed: ${error.message}`);
    return 1;
  }
  if (!observations.length) {
    console.error('\n⛔ DO NOT BOND — source reconstruction returned no observations; its commitment cannot match.');
    return 1;
  }
  let claim;
  try { claim = cmlsClaim(market, observations); } catch (error) {
    console.error(`\n⛔ DO NOT BOND — reconstructed source is not canonical CMLS input: ${error.message}`);
    return 1;
  }
  const rebuilt = inputsCommitment(claim, { calendarVersion: market.calendarVersion });
  if (!rebuilt.inputsHash.equals(market.inputsHash)) {
    console.error(`\n⛔ DO NOT BOND — REBUILD MISMATCH.`);
    console.error(`   ${observations.length} observations from the stated source hash to ${rebuilt.inputsHash.toString('hex')}`);
    console.error(`   market committed ${market.inputsHash.toString('hex')}; the resolver pointed here, but this is not what they pinned.`);
    return 1;
  }
  const truth = FLAG_ID[claim.verdict.flag];
  console.log(`rebuild  ${observations.length} observations re-fetched from RPC · commitment MATCHES ${market.inputsHash.toString('hex').slice(0, 16)}… ✅`);
  console.log(`\nresolver asserts  ${FLAG_NAME[market.resolverFlag]}`);
  console.log(`re-execution says ${claim.verdict.flag}     ← ${claim.verdict.reason}`);
  console.log(`\n${takeOtherSideValue(market, truth)}`);
  if (truth !== market.resolverFlag) console.log(`   vrdct challenge ${key.toBase58()} --flag ${claim.verdict.flag} --bond ${(Number(market.resolverBond) / 1_000_000_000).toFixed(9).replace(/0+$/, '').replace(/\.$/, '')}`);
  return 0;
}

async function markets() {
  const accounts = await conn.getProgramAccounts(PROGRAM_ID, { commitment: 'confirmed' });
  const live = accounts.flatMap(({ pubkey, account }) => {
    try {
      const market = decodeMarket(account.data);
      return market.state === 2 ? [] : [{ pubkey, market }];
    } catch { return []; }
  });
  if (!live.length) return console.log('No live Vrdct markets at this RPC.');
  for (const { pubkey, market } of live) {
    console.log(`${pubkey.toBase58()}  ${STATE[market.state] || `STATE_${market.state}`}  question ${short(market.marketId.toString('hex'))}`);
    console.log(`  resolver ${FLAG_NAME[market.resolverFlag]} ${sol(market.resolverBond)}  challenger ${market.state === 1 ? `${FLAG_NAME[market.challengerFlag]} ${sol(market.challengeBond)}` : 'none'}`);
    console.log(`  challenge until ${iso(market.challengeUntil)}  settle by ${iso(market.settleBy)}`);
    console.log(`  source ${sourceLabel(market.source)}`);
  }
}

function signerFromEnv() {
  if (!process.env.KEYPAIR) fatal('KEYPAIR must point to a Solana keypair JSON file for this signing command');
  try { return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.KEYPAIR, 'utf8')))); }
  catch { fatal(`could not read KEYPAIR ${process.env.KEYPAIR}`); }
}

function lamports(value) {
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,9})?$/.test(value || '')) fatal('--bond must be a positive SOL decimal with at most 9 decimal places');
  const [whole, fraction = ''] = value.split('.');
  const n = BigInt(whole) * 1_000_000_000n + BigInt((fraction + '000000000').slice(0, 9));
  if (n === 0n) fatal('--bond must be greater than zero');
  return n;
}

async function sendWithRetry(build, signer, label) {
  let error;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { return await sendAndConfirmTransaction(conn, build(), [signer], { commitment: 'confirmed' }); }
    catch (e) { error = e; if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 300)); }
  }
  throw new Error(`${label} failed after 3 attempts: ${error?.message || error}`);
}

async function challenge(address, flag, bondText) {
  if (!(flag in FLAG_ID)) fatal('--flag must be UNKNOWN, GREEN, YELLOW, RED, or STALE');
  const { key, market } = await readMarket(address);
  if (market.state !== 0) fatal(`market is ${STATE[market.state] || market.state}; it cannot be challenged`);
  if (FLAG_ID[flag] === market.resolverFlag) fatal('challenge flag must differ from resolver assertion');
  const signer = signerFromEnv();
  const bond = lamports(bondText);
  const signature = await sendWithRetry(() => new Transaction().add(ix('challenge', [u8(FLAG_ID[flag]), u64(bond)], [
    rw(signer.publicKey, true), rw(key), ro(SystemProgram.programId),
  ])), signer, 'challenge');
  console.log(`challenged ${key.toBase58()} with ${flag} and ${sol(bond)}: ${signature}`);
}

async function crank(address) {
  const { key, market } = await readMarket(address);
  if (market.state !== 1) fatal(`market is ${STATE[market.state] || market.state}; crank requires CHALLENGED`);
  if (market.claimType !== 1 || market.source.kind !== SOURCE_KIND.SOLANA_ACCOUNT_SIGNATURES) fatal('crank currently supports sourced CMLS markets only');
  const signer = signerFromEnv();
  const observations = await fetchObservations(RPC, market.source.account.toBase58(), { from: Number(market.source.fromTs), to: Number(market.source.toTs) });
  if (!observations.length) fatal('source reconstruction returned no observations; refusing to crank');
  const claim = cmlsClaim(market, observations);
  const commitment = inputsCommitment(claim, { calendarVersion: market.calendarVersion });
  if (!commitment.inputsHash.equals(market.inputsHash)) fatal('source rebuild does not match market inputs_hash; refusing to crank');
  const [feed] = PublicKey.findProgramAddressSync([Buffer.from('feed'), key.toBuffer(), signer.publicKey.toBuffer()], PROGRAM_ID);
  await sendWithRetry(() => new Transaction().add(ix('open_feed', [], [
    rw(signer.publicKey, true), ro(key), rw(feed), ro(SystemProgram.programId),
  ])), signer, 'open_feed');
  for (let i = 0; i < commitment.chunks.length; i++) {
    await sendWithRetry(() => new Transaction()
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }))
      .add(ix('feed', [vecU8(commitment.chunks[i])], [ro(signer.publicKey, true), ro(key), rw(feed)])), signer, `feed chunk ${i + 1}`);
    console.log(`fed ${i + 1}/${commitment.chunks.length} chunks`);
  }
  const truth = FLAG_ID[claim.verdict.flag];
  const reward = truth === market.resolverFlag ? cutOf(market.challengeBond)
    : truth === market.challengerFlag ? cutOf(market.resolverBond) : cutOf(market.resolverBond + market.challengeBond);
  const signature = await sendWithRetry(() => new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }))
    .add(ix('settle', [], [ro(signer.publicKey, true), rw(key), rw(market.resolver), rw(market.challenger), rw(signer.publicKey), rw(feed)])), signer, 'settle');
  console.log(`settled ${key.toBase58()} as ${claim.verdict.flag}; earned ${sol(reward)} cranker reward: ${signature}`);
}

const [verb, market, ...rest] = process.argv.slice(2);
try {
  if (verb === 'markets' && !market) await markets();
  else if (verb === 'check' && market && rest.length === 0) process.exitCode = await check(market);
  else if (verb === 'challenge' && market) {
    const flag = rest[rest.indexOf('--flag') + 1];
    const bond = rest[rest.indexOf('--bond') + 1];
    if (!flag || !bond) fatal('usage: vrdct challenge <market> --flag RED --bond 2');
    await challenge(market, flag, bond);
  } else if (verb === 'crank' && market && rest.length === 0) await crank(market);
  else fatal('usage: vrdct <markets | check <market> | challenge <market> --flag RED --bond 2 | crank <market>>');
} catch (error) {
  fatal(error instanceof Error ? error.message : String(error), 1);
}

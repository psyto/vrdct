// Vrdct — the on-chain resolution, end to end, with real lamports.
//
// Two markets, opposite outcomes, one program, no admin key:
//
//   MARKET A  closed-market-liquidation-soundness, on the REAL corpus claim (3,789 pinned Jupiter
//             Lend SPYx price updates). The resolver asserts GREEN — "the venue liquidates soundly"
//             — and posts a bond. A challenger asserts RED and matches it. The program re-executes
//             all 3,789 records on-chain and pays whoever the re-execution agrees with.
//
//   MARKET B  reserve-solvency, on the real Marinade snapshot. Here the resolver is HONEST and the
//             challenge is frivolous. Same program, same code path, opposite winner — which is the
//             point: nothing in the program prefers the party who opened the market.
//
// Run:  solana-test-validator -r      (in another terminal)
//       node client/bond-live.mjs
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
  ComputeBudgetProgram, sendAndConfirmTransaction, LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import '../../claimtypes/closed-market-soundness.mjs'; // register
import * as solvency from '../../claimtypes/solvency.mjs';
import { verify } from '../../core/verify.mjs';
import { resolve } from '../../core/resolution.mjs';
import { inputsCommitment, marketId, yesWhenMask, FLAG_ID, FLAG_NAME } from '../../core/encode.mjs';

const RPC = process.env.RPC || 'http://127.0.0.1:8899';
// Mirrors `declare_id!` in programs/vrdct-bond/src/lib.rs. Override if you deploy under your own.
const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || '7EtJACKUvpWGB524uqTykTzyCx1DyxKb76iEZVAiWwKS');
const BOND = 2 * LAMPORTS_PER_SOL;
const SOL = (l) => (l / LAMPORTS_PER_SOL).toFixed(4);

// ── Anchor wire format, hand-rolled (no anchor client dep) ───────────────────────────────────────
const disc = (name) => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const u8 = (v) => Buffer.from([v]);
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
const i64 = (v) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(v)); return b; };
const vecU8 = (b) => Buffer.concat([u32(b.length), b]);
const ix = (name, args, keys) => new TransactionInstruction({
  programId: PROGRAM_ID, keys, data: Buffer.concat([disc(name), ...args]),
});
const rw = (pubkey, signer = false) => ({ pubkey, isSigner: signer, isWritable: true });
const ro = (pubkey, signer = false) => ({ pubkey, isSigner: signer, isWritable: false });

const conn = new Connection(RPC, 'confirmed');
const send = (tx, signers) => sendAndConfirmTransaction(conn, tx, signers, { commitment: 'confirmed' });

// ── Market account decoding (layout mirrors state.rs) ─────────────────────────────────────────────
function decodeMarket(data) {
  const pk = (o) => new PublicKey(data.subarray(o, o + 32));
  return {
    claimType: data[41], nRecords: data.readUInt32LE(46), yesWhen: data[82],
    resolver: pk(83), resolverFlag: data[115], resolverBond: data.readBigUInt64LE(116),
    challenger: pk(124), challengerFlag: data[156], challengeBond: data.readBigUInt64LE(157),
    state: data[221], settledFlag: data[222], resolved: data[223],
    feedDigest: Buffer.from(data.subarray(224, 256)),
    fold: {
      count: data.readUInt32LE(256), openN: data.readUInt32LE(260), closedN: data.readUInt32LE(264),
      maxGap: data.readBigInt64LE(268),
    },
  };
}

async function fundedKeypair(sol = 10) {
  const kp = Keypair.generate();
  await conn.confirmTransaction(await conn.requestAirdrop(kp.publicKey, sol * LAMPORTS_PER_SOL), 'confirmed');
  return kp;
}

// ── One full market: open → challenge → stream the re-execution → settle ────────────────────────
async function runMarket({ label, question, claim, yesWhen, resolverAsserts, challengerAsserts, actors, tamperWith }) {
  const { resolver, challenger, cranker, treasury } = actors;
  const commit = inputsCommitment(claim);
  // The market id is the hash of the question — the question IS the address. The run tag is only
  // so repeated demo runs against a long-lived validator don't collide on the same PDA.
  const id = marketId(`${question}\n#${resolver.publicKey.toBase58().slice(0, 8)}`);
  const [market] = PublicKey.findProgramAddressSync([Buffer.from('market'), id], PROGRAM_ID);

  // What the offline engine says. The program must land on exactly this, from the same bytes.
  const engine = verify(claim);
  const offchain = resolve(claim, { market: question, yesWhen });

  console.log(`\n\x1b[1m${label}\x1b[0m`);
  console.log(`  ${question.length > 96 ? question.slice(0, 93) + '...' : question}`);
  console.log(`  claim_type   ${claim.claim_type}`);
  console.log(`  offline      ${claim.verdict.flag}  (verify ${engine.ok ? 'reproduces' : 'FAILS'}; market → ${offchain.resolved})`);
  console.log(`  inputs       ${commit.nRecords} records → ${commit.chunks.length} chunk(s), inputs_hash ${commit.inputsHash.toString('hex').slice(0, 16)}…`);
  console.log(`  market PDA   ${market.toBase58()}`);

  const before = {
    resolver: await conn.getBalance(resolver.publicKey),
    challenger: await conn.getBalance(challenger.publicKey),
    treasury: await conn.getBalance(treasury.publicKey),
  };

  // 1) open — the resolver commits to the inputs and puts lamports behind an assertion.
  await send(new Transaction().add(ix('open_market', [
    id, u8(commit.claimTypeId), u32(commit.calendarVersion), u32(commit.nRecords),
    commit.inputsHash, u8(yesWhenMask(yesWhen)), u8(FLAG_ID[resolverAsserts]),
    u64(BOND), i64(3600),
  ], [rw(resolver.publicKey, true), rw(market), ro(treasury.publicKey), ro(SystemProgram.programId)])), [resolver]);
  console.log(`  → open       resolver asserts ${resolverAsserts}, bonds ${SOL(BOND)} SOL`);

  // 2) challenge — someone who re-executed offline and got a different answer takes the other side.
  await send(new Transaction().add(ix('challenge', [u8(FLAG_ID[challengerAsserts]), u64(BOND)],
    [rw(challenger.publicKey, true), rw(market), ro(SystemProgram.programId)])), [challenger]);
  console.log(`  → challenge  challenger asserts ${challengerAsserts}, bonds ${SOL(BOND)} SOL`);

  const feedChunks = async (chunks, note) => {
    const t = Date.now();
    for (let i = 0; i < chunks.length; i++) {
      await send(new Transaction()
        .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }))
        .add(ix('feed', [vecU8(chunks[i])], [ro(cranker.publicKey, true), rw(market)])), [cranker]);
      if (chunks.length > 1 && process.stdout.isTTY) process.stdout.write(`\r  → feed       ${note} ${i + 1}/${chunks.length} chunks`);
    }
    return ((Date.now() - t) / 1000).toFixed(1);
  };
  const trySettle = () => send(new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }))
    .add(ix('settle', [], [
      rw(cranker.publicKey, true), rw(market), rw(resolver.publicKey), rw(challenger.publicKey), rw(treasury.publicKey),
    ])), [cranker]);

  // 2.5) the adversarial case: a feeder streams a DIFFERENT input set — one whose verdict would
  // flip the payout. Well-formed, correctly chunked, and completely useless: the hash chain lands
  // somewhere else, so the program refuses to settle on it. This is the whole safety argument.
  if (tamperWith) {
    const forged = inputsCommitment(tamperWith);
    await feedChunks(forged.chunks, 'forging…');
    let rejected = null;
    try { await trySettle(); } catch (e) { rejected = JSON.stringify(e.logs || e.message); }
    const bound = rejected?.includes('does not match the committed inputs_hash');
    console.log(`  → forge      a feeder streams inputs whose verdict would be ${tamperWith.verdict.flag}, not ${claim.verdict.flag}`);
    console.log(`  ${bound ? '\x1b[32m✓' : '\x1b[31m✗'} rejected   settle refused — the forged chain head is not the committed inputs_hash\x1b[0m`);
    await send(new Transaction().add(ix('reset_feed', [], [ro(cranker.publicKey, true), rw(market)])), [cranker]);
    if (!bound) return { parity: false, winner: null, truth: null };
  }

  // 3) feed — the re-execution itself, on-chain, permissionless, in canonical chunks.
  const secs = await feedChunks(commit.chunks, 're-executing on-chain…');
  const fed = decodeMarket((await conn.getAccountInfo(market)).data);
  const chainMatches = fed.feedDigest.equals(commit.inputsHash);
  if (process.stdout.isTTY && commit.chunks.length > 1) process.stdout.write('\r\x1b[K');
  console.log(`  → feed       ${fed.fold.count} records re-executed on-chain in ${commit.chunks.length} tx (${secs}s) · digest ${chainMatches ? 'closes the commitment ✓' : 'MISMATCH ✗'}`);
  if (claim.claim_type === 'closed-market-liquidation-soundness') {
    console.log(`  ${' '.repeat(13)}on-chain fold: ${fed.fold.openN} updates while OPEN, ${fed.fold.closedN} while CLOSED, max gap ${Number(fed.fold.maxGap) / 60} min`);
    console.log(`  ${' '.repeat(13)}offline  fold: ${claim.computation.openUpdates} / ${claim.computation.closedUpdates} / ${claim.computation.maxGapMin} min`);
  }

  // 4) settle — the program derives the verdict itself and moves the money.
  await trySettle();

  const m = decodeMarket((await conn.getAccountInfo(market)).data);
  const after = {
    resolver: await conn.getBalance(resolver.publicKey),
    challenger: await conn.getBalance(challenger.publicKey),
    treasury: await conn.getBalance(treasury.publicKey),
  };
  const d = (k) => { const v = (after[k] - before[k]) / LAMPORTS_PER_SOL; return `${v >= 0 ? '+' : ''}${v.toFixed(4)}`; };

  const truth = FLAG_NAME[m.settledFlag];
  const winner = m.settledFlag === m.resolverFlag ? 'resolver' : m.settledFlag === m.challengerFlag ? 'challenger' : 'cranker';
  console.log(`  → settle     \x1b[1mre-executed on-chain: ${truth}\x1b[0m → market resolves ${m.resolved ? 'YES' : 'NO'} · ${winner} captures the stake`);
  console.log(`               resolver ${d('resolver')} SOL   challenger ${d('challenger')} SOL   treasury ${d('treasury')} SOL`);

  const parity = truth === claim.verdict.flag && (m.resolved === 1) === (offchain.resolved === 'YES');
  console.log(`  ${parity ? '\x1b[32m✓' : '\x1b[31m✗'} parity     on-chain re-execution == offline verify (${truth} == ${claim.verdict.flag})\x1b[0m`);
  return { parity: parity && chainMatches, winner, truth };
}

// ── main ─────────────────────────────────────────────────────────────────────────────────────────
try {
  await conn.getVersion();
} catch {
  console.error(`\n  no validator at ${RPC}. Start one:  solana-test-validator -r\n`);
  process.exit(1);
}
if (!(await conn.getAccountInfo(PROGRAM_ID))?.executable) {
  console.error(`\n  program ${PROGRAM_ID.toBase58()} is not deployed. Run:  anchor deploy\n`);
  process.exit(1);
}

console.log(`\n\x1b[1mVrdct — on-chain bond & settlement\x1b[0m   re-execution decides the payout`);
console.log(`  program ${PROGRAM_ID.toBase58()}  ·  ${RPC}`);

const actors = {
  resolver: await fundedKeypair(), challenger: await fundedKeypair(),
  cranker: await fundedKeypair(), treasury: await fundedKeypair(1),
};

// MARKET A — the real corpus claim. The resolver is WRONG and re-execution slashes them.
const corpus = JSON.parse(readFileSync(new URL('../../corpus/jupiter-spyx-cmls.claim.json', import.meta.url)));
const a = await runMarket({
  label: 'MARKET A · closed-market-liquidation-soundness  (real corpus claim, resolver is wrong)',
  question: 'Does Jupiter Lend liquidate SPYx soundly across the closed-market weekend window?',
  claim: corpus, yesWhen: ['GREEN'], resolverAsserts: 'GREEN', challengerAsserts: 'RED', actors,
});

// MARKET B — same program, honest resolver, frivolous challenge. The other direction.
const marinade = solvency.build({
  subject: { protocol: 'Marinade', asset: 'mSOL', chain: 'solana' }, window: { epoch: 1004 },
  quantities: { virtualValue: '2383199200198962', liability: '2383199196106081', staleRecords: 0, inv2b_ok: true },
});
// ...and before it settles honestly, someone tries to feed inputs that would flip it to RED.
const forgery = solvency.build({
  subject: { protocol: 'Marinade', asset: 'mSOL', chain: 'solana' }, window: { epoch: 1004 },
  quantities: { virtualValue: '2383199196106081', liability: '2383199200198962', staleRecords: 0, inv2b_ok: true },
});
const b = await runMarket({
  label: 'MARKET B · reserve-solvency  (real Marinade snapshot, challenge is frivolous)',
  question: 'Is Marinade (mSOL) solvent at epoch 1004?',
  claim: marinade, yesWhen: ['GREEN'], resolverAsserts: 'GREEN', challengerAsserts: 'RED', actors,
  tamperWith: forgery,
});

const ok = a.parity && b.parity && a.winner === 'challenger' && b.winner === 'resolver';
console.log(`\n  ${ok ? '\x1b[32mBoth markets settled by re-execution alone\x1b[0m' : '\x1b[31mFAILED\x1b[0m'} — no vote, no committee, no admin key, and the program`);
console.log(`  had no preference for whoever opened the market: A slashed the resolver, B slashed the challenger.\n`);
process.exit(ok ? 0 : 1);

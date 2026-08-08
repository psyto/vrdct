// Vrdct — the canonical input commitment. This serialises already-canonical typed inputs from each
// claim-type parser; it must never interpret raw claim JSON itself. The parser is the consensus
// boundary shared with offline re-execution, while this module is the bridge to the on-chain program
// (`onchain/programs/vrdct-bond`). If either side derives different bytes or a different verdict, a
// market can pay the wrong party, so every constant here has a twin in Rust.
//
//   h_0     = sha256( [claim_type u8][calendar_version u32 LE][n_records u32 LE] )
//   h_{i+1} = sha256( h_i || chunk_i )        chunks: CHUNK_RECORDS records each, remainder last
//   inputs_hash = h_N
//
// A real claim's inputs do not fit in a transaction (the reference Jupiter Lend claim pins 3,789
// price-account updates). Committing to the chain head lets the program re-execute them across
// many transactions and still refuse to settle on anything but the exact pinned input set.
import { createHash } from 'node:crypto';
import { canonicalInputs as canonicalCmlsInputs } from '../claimtypes/closed-market-soundness.mjs';
import { canonicalInputs as canonicalSolvencyInputs } from '../claimtypes/solvency.mjs';

/// Claim-type tags — mirror `reexec::CT_*`.
export const CLAIM_TYPE_ID = {
  'closed-market-liquidation-soundness': 1,
  'reserve-solvency': 2,
};
/// Verdict flags — mirror `reexec::FLAG_*`.
export const FLAG_ID = { UNKNOWN: 0, GREEN: 1, YELLOW: 2, RED: 3, STALE: 4 };
export const FLAG_NAME = ['UNKNOWN', 'GREEN', 'YELLOW', 'RED', 'STALE'];
/// Source descriptor kinds — mirror `state::SOURCE_*`.
export const SOURCE_KIND = { UNSOURCED: 0, SOLANA_ACCOUNT_SIGNATURES: 1 };

/// Records per chunk — mirrors `reexec::CHUNK_RECORDS`. Part of the hash chain, so it is consensus.
export const CHUNK_RECORDS = 200;
/// Fixed record widths — mirror `reexec::record_size`.
export const RECORD_SIZE = { 1: 4, 2: 37 };
/// Mirrors `campana::CAL_2026_VERSION` and `CALENDAR_2026.version`.
export const CAL_2026_VERSION = 202601;

const sha256 = (...bufs) => createHash('sha256').update(Buffer.concat(bufs)).digest();

/// `yes_when` bitmask over flag names: the market resolves YES iff the re-executed flag is in here.
export function yesWhenMask(flagNames) {
  return flagNames.reduce((m, n) => m | (1 << FLAG_ID[n]), 0);
}

/// A market id is the sha256 of the market question — the PDA seed, so the question is the address.
export function marketId(question) {
  return sha256(Buffer.from(question, 'utf8'));
}

/// Hash the complete, bounded economic definition of a market. This is the PDA seed used by the
/// program; `marketId` alone is only a discoverable question label and cannot be squatted.
/// Mirrors `market_definition_hash` in `onchain/programs/vrdct-bond/src/lib.rs` exactly.
export function marketDefinitionHash({ marketId: id, claimTypeId, calendarVersion, nRecords, inputsHash, source, yesWhen, bond, challengeWindowSecs }) {
  if (!Buffer.isBuffer(id) || id.length !== 32) throw new Error('marketId must be 32 bytes');
  if (!Buffer.isBuffer(inputsHash) || inputsHash.length !== 32) throw new Error('inputsHash must be 32 bytes');
  if (!source || !Number.isInteger(source.kind) || source.kind < SOURCE_KIND.UNSOURCED || source.kind > SOURCE_KIND.SOLANA_ACCOUNT_SIGNATURES) {
    throw new Error('source.kind must be a known source descriptor kind');
  }
  if (!Buffer.isBuffer(source.account) || source.account.length !== 32) throw new Error('source.account must be 32 bytes');
  const u64 = Buffer.alloc(8);
  u64.writeBigUInt64LE(BigInt(bond));
  const i64 = Buffer.alloc(8);
  i64.writeBigInt64LE(BigInt(challengeWindowSecs));
  const fromTs = Buffer.alloc(8);
  fromTs.writeBigInt64LE(BigInt(source.fromTs));
  const toTs = Buffer.alloc(8);
  toTs.writeBigInt64LE(BigInt(source.toTs));
  const u32 = Buffer.alloc(4);
  u32.writeUInt32LE(calendarVersion);
  const records = Buffer.alloc(4);
  records.writeUInt32LE(nRecords);
  return sha256(
    Buffer.from('vrdct:market:v1', 'utf8'), id, Buffer.from([claimTypeId]), u32, records,
    inputsHash, Buffer.from([source.kind]), source.account, fromTs, toTs, Buffer.from([yesWhen]), u64, i64,
  );
}

const u128le = (v) => {
  const b = Buffer.alloc(16);
  let x = v;
  for (let i = 0; i < 16; i++) { b[i] = Number(x & 0xffn); x >>= 8n; }
  if (x !== 0n) throw new Error('value exceeds u128');
  return b;
};

/// Pack a claim's pinned inputs into the canonical record bytes the program re-executes.
export function encodeRecords(claim) {
  const id = CLAIM_TYPE_ID[claim.claim_type];
  if (!id) throw new Error(`unknown claim_type: ${claim.claim_type}`);

  if (id === 1) {
    // Ascending blockTimes, u32 LE. The program rejects out-of-order records, so the sort here is
    // not cosmetic — it is what makes `max_gap` independent of submission order.
    const times = [...canonicalCmlsInputs(claim.inputs).blockTimes].sort((a, b) => a - b);
    const buf = Buffer.alloc(times.length * 4);
    times.forEach((t, i) => {
      buf.writeUInt32LE(t, i * 4);
    });
    return { claimTypeId: id, nRecords: times.length, bytes: buf };
  }

  const q = canonicalSolvencyInputs(claim.inputs);
  // inv2b is tri-state in the JS engine (`=== true` proves, `=== false` disproves, absent is
  // neither) and the verdict differs across all three — so it is encoded as a tri-state byte.
  const inv2b = q.inv2bOk === true ? 1 : q.inv2bOk === false ? 0 : 2;
  const bytes = Buffer.concat([
    u128le(q.virtualValue),
    u128le(q.liability),
    Buffer.from([inv2b]),
    (() => { const b = Buffer.alloc(4); b.writeUInt32LE(q.staleRecords); return b; })(),
  ]);
  return { claimTypeId: id, nRecords: 1, bytes };
}

/// Split records into the canonical chunks. Any other split hashes to a different chain head.
export function chunksOf(claimTypeId, bytes) {
  const rec = RECORD_SIZE[claimTypeId];
  const per = CHUNK_RECORDS * rec;
  const out = [];
  for (let off = 0; off < bytes.length; off += per) out.push(bytes.subarray(off, Math.min(off + per, bytes.length)));
  return out;
}

/// The canonical input hash chain: `h_0 = sha256(header)`, then `h_i = sha256(h_{i-1} || chunk_i)`.
/// Twinned with the program's `header_digest` plus the `feed` fold, so anyone holding only the
/// chunks — a cache, a re-fetch, an archive — can check them against a Market's `inputs_hash`
/// without rebuilding a claim. One implementation on purpose: a second reader of this rule is how
/// a JS and an on-chain verdict come apart.
export function commitmentDigest({ claimTypeId, calendarVersion, nRecords, chunks }) {
  const header = Buffer.alloc(9);
  header.writeUInt8(claimTypeId, 0);
  header.writeUInt32LE(calendarVersion, 1);
  header.writeUInt32LE(nRecords, 5);

  let digest = sha256(header);
  for (const c of chunks) digest = sha256(digest, c);
  return digest;
}

/// The full commitment: what gets pinned on-chain at `open_market`, and the chunks that settle it.
export function inputsCommitment(claim, { calendarVersion = CAL_2026_VERSION } = {}) {
  const { claimTypeId, nRecords, bytes } = encodeRecords(claim);
  const chunks = chunksOf(claimTypeId, bytes);
  const digest = commitmentDigest({ claimTypeId, calendarVersion, nRecords, chunks });

  return { claimTypeId, calendarVersion, nRecords, inputsHash: digest, chunks, bytes };
}

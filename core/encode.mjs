// Vrdct — the canonical input commitment. This is the bridge between the offline engine and the
// on-chain bond program (`onchain/programs/vrdct-bond`): both must derive the SAME bytes, the SAME
// hash chain, and therefore the SAME verdict. If this file and `reexec/` in the program ever
// disagree, a market can be opened that no honest feed can settle — so the encoding is consensus,
// and every constant here has a twin in Rust.
//
//   h_0     = sha256( [claim_type u8][calendar_version u32 LE][n_records u32 LE] )
//   h_{i+1} = sha256( h_i || chunk_i )        chunks: CHUNK_RECORDS records each, remainder last
//   inputs_hash = h_N
//
// A real claim's inputs do not fit in a transaction (the reference Jupiter Lend claim pins 3,789
// price-account updates). Committing to the chain head lets the program re-execute them across
// many transactions and still refuse to settle on anything but the exact pinned input set.
import { createHash } from 'node:crypto';

/// Claim-type tags — mirror `reexec::CT_*`.
export const CLAIM_TYPE_ID = {
  'closed-market-liquidation-soundness': 1,
  'reserve-solvency': 2,
};
/// Verdict flags — mirror `reexec::FLAG_*`.
export const FLAG_ID = { UNKNOWN: 0, GREEN: 1, YELLOW: 2, RED: 3, STALE: 4 };
export const FLAG_NAME = ['UNKNOWN', 'GREEN', 'YELLOW', 'RED', 'STALE'];

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

const u128le = (v) => {
  const b = Buffer.alloc(16);
  let x = BigInt(v);
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
    const times = claim.inputs.observed.observations.map((o) => o.blockTime).sort((a, b) => a - b);
    const buf = Buffer.alloc(times.length * 4);
    times.forEach((t, i) => {
      if (!Number.isInteger(t) || t < 0 || t > 0xffffffff) throw new Error(`blockTime out of u32 range: ${t}`);
      buf.writeUInt32LE(t, i * 4);
    });
    return { claimTypeId: id, nRecords: times.length, bytes: buf };
  }

  const q = claim.inputs.observed.quantities;
  // inv2b is tri-state in the JS engine (`=== true` proves, `=== false` disproves, absent is
  // neither) and the verdict differs across all three — so it is encoded as a tri-state byte.
  const inv2b = q.inv2b_ok === true ? 1 : q.inv2b_ok === false ? 0 : 2;
  const bytes = Buffer.concat([
    u128le(q.virtualValue),
    u128le(q.liability),
    Buffer.from([inv2b]),
    (() => { const b = Buffer.alloc(4); b.writeUInt32LE(q.staleRecords >>> 0); return b; })(),
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

/// The full commitment: what gets pinned on-chain at `open_market`, and the chunks that settle it.
export function inputsCommitment(claim, { calendarVersion = CAL_2026_VERSION } = {}) {
  const { claimTypeId, nRecords, bytes } = encodeRecords(claim);
  const header = Buffer.alloc(9);
  header.writeUInt8(claimTypeId, 0);
  header.writeUInt32LE(calendarVersion, 1);
  header.writeUInt32LE(nRecords, 5);

  let digest = sha256(header);
  const chunks = chunksOf(claimTypeId, bytes);
  for (const c of chunks) digest = sha256(digest, c);

  return { claimTypeId, calendarVersion, nRecords, inputsHash: digest, chunks, bytes };
}

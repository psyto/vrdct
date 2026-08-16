//! Vrdct — on-chain re-execution.
//!
//! The engine is claim-type-AGNOSTIC, exactly as in `core/claim.mjs`: a claim-type supplies a pure
//! `fold_record` (deterministic streaming re-execution) and a pure `verdict` (fold -> flag). Adding
//! a surface means adding a module here and a tag below — never editing the bond/settlement logic.
//!
//! ## Why streaming
//!
//! A real claim's inputs do not fit in a transaction (the reference Jupiter Lend claim pins 3,789
//! price-account updates = ~15 KB of records). So the input set is committed as a **hash chain**
//! and re-executed **incrementally**:
//!
//! ```text
//!   h_0     = sha256( [claim_type u8][calendar_version u32 LE][n_records u32 LE] )
//!   h_{i+1} = sha256( h_i || chunk_i )        chunks are canonical: CHUNK_RECORDS per chunk
//!   inputs_hash = h_N
//! ```
//!
//! Each `feed` folds its chunk into the running verdict state AND advances the digest. `settle`
//! refuses to pay out unless the running digest equals the `inputs_hash` committed at market open
//! and exactly `n_records` records were folded. Feeding a different input set yields a different
//! digest, so it can never settle — the commitment is what makes streaming safe.

pub mod campana;
pub mod cmls;
pub mod solvency;

use anchor_lang::prelude::*;

/// Verdict flags. Same alphabet as the JS claim-types; the bond contract speaks only in these.
pub const FLAG_UNKNOWN: u8 = 0;
pub const FLAG_GREEN: u8 = 1;
pub const FLAG_YELLOW: u8 = 2;
pub const FLAG_RED: u8 = 3;
pub const FLAG_STALE: u8 = 4;
pub const FLAG_MAX: u8 = 4;

/// Claim-type tags. `closed-market-liquidation-soundness` and `reserve-solvency`.
pub const CT_CMLS: u8 = 1;
pub const CT_SOLVENCY: u8 = 2;

/// Canonical chunking: records per `feed` chunk. Part of the hash chain, so it is consensus.
pub const CHUNK_RECORDS: u32 = 200;

/// Fixed record width per claim-type, in bytes.
pub fn record_size(claim_type: u8) -> Option<usize> {
    match claim_type {
        CT_CMLS => Some(cmls::RECORD_SIZE),
        CT_SOLVENCY => Some(solvency::RECORD_SIZE),
        _ => None,
    }
}

/// The running re-execution state. One flat struct shared by all claim-types (a Solana account
/// cannot hold a Rust enum cheaply); each type touches only its own fields.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, Debug, PartialEq)]
pub struct Fold {
    /// records folded so far — must equal `n_records` at settle
    pub count: u32,
    /// CMLS: updates observed while the regular US session was OPEN
    pub open_n: u32,
    /// CMLS: updates observed while it was CLOSED (weekend / holiday / after-hours / half-day)
    pub closed_n: u32,
    /// CMLS: largest gap between consecutive updates, in seconds
    pub max_gap: i64,
    /// CMLS: previous record's timestamp (records must arrive non-decreasing)
    pub last_ts: i64,
    /// SOLVENCY: recomputed backing
    pub backing: u128,
    /// SOLVENCY: liability
    pub liability: u128,
    /// SOLVENCY: redeemable-backing proof — 0 = false, 1 = true, 2 = absent
    pub inv2b: u8,
    /// SOLVENCY: stale record count
    pub stale_records: u32,
}

impl Fold {
    /// 4 + 4 + 4 + 8 + 8 + 16 + 16 + 1 + 4
    pub const SPACE: usize = 65;
}

/// Fold one canonical chunk into the state. Pure: no clock, no account reads, no float.
pub fn fold_chunk(claim_type: u8, fold: &mut Fold, chunk: &[u8]) -> Result<()> {
    match claim_type {
        CT_CMLS => cmls::fold_chunk(fold, chunk),
        CT_SOLVENCY => solvency::fold_chunk(fold, chunk),
        _ => err!(crate::errors::VrdctError::UnknownClaimType),
    }
}

/// The verdict — the deterministic function whose output controls the payout.
pub fn verdict(claim_type: u8, fold: &Fold) -> Result<u8> {
    match claim_type {
        CT_CMLS => Ok(cmls::verdict(fold)),
        CT_SOLVENCY => Ok(solvency::verdict(fold)),
        _ => err!(crate::errors::VrdctError::UnknownClaimType),
    }
}

#[cfg(test)]
mod calendar_tests;
#[cfg(test)]
mod parity_tests;

use crate::reexec::Fold;
use anchor_lang::prelude::*;

pub const STATE_OPEN: u8 = 0;
pub const STATE_CHALLENGED: u8 = 1;
pub const STATE_SETTLED: u8 = 2;

/// A market whose payout is controlled by an on-chain-STATE condition.
///
/// The market never stores an *answer* — it stores a **commitment to the inputs** (`inputs_hash`)
/// and the flag each side **asserts** the re-execution will produce. The answer is produced by the
/// program itself, at settle time, by re-executing the claim-type over those pinned inputs.
#[account]
pub struct Market {
    pub bump: u8,
    /// caller-chosen id (sha256 of the market question) — also the PDA seed
    pub market_id: [u8; 32],
    /// claim-type tag (see `reexec::CT_*`)
    pub claim_type: u8,
    /// pinned holiday-calendar version — part of the input commitment
    pub calendar_version: u32,
    /// number of records the inputs commit to
    pub n_records: u32,
    /// h_N of the canonical input hash chain
    pub inputs_hash: [u8; 32],
    /// bitmask over flags: the market resolves YES iff `(yes_when >> flag) & 1`
    pub yes_when: u8,

    pub resolver: Pubkey,
    /// the flag the resolver asserts re-execution will produce
    pub resolver_flag: u8,
    pub resolver_bond: u64,

    /// `Pubkey::default()` until challenged
    pub challenger: Pubkey,
    pub challenger_flag: u8,
    pub challenge_bond: u64,

    pub treasury: Pubkey,
    pub opened_ts: i64,
    pub challenge_until: i64,
    pub settled_ts: i64,

    pub state: u8,
    /// the flag the program itself re-executed (valid once settled)
    pub settled_flag: u8,
    /// 1 = YES, 0 = NO (valid once settled)
    pub resolved: u8,

    /// running hash chain over the fed input chunks — must reach `inputs_hash` to settle
    pub feed_digest: [u8; 32],
    /// running re-execution state
    pub fold: Fold,
}

impl Market {
    // 8 disc + 1 + 32 + 1 + 4 + 4 + 32 + 1 + 32 + 1 + 8 + 32 + 1 + 8 + 32 + 8*3 + 1*3 + 32 + Fold
    pub const SPACE: usize = 384;
}

#[event]
pub struct MarketOpened {
    pub market: Pubkey,
    pub resolver: Pubkey,
    pub claim_type: u8,
    pub asserted_flag: u8,
    pub bond: u64,
    pub n_records: u32,
    pub inputs_hash: [u8; 32],
}

#[event]
pub struct MarketChallenged {
    pub market: Pubkey,
    pub challenger: Pubkey,
    pub asserted_flag: u8,
    pub bond: u64,
}

#[event]
pub struct MarketSettled {
    pub market: Pubkey,
    /// what the program re-executed — not what anyone claimed
    pub settled_flag: u8,
    pub resolved: u8,
    pub winner: Pubkey,
    pub payout: u64,
    pub treasury_cut: u64,
    /// true when settlement came from on-chain re-execution rather than an unchallenged window
    pub by_reexecution: bool,
}

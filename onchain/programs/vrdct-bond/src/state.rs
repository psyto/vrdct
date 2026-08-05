use crate::reexec::Fold;
use anchor_lang::prelude::*;

pub const STATE_OPEN: u8 = 0;
pub const STATE_CHALLENGED: u8 = 1;
pub const STATE_SETTLED: u8 = 2;
/// Tombstone written before Anchor returns account rent; makes a repeat close reject even if a
/// validator retains the zero-lamport account until cleanup.
pub const STATE_CLOSED: u8 = 3;

/// A market whose payout is controlled by an on-chain-STATE condition.
///
/// The market never stores an *answer* — it stores a **commitment to the inputs** (`inputs_hash`)
/// and the flag each side **asserts** the re-execution will produce. The answer is produced by the
/// program itself, at settle time, by re-executing the claim-type over those pinned inputs.
#[account]
pub struct Market {
    pub bump: u8,
    /// sha256 over the complete market definition; this is the market PDA seed.
    pub definition_hash: [u8; 32],
    /// caller-chosen question hash, retained for discovery but never used as an address on its own.
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

    /// Pays account creation rent and receives it again after `close_market`.
    pub rent_payer: Pubkey,
    pub opened_ts: i64,
    pub challenge_until: i64,
    /// A challenged market that cannot close its input commitment exits against the resolver here.
    pub settle_by: i64,
    pub settled_ts: i64,

    pub state: u8,
    /// the flag the program itself re-executed (valid once settled)
    pub settled_flag: u8,
    /// 1 = YES, 0 = NO (valid once settled)
    pub resolved: u8,
}

impl Market {
    // 8 disc + 1 + 32*2 + 1 + 4*2 + 32 + 1 + 32 + 1 + 8 + 32 + 1 + 8 + 32 + 8*4 + 1*3
    pub const SPACE: usize = 8
        + 1
        + 32
        + 32
        + 1
        + 4
        + 4
        + 32
        + 1
        + 32
        + 1
        + 8
        + 32
        + 1
        + 8
        + 32
        + 8
        + 8
        + 8
        + 8
        + 1
        + 1
        + 1;
}

/// An independent re-execution attempt. A feeder can only mutate its own PDA, so a bad stream
/// cannot reset, poison, or delay a different feeder's completed commitment.
#[account]
pub struct Feed {
    pub bump: u8,
    pub market: Pubkey,
    pub feeder: Pubkey,
    /// h_N of this feeder's canonical input chain.
    pub digest: [u8; 32],
    /// Explicit committed-record count, kept equal to `fold.count` by `feed`.
    pub count: u32,
    pub fold: Fold,
}

impl Feed {
    pub const SPACE: usize = 8 + 1 + 32 + 32 + 32 + 4 + Fold::SPACE;
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
    /// The feed completer's 10% slash reward; there is no treasury address.
    pub cranker_reward: u64,
    /// true when settlement came from on-chain re-execution rather than an unchallenged window
    pub by_reexecution: bool,
}

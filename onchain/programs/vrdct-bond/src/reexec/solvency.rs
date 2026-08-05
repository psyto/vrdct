//! Claim-type `reserve-solvency` (Redde lineage), on-chain.
//!
//! Port of `claimtypes/solvency.mjs :: reexec`. Re-derives a protocol's solvency from recomputed
//! on-chain quantities: GREEN iff recomputed backing >= liability, redeemable backing proven, and
//! no stale records.
//!
//! Record (exactly one per claim, 37 bytes):
//!   `u128 LE backing | u128 LE liability | u8 inv2b (0 false, 1 true, 2 absent) | u32 LE stale`

use super::{Fold, FLAG_GREEN, FLAG_RED, FLAG_STALE, FLAG_UNKNOWN};
use crate::errors::VrdctError;
use anchor_lang::prelude::*;

pub const RECORD_SIZE: usize = 37;

const INV2B_FALSE: u8 = 0;
const INV2B_TRUE: u8 = 1;

pub fn fold_chunk(fold: &mut Fold, chunk: &[u8]) -> Result<()> {
    require!(chunk.len() == RECORD_SIZE, VrdctError::MalformedChunk);
    require!(fold.count == 0, VrdctError::MalformedChunk); // a solvency claim is a single record
    fold.backing = u128::from_le_bytes(chunk[0..16].try_into().unwrap());
    fold.liability = u128::from_le_bytes(chunk[16..32].try_into().unwrap());
    fold.inv2b = chunk[32];
    fold.stale_records = u32::from_le_bytes(chunk[33..37].try_into().unwrap());
    fold.count = 1;
    Ok(())
}

pub fn verdict(fold: &Fold) -> u8 {
    if fold.count == 0 {
        return FLAG_UNKNOWN;
    }
    let inv1_ok = fold.backing >= fold.liability;
    if !inv1_ok || fold.inv2b == INV2B_FALSE {
        FLAG_RED
    } else if fold.inv2b == INV2B_TRUE && fold.stale_records == 0 {
        FLAG_GREEN
    } else {
        FLAG_STALE
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(backing: u128, liability: u128, inv2b: u8, stale: u32) -> Vec<u8> {
        let mut v = Vec::with_capacity(RECORD_SIZE);
        v.extend_from_slice(&backing.to_le_bytes());
        v.extend_from_slice(&liability.to_le_bytes());
        v.push(inv2b);
        v.extend_from_slice(&stale.to_le_bytes());
        v
    }
    fn feed(backing: u128, liability: u128, inv2b: u8, stale: u32) -> Fold {
        let mut f = Fold::default();
        fold_chunk(&mut f, &record(backing, liability, inv2b, stale)).unwrap();
        f
    }

    #[test]
    fn covered_and_proven_is_green() {
        assert_eq!(verdict(&feed(1_000, 900, INV2B_TRUE, 0)), FLAG_GREEN);
        assert_eq!(verdict(&feed(900, 900, INV2B_TRUE, 0)), FLAG_GREEN); // equality covers
    }

    #[test]
    fn undercollateralized_is_red() {
        assert_eq!(verdict(&feed(899, 900, INV2B_TRUE, 0)), FLAG_RED);
    }

    #[test]
    fn disproven_redeemability_is_red() {
        assert_eq!(verdict(&feed(10_000, 1, INV2B_FALSE, 0)), FLAG_RED);
    }

    #[test]
    fn stale_records_downgrade() {
        assert_eq!(verdict(&feed(1_000, 900, INV2B_TRUE, 3)), FLAG_STALE);
        assert_eq!(verdict(&feed(1_000, 900, 2, 0)), FLAG_STALE); // proof absent
    }

    #[test]
    fn second_record_rejected() {
        let mut f = feed(1_000, 900, INV2B_TRUE, 0);
        assert!(fold_chunk(&mut f, &record(1, 1, INV2B_TRUE, 0)).is_err());
    }
}

//! Claim-type `closed-market-liquidation-soundness` (Vesper lineage), on-chain.
//!
//! Port of `claimtypes/closed-market-soundness.mjs :: classifyUpdateTimes` as a streaming fold.
//! Re-executes, from the pinned update-times of the price account a venue liquidates against,
//! whether that feed kept updating while the underlying US equity market was CLOSED with no
//! market-status guard — in which case liquidations run against a price the regulated market
//! never printed (RED).
//!
//!   liveness signal:  closed>0 && max_gap < 30min -> LIVE_THROUGH_CLOSURE -> guard NONE  -> RED
//!                     closed == 0                 -> FROZEN_THROUGH_CLOSURE -> STALENESS_ONLY -> YELLOW
//!                     otherwise                   -> SPARSE               -> UNKNOWN
//!
//! Record: `u32 LE` unix blockTime, ascending. 4 bytes — valid through 2106.

use super::campana::{is_session_open, is_valid_2026_timestamp};
use super::{Fold, FLAG_RED, FLAG_UNKNOWN, FLAG_YELLOW};
use crate::errors::VrdctError;
use anchor_lang::prelude::*;

pub const RECORD_SIZE: usize = 4;

/// Liveness threshold: updates closer together than this, through a closure, mean a live feed.
const LIVE_GAP_SECS: i64 = 30 * 60;

pub fn fold_chunk(fold: &mut Fold, chunk: &[u8]) -> Result<()> {
    require!(chunk.len() % RECORD_SIZE == 0, VrdctError::MalformedChunk);
    for rec in chunk.chunks_exact(RECORD_SIZE) {
        let ts = u32::from_le_bytes([rec[0], rec[1], rec[2], rec[3]]) as i64;
        require!(is_valid_2026_timestamp(ts), VrdctError::CalendarOutOfRange);
        if fold.count > 0 {
            // The canonical observation set is sorted by (slot, sig); out-of-order records would
            // make `max_gap` depend on submission order, so they are rejected outright.
            require!(ts >= fold.last_ts, VrdctError::RecordsOutOfOrder);
            let gap = ts - fold.last_ts;
            if gap > fold.max_gap {
                fold.max_gap = gap;
            }
        }
        if is_session_open(ts) {
            fold.open_n += 1;
        } else {
            fold.closed_n += 1;
        }
        fold.last_ts = ts;
        fold.count += 1;
    }
    Ok(())
}

pub fn verdict(fold: &Fold) -> u8 {
    if fold.count == 0 {
        return FLAG_UNKNOWN; // NO_DATA
    }
    if fold.closed_n > 0 && fold.max_gap < LIVE_GAP_SECS {
        FLAG_RED // LIVE_THROUGH_CLOSURE -> no market-status guard
    } else if fold.closed_n == 0 {
        FLAG_YELLOW // FROZEN_THROUGH_CLOSURE -> staleness guard only
    } else {
        FLAG_UNKNOWN // SPARSE
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(times: &[u32]) -> Fold {
        let mut f = Fold::default();
        let bytes: Vec<u8> = times.iter().flat_map(|t| t.to_le_bytes()).collect();
        fold_chunk(&mut f, &bytes).unwrap();
        f
    }

    #[test]
    fn live_through_closure_is_red() {
        // Sat 2026-08-01, one update per minute for an hour: market CLOSED, feed live -> RED.
        let base: u32 = 1785_600_000; // inside 2026-08-01 UTC
        let times: Vec<u32> = (0..60).map(|i| base + i * 60).collect();
        let f = feed(&times);
        assert_eq!(f.open_n, 0);
        assert_eq!(f.closed_n, 60);
        assert_eq!(verdict(&f), FLAG_RED);
    }

    #[test]
    fn open_hours_only_is_yellow() {
        // Mon 2026-08-03 13:30Z..14:29Z == 09:30..10:29 ET -> all OPEN -> no closed updates.
        let base: u32 = 1_785_763_800; // 2026-08-03T13:30:00Z
        let times: Vec<u32> = (0..60).map(|i| base + i * 60).collect();
        let f = feed(&times);
        assert_eq!(f.closed_n, 0);
        assert_eq!(verdict(&f), FLAG_YELLOW);
    }

    #[test]
    fn sparse_is_unknown() {
        // Two closed-window updates a day apart -> gap >= 30min -> SPARSE -> UNKNOWN.
        let f = feed(&[1785_600_000, 1785_686_400]);
        assert_eq!(verdict(&f), FLAG_UNKNOWN);
    }

    #[test]
    fn out_of_order_rejected() {
        let mut f = Fold::default();
        let bytes: Vec<u8> = [1785_600_060u32, 1785_600_000u32]
            .iter()
            .flat_map(|t| t.to_le_bytes())
            .collect();
        assert!(fold_chunk(&mut f, &bytes).is_err());
    }

    #[test]
    fn calendar_boundary_is_rejected() {
        let mut f = Fold::default();
        let bytes: Vec<u8> = [1_767_225_599u32, 1_767_225_600u32]
            .iter()
            .flat_map(|t| t.to_le_bytes())
            .collect();
        assert!(fold_chunk(&mut f, &bytes).is_err());
    }

    #[test]
    fn empty_is_unknown() {
        assert_eq!(verdict(&Fold::default()), FLAG_UNKNOWN);
    }
}

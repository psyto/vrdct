// Trading-day window selection for the keeper. Deliberately zero-dependency — it imports only
// `core/campana.mjs`, so the canonical test suite can cover it without pulling a Solana client into
// the root package.
//
// This is *selection*, not re-execution: the chosen bounds end up in the Market definition as
// `source.from_ts`/`to_ts`, and every re-executor reads them from the account rather than
// recomputing them. It therefore has no Rust twin, and must never be called from inside a
// claim-type's `reexec`.
import { marketStatus } from '../core/campana.mjs';

/// The completed close-to-close window ending at the most recent finished US-equities session.
///
/// Close-to-close rather than calendar-day because a market-hours-guarded feed is *silent* on
/// weekends and holidays: a Saturday-to-Sunday window would hold no records at all, and
/// `open_market` rejects `n_records == 0`. Anchoring on session closes means every window contains
/// one full session and the closure around it, so both a live-through-closure feed (RED) and a
/// guarded one (YELLOW) produce an openable, meaningful market.
export function tradingWindow(now) {
  const toTs = marketStatus(now).last_close_ts;
  if (toTs == null) throw new Error(`no completed trading session before chain time ${now}`);
  // One second before the completed close is still in the preceding bucket, so Campana returns
  // the prior trading-day close through weekends, holidays, and shortened sessions alike.
  const fromTs = marketStatus(toTs - 1).last_close_ts;
  if (fromTs == null) throw new Error(`no prior trading session before close ${toTs}`);
  return { fromTs, toTs, chainNow: now };
}

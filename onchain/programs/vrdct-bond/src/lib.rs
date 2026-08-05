//! Vrdct's lamport-custody program. Re-execution decides a challenged payout; no account in this
//! program is privileged. Market addresses bind the complete definition, and re-execution progress
//! belongs to a feeder-specific PDA rather than a globally resettable market field.

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use solana_sha256_hasher::hashv;

pub mod errors;
pub mod reexec;
pub mod state;

use errors::VrdctError;
use reexec::{record_size, CHUNK_RECORDS, CT_CMLS, FLAG_MAX};
use state::*;

declare_id!("7EtJACKUvpWGB524uqTykTzyCx1DyxKb76iEZVAiWwKS");

/// Slash reward paid to the feeder who closes the committed input chain.
pub const CUT_BPS: u64 = 1_000;
/// One hour gives a watching challenger a realistic chance to submit one transaction, while the
/// seven-day ceiling prevents a resolver from turning a small bond into an unbounded lock.
pub const MIN_CHALLENGE_WINDOW_SECS: i64 = 60 * 60;
pub const MAX_CHALLENGE_WINDOW_SECS: i64 = 7 * 24 * 60 * 60;
/// A challenged commitment has one further day to be completed before it resolves against its
/// resolver. This is a program constant, not an opener-selected term.
pub const SETTLEMENT_WINDOW_SECS: i64 = 24 * 60 * 60;

/// h_0 of the canonical input chain: `[claim_type u8][calendar_version u32 LE][n_records u32 LE]`.
pub fn header_digest(claim_type: u8, calendar_version: u32, n_records: u32) -> [u8; 32] {
    hashv(&[
        &[claim_type],
        &calendar_version.to_le_bytes(),
        &n_records.to_le_bytes(),
    ])
    .to_bytes()
}

/// The complete, bounded definition used as the market PDA seed. `market_id` remains a readable
/// question hash, but cannot by itself reserve address space. Mirrors `marketDefinitionHash` in JS.
pub fn market_definition_hash(
    market_id: &[u8; 32],
    claim_type: u8,
    calendar_version: u32,
    n_records: u32,
    inputs_hash: &[u8; 32],
    yes_when: u8,
    bond: u64,
    challenge_window_secs: i64,
) -> [u8; 32] {
    hashv(&[
        b"vrdct:market:v1",
        market_id,
        &[claim_type],
        &calendar_version.to_le_bytes(),
        &n_records.to_le_bytes(),
        inputs_hash,
        &[yes_when],
        &bond.to_le_bytes(),
        &challenge_window_secs.to_le_bytes(),
    ])
    .to_bytes()
}

/// 10% of `amount`, overflow-free for the whole u64 range.
fn cut_of(amount: u64) -> u64 {
    amount / 10_000 * CUT_BPS + (amount % 10_000) * CUT_BPS / 10_000
}

fn move_lamports(from: &AccountInfo, to: &AccountInfo, amount: u64) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let f = from
        .lamports()
        .checked_sub(amount)
        .ok_or(VrdctError::Overflow)?;
    let t = to
        .lamports()
        .checked_add(amount)
        .ok_or(VrdctError::Overflow)?;
    **from.try_borrow_mut_lamports()? = f;
    **to.try_borrow_mut_lamports()? = t;
    Ok(())
}

fn yes_from(yes_when: u8, flag: u8) -> u8 {
    (yes_when >> flag) & 1
}

#[program]
pub mod vrdct_bond {
    use super::*;

    #[allow(clippy::too_many_arguments)]
    pub fn open_market(
        ctx: Context<OpenMarket>,
        definition_hash: [u8; 32],
        market_id: [u8; 32],
        claim_type: u8,
        calendar_version: u32,
        n_records: u32,
        inputs_hash: [u8; 32],
        yes_when: u8,
        asserted_flag: u8,
        bond: u64,
        challenge_window_secs: i64,
    ) -> Result<()> {
        require!(
            record_size(claim_type).is_some(),
            VrdctError::UnknownClaimType
        );
        require!(asserted_flag <= FLAG_MAX, VrdctError::UnknownFlag);
        require!(bond > 0, VrdctError::ZeroBond);
        require!(n_records > 0, VrdctError::NoRecords);
        require!(
            (MIN_CHALLENGE_WINDOW_SECS..=MAX_CHALLENGE_WINDOW_SECS)
                .contains(&challenge_window_secs),
            VrdctError::ChallengeWindowOutOfBounds
        );
        require!(
            definition_hash
                == market_definition_hash(
                    &market_id,
                    claim_type,
                    calendar_version,
                    n_records,
                    &inputs_hash,
                    yes_when,
                    bond,
                    challenge_window_secs,
                ),
            VrdctError::MarketDefinitionMismatch
        );
        if claim_type == CT_CMLS {
            require!(
                calendar_version == reexec::campana::CAL_2026_VERSION,
                VrdctError::UnsupportedCalendar
            );
        }

        let now = Clock::get()?.unix_timestamp;
        let challenge_until = now
            .checked_add(challenge_window_secs)
            .ok_or(VrdctError::Overflow)?;
        let m = &mut ctx.accounts.market;
        m.bump = ctx.bumps.market;
        m.definition_hash = definition_hash;
        m.market_id = market_id;
        m.claim_type = claim_type;
        m.calendar_version = calendar_version;
        m.n_records = n_records;
        m.inputs_hash = inputs_hash;
        m.yes_when = yes_when;
        m.resolver = ctx.accounts.resolver.key();
        m.resolver_flag = asserted_flag;
        m.resolver_bond = bond;
        m.challenger = Pubkey::default();
        m.challenger_flag = 0;
        m.challenge_bond = 0;
        m.rent_payer = ctx.accounts.resolver.key();
        m.opened_ts = now;
        m.challenge_until = challenge_until;
        m.settle_by = challenge_until
            .checked_add(SETTLEMENT_WINDOW_SECS)
            .ok_or(VrdctError::Overflow)?;
        m.settled_ts = 0;
        m.state = STATE_OPEN;
        m.settled_flag = 0;
        m.resolved = 0;

        emit!(MarketOpened {
            market: m.key(),
            resolver: m.resolver,
            claim_type,
            asserted_flag,
            bond,
            n_records,
            inputs_hash,
        });
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.resolver.to_account_info(),
                    to: ctx.accounts.market.to_account_info(),
                },
            ),
            bond,
        )?;
        Ok(())
    }

    pub fn challenge(ctx: Context<Challenge>, asserted_flag: u8, bond: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        {
            let m = &ctx.accounts.market;
            require!(m.state == STATE_OPEN, VrdctError::WrongState);
            require!(now <= m.challenge_until, VrdctError::ChallengeWindowClosed);
            require!(asserted_flag <= FLAG_MAX, VrdctError::UnknownFlag);
            require!(
                asserted_flag != m.resolver_flag,
                VrdctError::ChallengeMustDiffer
            );
            require!(bond >= m.resolver_bond, VrdctError::ChallengeBondTooSmall);
        }
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.challenger.to_account_info(),
                    to: ctx.accounts.market.to_account_info(),
                },
            ),
            bond,
        )?;
        let m = &mut ctx.accounts.market;
        m.challenger = ctx.accounts.challenger.key();
        m.challenger_flag = asserted_flag;
        m.challenge_bond = bond;
        m.state = STATE_CHALLENGED;
        emit!(MarketChallenged {
            market: m.key(),
            challenger: m.challenger,
            asserted_flag,
            bond
        });
        Ok(())
    }

    /// Start a feeder-owned re-execution attempt. Another feeder receives a different PDA.
    pub fn open_feed(ctx: Context<OpenFeed>) -> Result<()> {
        let m = &ctx.accounts.market;
        require!(m.state != STATE_SETTLED, VrdctError::WrongState);
        let f = &mut ctx.accounts.feed;
        f.bump = ctx.bumps.feed;
        f.market = m.key();
        f.feeder = ctx.accounts.feeder.key();
        f.digest = header_digest(m.claim_type, m.calendar_version, m.n_records);
        f.count = 0;
        f.fold = Default::default();
        Ok(())
    }

    /// Re-execute one canonical chunk into the caller's Feed PDA only.
    pub fn feed(ctx: Context<FeedChunk>, chunk: Vec<u8>) -> Result<()> {
        let m = &ctx.accounts.market;
        require!(m.state != STATE_SETTLED, VrdctError::WrongState);
        let f = &mut ctx.accounts.feed;
        let rec = record_size(m.claim_type).ok_or(VrdctError::UnknownClaimType)?;
        require!(
            !chunk.is_empty() && chunk.len() % rec == 0,
            VrdctError::MalformedChunk
        );
        let fed = (chunk.len() / rec) as u32;
        let remaining = m
            .n_records
            .checked_sub(f.count)
            .ok_or(VrdctError::TooManyRecords)?;
        require!(remaining > 0, VrdctError::TooManyRecords);
        require!(
            fed == core::cmp::min(CHUNK_RECORDS, remaining),
            VrdctError::NonCanonicalChunk
        );
        reexec::fold_chunk(m.claim_type, &mut f.fold, &chunk)?;
        f.count = f.fold.count;
        f.digest = hashv(&[&f.digest, &chunk]).to_bytes();
        Ok(())
    }

    /// A feeder can discard only its own partial work, close its PDA, and start again.
    pub fn close_feed(_ctx: Context<CloseFeed>) -> Result<()> {
        // This stays available after the market's terminal payout so non-winning feeders do not
        // strand their own rent. It never touches the Market or another feeder's state.
        Ok(())
    }

    /// Close a valid feeder commitment and pay the correct side. The caller can be anyone, but the
    /// reward always belongs to the feeder that paid to construct and completed this Feed PDA.
    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let market_ai = ctx.accounts.market.to_account_info();
        let (
            claim_type,
            inputs_hash,
            n_records,
            resolver_bond,
            challenge_bond,
            resolver_flag,
            challenger_flag,
            yes_when,
        ) = {
            let m = &ctx.accounts.market;
            require!(m.state == STATE_CHALLENGED, VrdctError::WrongState);
            require!(now <= m.settle_by, VrdctError::SettlementDeadlineClosed);
            (
                m.claim_type,
                m.inputs_hash,
                m.n_records,
                m.resolver_bond,
                m.challenge_bond,
                m.resolver_flag,
                m.challenger_flag,
                m.yes_when,
            )
        };
        let feed = &ctx.accounts.feed;
        require!(
            feed.count == n_records && feed.fold.count == n_records,
            VrdctError::IncompleteFeed
        );
        require!(feed.digest == inputs_hash, VrdctError::InputsHashMismatch);
        let truth = reexec::verdict(claim_type, &feed.fold)?;
        let pot = resolver_bond
            .checked_add(challenge_bond)
            .ok_or(VrdctError::Overflow)?;
        let (winner_ai, winner_key, payout, cranker_reward) = if resolver_flag == truth {
            let reward = cut_of(challenge_bond);
            (
                ctx.accounts.resolver.to_account_info(),
                ctx.accounts.resolver.key(),
                pot.checked_sub(reward).ok_or(VrdctError::Overflow)?,
                reward,
            )
        } else if challenger_flag == truth {
            let reward = cut_of(resolver_bond);
            (
                ctx.accounts.challenger.to_account_info(),
                ctx.accounts.challenger.key(),
                pot.checked_sub(reward).ok_or(VrdctError::Overflow)?,
                reward,
            )
        } else {
            let reward = cut_of(pot);
            (
                ctx.accounts.feed_feeder.to_account_info(),
                ctx.accounts.feed_feeder.key(),
                pot.checked_sub(reward).ok_or(VrdctError::Overflow)?,
                reward,
            )
        };
        move_lamports(&market_ai, &winner_ai, payout)?;
        move_lamports(
            &market_ai,
            &ctx.accounts.feed_feeder.to_account_info(),
            cranker_reward,
        )?;

        let m = &mut ctx.accounts.market;
        m.state = STATE_SETTLED;
        m.settled_flag = truth;
        m.resolved = yes_from(yes_when, truth);
        m.settled_ts = now;
        emit!(MarketSettled {
            market: m.key(),
            settled_flag: truth,
            resolved: m.resolved,
            winner: winner_key,
            payout,
            cranker_reward,
            by_reexecution: true,
        });
        Ok(())
    }

    /// The only timed exit from CHALLENGED. If no feeder can close the resolver's commitment by
    /// `settle_by`, the resolver bears that failure and the challenger receives the full pot.
    pub fn expire_challenged(ctx: Context<ExpireChallenged>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let market_ai = ctx.accounts.market.to_account_info();
        let (pot, flag, yes_when) = {
            let m = &ctx.accounts.market;
            require!(m.state == STATE_CHALLENGED, VrdctError::WrongState);
            require!(now > m.settle_by, VrdctError::SettlementDeadlineOpen);
            (
                m.resolver_bond
                    .checked_add(m.challenge_bond)
                    .ok_or(VrdctError::Overflow)?,
                m.challenger_flag,
                m.yes_when,
            )
        };
        move_lamports(&market_ai, &ctx.accounts.challenger.to_account_info(), pot)?;
        let m = &mut ctx.accounts.market;
        m.state = STATE_SETTLED;
        m.settled_flag = flag;
        m.resolved = yes_from(yes_when, flag);
        m.settled_ts = now;
        emit!(MarketSettled {
            market: m.key(),
            settled_flag: flag,
            resolved: m.resolved,
            winner: m.challenger,
            payout: pot,
            cranker_reward: 0,
            by_reexecution: false,
        });
        Ok(())
    }

    pub fn claim_uncontested(ctx: Context<ClaimUncontested>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let market_ai = ctx.accounts.market.to_account_info();
        let (bond, flag, yes_when) = {
            let m = &ctx.accounts.market;
            require!(m.state == STATE_OPEN, VrdctError::WrongState);
            require!(now > m.challenge_until, VrdctError::ChallengeWindowOpen);
            (m.resolver_bond, m.resolver_flag, m.yes_when)
        };
        move_lamports(&market_ai, &ctx.accounts.resolver.to_account_info(), bond)?;
        let m = &mut ctx.accounts.market;
        m.state = STATE_SETTLED;
        m.settled_flag = flag;
        m.resolved = yes_from(yes_when, flag);
        m.settled_ts = now;
        emit!(MarketSettled {
            market: m.key(),
            settled_flag: flag,
            resolved: m.resolved,
            winner: m.resolver,
            payout: bond,
            cranker_reward: 0,
            by_reexecution: false,
        });
        Ok(())
    }

    /// Return market rent after any terminal path. Re-opening needs the same complete definition,
    /// therefore produces the same re-execution result; freeing this PDA is not a replay hazard.
    pub fn close_market(ctx: Context<CloseMarket>) -> Result<()> {
        require!(
            ctx.accounts.market.state == STATE_SETTLED,
            VrdctError::WrongState
        );
        // Anchor's `close` transfers lamports but the runtime may retain a zero-lamport account
        // until the next cleanup. Reject that tombstone so this transition is observably once-only.
        require!(
            ctx.accounts.market.to_account_info().lamports() > 0,
            VrdctError::AlreadyClosed
        );
        ctx.accounts.market.state = STATE_CLOSED;
        // `close` can run before Anchor's normal account-exit phase. Persist the tombstone before
        // rent leaves, so a retained zero-lamport account cannot be closed idempotently.
        ctx.accounts.market.exit(ctx.program_id)?;
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(definition_hash: [u8; 32])]
pub struct OpenMarket<'info> {
    #[account(mut)]
    pub resolver: Signer<'info>,
    #[account(init, payer = resolver, space = Market::SPACE, seeds = [b"market", definition_hash.as_ref()], bump)]
    pub market: Account<'info, Market>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Challenge<'info> {
    #[account(mut)]
    pub challenger: Signer<'info>,
    #[account(mut, seeds = [b"market", market.definition_hash.as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct OpenFeed<'info> {
    #[account(mut)]
    pub feeder: Signer<'info>,
    #[account(seeds = [b"market", market.definition_hash.as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(init, payer = feeder, space = Feed::SPACE, seeds = [b"feed", market.key().as_ref(), feeder.key().as_ref()], bump)]
    pub feed: Account<'info, Feed>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FeedChunk<'info> {
    pub feeder: Signer<'info>,
    #[account(seeds = [b"market", market.definition_hash.as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(mut, seeds = [b"feed", market.key().as_ref(), feeder.key().as_ref()], bump = feed.bump,
        constraint = feed.market == market.key() @ VrdctError::FeedMismatch,
        constraint = feed.feeder == feeder.key() @ VrdctError::FeedMismatch)]
    pub feed: Account<'info, Feed>,
}

#[derive(Accounts)]
pub struct CloseFeed<'info> {
    #[account(mut)]
    pub feeder: Signer<'info>,
    #[account(seeds = [b"market", market.definition_hash.as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(mut, close = feeder, seeds = [b"feed", market.key().as_ref(), feeder.key().as_ref()], bump = feed.bump,
        constraint = feed.market == market.key() @ VrdctError::FeedMismatch,
        constraint = feed.feeder == feeder.key() @ VrdctError::FeedMismatch)]
    pub feed: Account<'info, Feed>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    pub cranker: Signer<'info>,
    #[account(mut, seeds = [b"market", market.definition_hash.as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
    /// CHECK: pinned to the market's resolver.
    #[account(mut, address = market.resolver)]
    pub resolver: UncheckedAccount<'info>,
    /// CHECK: pinned to the market's challenger.
    #[account(mut, address = market.challenger)]
    pub challenger: UncheckedAccount<'info>,
    /// CHECK: the recipient of Feed rent and reward; pinned to the Feed itself.
    #[account(mut, address = feed.feeder)]
    pub feed_feeder: UncheckedAccount<'info>,
    #[account(mut, close = feed_feeder, seeds = [b"feed", market.key().as_ref(), feed_feeder.key().as_ref()], bump = feed.bump,
        constraint = feed.market == market.key() @ VrdctError::FeedMismatch)]
    pub feed: Account<'info, Feed>,
}

#[derive(Accounts)]
pub struct ExpireChallenged<'info> {
    #[account(mut, seeds = [b"market", market.definition_hash.as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
    /// CHECK: pinned to the market's challenger.
    #[account(mut, address = market.challenger)]
    pub challenger: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ClaimUncontested<'info> {
    #[account(mut, seeds = [b"market", market.definition_hash.as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
    /// CHECK: pinned to the market's resolver.
    #[account(mut, address = market.resolver)]
    pub resolver: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct CloseMarket<'info> {
    #[account(mut, close = rent_payer, seeds = [b"market", market.definition_hash.as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
    /// CHECK: recorded at market creation; receives only rent on close.
    #[account(mut, address = market.rent_payer)]
    pub rent_payer: UncheckedAccount<'info>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cut_is_ten_percent() {
        assert_eq!(cut_of(1_000_000_000), 100_000_000);
        assert_eq!(cut_of(7), 0);
        assert_eq!(cut_of(u64::MAX / 2), (u64::MAX / 2) / 10);
    }

    #[test]
    fn market_address_binds_every_term() {
        let args = (
            [1; 32],
            1,
            202601,
            3,
            [2; 32],
            2,
            1_000,
            MIN_CHALLENGE_WINDOW_SECS,
        );
        let h = market_definition_hash(
            &args.0, args.1, args.2, args.3, &args.4, args.5, args.6, args.7,
        );
        assert_ne!(
            h,
            market_definition_hash(
                &args.0,
                args.1,
                args.2,
                args.3,
                &args.4,
                args.5,
                args.6 + 1,
                args.7
            )
        );
        assert_ne!(
            h,
            market_definition_hash(
                &args.0,
                args.1,
                args.2,
                args.3,
                &args.4,
                args.5,
                args.6,
                args.7 + 1
            )
        );
    }

    #[test]
    fn yes_when_bitmask() {
        assert_eq!(yes_from(1 << reexec::FLAG_GREEN, reexec::FLAG_GREEN), 1);
        assert_eq!(yes_from(1 << reexec::FLAG_GREEN, reexec::FLAG_RED), 0);
    }
}

//! # Vrdct — on-chain bond & settlement
//!
//! **Re-execution decides the payout.** This program is the on-chain half of the thesis in the
//! repo root: a market poses a boolean on-chain-STATE condition, two sides post real lamports
//! behind opposing assertions about it, and the *program itself re-executes the condition* to
//! decide who is paid. No token vote. No committee. No price oracle. No admin key — there is no
//! authority anywhere in this file that can name a winner.
//!
//! ## The mechanism
//!
//! 1. `open_market` — a resolver commits to a claim's **inputs** (`inputs_hash`, the head of a
//!    canonical hash chain), asserts the flag re-execution will produce, and posts a bond.
//! 2. `challenge` — anyone who re-executed offline and got a *different* flag posts a matching
//!    bond behind their own assertion. Now the market has two sides and a real counterparty.
//! 3. `feed` — anyone streams the committed input records. Each chunk is folded into the running
//!    verdict state and into the running digest. This is the re-execution, on-chain, in the open.
//! 4. `settle` — pays out **only** if the streamed digest equals the committed `inputs_hash` and
//!    every committed record was folded. The winner is whoever asserted the flag the program just
//!    re-executed. The loser is slashed; the treasury takes 10%, mirroring `core/bond.mjs`.
//!
//! Feeding a different input set produces a different digest, so it can never settle. That is what
//! makes streaming safe: the payout is a pure function of inputs fixed *before* any money moved.
//!
//! ## Honest scope
//!
//! The settlement *logic* is trustless — anyone re-runs `feed` and gets the same verdict. The
//! residual trust is the same one the README names: a claim's **inputs**. `inputs_hash` pins them,
//! it does not source them. And an unchallenged false assertion settles optimistically at the end
//! of its window — the usual optimistic-oracle assumption that challenging a false claim is
//! profitable. Both are stated, not hidden.

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

/// Treasury cut on a slash, in basis points. Mirrors `CUT = 0.10` in `core/bond.mjs`.
pub const CUT_BPS: u64 = 1_000;

/// h_0 of the input hash chain: sha256 over the canonical header.
/// `[claim_type u8][calendar_version u32 LE][n_records u32 LE]`
fn header_digest(claim_type: u8, calendar_version: u32, n_records: u32) -> [u8; 32] {
    hashv(&[
        &[claim_type],
        &calendar_version.to_le_bytes(),
        &n_records.to_le_bytes(),
    ])
    .to_bytes()
}

/// 10% of `amount`, overflow-free for the whole u64 range.
fn cut_of(amount: u64) -> u64 {
    amount / 10_000 * CUT_BPS + (amount % 10_000) * CUT_BPS / 10_000
}

/// Move lamports out of the program-owned market account.
fn move_lamports(from: &AccountInfo, to: &AccountInfo, amount: u64) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let f = from
        .lamports()
        .checked_sub(amount)
        .ok_or(VrdctError::Overflow)?;
    let t = to.lamports().checked_add(amount).ok_or(VrdctError::Overflow)?;
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

    /// Open a market: commit to the inputs, assert a verdict, post a bond.
    #[allow(clippy::too_many_arguments)]
    pub fn open_market(
        ctx: Context<OpenMarket>,
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
        if claim_type == CT_CMLS {
            require!(
                calendar_version == reexec::campana::CAL_2026_VERSION,
                VrdctError::UnsupportedCalendar
            );
        }

        // The bond is real custody: lamports leave the resolver and sit in the market PDA.
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

        let now = Clock::get()?.unix_timestamp;
        let m = &mut ctx.accounts.market;
        m.bump = ctx.bumps.market;
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
        m.treasury = ctx.accounts.treasury.key();
        m.opened_ts = now;
        m.challenge_until = now
            .checked_add(challenge_window_secs)
            .ok_or(VrdctError::Overflow)?;
        m.settled_ts = 0;
        m.state = STATE_OPEN;
        m.settled_flag = 0;
        m.resolved = 0;
        m.feed_digest = header_digest(claim_type, calendar_version, n_records);
        m.fold = Default::default();

        emit!(MarketOpened {
            market: m.key(),
            resolver: m.resolver,
            claim_type,
            asserted_flag,
            bond,
            n_records,
            inputs_hash,
        });
        Ok(())
    }

    /// Take the other side: assert a different flag over the same pinned inputs, post a bond.
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
            bond,
        });
        Ok(())
    }

    /// Re-execute one canonical chunk of the committed inputs. Permissionless — anyone can crank.
    pub fn feed(ctx: Context<Feed>, chunk: Vec<u8>) -> Result<()> {
        let m = &mut ctx.accounts.market;
        require!(m.state != STATE_SETTLED, VrdctError::WrongState);

        let rec = record_size(m.claim_type).ok_or(VrdctError::UnknownClaimType)?;
        require!(!chunk.is_empty(), VrdctError::MalformedChunk);
        require!(chunk.len() % rec == 0, VrdctError::MalformedChunk);

        // Canonical chunking is part of the commitment: every chunk is CHUNK_RECORDS records
        // except the last, which is the remainder. Any other split hashes to something else, so
        // the chain could not close — this check just fails it early and loudly.
        let fed = (chunk.len() / rec) as u32;
        let remaining = m
            .n_records
            .checked_sub(m.fold.count)
            .ok_or(VrdctError::TooManyRecords)?;
        require!(remaining > 0, VrdctError::TooManyRecords);
        let expected = core::cmp::min(CHUNK_RECORDS, remaining);
        require!(fed == expected, VrdctError::NonCanonicalChunk);

        reexec::fold_chunk(m.claim_type, &mut m.fold, &chunk)?;
        m.feed_digest = hashv(&[&m.feed_digest, &chunk]).to_bytes();
        Ok(())
    }

    /// Discard a partial/garbage feed and start the chain over from h_0. Permissionless: a feeder
    /// who streams the wrong records can only waste their own fees, never poison a settlement.
    pub fn reset_feed(ctx: Context<Feed>) -> Result<()> {
        let m = &mut ctx.accounts.market;
        require!(m.state != STATE_SETTLED, VrdctError::WrongState);
        m.fold = Default::default();
        m.feed_digest = header_digest(m.claim_type, m.calendar_version, m.n_records);
        Ok(())
    }

    /// Settle by re-execution. The program computes the verdict itself and pays the side that
    /// asserted it. Permissionless — the cranker has no discretion, only the ability to finish.
    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        let market_ai = ctx.accounts.market.to_account_info();
        let (claim_type, fold, inputs_hash, digest, n_records) = {
            let m = &ctx.accounts.market;
            require!(m.state == STATE_CHALLENGED, VrdctError::WrongState);
            (
                m.claim_type,
                m.fold,
                m.inputs_hash,
                m.feed_digest,
                m.n_records,
            )
        };
        require!(fold.count == n_records, VrdctError::IncompleteFeed);
        require!(digest == inputs_hash, VrdctError::InputsHashMismatch);

        // The verdict. Nobody supplies it; the program derives it from the pinned inputs.
        let truth = reexec::verdict(claim_type, &fold)?;

        let (resolver_bond, challenge_bond, resolver_flag, challenger_flag, yes_when) = {
            let m = &ctx.accounts.market;
            (
                m.resolver_bond,
                m.challenge_bond,
                m.resolver_flag,
                m.challenger_flag,
                m.yes_when,
            )
        };

        let (winner_ai, winner_key, payout, treasury_cut) = if resolver_flag == truth {
            let c = cut_of(challenge_bond);
            (
                ctx.accounts.resolver.to_account_info(),
                ctx.accounts.resolver.key(),
                resolver_bond + challenge_bond - c,
                c,
            )
        } else if challenger_flag == truth {
            let c = cut_of(resolver_bond);
            (
                ctx.accounts.challenger.to_account_info(),
                ctx.accounts.challenger.key(),
                resolver_bond + challenge_bond - c,
                c,
            )
        } else {
            // Both sides asserted a flag the re-execution did not produce. Neither earned the pot;
            // it goes to whoever actually proved it — the cranker who streamed the inputs.
            let pot = resolver_bond + challenge_bond;
            let c = cut_of(pot);
            (
                ctx.accounts.cranker.to_account_info(),
                ctx.accounts.cranker.key(),
                pot - c,
                c,
            )
        };

        move_lamports(&market_ai, &winner_ai, payout)?;
        move_lamports(
            &market_ai,
            &ctx.accounts.treasury.to_account_info(),
            treasury_cut,
        )?;

        let m = &mut ctx.accounts.market;
        m.state = STATE_SETTLED;
        m.settled_flag = truth;
        m.resolved = yes_from(yes_when, truth);
        m.settled_ts = Clock::get()?.unix_timestamp;

        emit!(MarketSettled {
            market: m.key(),
            settled_flag: truth,
            resolved: m.resolved,
            winner: winner_key,
            payout,
            treasury_cut,
            by_reexecution: true,
        });
        Ok(())
    }

    /// No one took the other side before the window closed: the assertion stands optimistically
    /// and the resolver's bond is returned. Nothing was re-executed on-chain here — the event says
    /// so (`by_reexecution: false`), because a settlement nobody contested is a weaker fact.
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
            treasury_cut: 0,
            by_reexecution: false,
        });
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(market_id: [u8; 32])]
pub struct OpenMarket<'info> {
    #[account(mut)]
    pub resolver: Signer<'info>,
    #[account(
        init,
        payer = resolver,
        space = Market::SPACE,
        seeds = [b"market", market_id.as_ref()],
        bump
    )]
    pub market: Account<'info, Market>,
    /// CHECK: recipient of the slash cut only; recorded on the market at open time.
    pub treasury: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Challenge<'info> {
    #[account(mut)]
    pub challenger: Signer<'info>,
    #[account(mut, seeds = [b"market", market.market_id.as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Feed<'info> {
    pub cranker: Signer<'info>,
    #[account(mut, seeds = [b"market", market.market_id.as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(mut)]
    pub cranker: Signer<'info>,
    #[account(mut, seeds = [b"market", market.market_id.as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
    /// CHECK: address is pinned to the market's recorded resolver.
    #[account(mut, address = market.resolver)]
    pub resolver: UncheckedAccount<'info>,
    /// CHECK: address is pinned to the market's recorded challenger.
    #[account(mut, address = market.challenger)]
    pub challenger: UncheckedAccount<'info>,
    /// CHECK: address is pinned to the market's recorded treasury.
    #[account(mut, address = market.treasury)]
    pub treasury: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ClaimUncontested<'info> {
    #[account(mut, seeds = [b"market", market.market_id.as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
    /// CHECK: address is pinned to the market's recorded resolver.
    #[account(mut, address = market.resolver)]
    pub resolver: UncheckedAccount<'info>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cut_is_ten_percent() {
        assert_eq!(cut_of(1_000_000_000), 100_000_000);
        assert_eq!(cut_of(0), 0);
        assert_eq!(cut_of(7), 0); // sub-basis-point dust stays with the winner
        assert_eq!(cut_of(u64::MAX / 2), (u64::MAX / 2) / 10);
    }

    #[test]
    fn yes_when_bitmask() {
        let green_only = 1u8 << reexec::FLAG_GREEN;
        assert_eq!(yes_from(green_only, reexec::FLAG_GREEN), 1);
        assert_eq!(yes_from(green_only, reexec::FLAG_RED), 0);
    }

    #[test]
    fn header_digest_is_stable() {
        let a = header_digest(1, 202601, 3789);
        let b = header_digest(1, 202601, 3789);
        assert_eq!(a, b);
        assert_ne!(a, header_digest(1, 202601, 3790));
    }
}

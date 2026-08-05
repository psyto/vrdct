//! Program-test coverage for custody transitions and account constraints. These tests deliberately
//! invoke the real instruction ABI: a unit test of the handler alone would miss PDA/`close` rules.
#![allow(deprecated)] // ProgramTest 2.x still exposes the system-program ID through solana_sdk.

use anchor_lang::{AccountSerialize, InstructionData};
use solana_program_test::{processor, ProgramTest, ProgramTestContext};
use solana_sdk::{
    account::Account,
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    system_program,
    transaction::Transaction,
};
use solana_sha256_hasher::hashv;
use vrdct_bond::{
    header_digest, market_definition_hash, reexec,
    state::{Feed, Market, STATE_CHALLENGED, STATE_OPEN, STATE_SETTLED},
};

const BOND: u64 = 1_000;

fn account<T: AccountSerialize>(value: &T, lamports: u64) -> Account {
    let mut data = Vec::new();
    value.try_serialize(&mut data).unwrap();
    Account {
        lamports,
        data,
        owner: vrdct_bond::ID,
        executable: false,
        rent_epoch: 0,
    }
}

fn market(
    definition_hash: [u8; 32],
    resolver: Pubkey,
    challenger: Pubkey,
    state: u8,
    settle_by: i64,
) -> Market {
    Market {
        bump: 255,
        definition_hash,
        market_id: [7; 32],
        claim_type: reexec::CT_CMLS,
        calendar_version: reexec::campana::CAL_2026_VERSION,
        n_records: 1,
        inputs_hash: [0; 32],
        yes_when: 1 << reexec::FLAG_RED,
        resolver,
        resolver_flag: reexec::FLAG_RED,
        resolver_bond: BOND,
        challenger,
        challenger_flag: reexec::FLAG_GREEN,
        challenge_bond: BOND,
        rent_payer: resolver,
        opened_ts: 0,
        challenge_until: 0,
        settle_by,
        settled_ts: 0,
        state,
        settled_flag: 0,
        resolved: 0,
    }
}

fn pda(definition: &[u8; 32]) -> Pubkey {
    Pubkey::find_program_address(&[b"market", definition], &vrdct_bond::ID).0
}
fn feed_pda(market: &Pubkey, feeder: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[b"feed", market.as_ref(), feeder.as_ref()],
        &vrdct_bond::ID,
    )
    .0
}
// Anchor's generated entrypoint ties the AccountInfo value and slice lifetimes together, while
// Solana 2.3's program-test processor accepts them independently. The runtime owns both for the
// complete synchronous call, so this adapter only narrows the slice lifetime for that call.
fn process_instruction(
    program_id: &Pubkey,
    accounts: &[solana_sdk::account_info::AccountInfo],
    data: &[u8],
) -> solana_sdk::entrypoint::ProgramResult {
    let tied: &[solana_sdk::account_info::AccountInfo<'_>] =
        unsafe { std::mem::transmute(accounts) };
    vrdct_bond::entry(program_id, tied, data)
}

fn ix(_name: &str, data: Vec<u8>, accounts: Vec<AccountMeta>) -> Instruction {
    Instruction {
        program_id: vrdct_bond::ID,
        accounts,
        data,
    }
}
async fn send(
    ctx: &mut ProgramTestContext,
    instruction: Instruction,
    signers: &[&Keypair],
) -> Result<(), solana_program_test::BanksClientError> {
    let bh = ctx.banks_client.get_latest_blockhash().await.unwrap();
    let mut tx = Transaction::new_with_payer(&[instruction], Some(&ctx.payer.pubkey()));
    let mut all = vec![&ctx.payer];
    all.extend_from_slice(signers);
    tx.sign(&all, bh);
    ctx.banks_client.process_transaction(tx).await
}

#[tokio::test]
#[ignore = "requires the BPF artifact; run npm run test:integration"]
async fn open_rejects_zero_and_negative_windows() {
    let resolver = Keypair::new();
    let mut pt = ProgramTest::new(
        "vrdct_bond",
        vrdct_bond::ID,
        processor!(process_instruction),
    );
    pt.add_account(
        resolver.pubkey(),
        Account {
            lamports: 10_000_000,
            ..Account::default()
        },
    );
    let mut ctx = pt.start_with_context().await;
    for window in [0, -1] {
        let definition = market_definition_hash(
            &[window as u8; 32],
            reexec::CT_CMLS,
            202601,
            1,
            &[1; 32],
            0,
            BOND,
            window,
        );
        let market_key = pda(&definition);
        let data = vrdct_bond::instruction::OpenMarket {
            definition_hash: definition,
            market_id: [window as u8; 32],
            claim_type: reexec::CT_CMLS,
            calendar_version: 202601,
            n_records: 1,
            inputs_hash: [1; 32],
            yes_when: 0,
            asserted_flag: reexec::FLAG_RED,
            bond: BOND,
            challenge_window_secs: window,
        }
        .data();
        assert!(send(
            &mut ctx,
            ix(
                "open_market",
                data,
                vec![
                    AccountMeta::new(resolver.pubkey(), true),
                    AccountMeta::new(market_key, false),
                    AccountMeta::new_readonly(system_program::id(), false),
                ]
            ),
            &[&resolver]
        )
        .await
        .is_err());
    }
}

#[tokio::test]
#[ignore = "requires the BPF artifact; run npm run test:integration"]
async fn expiry_and_uncontested_are_terminal_exits() {
    let resolver = Keypair::new();
    let challenger = Keypair::new();
    let d1 = [1; 32];
    let m1 = pda(&d1);
    let d2 = [2; 32];
    let m2 = pda(&d2);
    let mut pt = ProgramTest::new(
        "vrdct_bond",
        vrdct_bond::ID,
        processor!(process_instruction),
    );
    pt.add_account(
        resolver.pubkey(),
        Account {
            lamports: 1_000_000,
            ..Account::default()
        },
    );
    pt.add_account(
        challenger.pubkey(),
        Account {
            lamports: 1_000_000,
            ..Account::default()
        },
    );
    pt.add_account(
        m1,
        account(
            &market(
                d1,
                resolver.pubkey(),
                challenger.pubkey(),
                STATE_CHALLENGED,
                -1,
            ),
            2 * BOND + 10_000,
        ),
    );
    pt.add_account(
        m2,
        account(
            &market(d2, resolver.pubkey(), Pubkey::default(), STATE_OPEN, -1),
            BOND + 10_000,
        ),
    );
    let mut ctx = pt.start_with_context().await;
    let before = ctx
        .banks_client
        .get_balance(challenger.pubkey())
        .await
        .unwrap();
    send(
        &mut ctx,
        ix(
            "expire_challenged",
            vrdct_bond::instruction::ExpireChallenged {}.data(),
            vec![
                AccountMeta::new(m1, false),
                AccountMeta::new(challenger.pubkey(), false),
            ],
        ),
        &[],
    )
    .await
    .unwrap();
    assert_eq!(
        ctx.banks_client
            .get_balance(challenger.pubkey())
            .await
            .unwrap(),
        before + 2 * BOND
    );
    let before_resolver = ctx
        .banks_client
        .get_balance(resolver.pubkey())
        .await
        .unwrap();
    send(
        &mut ctx,
        ix(
            "claim_uncontested",
            vrdct_bond::instruction::ClaimUncontested {}.data(),
            vec![
                AccountMeta::new(m2, false),
                AccountMeta::new(resolver.pubkey(), false),
            ],
        ),
        &[],
    )
    .await
    .unwrap();
    assert_eq!(
        ctx.banks_client
            .get_balance(resolver.pubkey())
            .await
            .unwrap(),
        before_resolver + BOND
    );
}

#[tokio::test]
#[ignore = "requires the BPF artifact; run npm run test:integration"]
async fn feeds_are_isolated_and_settle_pays_the_feeder_not_the_caller() {
    let resolver = Keypair::new();
    let challenger = Keypair::new();
    let feeder = Keypair::new();
    let second_feeder = Keypair::new();
    let caller = Keypair::new();
    let definition = [3; 32];
    let market_key = pda(&definition);
    let ts = 1_767_225_600u32;
    let chunk = ts.to_le_bytes().to_vec();
    let digest = hashv(&[&header_digest(reexec::CT_CMLS, 202601, 1), &chunk]).to_bytes();
    let mut m = market(
        definition,
        resolver.pubkey(),
        challenger.pubkey(),
        STATE_CHALLENGED,
        i64::MAX,
    );
    m.inputs_hash = digest;
    let mut pt = ProgramTest::new(
        "vrdct_bond",
        vrdct_bond::ID,
        processor!(process_instruction),
    );
    pt.add_account(market_key, account(&m, 2 * BOND + 20_000));
    for k in [&feeder, &second_feeder] {
        pt.add_account(
            k.pubkey(),
            Account {
                lamports: 10_000_000,
                ..Account::default()
            },
        );
    }
    for k in [&resolver, &challenger, &caller] {
        pt.add_account(
            k.pubkey(),
            Account {
                lamports: 1_000_000,
                ..Account::default()
            },
        );
    }
    let mut ctx = pt.start_with_context().await;
    let f1 = feed_pda(&market_key, &feeder.pubkey());
    let f2 = feed_pda(&market_key, &second_feeder.pubkey());
    for (who, feed) in [(&feeder, f1), (&second_feeder, f2)] {
        send(
            &mut ctx,
            ix(
                "open_feed",
                vrdct_bond::instruction::OpenFeed {}.data(),
                vec![
                    AccountMeta::new(who.pubkey(), true),
                    AccountMeta::new_readonly(market_key, false),
                    AccountMeta::new(feed, false),
                    AccountMeta::new_readonly(system_program::id(), false),
                ],
            ),
            &[who],
        )
        .await
        .unwrap();
    }
    send(
        &mut ctx,
        ix(
            "feed",
            vrdct_bond::instruction::Feed {
                chunk: chunk.clone(),
            }
            .data(),
            vec![
                AccountMeta::new_readonly(feeder.pubkey(), true),
                AccountMeta::new_readonly(market_key, false),
                AccountMeta::new(f1, false),
            ],
        ),
        &[&feeder],
    )
    .await
    .unwrap();
    let saved = ctx
        .banks_client
        .get_account(f1)
        .await
        .unwrap()
        .unwrap()
        .data;
    // The second feeder cannot name or mutate f1: its own feed remains independent and f1 bytes do not change.
    assert!(send(
        &mut ctx,
        ix(
            "feed",
            vrdct_bond::instruction::Feed { chunk }.data(),
            vec![
                AccountMeta::new_readonly(second_feeder.pubkey(), true),
                AccountMeta::new_readonly(market_key, false),
                AccountMeta::new(f1, false),
            ]
        ),
        &[&second_feeder]
    )
    .await
    .is_err());
    assert_eq!(
        ctx.banks_client
            .get_account(f1)
            .await
            .unwrap()
            .unwrap()
            .data,
        saved
    );
    let feeder_before = ctx.banks_client.get_balance(feeder.pubkey()).await.unwrap();
    let caller_before = ctx.banks_client.get_balance(caller.pubkey()).await.unwrap();
    send(
        &mut ctx,
        ix(
            "settle",
            vrdct_bond::instruction::Settle {}.data(),
            vec![
                AccountMeta::new_readonly(caller.pubkey(), true),
                AccountMeta::new(market_key, false),
                AccountMeta::new(resolver.pubkey(), false),
                AccountMeta::new(challenger.pubkey(), false),
                AccountMeta::new(feeder.pubkey(), false),
                AccountMeta::new(f1, false),
            ],
        ),
        &[&caller],
    )
    .await
    .unwrap();
    assert!(
        ctx.banks_client.get_balance(feeder.pubkey()).await.unwrap() >= feeder_before + BOND / 10
    );
    assert_eq!(
        ctx.banks_client.get_balance(caller.pubkey()).await.unwrap(),
        caller_before
    );
}

#[tokio::test]
#[ignore = "requires the BPF artifact; run npm run test:integration"]
async fn settle_rejects_foreign_feed_and_market_closes_only_once_settled() {
    let resolver = Keypair::new();
    let challenger = Keypair::new();
    let feeder = Keypair::new();
    let d1 = [4; 32];
    let d2 = [5; 32];
    let m1 = pda(&d1);
    let m2 = pda(&d2);
    let feed = feed_pda(&m1, &feeder.pubkey());
    let mut foreign = Feed {
        bump: 255,
        market: m2,
        feeder: feeder.pubkey(),
        digest: [0; 32],
        count: 0,
        fold: Default::default(),
    };
    foreign.fold.count = 0;
    let mut pt = ProgramTest::new(
        "vrdct_bond",
        vrdct_bond::ID,
        processor!(process_instruction),
    );
    for k in [&resolver, &challenger, &feeder] {
        pt.add_account(
            k.pubkey(),
            Account {
                lamports: 1_000_000,
                ..Account::default()
            },
        );
    }
    pt.add_account(
        m1,
        account(
            &market(
                d1,
                resolver.pubkey(),
                challenger.pubkey(),
                STATE_CHALLENGED,
                i64::MAX,
            ),
            2 * BOND + 10_000,
        ),
    );
    pt.add_account(
        m2,
        account(
            &market(d2, resolver.pubkey(), challenger.pubkey(), STATE_SETTLED, 0),
            10_000,
        ),
    );
    pt.add_account(feed, account(&foreign, 10_000));
    let mut ctx = pt.start_with_context().await;
    let payer = ctx.payer.pubkey();
    assert!(send(
        &mut ctx,
        ix(
            "settle",
            vrdct_bond::instruction::Settle {}.data(),
            vec![
                AccountMeta::new_readonly(payer, true),
                AccountMeta::new(m1, false),
                AccountMeta::new(resolver.pubkey(), false),
                AccountMeta::new(challenger.pubkey(), false),
                AccountMeta::new(feeder.pubkey(), false),
                AccountMeta::new(feed, false),
            ]
        ),
        &[]
    )
    .await
    .is_err());
    // `m2` is settled, so exactly one close succeeds; a second call cannot resurrect or close it again.
    send(
        &mut ctx,
        ix(
            "close_market",
            vrdct_bond::instruction::CloseMarket {}.data(),
            vec![
                AccountMeta::new(m2, false),
                AccountMeta::new(resolver.pubkey(), false),
            ],
        ),
        &[],
    )
    .await
    .unwrap();
    assert!(ctx.banks_client.get_account(m2).await.unwrap().is_none());
    assert!(send(
        &mut ctx,
        ix(
            "close_market",
            vrdct_bond::instruction::CloseMarket {}.data(),
            vec![
                AccountMeta::new(m2, false),
                AccountMeta::new(resolver.pubkey(), false),
            ]
        ),
        &[]
    )
    .await
    .is_err());
}

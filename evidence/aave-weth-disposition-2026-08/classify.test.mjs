// Adversarial fixtures for the disposition classifier.
//
// Every case here is one the classifier could plausibly get WRONG, and most of them are wrong in the
// direction that would make the headline number bigger. That is deliberate: a fixture set that only
// contains the cases the implementation already handles measures the fixture, not the boundary — the
// sentence this repo has now paid for in three separate tasks.
import assert from 'node:assert/strict';
import test from 'node:test';
import { classify, ruleSet, VERDICT, TRANSFER, WETH_DEPOSIT, WETH_WITHDRAWAL } from './classify.mjs';

const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const WSTETH = '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0';
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const DEBT = '0xea51d7853eefb32b6ee06b1c12e6dcca88be0ffe';   // Aave's variableDebtWETH
const ATOKEN = '0x4d5f47fa6a74757f35c14fd3a6ef8e3c9bc514e8';
const USER = '0xbbbb000000000000000000000000000000000001';
const OTHER = '0xcccc000000000000000000000000000000000002';   // a different onBehalfOf
const ROUTER = '0xdddd000000000000000000000000000000000003';
const CEX = '0xeeee000000000000000000000000000000000004';

const AMOUNT = 5_000000000000000000n;   // 5 WETH
const pad = (a) => '0x' + '0'.repeat(24) + a.slice(2);
const word = (v) => '0x' + v.toString(16).padStart(64, '0');
const xfer = (token, from, to, value) => ({ address: token, topics: [TRANSFER, pad(from), pad(to)], data: word(value) });
const unwrap = (who, wad) => ({ address: WETH, topics: [WETH_WITHDRAWAL, pad(who)], data: word(wad) });
const wrap = (who, wad) => ({ address: WETH, topics: [WETH_DEPOSIT, pad(who)], data: word(wad) });
// Aave mints this on every borrow. It is in every fixture precisely because it must never matter.
const mintDebt = (who, v) => xfer(DEBT, '0x0000000000000000000000000000000000000000', who, v);
const deliver = (who = USER) => [mintDebt(who, AMOUNT), xfer(WETH, ATOKEN, who, AMOUNT)];

const RULES = ruleSet({ ethDenominated: [WETH, WSTETH] });
const run = (logs, user = USER) => classify({ user, amount: AMOUNT, logs, weth: WETH, rules: RULES, debtToken: DEBT });

test('proceeds into a liquid staking token stay ETH-denominated — the case that would inflate the number', () => {
  const r = run([...deliver(), xfer(WETH, USER, ROUTER, AMOUNT), xfer(WSTETH, ROUTER, USER, 4_100000000000000000n)]);
  assert.equal(r.verdict, VERDICT.STAYED_ETH, 'a WETH -> wstETH loop was counted as leaving ETH');
});

test('unwrapping to native ETH stays ETH-denominated, and is invisible to Transfer alone', () => {
  const logs = [...deliver(), unwrap(USER, AMOUNT)];
  assert.equal(logs.filter((l) => l.topics[0] === TRANSFER && l.address === WETH).length, 1,
    'the fixture must contain no Transfer explaining where the WETH went, or it proves nothing');
  assert.equal(run(logs).verdict, VERDICT.STAYED_ETH);
});

test('proceeds into a stablecoin leave ETH denomination', () => {
  const r = run([...deliver(), xfer(WETH, USER, ROUTER, AMOUNT), xfer(USDC, ROUTER, USER, 12_000_000000n)]);
  assert.equal(r.verdict, VERDICT.LEFT_ETH);
  assert.match(r.detail, /a0b86991/);
});

test('a flash borrow repaid in the same transaction is excluded, not counted as anything', () => {
  const r = run([...deliver(), xfer(WETH, USER, ROUTER, AMOUNT), xfer(WETH, ROUTER, USER, AMOUNT), xfer(WETH, USER, ATOKEN, AMOUNT)]);
  assert.equal(r.verdict, VERDICT.FLASH);
});

test('a round trip that ends back in WETH did not leave ETH denomination', () => {
  const r = run([...deliver(),
    xfer(WETH, USER, ROUTER, AMOUNT), xfer(USDC, ROUTER, USER, 12_000_000000n),
    xfer(USDC, USER, ROUTER, 12_000_000000n), xfer(WETH, ROUTER, USER, AMOUNT)]);
  assert.notEqual(r.verdict, VERDICT.LEFT_ETH, 'an intra-transaction round trip was counted as a sale');
  assert.equal(r.verdict, VERDICT.HELD);
});

test('WETH sent somewhere opaque is UNRESOLVED, never a sale', () => {
  const r = run([...deliver(), xfer(WETH, USER, CEX, AMOUNT)]);
  assert.equal(r.verdict, VERDICT.UNRESOLVED, 'an unexplained transfer out was counted as a sale');
});

test('the debt token Aave mints on every borrow is never evidence of anything', () => {
  // Without the exclusion this is a non-ETH-denominated gain and reads as LEFT_ETH.
  const r = run([...deliver()]);
  assert.equal(r.verdict, VERDICT.HELD);
  const withoutExclusion = classify({ user: USER, amount: AMOUNT, logs: deliver(), weth: WETH, rules: RULES });
  assert.equal(withoutExclusion.verdict, VERDICT.LEFT_ETH,
    'the fixture must show the debt token WOULD mislead, or the exclusion is untested');
});

test('wrapping ETH in the same transaction does not manufacture an ETH-denominated gain', () => {
  const r = run([...deliver(), wrap(USER, 2_000000000000000000n)]);
  assert.equal(r.verdict, VERDICT.HELD, 'a wrap was read as proceeds staying in ETH via another asset');
});

test('the funds follow `user`, and reading `onBehalfOf` instead changes the answer', () => {
  // Probe 2's bug, frozen: a borrow whose debt sits with OTHER while the WETH goes to USER.
  const logs = [mintDebt(OTHER, AMOUNT), xfer(WETH, ATOKEN, USER, AMOUNT),
    xfer(WETH, USER, ROUTER, AMOUNT), xfer(USDC, ROUTER, USER, 12_000_000000n)];
  assert.equal(run(logs, USER).verdict, VERDICT.LEFT_ETH);
  assert.notEqual(run(logs, OTHER).verdict, VERDICT.LEFT_ETH,
    'following onBehalfOf must NOT reproduce the right answer, or the distinction is untested');
});

test('an ERC-721 transfer is not a token gain, and it is the case no hand-written fixture had', () => {
  // Same topic0 as ERC-20, but the tokenId is INDEXED: four topics, empty data. Found by the first
  // real transaction that contained one — BigInt('0x') threw. Had it not thrown, an NFT arriving at
  // the borrower would have read as a non-ETH-denominated gain, i.e. as a sale.
  const nft = { address: '0xnft00000000000000000000000000000000000001', topics: [TRANSFER, pad(ROUTER), pad(USER), word(7n)], data: '0x' };
  assert.equal(nft.topics.length, 4, 'the fixture must have the ERC-721 arity, or it tests nothing');
  assert.equal(nft.data, '0x');
  const r = run([...deliver(), nft]);
  assert.equal(r.verdict, VERDICT.HELD, 'an NFT transfer was read as the borrow leaving ETH denomination');
});

test('the rule set is declared, and the engine has no opinion about what is ETH', () => {
  const withoutLst = ruleSet({ ethDenominated: [WETH] });
  const logs = [...deliver(), xfer(WETH, USER, ROUTER, AMOUNT), xfer(WSTETH, ROUTER, USER, 4_100000000000000000n)];
  assert.equal(classify({ user: USER, amount: AMOUNT, logs, weth: WETH, rules: RULES, debtToken: DEBT }).verdict, VERDICT.STAYED_ETH);
  assert.equal(classify({ user: USER, amount: AMOUNT, logs, weth: WETH, rules: withoutLst, debtToken: DEBT }).verdict, VERDICT.LEFT_ETH);
  // Same chain data, two verdicts, decided entirely by a list the caller pins. That is why the list
  // is published with the number and hashed into it, rather than living in this file.
});

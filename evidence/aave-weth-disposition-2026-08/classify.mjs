// Classify what a single WETH borrow did INSIDE ITS OWN TRANSACTION.
//
// Pure: receipt logs in, verdict out. No network, no prices, no address book beyond the rule set the
// caller pins. Written after three hypotheses died against real data (see README) and before any
// number was produced, because a classifier written first is a classifier the data gets forced into.
//
// WHAT IT ANSWERS, and the wording is the whole discipline:
//
//   > Under rule set R, did this borrow's proceeds leave ETH denomination within the same transaction?
//
// Not "was this a short". Not "was this a funding leg". Those are claims about intent, and intent is
// not on chain. A borrower who swaps WETH for USDC may be shorting, hedging, or paying an invoice —
// this says the proceeds left ETH denomination and stops.
//
// WHY CATEGORICAL RATHER THAN APPORTIONED. Splitting a borrow across outcomes by value would need
// prices for every token in the transaction, and a price is an external input the resolver cannot
// re-execute. That is the bar task 012 was rejected against, so it is not crossed here: a borrow gets
// one verdict, and the published figure is a share of borrows and of borrowed WETH, never a share of
// value.

export const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
// Identified by behaviour in identify-events.mjs, not from memory — arity cannot separate these two.
export const WETH_DEPOSIT = '0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c';
export const WETH_WITHDRAWAL = '0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65';

export const VERDICT = {
  LEFT_ETH: 'left-eth',        // a non-ETH-denominated asset net-increased for the borrower
  STAYED_ETH: 'stayed-eth',    // proceeds stayed ETH-denominated: unwrapped, or into an LST in R
  HELD: 'held',                // the WETH simply stayed with the borrower in this transaction
  FLASH: 'flash',              // returned to the aToken it came from — excluded, not counted
  UNRESOLVED: 'unresolved',    // WETH left and nothing identifiable came back
};

const norm = (a) => a.toLowerCase();
const addrOf = (topic) => norm('0x' + topic.slice(26));

/// The rule set is DECLARED, never inferred. `ethDenominated` is the caller's list of what counts as
/// still-ETH; the engine has no opinion about it and cannot acquire one. Pin it, hash it, publish it.
export function ruleSet({ ethDenominated }) {
  const set = new Set(ethDenominated.map(norm));
  return { ethDenominated: set, isEth: (token) => set.has(norm(token)) };
}

/// deltas: token -> net amount for `who`, from Transfer plus WETH's wrap/unwrap, which move value
/// between WETH and native ETH without emitting any Transfer at all.
function netDeltas(logs, who, weth) {
  const d = new Map();
  const add = (token, amount) => d.set(norm(token), (d.get(norm(token)) ?? 0n) + amount);
  for (const log of logs) {
    const t0 = log.topics[0];
    // An ERC-20 Transfer has EXACTLY three topics and one data word. An ERC-721 Transfer shares the
    // same topic0 but indexes the tokenId, giving four topics and EMPTY data — so `topics.length >= 3`
    // matched it, and `BigInt('0x')` threw on the first NFT that appeared in a borrow transaction.
    // Had it not thrown, an NFT movement would have counted as a non-ETH-denominated GAIN, i.e. as
    // the borrow leaving ETH denomination. No hand-written fixture produced this: they were all
    // written in the ERC-20 shape, so the shape was the thing being tested.
    if (t0 === TRANSFER && log.topics.length === 3 && log.data.length === 66) {
      const value = BigInt(log.data);
      if (addrOf(log.topics[1]) === who) add(log.address, -value);
      if (addrOf(log.topics[2]) === who) add(log.address, value);
      continue;
    }
    if (norm(log.address) !== norm(weth) || log.topics.length < 2) continue;
    if (addrOf(log.topics[1]) !== who) continue;
    const wad = BigInt(log.data);
    if (t0 === WETH_WITHDRAWAL) { add(weth, -wad); add('native-eth', wad); }
    if (t0 === WETH_DEPOSIT) { add(weth, wad); add('native-eth', -wad); }
  }
  return d;
}

/// The address the borrow was DELIVERED from is the reserve's aToken, and it is read off the
/// transaction rather than configured: a hard-coded aToken address is one more thing that can be
/// wrong without anything noticing.
function deliveredFrom(logs, user, weth, amount) {
  for (const log of logs) {
    if (log.topics[0] !== TRANSFER || log.topics.length < 3) continue;
    if (norm(log.address) !== norm(weth)) continue;
    if (addrOf(log.topics[2]) !== user) continue;
    if (BigInt(log.data) === amount) return addrOf(log.topics[1]);
  }
  return null;
}

export function classify({ user, amount, logs, weth, rules, debtToken }) {
  const who = norm(user);
  const wei = BigInt(amount);
  const deltas = netDeltas(logs, who, weth);

  // Aave mints a debt token to the borrower on every borrow, by construction. It is in 12 of 12
  // transactions and says nothing about disposition — probe 1's whole finding.
  if (debtToken) deltas.delete(norm(debtToken));

  const source = deliveredFrom(logs, who, weth, wei);
  if (source) {
    const backToSource = logs.some((l) => l.topics[0] === TRANSFER && l.topics.length >= 3
      && norm(l.address) === norm(weth) && addrOf(l.topics[1]) === who
      && addrOf(l.topics[2]) === source && BigInt(l.data) >= wei);
    if (backToSource) return { verdict: VERDICT.FLASH, detail: 'returned to the aToken it came from' };
  }

  const gained = [...deltas].filter(([, v]) => v > 0n);
  const nonEthGain = gained.filter(([token]) => token !== 'native-eth' && !rules.isEth(token));
  const ethGain = gained.filter(([token]) => token === 'native-eth' || rules.isEth(token));

  if (nonEthGain.length > 0) {
    return { verdict: VERDICT.LEFT_ETH, detail: nonEthGain.map(([t]) => t).join(',') };
  }
  // A round trip (WETH -> USDC -> WETH inside one transaction) nets to no non-ETH gain and lands
  // here, which is the intended answer: nothing left ETH denomination by the end of the transaction.
  const wethDelta = deltas.get(norm(weth)) ?? 0n;
  const otherEthGain = ethGain.filter(([token]) => token !== norm(weth));
  if (otherEthGain.length > 0) {
    return { verdict: VERDICT.STAYED_ETH, detail: otherEthGain.map(([t]) => t).join(',') };
  }
  if (wethDelta >= wei) return { verdict: VERDICT.HELD, detail: 'WETH remained with the borrower' };
  return { verdict: VERDICT.UNRESOLVED, detail: `WETH left and nothing identifiable returned (net ${wethDelta})` };
}

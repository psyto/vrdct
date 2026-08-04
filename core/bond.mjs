// Vrdct — bond & slash. The monetization hook: a resolution's verdict controls a payout. A resolver
// posts a claim with a bond; a challenger stakes and triggers adjudication (re-execution). Symmetric:
//   claim false (verify fails) -> resolver SLASHED, challenger paid.
//   claim holds (verify ok)    -> challenger SLASHED (frivolous), resolver paid.
// The referee is re-execution, not an authority. Reference state machine; on-chain custody is a PDA.
import { verify } from './verify.mjs';

const CUT = 0.10; // treasury cut on a slash

const r6 = (x) => +x.toFixed(6);
export function settle(claim, { resolverBond, challengeBond }) {
  const v = verify(claim);
  const bal = { resolver: -resolverBond, challenger: -challengeBond, treasury: 0 };
  if (v.ok) { // claim re-executes -> the challenge was frivolous
    const cut = r6(challengeBond * CUT);
    bal.resolver = r6(bal.resolver + resolverBond + (challengeBond - cut));
    bal.treasury = cut;
    return { outcome: 'CHALLENGE_FAILED', reexecutes: true, balances: bal };
  }
  const cut = r6(resolverBond * CUT); // claim is provably false -> resolver slashed
  bal.challenger = r6(bal.challenger + challengeBond + (resolverBond - cut));
  bal.treasury = cut;
  return { outcome: 'SLASHED', reexecutes: false, balances: bal };
}

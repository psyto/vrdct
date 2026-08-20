# Decision — Vrdct is a held asset, not an active project

**Decided by:** the founder, 2026-08-21. **Supersedes** the active status of every gate in this repo.
**Not a discard.** Not a pause waiting on an agent. **Nothing here is queued for anyone.**

## The three hypotheses, closed

| hypothesis | result | the essential problem |
| --- | --- | --- |
| **H1** — CMLS | `KILLED` | the answer is already determined when the market opens |
| **H2** — obligor-bonded SLA | KILL-equivalent; stopped at design review, zero evidence run | omission cannot be settled, and obligation/action/evidence are not bound |
| **H3** — timeout guarantee | design review **did not pass** | false performance evidence, censorship of evidence delivery, and a self-referential buyer hypothesis all unresolved |

H3's P0 is worth stating in full because it is the one that looks fine and is not:

> *"No evidence by the deadline, the bond is forfeit"* is clean on the page. But **an obligor who
> genuinely performed and was prevented from delivering the evidence is slashed identically to one who
> did nothing** — and the buyer collects in both cases, so the buyer acquires an incentive to obstruct
> delivery. A timeout alone is therefore not a neutral adjudication.

Full review: [`../../reviews/022-h3-design-gate.md`](../../reviews/022-h3-design-gate.md).

## What is genuinely preserved

**Two different implementations, written independently, reconstructed the same input set, the same
hash and the same verdict from a public RPC.** That is a re-executable adjudication engine and it is
real.

**It is not, by itself, a product.** Recording that in the same breath, because every failure in this
repo has come from treating a capability as if it were a market.

## H4 — the conditions for opening, which only the outside world can satisfy

If Vrdct is retried, H4 may be opened **only in this order**, and none of these steps is work an agent
can start:

1. **A concrete buyer and a single obligation, first.** Not "an SLA anyone can use" — *this* DAO or
   integrator needs a guarantee about *this* operation.
2. **Performance evidence that depends on neither party.** For instance a publicly verifiable state
   transition or receipt emitted by the target program itself. **Not** a return to proving omission by
   searching signature history.
3. **Vrdct's specific advantage, proved before anything is built.** If an ordinary escrow, bond,
   timelock or SLA contract suffices, there is no reason for Vrdct. Re-execution must demonstrably
   lower the cost of dispute, adjudication or verification at one identified point.

**The trigger is external demand, found outside this repository. It is not a design round.** Supplying
another abstract hypothesis at this stage is the specific risk the founder named: it would turn a good
re-execution engine into *a project searching for something guarantee-shaped.*

## Carried, unchanged

- **T-12** — `2.50859` SOL stranded per run (`reviews/main-2026-08-12-devnet-debt.md` F1). Still open,
  and still blocking any real-value run.
- **T-3** — `core/rpc.mjs:19`'s silent 20-page truncation. Still open. It matters more than its
  severity suggests: `onchain/…/state.rs:10-12` assigns provenance defence to a challenger who
  reconstructs before bonding, so reconstruction *is* the security model.
- **No funds ever moved.** No mainnet, no devnet, no deploy, at any point across all three hypotheses.

## Cost

Three product hypotheses opened and closed. **No code was written toward any of them.** H1 died on
measured evidence; H2 and H3 died at review before a single evidence item ran. Whatever else this
was, it was cheap.

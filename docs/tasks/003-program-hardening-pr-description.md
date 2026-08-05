# Task 003 PR description — state-machine coverage

`Market` custody has exactly three states. This table is the PR description payload: each row lists
whether an instruction is accepted and every path that can move a bonded market to `SETTLED`.

| Market state | `challenge` | `open_feed` / `feed` / `close_feed` | `settle` | `claim_uncontested` | `expire_challenged` | `close_market` |
| --- | --- | --- | --- | --- | --- | --- |
| `OPEN` | accepted through `challenge_until`, then → `CHALLENGED` | feeder-local work allowed; it cannot affect another Feed PDA | reject | after `challenge_until` → `SETTLED`, resolver bond returned | reject | reject |
| `CHALLENGED` | reject | feeder-local work allowed; any feeder can close and restart only its own PDA | any time with count+digest match → `SETTLED`; re-execution chooses payout and completed feeder receives 10% slash reward | reject | after `settle_by` → `SETTLED`; challenger receives the complete pot | reject |
| `SETTLED` | reject | an existing feeder may `close_feed` to recover only its own rent; no new/feed mutation | reject | reject | reject | accepted once; returns account rent to recorded `rent_payer` and removes the account |

There is no `reset_feed`: a malformed stream can be closed only by its recorded feeder. The market
PDA is seeded by a hash of the question label, input commitment, verdict mapping, bond, and bounded
challenge window. Thus a pre-emptive opener can only fund that exact market definition; it cannot
reserve a question address under different terms.

The only paths out of a bond-holding state are therefore `claim_uncontested`, `settle`, and
`expire_challenged`. `close_market` follows a terminal payout and only returns rent, never bonds.
After `settle_by`, a completed Feed may still settle, so it races permissionless expiry; whichever
terminal transaction finalizes first wins.

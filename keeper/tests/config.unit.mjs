// Keeper unit tests that need neither a validator nor an RPC. They live here rather than in the
// root canonical suite because `keeper/lib.mjs` imports a Solana client, and the root package
// deliberately has no dependencies — see `keeper/window.mjs` for the pure half that does run there.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { claimUncontestedIx, normalizeConfig } from '../lib.mjs';

const base = {
  rpc: 'http://cluster.example', keypair: '/tmp/keeper.json', bondLamports: '1', challengeWindowSecs: 3600,
  subjects: [{ venue: 'Venue', question: 'Question', priceAccount: '11111111111111111111111111111111', yesWhen: ['GREEN'] }],
};

test('keeper config defaults sourceRpc, permits source/cluster split, and rejects obsolete sub-day windows', () => {
  assert.equal(normalizeConfig(base).sourceRpc, base.rpc);
  assert.equal(normalizeConfig({ ...base, sourceRpc: 'https://history.example' }).sourceRpc, 'https://history.example');
  assert.throws(() => normalizeConfig({ ...base, sourceRpc: 3 }), /sourceRpc/);
  assert.throws(() => normalizeConfig({ ...base, subjects: [{ ...base.subjects[0], windowSecs: 60 }] }), /windowSecs.*no longer supported/);
});

// `claim_uncontested` cannot be reached from the local-validator E2E: the program's minimum
// challenge window is an hour and `solana-test-validator` has no clock to warp. Its account order
// is still worth pinning, because getting it wrong sends this keeper's returned bond to the wrong
// account — the one failure mode on this path that actually costs money.
test('claim_uncontested is built as (market, resolver) with the Anchor discriminator', () => {
  const programId = new PublicKey('7EtJACKUvpWGB524uqTykTzyCx1DyxKb76iEZVAiWwKS');
  const marketKey = new PublicKey('11111111111111111111111111111112');
  const resolver = new PublicKey('11111111111111111111111111111113');
  const instruction = claimUncontestedIx({ programId, marketKey, resolver });

  assert.ok(instruction.programId.equals(programId));
  assert.deepEqual(instruction.keys.map((key) => key.pubkey.toBase58()), [marketKey.toBase58(), resolver.toBase58()]);
  assert.deepEqual(instruction.keys.map((key) => key.isWritable), [true, true]);
  assert.deepEqual(instruction.keys.map((key) => key.isSigner), [false, false], 'the program takes no signer here; it is permissionless');
  assert.ok(instruction.data.equals(createHash('sha256').update('global:claim_uncontested').digest().subarray(0, 8)));
});

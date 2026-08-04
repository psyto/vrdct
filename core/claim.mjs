// Vrdct — the generic VerifiableClaim + a claim-type registry.
//
// A claim is a re-executable statement whose verdict is a deterministic function of pinned inputs.
// The engine is claim-type-AGNOSTIC: each claim_type is a pluggable module that supplies
//   • type       — the claim_type string
//   • invariant  — { id, statement }
//   • reexec(inputs) -> { computation, verdict }   (the deterministic core)
//   • checks(claim, recomputed) -> [[label, ok, detail], ...]   (extra per-type verify checks)
// New surfaces (closed-market soundness, reserve solvency, depeg, exploit, agent-escrow) are added
// by registering a module — never by editing the engine. This is the "1 engine × N surfaces" core.

import { canonical, sha256 } from './hash.mjs';

export const CLAIM_SCHEMA = 'vrdct.claim/v0';

const REGISTRY = new Map();
export function registerClaimType(mod) {
  if (!mod?.type || typeof mod.reexec !== 'function') throw new Error('claim-type needs { type, reexec }');
  REGISTRY.set(mod.type, mod);
  return mod;
}
export function claimType(t) { return REGISTRY.get(t); }
export function claimTypes() { return [...REGISTRY.keys()]; }

// Content address over the SEMANTIC body only (excludes attestation/reproduce/emitted metadata).
export function claimBody(c) {
  return { schema: c.schema, claim_type: c.claim_type, subject: c.subject, invariant: c.invariant, inputs: c.inputs, computation: c.computation, verdict: c.verdict };
}
export function claimId(c) { return 'vc_' + sha256(canonical(claimBody(c))).slice(0, 40); }

// Build a claim by re-executing a registered claim-type over pinned inputs.
export function buildClaim({ type, subject, inputs }) {
  const mod = claimType(type);
  if (!mod) throw new Error(`unknown claim_type: ${type} (register it first)`);
  const { computation, verdict } = mod.reexec(inputs);
  const claim = {
    schema: CLAIM_SCHEMA, claim_type: type, subject,
    invariant: mod.invariant,
    inputs, computation, verdict,
    reproduce: 'node verify.mjs <claim.json>   # anyone reproduces the verdict',
    attestation: { node: 'anon', sig: null, emitted_ts: Math.floor(Date.now() / 1000) },
  };
  claim.claim_id = claimId(claim);
  return claim;
}

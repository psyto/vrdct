// Vrdct — minimal Solana JSON-RPC (zero-dep). The engine is offline/pure; this adapter is only for
// fetching a claim's inputs (chain observations) at claim-build time. Verification stays reproducible
// from the embedded inputs.
export async function rpc(url, method, params) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const t = await r.text();
  if (!t) throw new Error(`${method}: empty response`);
  if (t.trimStart().startsWith('<')) throw new Error(`${method}: HTML (rate-limited)`);
  const j = JSON.parse(t);
  if (j.error) throw new Error(`${method}: ${j.error.message || JSON.stringify(j.error)}`);
  return j.result;
}

// Canonical observation set for a price account over [from, to]: successful updates, by signature,
// sorted by (slot, sig) so any honest re-executor gets a byte-identical set.
export async function fetchObservations(url, acct, { from, to = Infinity } = {}) {
  const rows = [];
  let before;
  for (let p = 0; p < 20; p++) {
    const opts = { limit: 1000 }; if (before) opts.before = before;
    const sigs = await rpc(url, 'getSignaturesForAddress', [acct, opts]);
    if (!sigs || !sigs.length) break;
    for (const s of sigs) rows.push(s);
    before = sigs[sigs.length - 1].signature;
    if (sigs[sigs.length - 1].blockTime && sigs[sigs.length - 1].blockTime < from) break;
    await new Promise((r) => setTimeout(r, 120));
  }
  return rows
    .filter((s) => s.blockTime != null && s.err == null && s.blockTime >= from && s.blockTime <= to)
    .map((s) => ({ sig: s.signature, slot: s.slot, blockTime: s.blockTime }))
    .sort((a, b) => a.slot - b.slot || (a.sig < b.sig ? -1 : 1));
}

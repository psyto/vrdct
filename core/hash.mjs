// Vrdct — canonical serialization + hashing. Zero-dep.
// Two independent re-executions of the same claim serialize identically and hash identically —
// that byte-for-byte equality is the network's agreement primitive.
import { createHash } from 'node:crypto';

// Canonical JSON: recursively sort object keys so identical content always serializes identically.
export function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}
export function sha256(s) { return createHash('sha256').update(s).digest('hex'); }

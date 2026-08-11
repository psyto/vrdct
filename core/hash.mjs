// Vrdct — canonical serialization + hashing. Zero-dep.
// Two independent re-executions of the same claim serialize identically and hash identically —
// that byte-for-byte equality is the network's agreement primitive.
import { createHash } from 'node:crypto';

// Canonical JSON: recursively sort object keys so identical content always serializes identically.
//
// It REFUSES anything JSON cannot represent, rather than letting `JSON.stringify` coerce it. That is
// Codex's F11 (reviews/011), and it is the same defect as F7 and F9 one layer further down: this
// function is the agreement primitive, and it was silently mapping `NaN`, `Infinity` and `-Infinity`
// onto `null`. So a `null` field could be replaced by `NaN` and serialize to the identical bytes —
// the content hash did not move, no reseal was needed, and the whole-output binding compared two
// strings that agreed about a body that did not. A canonicalizer that coerces is a canonicalizer
// that lets two different bodies be the same claim.
// Scope, deliberately: values `JSON.stringify` COERCES to something else. `undefined` is also not
// JSON, but it does not collide — `JSON.stringify` returns the value `undefined`, which concatenates
// to the literal text `undefined`, so two different bodies still produce two different strings. And
// solvency builds claims carrying `undefined` today, so rejecting it here would refuse valid claims
// under the guise of fixing a forgery. It is reported separately rather than folded in.
function unrepresentable(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? null : String(v);
  if (typeof v === 'bigint') return 'a bigint';
  if (typeof v === 'function' || typeof v === 'symbol') return `a ${typeof v}`;
  return null;
}
export function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  }
  const bad = unrepresentable(v);
  if (bad !== null) throw new Error(`canonical: ${bad} is not representable in JSON, so it cannot be part of an agreed body`);
  return JSON.stringify(v);
}
export function sha256(s) { return createHash('sha256').update(s).digest('hex'); }

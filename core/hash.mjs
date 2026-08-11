// Vrdct — canonical serialization + hashing. Zero-dep.
// Two independent re-executions of the same claim serialize identically and hash identically —
// that byte-for-byte equality is the network's agreement primitive.
import { createHash } from 'node:crypto';

// Canonical JSON: recursively sort object keys so identical content always serializes identically.
//
// It accepts a JSON VALUE TREE and refuses everything else, rather than letting `JSON.stringify`
// coerce. This is the agreement primitive, so a value it maps onto some other value's bytes is two
// different bodies being the same claim — the content hash does not move and nothing above can tell
// them apart. Codex found three families (reviews/011 F11, F12), and the third was found only after
// the first fix published a false reason for stopping short of it:
//
//   COERCED     `NaN`, `Infinity`, `-Infinity` → `null`. A null field becomes NaN, identical bytes.
//   DROPPED     `undefined` and array HOLES. `[undefined]`, `[,]` and `[]` all serialize to `[]`,
//               because `join` renders both as empty. The first fix left `undefined` alone on the
//               stated ground that it "does not collide" — which was checked in an OBJECT, where
//               `{"a":undefined}` and `{}` do differ, and then generalised without checking an
//               array. It collides in arrays. The reason was wrong, so the scope was wrong.
//   IMPERSONATED  `Date`, `Map`, `Set`, `RegExp`, class instances — `Object.keys` of each is empty,
//               so every one of them serializes to `{}` and collides with an empty object. Codex
//               demonstrated it on a real CMLS claim: an empty `dailyClosed` replaced by
//               `new Date(0)` left `claim_id` unchanged and `verify()` true.
//
// Cycles are refused too: they have no canonical form, and the old walk recursed until the stack
// went, which is a crash rather than a verdict.
function unrepresentable(v) {
  if (v === undefined) return 'undefined';
  if (typeof v === 'number') return Number.isFinite(v) ? null : String(v);
  if (typeof v === 'bigint') return 'a bigint';
  if (typeof v === 'function' || typeof v === 'symbol') return `a ${typeof v}`;
  return null;
}
// A JSON object is a plain one. Anything carrying a prototype carries state `Object.keys` cannot see.
function plainObject(v) {
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}
function serialize(v, ancestors) {
  if (Array.isArray(v)) {
    if (Object.getPrototypeOf(v) !== Array.prototype) throw new Error('canonical: an Array subclass is not a JSON array');
    if (ancestors.has(v)) throw new Error('canonical: the value is cyclic, so it has no canonical form');
    ancestors.add(v);
    const parts = [];
    for (let i = 0; i < v.length; i++) {
      if (!(i in v)) throw new Error(`canonical: index ${i} is a hole, which JSON cannot represent`);
      parts.push(serialize(v[i], ancestors));
    }
    ancestors.delete(v);
    return '[' + parts.join(',') + ']';
  }
  if (v !== null && typeof v === 'object') {
    if (!plainObject(v)) throw new Error(`canonical: ${v.constructor?.name ?? 'a non-plain object'} is not a JSON object`);
    if (ancestors.has(v)) throw new Error('canonical: the value is cyclic, so it has no canonical form');
    ancestors.add(v);
    const body = '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + serialize(v[k], ancestors)).join(',') + '}';
    ancestors.delete(v);
    return body;
  }
  const bad = unrepresentable(v);
  if (bad !== null) throw new Error(`canonical: ${bad} is not representable in JSON, so it cannot be part of an agreed body`);
  return JSON.stringify(v);
}
export function canonical(v) { return serialize(v, new Set()); }
export function sha256(s) { return createHash('sha256').update(s).digest('hex'); }

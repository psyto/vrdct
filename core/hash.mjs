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

// WHERE THE ADVERSARIAL BOUNDARY ACTUALLY IS — Codex, reviews/011 F13, and it is a limit rather than
// a bug to fix. A JS object graph has state that JSON does not: properties that are non-enumerable,
// symbol-keyed, or accessors; own keys on an array beside its indices; a prototype that can make a
// hole read as filled; and Proxies, which standard JS cannot reliably detect at all. Two graphs
// differing only in such state serialized to the same bytes.
//
// Every one of those that can be SEEN is refused below: own keys are read with `Reflect.ownKeys` so
// non-enumerables and symbols are found rather than skipped, values are taken from property
// DESCRIPTORS so no getter is invoked and no prototype can fill a hole, and an array may own nothing
// but its indices and `length`.
//
// What cannot be seen is a Proxy. So this function is NOT an adversarial parser for an arbitrary
// in-memory graph, and the repo does not claim it is. **The trust boundary is `JSON.parse` output or
// a validated snapshot** — a body that arrived as text, or one a registered claim-type built from
// inputs its own `canonicalInputs` accepted. Hardening here narrows the accident; it does not make a
// hostile object graph safe, and saying otherwise would be a mechanism named rather than implemented.
function ownDataValue(v, key) {
  const d = Object.getOwnPropertyDescriptor(v, key);
  if (d === undefined) throw new Error(`canonical: '${String(key)}' is not an own property, and JSON has no prototype chain to inherit it from`);
  if (!d.enumerable) throw new Error(`canonical: '${String(key)}' is non-enumerable, so it is invisible to JSON while still being part of the value`);
  if (!('value' in d)) throw new Error(`canonical: '${String(key)}' is an accessor, and an accessor can answer differently each time it is asked`);
  return d.value;
}
function serialize(v, ancestors) {
  if (Array.isArray(v)) {
    if (Object.getPrototypeOf(v) !== Array.prototype) throw new Error('canonical: an Array subclass is not a JSON array');
    if (ancestors.has(v)) throw new Error('canonical: the value is cyclic, so it has no canonical form');
    for (const k of Reflect.ownKeys(v)) {
      if (k === 'length') continue;
      if (typeof k === 'symbol') throw new Error('canonical: a symbol-keyed property is invisible to JSON, so it cannot be part of an agreed body');
      if (!/^(0|[1-9][0-9]*)$/.test(k) || Number(k) >= v.length) throw new Error(`canonical: an array owns '${k}', which JSON cannot represent`);
    }
    ancestors.add(v);
    const parts = [];
    // by descriptor, never `v[i]` or `i in v`: both consult the prototype, so Array.prototype[0] = 'x'
    // could fill a hole and change the bytes of a value nobody edited
    for (let i = 0; i < v.length; i++) {
      if (Object.getOwnPropertyDescriptor(v, String(i)) === undefined) {
        throw new Error(`canonical: index ${i} is a hole, which JSON cannot represent`);
      }
      parts.push(serialize(ownDataValue(v, String(i)), ancestors));
    }
    ancestors.delete(v);
    return '[' + parts.join(',') + ']';
  }
  if (v !== null && typeof v === 'object') {
    if (!plainObject(v)) throw new Error(`canonical: ${v.constructor?.name ?? 'a non-plain object'} is not a JSON object`);
    if (ancestors.has(v)) throw new Error('canonical: the value is cyclic, so it has no canonical form');
    const keys = Reflect.ownKeys(v);
    for (const k of keys) {
      if (typeof k === 'symbol') throw new Error('canonical: a symbol-keyed property is invisible to JSON, so it cannot be part of an agreed body');
    }
    ancestors.add(v);
    const body = '{' + keys.sort().map((k) => JSON.stringify(k) + ':' + serialize(ownDataValue(v, k), ancestors)).join(',') + '}';
    ancestors.delete(v);
    return body;
  }
  const bad = unrepresentable(v);
  if (bad !== null) throw new Error(`canonical: ${bad} is not representable in JSON, so it cannot be part of an agreed body`);
  return JSON.stringify(v);
}
export function canonical(v) { return serialize(v, new Set()); }
export function sha256(s) { return createHash('sha256').update(s).digest('hex'); }

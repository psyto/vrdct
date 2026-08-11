// Vrdct — mechanical enforcement for a claim-type's explicit input schema.
//
// This module deliberately knows no claim-type schema. Each surface states its own allowed keys at
// the call site; sharing only the rejection mechanism keeps those contracts visible and prevents
// five subtly different versions of the same input-boundary rule.
export function closed(name, value, allowed) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new Error(`${name} carries an unrecognised key '${key}': this type's inputs are a closed domain`);
    }
  }
}

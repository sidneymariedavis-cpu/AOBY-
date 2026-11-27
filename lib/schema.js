/* Minimal JSON-schema subset validator (type, enum, properties, required, items, maxLength, maxItems, nullable via type arrays).
 * Used for server-side validation of every AI response. Unknown properties are stripped. */
'use strict';
function typeOf(v) { if (v === null) return 'null'; if (Array.isArray(v)) return 'array'; return typeof v; }
function validate(schema, value, path = '$') {
  const errors = [];
  const types = [].concat(schema.type || []);
  const t = typeOf(value);
  if (types.length && !types.some((x) => x === t || (x === 'integer' && t === 'number' && Number.isInteger(value)))) {
    return { ok: false, errors: [`${path}: expected ${types.join('|')}, got ${t}`] };
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: not one of ${schema.enum.join(', ')}`);
  if (t === 'string' && schema.maxLength && value.length > schema.maxLength) errors.push(`${path}: too long`);
  if (t === 'number' && (value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity))) errors.push(`${path}: out of range`);
  let out = value;
  if (t === 'object' && schema.properties) {
    out = {};
    for (const k of schema.required || []) if (!(k in value)) errors.push(`${path}.${k}: required`);
    for (const [k, sub] of Object.entries(schema.properties)) {
      if (k in value) { const r = validate(sub, value[k], `${path}.${k}`); errors.push(...r.errors); out[k] = r.value; }
    }
  }
  if (t === 'array' && schema.items) {
    if (schema.maxItems && value.length > schema.maxItems) errors.push(`${path}: too many items`);
    out = value.map((v, i) => { const r = validate(schema.items, v, `${path}[${i}]`); errors.push(...r.errors); return r.value; });
  }
  return { ok: errors.length === 0, errors, value: out };
}
module.exports = { validate };

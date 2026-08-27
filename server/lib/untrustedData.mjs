const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_DEPTH = 24;
const MAX_ARRAY_ITEMS = 100_000;
const MAX_OBJECT_KEYS = 512;
const MAX_STRUCTURAL_LENGTH = 512;
const URL_FIELD_NAMES = new Set(['url', 'link', 'href', 'src', 'homepage', 'website', 'odkaz', 'zdroj']);
const STRUCTURAL_FIELDS = new Set([
  'status', 'visibility', 'role', 'colorToken', 'materialType', 'sourceType', 'entityType',
  'operation', 'resource', 'schema', 'format', 'priority', 'category', 'mode', 'purpose',
  'triggerType', 'triggerMode', 'accessMode', 'planType', 'ordering', 'syncContract',
  'contractVersion',
]);
function unsafeStructuralString(value) { return value.length > MAX_STRUCTURAL_LENGTH || /[\u0000-\u001f\u007f<>"'`]/u.test(value); }
function isIdentifierField(key) { return key === 'id' || key === 'key' || key.endsWith('Id') || key.endsWith('Ids'); }
function isUrlField(key) { const normalized = String(key).toLowerCase(); return normalized.endsWith('url') || URL_FIELD_NAMES.has(normalized); }
function looksLikeExecutableUrl(value) {
  const normalized = String(value).trim().replace(/[\u0000-\u001f\u007f]/gu, '');
  return /^(?:javascript|vbscript):/i.test(normalized) || /^data:[^,\s]{0,200},/i.test(normalized);
}
function assertIdentifier(value, path) {
  if (value == null || value === '') return;
  if (Array.isArray(value)) { for (let index = 0; index < value.length; index += 1) assertIdentifier(value[index], `${path}[${index}]`); return; }
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`${path} musí být jednoduchý identifikátor.`);
  const normalized = String(value);
  if (FORBIDDEN_KEYS.has(normalized)) throw new Error(`${path} používá zakázaný identifikátor.`);
  if (unsafeStructuralString(normalized)) throw new Error(`${path} obsahuje nepovolené znaky nebo je příliš dlouhé.`);
}
function assertStructuralToken(value, path) {
  if (value == null || value === '') return;
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') throw new Error(`${path} má neplatný strukturální typ.`);
  if (unsafeStructuralString(String(value))) throw new Error(`${path} obsahuje nepovolené strukturální znaky.`);
}
function assertExternalUrl(value, path) {
  if (value == null || value === '') return;
  if (typeof value !== 'string') throw new Error(`${path} musí být URL řetězec.`);
  if (unsafeStructuralString(value)) throw new Error(`${path} obsahuje nepovolené znaky.`);
  let parsed;
  try { parsed = new URL(value, 'https://lesson-hub.invalid/'); } catch { throw new Error(`${path} není platná URL.`); }
  if (!['http:', 'https:', 'file:'].includes(parsed.protocol)) throw new Error(`${path} používá nepovolený protokol.`);
}
function visit(value, path, depth, seen) {
  if (depth > MAX_DEPTH) throw new Error(`${path} překračuje maximální hloubku dat.`);
  if (typeof value === 'string' && looksLikeExecutableUrl(value)) throw new Error(`${path} používá nebezpečný URL protokol.`);
  if (value == null || typeof value !== 'object') return;
  if (seen.has(value)) throw new Error(`${path} obsahuje cyklickou strukturu.`);
  seen.add(value);
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ITEMS) throw new Error(`${path} obsahuje příliš mnoho položek.`);
    for (let index = 0; index < value.length; index += 1) visit(value[index], `${path}[${index}]`, depth + 1, seen);
    seen.delete(value); return;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${path} není prostý datový objekt.`);
  const keys = Object.keys(value);
  if (keys.length > MAX_OBJECT_KEYS) throw new Error(`${path} obsahuje příliš mnoho polí.`);
  for (const key of keys) {
    if (FORBIDDEN_KEYS.has(key)) throw new Error(`${path}.${key} používá zakázaný klíč.`);
    const child = value[key];
    const childPath = `${path}.${key}`;
    if (isIdentifierField(key)) assertIdentifier(child, childPath);
    if (STRUCTURAL_FIELDS.has(key)) assertStructuralToken(child, childPath);
    if (isUrlField(key)) assertExternalUrl(child, childPath);
    visit(child, childPath, depth + 1, seen);
  }
  seen.delete(value);
}
export function assertSafeUntrustedRecord(value, { label = 'záznam' } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} musí být datový objekt.`);
  visit(value, label, 0, new WeakSet());
  return value;
}
export function assertSafeUntrustedIdentifier(value, { label = 'identifikátor' } = {}) { assertIdentifier(value, label); return value; }

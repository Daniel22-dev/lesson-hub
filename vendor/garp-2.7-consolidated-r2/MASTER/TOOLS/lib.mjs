import fs from 'node:fs';
import crypto from 'node:crypto';

export const EXIT = Object.freeze({ PASS: 0, FAIL: 1, HARNESS_ERROR: 2, NOT_TESTED: 3 });
export const SHA256_RE = /^[a-f0-9]{64}$/i;
export const SHA1_RE = /^[a-f0-9]{40}$/i;

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
export function isObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}
export function nonEmptyObject(v) {
  return isObject(v) && Object.keys(v).length > 0;
}
export function fail(message, details = []) {
  process.stdout.write(JSON.stringify({classification:'CONTRACT_TEST',status:'FAIL',message,details}, null, 2) + '\n');
  process.exit(EXIT.FAIL);
}
export function harnessError(error) {
  process.stderr.write(JSON.stringify({classification:'HARNESS_ERROR',status:'HARNESS_ERROR',message:String(error?.message || error)}, null, 2) + '\n');
  process.exit(EXIT.HARNESS_ERROR);
}
export function pass(payload = {}) {
  process.stdout.write(JSON.stringify({classification:'CONTRACT_TEST',status:'PASS',...payload}, null, 2) + '\n');
  process.exit(EXIT.PASS);
}
export function notTested(payload = {}) {
  process.stdout.write(JSON.stringify({classification:'LIVE_TEST',status:'NOT_TESTED',...payload}, null, 2) + '\n');
  process.exit(EXIT.NOT_TESTED);
}
export function parseArgs(argv) {
  const out = {_:[]};
  for (let i=0;i<argv.length;i++) {
    const x=argv[i];
    if (x.startsWith('--')) { const k=x.slice(2); const n=argv[i+1]; if (n && !n.startsWith('--')) {out[k]=n;i++;} else out[k]=true; }
    else out._.push(x);
  }
  return out;
}
export function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
export function validateIdentity(actual, expected, errors, prefix='releaseIdentity') {
  if (!isObject(actual) || !isObject(expected)) { errors.push(`${prefix}: missing`); return; }
  for (const key of ['appId','appVersion','sourceCommit']) {
    if (String(actual[key] || '') !== String(expected[key] || '')) errors.push(`${prefix}.${key}: mismatch`);
  }
  if (actual.sourceCommit && !SHA1_RE.test(actual.sourceCommit)) errors.push(`${prefix}.sourceCommit: invalid sha`);
}
export function validIso(v) { return typeof v === 'string' && Number.isFinite(Date.parse(v)); }
export function isFresh(v, maxHours, nowMs) {
  if (!validIso(v)) return false;
  const age = nowMs - Date.parse(v);
  return age >= 0 && age <= Number(maxHours) * 3600000;
}
export function uniqueBy(items, key) {
  const seen = new Set();
  for (const item of items) { const v=item?.[key]; if (!v || seen.has(v)) return false; seen.add(v); }
  return true;
}

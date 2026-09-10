#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { isPrivateKeyRule, scanSecretBuffer } from './secret-scan-common.mjs';

const root = path.resolve(process.argv[2] || '.');
const excludedDirs = new Set(['.git', 'node_modules', 'dist', 'dist-school-server', 'coverage', 'qa-results']);
const excludedFiles = new Set(['package-lock.json']);
function relPath(file) { return path.relative(root, file).replaceAll('\\', '/'); }
function isSyntheticFixture(rel) {
  const parts = String(rel).split('::');
  return parts.some((part) => part === 'security/garp25/tools/selftest-garp251.mjs'
    || /(?:^|\/)security\/garp25\/tools\/selftest-garp251\.mjs$/.test(part)
    || /(?:^|\/)scripts\/test-/.test(part)
    || /(?:^|\/)server\/test-/.test(part)
    || /(?:^|\/)security\/fixtures\//.test(part)
    || /(?:^|\/)security\/evidence\/prep\/negative-/.test(part));
}
function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() && excludedDirs.has(e.name)) continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(f));
    else if (e.isFile() && !excludedFiles.has(e.name)) out.push(f);
  }
  return out;
}
const files = walk(root), findings = [], syntheticFindings = [], info = [];
for (const file of files) {
  const rel = relPath(file);
  const result = scanSecretBuffer(fs.readFileSync(file), rel);
  if (result.binary && result.hits.length === 0) info.push({ path: rel, note: 'binary-no-private-key-detected' });
  const detail = result.findings?.length ? result.findings : result.hits.map((rule) => ({ path: rel, rule }));
  const grouped = new Map();
  for (const hit of detail) {
    if (!grouped.has(hit.path)) grouped.set(hit.path, new Set());
    grouped.get(hit.path).add(hit.rule);
  }
  for (const [hitPath, rulesSet] of grouped.entries()) {
    const rules = [...rulesSet];
    const item = { path: hitPath, rules };
    if (isSyntheticFixture(hitPath) && rules.every((id) => !isPrivateKeyRule(id))) syntheticFindings.push(item);
    else findings.push(item);
  }
}
const status = findings.length === 0 ? 'PASS' : 'FAIL';
const out = {
  status,
  schema: 'ghrab-source-secret-scan-v3',
  scannedFiles: files.length,
  findingsCount: findings.length,
  findings,
  syntheticFindingsCount: syntheticFindings.length,
  syntheticFindings,
  binaryInfoCount: info.length,
  note: 'Canonical source scanner shares secret/private-key rules with the deployment scanner. Synthetic allowlist is path-bounded and never applies to private-key material.',
};
console[status === 'PASS' ? 'log' : 'error'](JSON.stringify(out, null, 2));
process.exit(status === 'PASS' ? 0 : 1);

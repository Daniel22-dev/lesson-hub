#!/usr/bin/env node
// GARP 2.5.1 GHRAB - verify-release-integrity (schema v2)
// Pouziva stejne kanonicke poradi jako create. Manifest schematu v1 odmita fail-closed,
// protoze jeho artifactDigest neni reprodukovatelny nezavislym verifierem.
import { createHash } from 'node:crypto';
import { readFile, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';

const [dirArg, manifestArg] = process.argv.slice(2);
if (!dirArg || !manifestArg) {
  console.error('Usage: node verify-release-integrity.mjs <deployment-dir> <manifest>');
  process.exit(2);
}
const root = path.resolve(dirArg);
let manifest;
try { manifest = JSON.parse(await readFile(manifestArg, 'utf8')); }
catch (e) { fail(['manifest-unreadable:' + e.message]); }

if (manifest.schema !== 'ghrab-release-integrity-v2')
  fail([`schema:${manifest.schema || 'missing'} (ocekavano ghrab-release-integrity-v2; v1 manifest znovu vygeneruj)`]);
if (manifest.digestAlgorithmId !== 'ghrab-artifact-digest-v2') fail(['digestAlgorithmId']);
if (manifest.hashAlgorithm !== 'SHA-256') fail(['hashAlgorithm']);
if (!Array.isArray(manifest.files) || !manifest.files.length) fail(['files-empty']);

const EXCLUDE = new Set(['release-integrity.json', 'release-integrity.sig',
  'package-attestation.json', 'package-attestation.sig', 'SHA256SUMS.txt']);
const hex = b => createHash('sha256').update(b).digest('hex');
const expected = new Map(manifest.files.map(f => [String(f.path).normalize('NFC'), f]));
if (expected.size !== manifest.files.length) fail(['duplicate-paths-in-manifest']);
if (typeof manifest.fileCount === 'number' && manifest.fileCount !== manifest.files.length) fail(['fileCount']);

const seen = new Set();
const errors = [];
async function walk(dir, base = '') {
  for (const name of await readdir(dir)) {
    const abs = path.join(dir, name);
    const rel = path.posix.join(base, name).normalize('NFC');
    const st = await lstat(abs);
    if (st.isSymbolicLink()) { errors.push(`symlink:${rel}`); continue; }
    if (st.isDirectory()) { await walk(abs, rel); continue; }
    if (!st.isFile()) { errors.push(`irregular-file:${rel}`); continue; }
    if (base === '' && EXCLUDE.has(rel)) continue;
    seen.add(rel);
    const e = expected.get(rel);
    const data = await readFile(abs);
    if (!e) { errors.push(`unexpected:${rel}`); continue; }
    if (e.size !== data.length) errors.push(`size:${rel}`);
    if (e.sha256 !== hex(data)) errors.push(`sha256:${rel}`);
  }
}
await walk(root);
for (const rel of expected.keys()) if (!seen.has(rel)) errors.push(`missing:${rel}`);

const rows = [...manifest.files].sort((a, b) =>
  Buffer.compare(Buffer.from(String(a.path).normalize('NFC'), 'utf8'), Buffer.from(String(b.path).normalize('NFC'), 'utf8')));
const header = `ghrab-artifact-digest-v2\0${rows.length}\n`;
const body = rows.map(f => `${String(f.path).normalize('NFC')}\0${f.sha256}\0${f.size}\n`).join('');
const recomputed = hex(Buffer.from(header + body, 'utf8'));
if (manifest.artifactDigest !== recomputed) errors.push('artifactDigest');

if (errors.length) fail(errors);
console.log(JSON.stringify({ status: 'VERIFIED', files: seen.size, artifactDigest: recomputed }, null, 2));

function fail(errs) {
  console.error(JSON.stringify({ status: 'TAMPERED', errors: errs }, null, 2));
  process.exit(1);
}

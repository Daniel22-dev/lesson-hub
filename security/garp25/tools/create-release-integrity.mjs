#!/usr/bin/env node
// GARP 2.5.1 GHRAB - create-release-integrity (schema v2)
// Zmena proti 2.5: deterministicke poradi nezavisle na ICU/locale a na poradi pruchodu
// adresarem. Cesty se normalizuji do NFC a radi bytove (UTF-8), nikoli localeCompare.
import { createHash } from 'node:crypto';
import { readdir, readFile, lstat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [dirArg, appId, version, keyId, outArg = 'release-integrity.json'] = process.argv.slice(2);
if (!dirArg || !appId || !version || !keyId) {
  console.error('Usage: node create-release-integrity.mjs <deployment-dir> <appId> <version> <keyId> [output]');
  process.exit(2);
}
const root = path.resolve(dirArg);
const EXCLUDE = new Set(['release-integrity.json', 'release-integrity.sig',
  'package-attestation.json', 'package-attestation.sig', 'SHA256SUMS.txt']);
const hex = b => createHash('sha256').update(b).digest('hex');

async function walk(dir, base = '') {
  const rows = [];
  for (const name of await readdir(dir)) {
    const abs = path.join(dir, name);
    const rel = path.posix.join(base, name).normalize('NFC');
    const st = await lstat(abs);
    if (st.isSymbolicLink()) throw new Error(`Symlink forbidden: ${rel}`);
    if (st.isDirectory()) rows.push(...await walk(abs, rel));
    else if (st.isFile()) {
      if (base === '' && EXCLUDE.has(rel)) continue;
      const data = await readFile(abs);
      rows.push({ path: rel, size: data.length, sha256: hex(data) });
    } else throw new Error(`Unsupported file type: ${rel}`);
  }
  return rows;
}

export function canonicalOrder(files) {
  return [...files].sort((a, b) =>
    Buffer.compare(Buffer.from(a.path, 'utf8'), Buffer.from(b.path, 'utf8')));
}

export function artifactDigest(files) {
  const rows = canonicalOrder(files);
  const header = `ghrab-artifact-digest-v2\0${rows.length}\n`;
  const body = rows.map(f => `${f.path}\0${f.sha256}\0${f.size}\n`).join('');
  return hex(Buffer.from(header + body, 'utf8'));
}

const files = canonicalOrder(await walk(root));
if (!files.length) throw new Error('Deployment directory is empty');

// NFC kolize: dve ruzne cesty, ktere po normalizaci splynou, by rozbily 1:1 mapovani.
const dup = new Set();
for (const f of files) { if (dup.has(f.path)) throw new Error(`Duplicate path after NFC: ${f.path}`); dup.add(f.path); }

const manifest = {
  schema: 'ghrab-release-integrity-v2',
  digestAlgorithmId: 'ghrab-artifact-digest-v2',
  pathEncoding: 'NFC',
  pathOrder: 'utf8-bytewise',
  appId, version,
  buildId: process.env.GHRAB_BUILD_ID || `local-${Date.now()}`,
  createdAt: new Date().toISOString(),
  sourceCommit: process.env.GHRAB_SOURCE_COMMIT || null,
  sourcePackageSha256: process.env.GHRAB_SOURCE_PACKAGE_SHA256 || null,
  deploymentPackageSha256: process.env.GHRAB_DEPLOYMENT_PACKAGE_SHA256 || null,
  artifactDigest: artifactDigest(files),
  fileCount: files.length,
  buildProvenanceSha256: process.env.GHRAB_BUILD_PROVENANCE_SHA256 || null,
  sbomSha256: process.env.GHRAB_SBOM_SHA256 || null,
  evidenceManifestSha256: process.env.GHRAB_EVIDENCE_MANIFEST_SHA256 || null,
  hashAlgorithm: 'SHA-256',
  signature: { algorithm: 'Ed25519', keyId },
  files
};
await writeFile(path.resolve(outArg), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ status: 'PASS', output: path.resolve(outArg), files: files.length, artifactDigest: manifest.artifactDigest }, null, 2));

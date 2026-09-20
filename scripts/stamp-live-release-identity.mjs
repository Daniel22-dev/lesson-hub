#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const target = path.resolve(process.argv[2] || path.join(root, 'dist-pages', 'studio-manifest.json'));

for (const name of ['GHRAB_SOURCE_REPOSITORY', 'GHRAB_SOURCE_COMMIT', 'GHRAB_BUILD_ID']) {
  if (!String(process.env[name] || '').trim()) throw new Error(`LIVE identity stamp: missing ${name}.`);
}
if (!/^[0-9a-f]{40}$/i.test(process.env.GHRAB_SOURCE_COMMIT)) throw new Error('LIVE identity stamp: GHRAB_SOURCE_COMMIT is not a full Git SHA.');
if (!fs.existsSync(target)) throw new Error(`LIVE identity stamp: missing ${target}.`);

const manifest = JSON.parse(fs.readFileSync(target, 'utf8'));
if (manifest.id !== 'lesson-hub') throw new Error(`LIVE identity stamp: app id ${manifest.id} != lesson-hub.`);
if (manifest.version !== pkg.version) throw new Error(`LIVE identity stamp: version ${manifest.version} != ${pkg.version}.`);
for (const key of ['contract','requiredPlatformRange','platformVersion','brandVersion','studioBridge','artifactEnvelope','storagePrefix','cacheName']) {
  if (manifest.platform?.[key] == null || manifest.platform?.[key] === '') throw new Error(`LIVE identity stamp: missing platform.${key}.`);
}
manifest.releaseIdentity = {
  schema: 'ghrab-app-release-identity-v1',
  contract: 'ghrab-release-integrity-v2',
  url: './release-integrity.json',
  assuranceMode: 'TRANSITIONAL',
  appId: 'lesson-hub',
  version: pkg.version,
  source: {
    repository: process.env.GHRAB_SOURCE_REPOSITORY,
    commit: process.env.GHRAB_SOURCE_COMMIT.toLowerCase(),
  },
  buildId: process.env.GHRAB_BUILD_ID,
  evidence: {
    releaseIntegrity: 'release-integrity.json',
    provenance: 'build-provenance.json',
    sbom: 'sbom.cdx.json',
    securityEvidenceManifest: 'security-evidence-manifest.json',
  },
};
fs.writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  status: 'PASS',
  appId: manifest.id,
  version: manifest.version,
  contract: manifest.releaseIdentity.contract,
  repository: manifest.releaseIdentity.source.repository,
  sourceCommit: manifest.releaseIdentity.source.commit,
  buildId: manifest.releaseIdentity.buildId,
}, null, 2));

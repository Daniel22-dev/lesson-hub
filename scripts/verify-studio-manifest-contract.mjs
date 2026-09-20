#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const target = path.resolve(process.argv[2] || path.join(root, 'dist', 'studio-manifest.json'));
const fail = (message) => { console.error(`[STUDIO-MANIFEST] FAIL: ${message}`); process.exit(1); };
if (!fs.existsSync(target)) fail(`missing ${path.relative(root, target)}`);
const manifest = JSON.parse(fs.readFileSync(target, 'utf8'));

if (manifest.schema !== 'ai-studio-app-manifest-v1') fail(`schema=${manifest.schema}`);
if (manifest.id !== 'lesson-hub') fail(`id=${manifest.id}`);
if (manifest.version !== pkg.version) fail(`version=${manifest.version} expected=${pkg.version}`);
if (String(manifest.repository || '').toLowerCase() !== 'daniel22-dev/lesson-hub') fail(`repository=${manifest.repository}`);
if (manifest.compatibility?.platformContract !== 'ghrab-platform-v1') fail('compatibility.platformContract');
if (manifest.compatibility?.platformRange !== '>=1.1.2 <2.0.0') fail('compatibility.platformRange');
if (!['2.0', 2, '2', 'ghrab-studio-handoff-v2'].includes(manifest.compatibility?.studioBridge)) fail('compatibility.studioBridge');

const p = manifest.platform || {};
const required = {
  contract: 'ghrab-platform-v1',
  platformVersion: '1.1.2',
  requiredPlatformRange: '>=1.1.2 <2.0.0',
  brandVersion: '1.0.0',
  storagePrefix: 'ghrab.lesson-hub.',
  cacheName: `ghrab-lesson-hub-v${pkg.version}`,
};
for (const [key, value] of Object.entries(required)) if (p[key] !== value) fail(`platform.${key}=${p[key]} expected=${value}`);
if (![2, '2', '2.0', 'ghrab-studio-handoff-v2'].includes(p.studioBridge)) fail(`platform.studioBridge=${p.studioBridge}`);
if (![1, 'ghrab-artifact-envelope-v1'].includes(p.artifactEnvelope)) fail(`platform.artifactEnvelope=${p.artifactEnvelope}`);
if (p.requiredRange !== p.requiredPlatformRange) fail('platform requiredRange alias drift');
if (p.bridgeContract !== 'ghrab-studio-handoff-v2') fail(`platform.bridgeContract=${p.bridgeContract}`);
if (p.artifactContract !== 'ghrab-artifact-envelope-v1') fail(`platform.artifactContract=${p.artifactContract}`);
if (manifest.releaseIdentity != null) {
  const r = manifest.releaseIdentity;
  if (r.contract !== 'ghrab-release-integrity-v2' || r.url !== './release-integrity.json') fail('releaseIdentity pointer');
  if (r.appId !== manifest.id || r.version !== manifest.version) fail('releaseIdentity app/version');
  if (!/^[0-9a-f]{40}$/i.test(String(r.source?.commit || ''))) fail('releaseIdentity source commit');
}
console.log(`[STUDIO-MANIFEST] PASS: ${path.relative(root, target)} preserves Studio + Platform 1.1.2 contract.`);

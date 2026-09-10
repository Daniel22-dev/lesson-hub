#!/usr/bin/env node
// GARP 2.5.1 GHRAB - selftest
// Rozsiruje selftest 2.5 o negativni kontroly, ktere v nem chybely: determinismus
// artifactDigest, vazba keyId na trust root, revokovany klic, anti-rollback,
// neznamy release, prisna provenance, .env rodina, secret ve velkem souboru,
// vendorovany drift, zmrazeni brany v SW a fail-closed chovani release gate.
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const errors = [];
const passed = [];
const run = (s, a) => spawnSync(process.execPath, [path.join(here, s), ...a], { encoding: 'utf8' });
const runEnv = (s, a, env) => spawnSync(process.execPath, [path.join(here, s), ...a], { encoding: 'utf8', env: { ...process.env, ...env } });
const expect = (name, cond) => { if (cond) passed.push(name); else errors.push(name); };

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let j = 0; j < 8; j += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function storedZip(name, data) {
  const filename = Buffer.from(name, 'utf8');
  const body = Buffer.from(data);
  const crc = crc32(body);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(0, 8);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(body.length, 22);
  local.writeUInt16LE(filename.length, 26); local.writeUInt16LE(0, 28);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8); central.writeUInt16LE(0, 10);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(body.length, 24);
  central.writeUInt16LE(filename.length, 28); central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32); central.writeUInt32LE(0, 42);
  const cdOffset = local.length + filename.length + body.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + filename.length, 12); eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, filename, body, central, filename, eocd]);
}

const t = await mkdtemp(path.join(tmpdir(), 'garp251-'));
try {
  // --- fixture: deployment, ktery drive rozbijel poradi (adresar 'a' vedle souboru 'a.js')
  const deploy = path.join(t, 'dist');
  await mkdir(path.join(deploy, 'a'), { recursive: true });
  await writeFile(path.join(deploy, 'index.html'), '<h1>synthetic</h1>\n');
  await writeFile(path.join(deploy, 'a.js'), 'console.log("a")\n');
  await writeFile(path.join(deploy, 'a', 'z.js'), 'console.log("z")\n');
  await writeFile(path.join(deploy, 'ch.js'), 'console.log("ch")\n');
  await writeFile(path.join(deploy, 'h.js'), 'console.log("h")\n');

  let r = run('create-release-integrity.mjs', [deploy, 'synthetic-app', '1.2.0', 'ghrab-key-2026-A', path.join(t, 'ri.json')]);
  expect('create-ri', r.status === 0);
  const digest1 = JSON.parse(r.stdout || '{}').artifactDigest;

  // NC-1 determinismus: druhy beh musi dat stejny digest
  r = run('create-release-integrity.mjs', [deploy, 'synthetic-app', '1.2.0', 'ghrab-key-2026-A', path.join(t, 'ri2.json')]);
  expect('digest-deterministic', JSON.parse(r.stdout || '{}').artifactDigest === digest1);

  await copyFile(path.join(t, 'ri.json'), path.join(deploy, 'release-integrity.json'));
  r = run('verify-release-integrity.mjs', [deploy, path.join(deploy, 'release-integrity.json')]);
  expect('verify-ri-clean-with-dir-file-collision', r.status === 0);

  // NC-2 byte tamper
  await writeFile(path.join(deploy, 'a.js'), 'console.log("tampered")\n');
  r = run('verify-release-integrity.mjs', [deploy, path.join(deploy, 'release-integrity.json')]);
  expect('NC-ri-byte-tamper-fails', r.status !== 0);
  await writeFile(path.join(deploy, 'a.js'), 'console.log("a")\n');

  // NC-3 pridany soubor
  await writeFile(path.join(deploy, 'extra.js'), 'x\n');
  r = run('verify-release-integrity.mjs', [deploy, path.join(deploy, 'release-integrity.json')]);
  expect('NC-ri-extra-file-fails', r.status !== 0);
  await rm(path.join(deploy, 'extra.js'));

  // NC-4 legacy v1 manifest musi byt odmitnut
  const legacy = JSON.parse(await readFile(path.join(t, 'ri.json'), 'utf8'));
  legacy.schema = 'ghrab-release-integrity-v1';
  await writeFile(path.join(t, 'legacy.json'), JSON.stringify(legacy));
  r = run('verify-release-integrity.mjs', [deploy, path.join(t, 'legacy.json')]);
  expect('NC-legacy-v1-rejected', r.status !== 0);

  // --- podpis a trust root
  const A = generateKeyPairSync('ed25519'), B = generateKeyPairSync('ed25519');
  const pem = k => k.export({ type: 'spki', format: 'pem' });
  await writeFile(path.join(t, 'A.priv'), A.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  await writeFile(path.join(t, 'B.priv'), B.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const trust = {
    schema: 'ghrab-trust-root-v1',
    keys: [
      { keyId: 'ghrab-key-2026-A', algorithm: 'Ed25519', status: 'active', publicKeyPem: pem(A.publicKey) },
      { keyId: 'ghrab-key-2025-OLD', algorithm: 'Ed25519', status: 'revoked', publicKeyPem: pem(B.publicKey) }
    ]
  };
  await writeFile(path.join(t, 'trust-root.json'), JSON.stringify(trust, null, 2));

  r = run('sign-release-integrity.mjs', [path.join(deploy, 'release-integrity.json'), path.join(t, 'A.priv'), path.join(deploy, 'release-integrity.sig')]);
  expect('sign', r.status === 0);
  r = run('verify-release-signature.mjs', [path.join(deploy, 'release-integrity.json'), path.join(deploy, 'release-integrity.sig'), path.join(t, 'trust-root.json')]);
  expect('verify-signature-clean', r.status === 0);

  // NC-5 podpis cizim klicem pri deklarovanem keyId A
  r = run('sign-release-integrity.mjs', [path.join(deploy, 'release-integrity.json'), path.join(t, 'B.priv'), path.join(t, 'wrong.sig')]);
  r = run('verify-release-signature.mjs', [path.join(deploy, 'release-integrity.json'), path.join(t, 'wrong.sig'), path.join(t, 'trust-root.json')]);
  expect('NC-wrong-key-for-declared-keyId-denied', r.status !== 0);

  // NC-6 revokovany klic
  const revoked = JSON.parse(await readFile(path.join(t, 'ri.json'), 'utf8'));
  revoked.signature.keyId = 'ghrab-key-2025-OLD';
  await writeFile(path.join(t, 'revoked.json'), JSON.stringify(revoked, null, 2) + '\n');
  run('sign-release-integrity.mjs', [path.join(t, 'revoked.json'), path.join(t, 'B.priv'), path.join(t, 'revoked.sig')]);
  r = run('verify-release-signature.mjs', [path.join(t, 'revoked.json'), path.join(t, 'revoked.sig'), path.join(t, 'trust-root.json')]);
  expect('NC-revoked-key-denied', r.status !== 0);

  // NC-7 neznamy keyId
  const unknown = JSON.parse(await readFile(path.join(t, 'ri.json'), 'utf8'));
  unknown.signature.keyId = 'attacker-key';
  await writeFile(path.join(t, 'unknown.json'), JSON.stringify(unknown, null, 2) + '\n');
  run('sign-release-integrity.mjs', [path.join(t, 'unknown.json'), path.join(t, 'B.priv'), path.join(t, 'unknown.sig')]);
  r = run('verify-release-signature.mjs', [path.join(t, 'unknown.json'), path.join(t, 'unknown.sig'), path.join(t, 'trust-root.json')]);
  expect('NC-unknown-keyId-denied', r.status !== 0);

  // --- registry / anti-rollback
  const registry = {
    schema: 'ghrab-release-registry-v1', updatedAt: new Date().toISOString(),
    apps: [{ appId: 'synthetic-app', approvedVersion: '1.2.0', artifactDigest: digest1, keyId: 'ghrab-key-2026-A', approvedAt: new Date().toISOString(), status: 'approved', history: [{ version: '1.1.0' }] }]
  };
  await writeFile(path.join(t, 'registry.json'), JSON.stringify(registry, null, 2));
  r = run('verify-release-registry.mjs', [path.join(deploy, 'release-integrity.json'), path.join(t, 'registry.json')]);
  expect('registry-clean', r.status === 0);

  // NC-8 validne podepsany starsi release
  const old = { ...registry, apps: [{ ...registry.apps[0], approvedVersion: '1.3.0', history: [{ version: '1.2.0' }] }] };
  await writeFile(path.join(t, 'registry-newer.json'), JSON.stringify(old, null, 2));
  r = run('verify-release-registry.mjs', [path.join(deploy, 'release-integrity.json'), path.join(t, 'registry-newer.json')]);
  expect('NC-signed-rollback-denied', r.status !== 0);

  // NC-9 neznama aplikace
  const foreign = { ...registry, apps: [{ ...registry.apps[0], appId: 'jina-app' }] };
  await writeFile(path.join(t, 'registry-foreign.json'), JSON.stringify(foreign, null, 2));
  r = run('verify-release-registry.mjs', [path.join(deploy, 'release-integrity.json'), path.join(t, 'registry-foreign.json')]);
  expect('NC-unknown-release-denied', r.status !== 0);

  // --- provenance
  const artifact = path.join(t, 'build.zip');
  await writeFile(artifact, 'synthetic-artifact');
  run('create-build-provenance.mjs', [artifact, path.join(t, 'prov-local.json')]);
  r = run('verify-build-provenance.mjs', [artifact, path.join(t, 'prov-local.json')]);
  expect('NC-untrusted-local-builder-rejected', r.status !== 0);
  r = run('verify-build-provenance.mjs', [artifact, path.join(t, 'prov-local.json'), '--allow-local-builder']);
  expect('NC-local-builder-without-source-identity-still-rejected', r.status !== 0);

  const localWithSource = JSON.parse(await readFile(path.join(t, 'prov-local.json'), 'utf8'));
  localWithSource.source.revision = 'b'.repeat(40);
  await writeFile(path.join(t, 'prov-local2.json'), JSON.stringify(localWithSource, null, 2));
  r = run('verify-build-provenance.mjs', [artifact, path.join(t, 'prov-local2.json')]);
  expect('NC-school-profile-rejects-local-builder', r.status !== 0);
  r = run('verify-build-provenance.mjs', [artifact, path.join(t, 'prov-local2.json'), '--allow-local-builder']);
  expect('prep-allows-local-builder-explicitly', r.status === 0);

  const good = JSON.parse(await readFile(path.join(t, 'prov-local.json'), 'utf8'));
  good.source.revision = 'a'.repeat(40);
  good.builder.id = 'github-actions://Daniel22-dev/ai-studio-ghrab';
  await writeFile(path.join(t, 'prov.json'), JSON.stringify(good, null, 2));
  r = run('verify-build-provenance.mjs', [artifact, path.join(t, 'prov.json')]);
  expect('provenance-clean', r.status === 0);
  await writeFile(artifact, 'tampered-artifact');
  r = run('verify-build-provenance.mjs', [artifact, path.join(t, 'prov.json')]);
  expect('NC-provenance-artifact-tamper-fails', r.status !== 0);
  await writeFile(artifact, 'synthetic-artifact');

  const baseOnly = JSON.parse(await readFile(path.join(t, 'prov-local.json'), 'utf8'));
  baseOnly.source.revision = null;
  baseOnly.source.baseCommit = 'c'.repeat(40);
  baseOnly.source.sourcePackageSha256 = 'd'.repeat(64);
  await writeFile(path.join(t, 'prov-base.json'), JSON.stringify(baseOnly, null, 2));
  r = run('verify-build-provenance.mjs', [artifact, path.join(t, 'prov-base.json'), '--allow-local-builder']);
  expect('provenance-base-commit-with-source-package-clean', r.status === 0);
  r = runEnv('verify-build-provenance.mjs', [artifact, path.join(t, 'prov-base.json'), '--allow-local-builder'], { GHRAB_EXPECT_BASE_COMMIT: 'e'.repeat(40) });
  expect('NC-provenance-base-commit-mismatch-fails', r.status !== 0);

  // --- leak scanner
  const leak = path.join(t, 'leak'); await mkdir(leak);
  await writeFile(path.join(leak, 'index.html'), 'ok');
  r = run('scan-deployment-leaks.mjs', [leak]);
  expect('leak-clean', r.status === 0);
  await writeFile(path.join(leak, '.env.production'), 'SESSION_SECRET=7f3a9c1e5b2d8046af11c3e7b9d05a62\n');
  r = run('scan-deployment-leaks.mjs', [leak]);
  expect('NC-env-production-detected', r.status !== 0);
  await rm(path.join(leak, '.env.production'));
  await writeFile(path.join(leak, 'bundle.js'), '// b\n' + 'a'.repeat(2_100_000) + '\nconst K="AIzaSyFAKEFAKEFAKEFAKEFAKEFAKEFAKE00";\n');
  r = run('scan-deployment-leaks.mjs', [leak]);
  expect('NC-secret-in-large-bundle-detected', r.status !== 0);
  await rm(path.join(leak, 'bundle.js'));
  await writeFile(path.join(leak, 'app.js.map'), '{}');
  r = run('scan-deployment-leaks.mjs', [leak]);
  expect('NC-sourcemap-detected', r.status !== 0);
  await rm(path.join(leak, 'app.js.map'));
  await writeFile(path.join(leak, 'jwk.json'), JSON.stringify({ kty: 'EC', crv: 'P-256', x: 'A'.repeat(43), y: 'B'.repeat(43), d: 'C'.repeat(43) }));
  r = run('scan-deployment-leaks.mjs', [leak]);
  expect('NC-jwk-private-key-detected', r.status !== 0);
  await rm(path.join(leak, 'jwk.json'));
  await writeFile(path.join(leak, 'encrypted.txt'), '-----BEGIN ' + 'ENCRYPTED PRIVATE KEY-----\n' + 'A'.repeat(64) + '\n-----END ' + 'ENCRYPTED PRIVATE KEY-----\n');
  r = run('scan-deployment-leaks.mjs', [leak]);
  expect('NC-encrypted-private-key-detected', r.status !== 0);
  await rm(path.join(leak, 'encrypted.txt'));
  await writeFile(path.join(leak, 'pgp.txt'), '-----BEGIN ' + 'PGP PRIVATE KEY ' + 'BLOCK' + '-----\n' + 'A'.repeat(64) + '\n-----END ' + 'PGP PRIVATE KEY ' + 'BLOCK' + '-----\n');
  r = run('scan-deployment-leaks.mjs', [leak]);
  expect('NC-pgp-private-key-detected', r.status !== 0);
  await rm(path.join(leak, 'pgp.txt'));

  const { privateKey: ecPrivate } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const { privateKey: edPrivate } = generateKeyPairSync('ed25519');
  const jwk = ecPrivate.export({ format: 'jwk' });
  const privatePem = edPrivate.export({ format: 'pem', type: 'pkcs8' });
  const privateDerBytes = edPrivate.export({ format: 'der', type: 'pkcs8' });
  const syntheticSecret = 'Ab9CdefGhijKLMNopQRstUVwxyz0123456789';
  const secretClassFixtures = [
    ['B01', 'app.js', `const k={kty:'${jwk.kty}',crv:'${jwk.crv}',x:'${jwk.x}',y:'${jwk.y}',d:'${jwk.d}'};`],
    ['B02', 'app.json', JSON.stringify({ payload: JSON.stringify(jwk) })],
    ['B03', 'app.js', `const material='${Buffer.from(privateDerBytes).toString('base64')}';`],
    ['B04', 'app.js', `const material='${Buffer.from(privatePem).toString('base64')}';`],
    ['B05', 'app.js', `const clientSecret = "${syntheticSecret}";`],
    ['B06', 'app.json', JSON.stringify({ apiKey: syntheticSecret })],
    ['B07', 'app.js', `const cfg={smtpPassword:'${syntheticSecret}'};`],
    ['B08', 'app.js', `const API_KEY = \`${syntheticSecret}\`;`],
    ['B09', 'app.js', `const value='sk_live_${'A'.repeat(28)}';`],
    ['B10', 'app.js', `const value='github_pat_${'A'.repeat(30)}';`],
    ['B11', 'app.js', `const url='smtp://user:${syntheticSecret}@mail.example.invalid';`],
    ['B12', 'app.env', `APP_SECRET=${syntheticSecret}\n`],
    ['B13', 'private.der', Buffer.from(privateDerBytes)],
    ['B14', 'private.gz', gzipSync(Buffer.from(privatePem))],
    ['B15', 'app.env', `AWS_SECRET_ACCESS_KEY=${'AbCdEf0123456789'.repeat(3).slice(0,40)}\n`],
    ['C07', 'double-base64.txt', Buffer.from(Buffer.from(privatePem).toString('base64')).toString('base64')],
    ['C09', 'private-hex.txt', Buffer.from(privateDerBytes).toString('hex')],
    ['C10', 'private.zip', storedZip('private.pem', privatePem)],
    ['C13', 'config.yaml', `smtp_password: ${syntheticSecret}\n`],
    ['C16', 'config.txt', `upstream_secret=${syntheticSecret}\napi_key=${syntheticSecret}\n`],
    ['E01', 'nested.yaml', `smtp:\n  password: ${syntheticSecret}\n`],
    ['E02', 'mail.ini', `[mail]\npassword = ${syntheticSecret}\n`],
    ['E03', 'compose.yaml', `environment:\n  - smtp_password=${syntheticSecret}\n`],
    ['E04', 'db.properties', `db.password=${syntheticSecret}\n`],
    ['C12', 'charcode.js', `const token=String.fromCharCode(${Array.from('sk_live_' + 'A'.repeat(28)).map((c)=>c.charCodeAt(0)).join(',')});`],
    ['C17', 'basic.js', `const auth=btoa("user:${syntheticSecret}");`],
    ['D15', 'split-key.js', `const material=['${Buffer.from(privateDerBytes).toString('base64').slice(0, 60)}','${Buffer.from(privateDerBytes).toString('base64').slice(60)}'].join("");`],
  ];
  for (const [id, name, content] of secretClassFixtures) {
    const dir = path.join(t, `secret-class-${id}`);
    await mkdir(dir);
    await writeFile(path.join(dir, name), content);
    const sourceResult = run('scan-source-secrets.mjs', [dir]);
    const deploymentResult = run('scan-deployment-leaks.mjs', [dir]);
    expect(`NC-secret-class-${id}-source-and-deployment-fail`, sourceResult.status !== 0 && deploymentResult.status !== 0);
  }

  // --- evidence
  const ev = path.join(t, 'evidence'); await mkdir(ev);
  await writeFile(path.join(ev, 'result.txt'), 'PASS synthetic\n');
  run('create-evidence-manifest.mjs', [ev, path.join(t, 'evidence.json')]);
  r = run('verify-evidence-manifest.mjs', [ev, path.join(t, 'evidence.json')]);
  expect('evidence-clean', r.status === 0);
  await writeFile(path.join(ev, 'result.txt'), 'TAMPER\n');
  r = run('verify-evidence-manifest.mjs', [ev, path.join(t, 'evidence.json')]);
  expect('NC-evidence-tamper-fails', r.status !== 0);
  await writeFile(path.join(ev, 'result.txt'), 'PASS synthetic\n');

  // N10 hardening: evidence manifest v2 must bind selected authoritative policy files outside evidence-dir.
  const policyFile = path.join(t, 'security-critical-assets.json');
  await writeFile(policyFile, '["app-guard.js"]\n');
  run('create-evidence-manifest.mjs', [ev, path.join(t, 'evidence-v2.json'), '--project-root', t, '--extra', 'security-critical-assets.json']);
  r = run('verify-evidence-manifest.mjs', [ev, path.join(t, 'evidence-v2.json'), '--project-root', t]);
  expect('evidence-v2-external-policy-clean', r.status === 0);
  await writeFile(policyFile, '["tampered.js"]\n');
  r = run('verify-evidence-manifest.mjs', [ev, path.join(t, 'evidence-v2.json'), '--project-root', t]);
  expect('NC-evidence-v2-external-policy-tamper-fails', r.status !== 0);
  await writeFile(policyFile, '["app-guard.js"]\n');

  // --- vendorovana konzistence
  const eco = path.join(t, 'eco');
  await mkdir(path.join(eco, 'studio', 'src'), { recursive: true });
  await mkdir(path.join(eco, 'ks', 'src', 'vendor'), { recursive: true });
  await mkdir(path.join(eco, 'sortio', 'src', 'vendor'), { recursive: true });
  await writeFile(path.join(eco, 'studio', 'src', 'platform.js'), 'export const V="1.1.0"\n');
  await writeFile(path.join(eco, 'ks', 'src', 'vendor', 'platform.js'), 'export const V="1.1.0"\n');
  await writeFile(path.join(eco, 'sortio', 'src', 'vendor', 'platform.js'), 'export const V="1.0.9"\n');
  const cfg = {
    schema: 'ghrab-vendored-consistency-v1', canonicalRoot: 'studio',
    components: [{ id: 'platform', canonical: 'src/platform.js', severity: 'CRITICAL' }],
    consumers: [
      { appId: 'ks', root: 'ks', copies: { platform: ['src/vendor/platform.js'] } },
      { appId: 'sortio', root: 'sortio', copies: { platform: ['src/vendor/platform.js'] } }
    ]
  };
  await writeFile(path.join(eco, 'cfg.json'), JSON.stringify(cfg, null, 2));
  r = run('check-vendored-consistency.mjs', [path.join(eco, 'cfg.json')]);
  expect('NC-vendored-drift-detected', r.status !== 0 && r.stderr.includes('DRIFT'));
  await writeFile(path.join(eco, 'sortio', 'src', 'vendor', 'platform.js'), 'export const V="1.1.0"\n');
  r = run('check-vendored-consistency.mjs', [path.join(eco, 'cfg.json')]);
  expect('vendored-consistent-after-fix', r.status === 0);

  // --- service worker freeze
  const swDir = path.join(t, 'swapp'); await mkdir(swDir, { recursive: true });
  await writeFile(path.join(swDir, 'app-guard.js'), '// guard\n');
  await writeFile(path.join(swDir, 'revoked-access.json'), '[]\n');
  await writeFile(path.join(swDir, 'index.html'), 'ok');
  const badSw = `const PRECACHE=['/index.html','/app-guard.js','/revoked-access.json'];
self.addEventListener('install',e=>e.waitUntil(caches.open('x').then(cache=>cache.addAll(PRECACHE))));
self.addEventListener('fetch',e=>{e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request)))});`;
  await writeFile(path.join(t, 'sw-bad.js'), badSw);
  r = run('check-sw-security-freeze.mjs', [path.join(t, 'sw-bad.js'), swDir]);
  expect('NC-sw-freezes-guard-detected', r.status !== 0);

  // GH-02 hotfix regression: variable name must not hide an array-driven cache.add path.
  const blindSpotSw = `const RANDOM_CACHE_LIST=['/index.html','/app-guard.js'];
self.addEventListener('install',e=>e.waitUntil(caches.open('x').then(cache=>Promise.all(RANDOM_CACHE_LIST.map(asset=>cache.add(asset))))));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(u.pathname.includes('app-guard')){e.respondWith(fetch(e.request,{cache:'no-store'}));return;}e.respondWith(fetch(e.request));});`;
  await writeFile(path.join(t, 'sw-blindspot.js'), blindSpotSw);
  r = run('check-sw-security-freeze.mjs', [path.join(t, 'sw-blindspot.js'), swDir]);
  expect('NC-sw-arbitrary-array-name-cannot-hide-critical-precache', r.status !== 0 && (r.stderr.includes('CRITICAL') || r.stdout.includes('CRITICAL')));
  const goodSw = `const PRECACHE=['/index.html'];
async function networkOnlyNoStore(request){return fetch(request,{cache:'no-store'})}
function isSecurityCriticalRequest(url,scopePath){const relative=url.pathname.slice(scopePath.length);return relative==='app-guard.js'||relative.endsWith('/app-guard.js')||relative==='revoked-access.json'||relative.endsWith('/revoked-access.json')}
async function cacheFirst(request){const cache=await caches.open('x');const cached=await cache.match(request);if(cached)return cached;const response=await fetch(request);if(response&&response.ok)await cache.put(request,response.clone());return response}
self.addEventListener('fetch',e=>{const request=e.request;const u=new URL(request.url);const scopePath=new URL('./',self.location.href).pathname;if(isSecurityCriticalRequest(u,scopePath)){e.respondWith(networkOnlyNoStore(request));return;}e.respondWith(cacheFirst(request))});`;
  await writeFile(path.join(t, 'sw-good.js'), goodSw);
  const goodCriticalListPath = path.join(t, 'critical-good.json');
  await writeFile(goodCriticalListPath, JSON.stringify(['app-guard','revoked-access.json'], null, 2));
  r = run('check-sw-security-freeze.mjs', [path.join(t, 'sw-good.js'), swDir, goodCriticalListPath]);
  expect('sw-network-first-for-guard-passes', r.status === 0);
  let goodSwReport = {}; try { goodSwReport = JSON.parse(r.stdout || '{}'); } catch {}
  expect('sw-pass-emits-positive-behavioral-evidence', goodSwReport.behavioralGuard?.status === 'PASS' && goodSwReport.fetchRouteBehavior?.status === 'PASS' && goodSwReport.fetchRouteBehavior?.checkedAuthoritative >= 2);
  const serverOnlyCritical = path.join(t, 'critical-server-only.json');
  await writeFile(serverOnlyCritical, JSON.stringify(['access-control'], null, 2));
  r = run('check-sw-security-freeze.mjs', [path.join(t, 'sw-good.js'), swDir, serverOnlyCritical]);
  expect('NC-sw-server-only-authority-is-behaviorally-tested', r.status !== 0 && (r.stderr.includes('access-control') || r.stdout.includes('access-control')));

  // N7 hardening: alternate Cache API write paths must never be silent PASS.
  const criticalListPath = path.join(t, 'critical-list.json');
  await writeFile(criticalListPath, JSON.stringify(['app-guard.js'], null, 2));
  const swVariants = [
    ['property-array-addAll', `self.EXTRA_ASSETS=['/app-guard.js'];\nself.addEventListener('install',e=>e.waitUntil(caches.open('x').then(cache=>cache.addAll(self.EXTRA_ASSETS))));`],
    ['cache-put-literal', `self.addEventListener('install',e=>e.waitUntil(caches.open('x').then(cache=>cache.put('/app-guard.js',new Response('x')))));`],
    ['cache-add-new-request', `self.addEventListener('install',e=>e.waitUntil(caches.open('x').then(cache=>cache.add(new Request('/app-guard.js')))));`],
    ['concat-addAll', `const BASE=['/index.html'];const X=BASE.concat(['/app-guard.js']);\nself.addEventListener('install',e=>e.waitUntil(caches.open('x').then(cache=>cache.addAll(X))));`],
    ['split-addAll', `const X='/index.html,/app-guard.js'.split(',');\nself.addEventListener('install',e=>e.waitUntil(caches.open('x').then(cache=>cache.addAll(X))));`],
    ['object-values-forof-add', `const MAP={a:'/index.html',b:'/app-guard.js'};\nself.addEventListener('install',e=>e.waitUntil((async()=>{const cache=await caches.open('x');for(const asset of Object.values(MAP)){await cache.add(asset)}})()));`]
  ];
  for (const [id, code] of swVariants) {
    const f = path.join(t, `sw-${id}.js`); await writeFile(f, code);
    r = run('check-sw-security-freeze.mjs', [f, swDir, criticalListPath]);
    expect(`NC-sw-${id}-not-silent-pass`, r.status !== 0);
  }
  const unresolvedSw = `let dynamicPath;self.addEventListener('install',e=>e.waitUntil(caches.open('x').then(cache=>cache.add(dynamicPath))));`;
  await writeFile(path.join(t, 'sw-unresolved.js'), unresolvedSw);
  r = run('check-sw-security-freeze.mjs', [path.join(t, 'sw-unresolved.js'), swDir, criticalListPath]);
  expect('NC-sw-unresolved-cache-write-amber-or-fail', r.status !== 0 && (r.stderr.includes('AMBER') || r.stdout.includes('AMBER') || r.stderr.includes('FAIL') || r.stdout.includes('FAIL')));

  // N8 hardening: comments/text proximity cannot create a network-only exemption.
  await writeFile(path.join(swDir, 'data-manifest.json'), '{}\n');
  const dataCritical = path.join(t, 'critical-data.json');
  await writeFile(dataCritical, JSON.stringify(['data-manifest.json'], null, 2));
  const commentBypassSw = `const CORE=['/index.html'];\nself.addEventListener('install',e=>e.waitUntil(caches.open('x').then(cache=>cache.addAll(CORE))));\nasync function networkFirst(request){ // data-manifest.json network later\n const cache=await caches.open('x');try{return await fetch(request)}catch(e){return cache.match(request)}}\nasync function cacheFirst(request){const cache=await caches.open('x');const c=await cache.match(request);if(c)return c;const rr=await fetch(request);if(rr.ok)await cache.put(request,rr.clone());return rr}\nself.addEventListener('fetch',e=>e.respondWith(cacheFirst(e.request)));`;
  await writeFile(path.join(t, 'sw-comment-bypass.js'), commentBypassSw);
  r = run('check-sw-security-freeze.mjs', [path.join(t, 'sw-comment-bypass.js'), swDir, dataCritical]);
  expect('NC-sw-comment-cannot-create-exemption', r.status !== 0);

  // N6 2026-09-09 hardening: literals that look equivalent after normalization must not mask a false runtime predicate.
  const behavioralBypassSw = `async function networkOnlyNoStore(request){return fetch(request,{cache:'no-store'})}
function isSecurityCriticalRequest(url,scopePath){const relative=url.pathname.slice(scopePath.length);return relative==='./app-guard.js'}
async function cacheFirst(request){const cache=await caches.open('x');const cached=await cache.match(request);if(cached)return cached;const response=await fetch(request);if(response&&response.ok)await cache.put(request,response.clone());return response}
self.addEventListener('fetch',event=>{const request=event.request;const url=new URL(request.url);const scopePath=new URL('./',self.location.href).pathname;if(isSecurityCriticalRequest(url,scopePath)){event.respondWith(networkOnlyNoStore(request));return;}event.respondWith(cacheFirst(request));});`;
  await writeFile(path.join(t, 'sw-behavioral-guard-bypass.js'), behavioralBypassSw);
  r = run('check-sw-security-freeze.mjs', [path.join(t, 'sw-behavioral-guard-bypass.js'), swDir, criticalListPath]);
  expect('NC-sw-behavioral-guard-false-negative-detected', r.status !== 0 && (r.stderr.includes('behavioral') || r.stdout.includes('behavioral')));

  // N14 2026-09-09 hardening: the whole fetch route must be fail-closed, not just the predicate.
  const negatedGuardSw = goodSw.replace('if(isSecurityCriticalRequest(u,scopePath)){','if(!isSecurityCriticalRequest(u,scopePath)){');
  await writeFile(path.join(t, 'sw-guard-negated.js'), negatedGuardSw);
  r = run('check-sw-security-freeze.mjs', [path.join(t, 'sw-guard-negated.js'), swDir, goodCriticalListPath]);
  expect('NC-sw-negated-critical-guard-detected', r.status !== 0 && (r.stderr.includes('fetch handler') || r.stdout.includes('fetch handler')));
  const noRespondGuardSw = goodSw.replace('e.respondWith(networkOnlyNoStore(request));return;','networkOnlyNoStore(request);');
  await writeFile(path.join(t, 'sw-guard-no-respond.js'), noRespondGuardSw);
  r = run('check-sw-security-freeze.mjs', [path.join(t, 'sw-guard-no-respond.js'), swDir, goodCriticalListPath]);
  expect('NC-sw-critical-route-without-respond-return-detected', r.status !== 0 && (r.stderr.includes('fetch handler') || r.stdout.includes('fetch handler')));
  // N20/N21/N22 hardening: close the pre-guard routing-property class and verify the trusted sink itself.
  const preGuardVariants = [
    ['destination-respond', `if(e.request.destination==='script'){e.respondWith(networkFirst(e.request));return;}`],
    ['mode-return', `if(e.request.mode!=='same-origin')return;`],
    ['event-client-respond', `if(e.clientId){e.respondWith(networkFirst(e.request));return;}`],
    ['url-search', `if(u.search){e.respondWith(networkFirst(e.request));return;}`],
    ['referrer-respond', `if(e.request.referrer){e.respondWith(networkFirst(e.request));return;}`]
  ];
  for (const [id, pre] of preGuardVariants) {
    const mutated = goodSw.replace('if(isSecurityCriticalRequest(u,scopePath)){', `${pre}if(isSecurityCriticalRequest(u,scopePath)){`);
    const f = path.join(t, `sw-pre-guard-${id}.js`); await writeFile(f, mutated);
    r = run('check-sw-security-freeze.mjs', [f, swDir, goodCriticalListPath]);
    expect(`NC-sw-pre-guard-${id}-detected`, r.status !== 0 && (r.stderr.includes('preGuardReads') || r.stdout.includes('preGuardReads') || r.stderr.includes('fetch handler') || r.stdout.includes('fetch handler')));
  }
  const sinkNoStoreSw = goodSw.replace("return fetch(request,{cache:'no-store'})", 'return fetch(request)');
  await writeFile(path.join(t, 'sw-sink-no-no-store.js'), sinkNoStoreSw);
  r = run('check-sw-security-freeze.mjs', [path.join(t, 'sw-sink-no-no-store.js'), swDir, goodCriticalListPath]);
  expect('NC-sw-network-only-sink-must-use-no-store', r.status !== 0 && (r.stderr.includes('networkOnlyNoStore') || r.stdout.includes('networkOnlyNoStore')));
  const sinkCacheWriteSw = goodSw.replace(
    "async function networkOnlyNoStore(request){return fetch(request,{cache:'no-store'})}",
    "async function networkOnlyNoStore(request){const c=await caches.open('x');const r=await fetch(request,{cache:'no-store'});await c.put(request,r);return r}"
  );
  await writeFile(path.join(t, 'sw-sink-cache-write.js'), sinkCacheWriteSw);
  r = run('check-sw-security-freeze.mjs', [path.join(t, 'sw-sink-cache-write.js'), swDir, goodCriticalListPath]);
  expect('NC-sw-network-only-sink-cache-write-is-critical', r.status !== 0 && (r.stderr.includes('CRITICAL') || r.stdout.includes('CRITICAL')));

  // Round-4 class closure: even ignored pre-guard side effects and multiple handlers must fail closed.
  const preGuardNetworkFirstSw = goodSw.replace('if(isSecurityCriticalRequest(u,scopePath)){', 'networkFirst(e.request);if(isSecurityCriticalRequest(u,scopePath)){');
  await writeFile(path.join(t, 'sw-pre-guard-networkfirst-side-effect.js'), preGuardNetworkFirstSw);
  r = run('check-sw-security-freeze.mjs', [path.join(t, 'sw-pre-guard-networkfirst-side-effect.js'), swDir, goodCriticalListPath]);
  expect('NC-sw-pre-guard-networkfirst-side-effect-detected', r.status !== 0 && (r.stderr.includes('preGuardEffects') || r.stdout.includes('preGuardEffects')));
  const preGuardFetchSw = goodSw.replace('if(isSecurityCriticalRequest(u,scopePath)){', 'fetch(e.request);if(isSecurityCriticalRequest(u,scopePath)){');
  await writeFile(path.join(t, 'sw-pre-guard-direct-fetch-side-effect.js'), preGuardFetchSw);
  r = run('check-sw-security-freeze.mjs', [path.join(t, 'sw-pre-guard-direct-fetch-side-effect.js'), swDir, goodCriticalListPath]);
  expect('NC-sw-pre-guard-direct-fetch-side-effect-detected', r.status !== 0 && (r.stderr.includes('preGuardEffects') || r.stdout.includes('preGuardEffects')));
  const multipleFetchHandlersSw = goodSw + `
self.addEventListener('fetch',e=>{networkFirst(e.request);});
`;
  await writeFile(path.join(t, 'sw-multiple-fetch-handlers.js'), multipleFetchHandlersSw);
  r = run('check-sw-security-freeze.mjs', [path.join(t, 'sw-multiple-fetch-handlers.js'), swDir, goodCriticalListPath]);
  expect('NC-sw-multiple-fetch-handlers-detected', r.status !== 0 && (r.stderr.includes('fetch-handler-registration-ambiguous') || r.stdout.includes('fetch-handler-registration-ambiguous')));
  const asyncDeferredSideEffectSw = goodSw.replace('if(isSecurityCriticalRequest(u,scopePath)){', 'Promise.resolve().then(()=>networkFirst(e.request));if(isSecurityCriticalRequest(u,scopePath)){');
  await writeFile(path.join(t, 'sw-pre-guard-async-deferred-side-effect.js'), asyncDeferredSideEffectSw);
  r = run('check-sw-security-freeze.mjs', [path.join(t, 'sw-pre-guard-async-deferred-side-effect.js'), swDir, goodCriticalListPath]);
  expect('NC-sw-pre-guard-async-deferred-side-effect-detected', r.status !== 0 && (r.stderr.includes('not-safe-for-bounded-eval') || r.stdout.includes('not-safe-for-bounded-eval')));
  const postGuardSideEffectSw = goodSw.replace('if(isSecurityCriticalRequest(u,scopePath)){e.respondWith(networkOnlyNoStore(request));return;}', 'if(isSecurityCriticalRequest(u,scopePath)){networkFirst(request);e.respondWith(networkOnlyNoStore(request));return;}');
  await writeFile(path.join(t, 'sw-critical-branch-extra-route-effect.js'), postGuardSideEffectSw);
  r = run('check-sw-security-freeze.mjs', [path.join(t, 'sw-critical-branch-extra-route-effect.js'), swDir, goodCriticalListPath]);
  expect('NC-sw-critical-branch-extra-route-effect-detected', r.status !== 0 && (r.stderr.includes('routeEffects') || r.stdout.includes('routeEffects') || r.stderr.includes('fetch handler') || r.stdout.includes('fetch handler')));
  const postGuardAsyncSourceSw = goodSw.replace('if(isSecurityCriticalRequest(u,scopePath)){e.respondWith(networkOnlyNoStore(request));return;}', 'if(isSecurityCriticalRequest(u,scopePath)){e.preloadResponse.then(()=>networkFirst(request));e.respondWith(networkOnlyNoStore(request));return;}');
  await writeFile(path.join(t, 'sw-critical-branch-async-source.js'), postGuardAsyncSourceSw);
  r = run('check-sw-security-freeze.mjs', [path.join(t, 'sw-critical-branch-async-source.js'), swDir, goodCriticalListPath]);
  expect('NC-sw-critical-branch-async-source-detected', r.status !== 0 && (r.stderr.includes('postGuardReads') || r.stdout.includes('postGuardReads') || r.stderr.includes('not-safe-for-bounded-eval') || r.stdout.includes('not-safe-for-bounded-eval')));

  // N6 hardening: release gate itself must enforce the authoritative list and propagate SW failure.
  r = run('release-gate.mjs', [
    '--profile', 'prep', '--deploy', deploy, '--manifest', path.join(deploy, 'release-integrity.json'),
    '--signature', path.join(deploy, 'release-integrity.sig'), '--trust-root', path.join(t, 'trust-root.json'),
    '--sw', path.join(t, 'sw-blindspot.js'), '--critical-list', criticalListPath
  ]);
  expect('NC-gate-propagates-sw-critical-failure', r.status !== 0 && (r.stderr.includes('sw-security-freeze') || r.stdout.includes('sw-security-freeze')));

  r = run('release-gate.mjs', [
    '--profile', 'prep', '--deploy', deploy, '--manifest', path.join(deploy, 'release-integrity.json'),
    '--signature', path.join(deploy, 'release-integrity.sig'), '--trust-root', path.join(t, 'trust-root.json'),
    '--sw', path.join(t, 'sw-good.js')
  ]);
  expect('NC-gate-missing-critical-list-fails-closed', r.status !== 0 && (r.stderr.includes('critical-asset-list-missing') || r.stdout.includes('critical-asset-list-missing')));

  // N8/N11 hardening: explicit AI boundary inventory and byte fingerprint are release-verifiable.
  const aiRoot = path.join(t, 'ai-root'); await mkdir(path.join(aiRoot, 'src', 'js'), { recursive: true });
  await writeFile(path.join(aiRoot, 'package.json'), JSON.stringify({name:'synthetic-ai',version:'1.0.0'}));
  await writeFile(path.join(aiRoot, 'src', 'js', 'ai.js'), 'export const prompt = "synthetic";\n');
  const aiBytes = await readFile(path.join(aiRoot, 'src', 'js', 'ai.js'));
  const aiSha = createHash('sha256').update(aiBytes).digest('hex');
  const aiAggregate = createHash('sha256').update(Buffer.from(`${aiSha}  src/js/ai.js\n`)).digest('hex');
  await writeFile(path.join(aiRoot, 'inventory.json'), JSON.stringify(['src/js/ai.js'], null, 2));
  await writeFile(path.join(aiRoot, 'fingerprint.json'), JSON.stringify({schema:'ghrab-ai-assurance-fingerprint-v2',appId:'synthetic-ai',appVersion:'1.0.0',algorithm:'SHA-256',aggregate:aiAggregate,files:[{path:'src/js/ai.js',sha256:aiSha}]}, null, 2));
  r = run('verify-ai-assurance-fingerprint.mjs', [path.join(aiRoot, 'fingerprint.json'), path.join(aiRoot, 'inventory.json'), aiRoot]);
  expect('ai-assurance-explicit-inventory-clean', r.status === 0);
  await writeFile(path.join(aiRoot, 'src', 'js', 'untracked.js'), 'export const systemInstruction = "new boundary"; function callGemini(){}\n');
  r = run('verify-ai-assurance-fingerprint.mjs', [path.join(aiRoot, 'fingerprint.json'), path.join(aiRoot, 'inventory.json'), aiRoot]);
  expect('NC-ai-assurance-inventory-drift-fails-in-canonical-verifier', r.status !== 0 && (r.stderr.includes('inventory-drift-untracked') || r.stdout.includes('inventory-drift-untracked')));
  await rm(path.join(aiRoot, 'src', 'js', 'untracked.js'));
  await writeFile(path.join(aiRoot, 'src', 'js', 'ai.js'), 'export const prompt = "tampered";\n');
  r = run('verify-ai-assurance-fingerprint.mjs', [path.join(aiRoot, 'fingerprint.json'), path.join(aiRoot, 'inventory.json'), aiRoot]);
  expect('NC-ai-assurance-byte-tamper-fails', r.status !== 0);

  // --- release gate fail-closed
  r = run('release-gate.mjs', ['--profile', 'school', '--deploy', deploy, '--manifest', path.join(deploy, 'release-integrity.json')]);
  expect('NC-gate-missing-inputs-fails-closed', r.status !== 0 && r.stderr.includes('required-input-missing'));

  await writeFile(path.join(deploy, 'release-integrity.json'), await readFile(path.join(t, 'ri.json')));
  run('sign-release-integrity.mjs', [path.join(deploy, 'release-integrity.json'), path.join(t, 'A.priv'), path.join(deploy, 'release-integrity.sig')]);
  r = run('release-gate.mjs', [
    '--profile', 'school', '--deploy', deploy, '--manifest', path.join(deploy, 'release-integrity.json'),
    '--signature', path.join(deploy, 'release-integrity.sig'), '--trust-root', path.join(t, 'trust-root.json'),
    '--registry', path.join(t, 'registry.json'), '--artifact', artifact, '--provenance', path.join(t, 'prov.json'),
    '--evidence-dir', ev, '--evidence-manifest', path.join(t, 'evidence.json')
  ]);
  expect('gate-full-chain-green', r.status === 0);
} finally { await rm(t, { recursive: true, force: true }); }

const out = { status: errors.length ? 'FAIL' : 'PASS', checks: passed.length + errors.length, passed: passed.length, failed: errors };
console[errors.length ? 'error' : 'log'](JSON.stringify(out, null, 2));
process.exit(errors.length ? 1 : 0);

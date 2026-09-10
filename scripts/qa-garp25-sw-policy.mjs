#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const checker = path.join(root, 'security/garp25/tools/check-sw-security-freeze.mjs');
const list = path.join(root, 'security/security-critical-assets.json');
const deploy = path.join(root, 'dist-school-server');
const sw = path.join(deploy, 'sw.js');
const run = (swPath) => spawnSync(process.execPath, [checker, swPath, deploy, list], { encoding: 'utf8' });
const base = run(sw);
const cases = [{ id: 'baseline', pass: base.status === 0, exit: base.status, detail: (base.stdout || base.stderr || '').slice(0, 600) }];
const raw = fs.readFileSync(sw, 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lesson-hub-garp25-sw-'));
try {
  const mutations = [
    ['SHNC-SW-01-PRECACHE-CRITICAL', raw.replace('const CORE_ASSETS = [', 'const CORE_ASSETS = [\n  "./src/access/deployment-config.js",')],
    ['SHNC-SW-02-GUARD-REMOVED', raw.replaceAll('isSecurityCriticalRequest', 'isSecurityCriticalRequest_MUTATED')],
    ['SHNC-SW-03-GUARD-NEGATED', raw.replace('if (isSecurityCriticalRequest(url, scopePath)) {', 'if (!isSecurityCriticalRequest(url, scopePath)) {')],
    ['SHNC-SW-04-NO-RESPONDWITH', raw.replace("    event.respondWith(networkOnlyNoStore(request));\n    return;", "    networkOnlyNoStore(request);\n    return;")],
    ['SHNC-SW-05-PRE-GUARD-RESPOND', raw.replace('  if (isSecurityCriticalRequest(url, scopePath)) {', "  if (request.destination === 'script') { event.respondWith(networkFirst(request)); return; }\n  if (isSecurityCriticalRequest(url, scopePath)) {")],
    ['SHNC-SW-06-SINK-NO-NOSTORE', raw.replace("return fetch(request, { cache: 'no-store' });", 'return fetch(request);')],
    ['SHNC-SW-07-SINK-CACHE-WRITE', raw.replace("async function networkOnlyNoStore(request) {\n  return fetch(request, { cache: 'no-store' });\n}", "async function networkOnlyNoStore(request) {\n  const cache = await caches.open(CACHE_NAME);\n  const response = await fetch(request, { cache: 'no-store' });\n  await cache.put(request, response.clone());\n  return response;\n}")],
    ['SHNC-SW-08-PRE-GUARD-EFFECT', raw.replace('  if (isSecurityCriticalRequest(url, scopePath)) {', '  networkFirst(request);\n  if (isSecurityCriticalRequest(url, scopePath)) {')],
    ['SHNC-SW-09-MULTIPLE-FETCH-HANDLERS', raw + "\nself['addEventListener']('fetch', event => { networkFirst(event.request); });\n"],
    ['SHNC-SW-10-PRE-GUARD-ASYNC', raw.replace('  if (isSecurityCriticalRequest(url, scopePath)) {', '  Promise.resolve().then(() => networkFirst(request));\n  if (isSecurityCriticalRequest(url, scopePath)) {')],
    ['SHNC-SW-11-CRITICAL-SIDE-EFFECT', raw.replace("  if (isSecurityCriticalRequest(url, scopePath)) {\n    event.respondWith(networkOnlyNoStore(request));", "  if (isSecurityCriticalRequest(url, scopePath)) {\n    networkFirst(request);\n    event.respondWith(networkOnlyNoStore(request));")],
    ['SHNC-SW-12-POST-GUARD-METADATA', raw.replace("  if (isSecurityCriticalRequest(url, scopePath)) {\n    event.respondWith(networkOnlyNoStore(request));", "  if (isSecurityCriticalRequest(url, scopePath)) {\n    void request.destination;\n    event.respondWith(networkOnlyNoStore(request));")],
    ['SHNC-SW-13-CRITICAL-DEFERRED-EFFECT', raw.replace("  if (isSecurityCriticalRequest(url, scopePath)) {\n    event.respondWith(networkOnlyNoStore(request));", "  if (isSecurityCriticalRequest(url, scopePath)) {\n    event.preloadResponse.then(() => networkFirst(request));\n    event.respondWith(networkOnlyNoStore(request));")],
  ];
  for (const [id, text] of mutations) {
    const file = path.join(tmp, `${id}.js`);
    fs.writeFileSync(file, text);
    const result = run(file);
    cases.push({ id, pass: result.status !== 0, exit: result.status, detectedCritical: /CRITICAL|HIGH|FAIL|RED|TAMPERED/i.test((result.stdout || '') + (result.stderr || '')) });
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
const ok = cases.every((item) => item.pass);
console[ok ? 'log' : 'error'](JSON.stringify({ status: ok ? 'PASS' : 'FAIL', cases }, null, 2));
process.exit(ok ? 0 : 1);

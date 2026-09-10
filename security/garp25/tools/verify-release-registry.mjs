#!/usr/bin/env node
// GARP 2.5.1 GHRAB - verify-release-registry
// RI-08 / SHNC-05: v GARP 2.5 nemel zadnou referencni implementaci. Overuje, ze
// nasazeny manifest odpovida SCHVALENEMU zaznamu v Release Registry, a odmita
// validne podepsany starsi release (anti-rollback) i neznamy release.
import { readFile } from 'node:fs/promises';

const [manifestPath, registryPath] = process.argv.slice(2);
if (!manifestPath || !registryPath) {
  console.error('Usage: node verify-release-registry.mjs <manifest> <release-registry.json>');
  process.exit(2);
}
const errors = [];
let manifest, registry;
try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); } catch { deny(['manifest-unreadable']); }
try { registry = JSON.parse(await readFile(registryPath, 'utf8')); } catch { deny(['registry-unreadable']); }
if (registry.schema !== 'ghrab-release-registry-v1') deny(['registry-schema']);

const entry = (registry.apps || []).find(a => a.appId === manifest.appId);
if (!entry) deny([`unknown-app:${manifest.appId}`]);
if ((registry.apps || []).filter(a => a.appId === manifest.appId).length > 1) errors.push('duplicate-appId');
if (entry.status !== 'approved') errors.push(`registry-status:${entry.status || 'missing'}`);

if (entry.artifactDigest !== manifest.artifactDigest) errors.push('artifactDigest-mismatch');
if (entry.keyId !== manifest?.signature?.keyId) errors.push('keyId-mismatch');
if (entry.approvedVersion !== manifest.version) errors.push(`version-mismatch:observed=${manifest.version},approved=${entry.approvedVersion}`);

// Anti-rollback: nasazovana verze nesmi byt nizsi nez nejvyssi kdy schvalena.
// history je nepovinne pole {version, approvedAt}; bez nej se pouzije approvedVersion.
const history = Array.isArray(entry.history) ? entry.history.map(h => h.version) : [];
const known = [entry.approvedVersion, ...history].filter(Boolean);
const highest = known.reduce((a, b) => (cmpVersion(a, b) >= 0 ? a : b), known[0]);
if (cmpVersion(manifest.version, highest) < 0) errors.push(`rollback-denied:${manifest.version}<${highest}`);

if (errors.length) deny(errors);
console.log(JSON.stringify({
  status: 'APPROVED', appId: manifest.appId, version: manifest.version,
  artifactDigest: manifest.artifactDigest, keyId: entry.keyId
}, null, 2));

function cmpVersion(a, b) {
  const pa = String(a).split(/[.\-+]/).map(x => (/^\d+$/.test(x) ? Number(x) : x));
  const pb = String(b).split(/[.\-+]/).map(x => (/^\d+$/.test(x) ? Number(x) : x));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x < y ? -1 : 1;
    return String(x) < String(y) ? -1 : 1;
  }
  return 0;
}
function deny(errs) {
  console.error(JSON.stringify({ status: 'DENIED', errors: errs }, null, 2));
  process.exit(1);
}

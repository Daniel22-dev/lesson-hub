#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const devPath = process.argv[2] || `security/sbom/${pkg.name}-${pkg.version}-development.cdx.json`;
const deployPath = process.argv[3] || `security/sbom/${pkg.name}-${pkg.version}-deployment.cdx.json`;
const errors = [];
const readBom = (p) => { if (!fs.existsSync(p)) { errors.push(`missing:${p}`); return {}; } return JSON.parse(fs.readFileSync(p, 'utf8')); };
const dev = readBom(devPath), deploy = readBom(deployPath);
for (const [label,bom] of [['development',dev],['deployment',deploy]]) {
  if (bom.bomFormat !== 'CycloneDX') errors.push(`${label}:bomFormat`);
  if (bom.specVersion !== '1.7') errors.push(`${label}:specVersion:${bom.specVersion}`);
  if (bom.metadata?.component?.name !== pkg.name || bom.metadata?.component?.version !== pkg.version) errors.push(`${label}:application-identity`);
  if (!Array.isArray(bom.dependencies) || !bom.dependencies.length) errors.push(`${label}:dependency-graph-missing`);
}
const expectedLock = new Map(Object.entries(lock.packages || {}).filter(([k,v]) => k.startsWith('node_modules/') && v?.version).map(([k,v]) => [k,String(v.version)]));
const observedLock = new Map();
for (const c of dev.components || []) {
  const lockPath = c.properties?.find((x) => x.name === 'ghrab:lockfilePath')?.value;
  if (!lockPath) { errors.push(`development:component-without-lockfilePath:${c.name}`); continue; }
  observedLock.set(lockPath,c);
  if (c.scope !== 'excluded') errors.push(`development:scope:${lockPath}:${c.scope}`);
  if (c.purl?.includes('%2F')) errors.push(`development:noncanonical-purl:${c.purl}`);
}
for (const [k,v] of expectedLock) { const c=observedLock.get(k); if(!c) errors.push(`development:missing:${k}`); else if(String(c.version)!==v) errors.push(`development:version:${k}`); }
for (const k of observedLock.keys()) if(!expectedLock.has(k)) errors.push(`development:unexpected:${k}`);

// Compare the SBOM to the actually installed tree, not merely to the lockfile.
const installed = new Map();
function visitNodeModules(dir, prefix = 'node_modules') {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir).sort()) {
    if (name.startsWith('.')) continue;
    const abs = path.join(dir, name);
    if (!fs.statSync(abs).isDirectory()) continue;
    if (name.startsWith('@')) {
      for (const leaf of fs.readdirSync(abs).sort()) visitPackage(path.join(abs, leaf), `${prefix}/${name}/${leaf}`);
    } else visitPackage(abs, `${prefix}/${name}`);
  }
}
function visitPackage(abs, lockPath) {
  const manifest = path.join(abs, 'package.json');
  if (!fs.existsSync(manifest)) { errors.push(`installed-missing-package-json:${lockPath}`); return; }
  const meta = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  installed.set(lockPath, String(meta.version || ''));
  const expected = expectedLock.get(lockPath);
  if (!expected) errors.push(`installed-extraneous:${lockPath}@${meta.version || 'unknown'}`);
  else if (expected !== String(meta.version || '')) errors.push(`installed-version-mismatch:${lockPath}:${meta.version}!=${expected}`);
  const c = observedLock.get(lockPath);
  if (!c || c.name !== meta.name || String(c.version) !== String(meta.version || '')) errors.push(`installed-not-matched-by-sbom:${lockPath}`);
  visitNodeModules(path.join(abs, 'node_modules'), `${lockPath}/node_modules`);
}
if (!fs.existsSync('node_modules')) errors.push('installed-tree:node_modules-missing');
else visitNodeModules('node_modules');
for (const [lockPath, meta] of Object.entries(lock.packages || {})) {
  if (!lockPath.startsWith('node_modules/')) continue;
  if (!installed.has(lockPath) && !meta.optional) errors.push(`installed-missing-required:${lockPath}`);
}

const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const deploymentExpected = new Map([
  ['ghrab:platform:1.1.2','dist-school-server/ghrab/ghrab-platform.js'],
  ['ghrab:error-reporter:1.1.2','dist-school-server/src/access/error-reporter.js'],
]);
for (const [ref,file] of deploymentExpected) {
  const c=(deploy.components || []).find((x)=>x['bom-ref']===ref);
  if(!c) { errors.push(`deployment:missing:${ref}`); continue; }
  const h=c.hashes?.find((x)=>x.alg==='SHA-256')?.content;
  if(!fs.existsSync(file) || h!==sha(file)) errors.push(`deployment:hash:${ref}`);
  if(c.scope!=='required') errors.push(`deployment:scope:${ref}:${c.scope}`);
}
for (const c of deploy.components || []) if(!deploymentExpected.has(c['bom-ref'])) errors.push(`deployment:unexpected:${c['bom-ref']}`);

const out={ status:errors.length?'FAIL':'PASS', developmentSbom:devPath, deploymentSbom:deployPath, lockPackages:expectedLock.size, installedPackages:[...installed.entries()].map(([k,v])=>`${k}@${v}`), deployedVendoredComponents:deploymentExpected.size, errors };
console[errors.length?'error':'log'](JSON.stringify(out,null,2));
process.exit(errors.length?1:0);

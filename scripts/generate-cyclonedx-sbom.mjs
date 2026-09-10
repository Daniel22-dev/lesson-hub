#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const devOut = process.argv[2] || `security/sbom/${pkg.name}-${pkg.version}-development.cdx.json`;
const deployOut = process.argv[3] || `security/sbom/${pkg.name}-${pkg.version}-deployment.cdx.json`;
const appRef = `pkg:npm/${pkg.name}@${pkg.version}`;

function timestamp() {
  const epoch = String(process.env.SOURCE_DATE_EPOCH || '').trim();
  return epoch ? new Date(Number(epoch) * 1000).toISOString() : new Date().toISOString();
}
function packageName(lockPath, meta) {
  if (meta?.name) return meta.name;
  const parts = String(lockPath).slice(String(lockPath).lastIndexOf('node_modules/') + 13).split('/').filter(Boolean);
  return parts[0]?.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
}
function purlName(name) {
  if (!name.startsWith('@')) return encodeURIComponent(name);
  const [scope, leaf] = name.split('/');
  return `%40${encodeURIComponent(scope.slice(1))}/${encodeURIComponent(leaf)}`;
}
function purl(name, version) { return `pkg:npm/${purlName(name)}@${encodeURIComponent(version)}`; }
function hashesFromSri(sri) {
  const first = String(sri || '').split(/\s+/)[0];
  const match = first.match(/^(sha(?:256|384|512))-(.+)$/i);
  if (!match) return [];
  return [{ alg: match[1].toUpperCase().replace('SHA', 'SHA-'), content: Buffer.from(match[2], 'base64').toString('hex') }];
}
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function serial(seed) {
  const h = crypto.createHash('sha256').update(seed).digest('hex').slice(0, 32).split('');
  h[12] = '4'; h[16] = ['8','9','a','b'][parseInt(h[16], 16) % 4];
  const x = h.join(''); return `urn:uuid:${x.slice(0,8)}-${x.slice(8,12)}-${x.slice(12,16)}-${x.slice(16,20)}-${x.slice(20)}`;
}
function resolveDependency(fromLockPath, name, packages) {
  let current = fromLockPath;
  while (true) {
    const candidate = current ? `${current}/node_modules/${name}` : `node_modules/${name}`;
    if (packages[candidate]) return candidate;
    if (!current) return null;
    const i = current.lastIndexOf('/node_modules/');
    current = i >= 0 ? current.slice(0, i) : '';
  }
}

const components = [];
const refByPath = new Map();
for (const [lockPath, meta] of Object.entries(lock.packages || {})) {
  if (!lockPath || !lockPath.startsWith('node_modules/') || !meta?.version) continue;
  const name = packageName(lockPath, meta);
  const bomRef = purl(name, String(meta.version));
  refByPath.set(lockPath, bomRef);
  components.push({
    'bom-ref': bomRef,
    type: 'library', name, version: String(meta.version), purl: bomRef, scope: 'excluded',
    hashes: hashesFromSri(meta.integrity),
    properties: [{ name: 'ghrab:lockfilePath', value: lockPath }, { name: 'ghrab:deploymentScope', value: 'development-only' }],
  });
}
components.sort((a,b) => Buffer.compare(Buffer.from(a['bom-ref']), Buffer.from(b['bom-ref'])));
const dependencies = [{ ref: appRef, dependsOn: Object.keys({ ...(lock.packages?.['']?.dependencies || {}), ...(lock.packages?.['']?.devDependencies || {}) }).map((name) => refByPath.get(resolveDependency('', name, lock.packages || {}))).filter(Boolean).sort() }];
for (const [lockPath, meta] of Object.entries(lock.packages || {})) {
  if (!refByPath.has(lockPath)) continue;
  const names = Object.keys({ ...(meta.dependencies || {}), ...(meta.optionalDependencies || {}), ...(meta.peerDependencies || {}) });
  dependencies.push({ ref: refByPath.get(lockPath), dependsOn: names.map((name) => refByPath.get(resolveDependency(lockPath, name, lock.packages || {}))).filter(Boolean).sort() });
}
const devBom = {
  bomFormat: 'CycloneDX', specVersion: '1.7', serialNumber: serial(JSON.stringify(components)), version: 1,
  metadata: { timestamp: timestamp(), component: { 'bom-ref': appRef, type: 'application', name: pkg.name, version: pkg.version, purl: appRef }, properties: [
    { name: 'ghrab:scope', value: 'development-dependency-tree' },
    { name: 'ghrab:note', value: 'All npm packages are development-only and excluded from the static frontend deployment.' },
  ] },
  components, dependencies,
};

const deploymentComponents = [
  { id: 'ghrab-platform', name: 'GHRAB Platform', version: '1.1.2', file: 'dist-school-server/ghrab/ghrab-platform.js', ref: 'ghrab:platform:1.1.2' },
  { id: 'ghrab-error-reporter', name: 'GHRAB Error Reporter', version: '1.1.2', file: 'dist-school-server/src/access/error-reporter.js', ref: 'ghrab:error-reporter:1.1.2' },
].map((item) => {
  if (!fs.existsSync(path.join(root, item.file))) throw new Error(`Deployment SBOM input missing: ${item.file}`);
  return { 'bom-ref': item.ref, type: 'library', name: item.name, version: item.version, scope: 'required', hashes: [{ alg: 'SHA-256', content: sha256File(path.join(root, item.file)) }], properties: [{ name: 'ghrab:deploymentPath', value: item.file.replace(/^dist-school-server\//, '') }, { name: 'ghrab:vendored', value: 'true' }] };
});
const deployBom = {
  bomFormat: 'CycloneDX', specVersion: '1.7', serialNumber: serial(JSON.stringify(deploymentComponents)), version: 1,
  metadata: { timestamp: timestamp(), component: { 'bom-ref': appRef, type: 'application', name: pkg.name, version: pkg.version, purl: appRef }, properties: [
    { name: 'ghrab:scope', value: 'dist-school-server deployment' },
    { name: 'ghrab:note', value: 'Static school-server frontend deployment; npm devDependencies are not deployed.' },
  ] },
  components: deploymentComponents,
  dependencies: [{ ref: appRef, dependsOn: deploymentComponents.map((item) => item['bom-ref']).sort() }, ...deploymentComponents.map((item) => ({ ref: item['bom-ref'], dependsOn: [] }))],
};
for (const [out, bom] of [[devOut, devBom], [deployOut, deployBom]]) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(bom, null, 2) + '\n'); }
console.log(JSON.stringify({ status: 'PASS', development: { output: devOut, components: components.length, dependencies: dependencies.length }, deployment: { output: deployOut, components: deploymentComponents.length, dependencies: deployBom.dependencies.length } }, null, 2));

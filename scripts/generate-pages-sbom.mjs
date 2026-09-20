#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = process.cwd();
const dist = path.resolve(process.argv[2] || 'dist-pages');
const out = path.resolve(process.argv[3] || path.join(dist, 'sbom.cdx.json'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (!fs.existsSync(dist)) throw new Error(`Pages SBOM: missing ${dist}`);
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const required = [
  { ref: 'ghrab:platform:1.1.2', name: 'GHRAB Platform', version: '1.1.2', rel: 'ghrab/ghrab-platform.js' },
  { ref: 'ghrab:error-reporter:1.1.2', name: 'GHRAB Error Reporter', version: '1.1.2', rel: 'src/access/error-reporter.js' },
];
const components = required.map((item) => {
  const file = path.join(dist, item.rel);
  if (!fs.existsSync(file)) throw new Error(`Pages SBOM input missing: ${item.rel}`);
  return {
    'bom-ref': item.ref,
    type: 'library',
    name: item.name,
    version: item.version,
    scope: 'required',
    hashes: [{ alg: 'SHA-256', content: sha256(file) }],
    properties: [{ name: 'ghrab:deploymentPath', value: item.rel }, { name: 'ghrab:vendored', value: 'true' }],
  };
});
const appRef = `pkg:npm/${pkg.name}@${pkg.version}`;
const bom = {
  '$schema': 'https://cyclonedx.org/schema/bom-1.7.schema.json',
  bomFormat: 'CycloneDX',
  specVersion: '1.7',
  version: 1,
  metadata: {
    component: { 'bom-ref': appRef, type: 'application', name: pkg.name, version: pkg.version, purl: appRef },
    properties: [
      { name: 'ghrab:scope', value: 'github-pages deployment' },
      { name: 'ghrab:note', value: 'Static Pages deployment; npm development dependencies are not deployed.' },
    ],
  },
  components,
  dependencies: [{ ref: appRef, dependsOn: components.map((x) => x['bom-ref']).sort() }, ...components.map((x) => ({ ref: x['bom-ref'], dependsOn: [] }))],
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(bom, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ status: 'PASS', output: out, appId: 'lesson-hub', version: pkg.version, components: components.length }, null, 2));

#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const dist = path.join(root, 'dist-pages');
const evidenceDir = path.join(root, 'qa-results', 'release-current');
const tools = path.join(root, 'security', 'garp25', 'tools');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const appId = 'lesson-hub';
const checks = [];
const add = (id, ok, detail = '') => checks.push({ id, ok: Boolean(ok), detail: String(detail).slice(0, 500) });
const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const isSha256 = (v) => /^[a-f0-9]{64}$/i.test(String(v || ''));
const isCommit = (v) => /^[a-f0-9]{40}$/i.test(String(v || ''));
const files = {
  integrity: path.join(dist, 'release-integrity.json'),
  manifest: path.join(dist, 'studio-manifest.json'),
  sbom: path.join(dist, 'sbom.cdx.json'),
  provenance: path.join(dist, 'build-provenance.json'),
  evidence: path.join(dist, 'security-evidence-manifest.json'),
};
for (const [n, f] of Object.entries(files)) add(`file.${n}`, fs.existsSync(f), f);
if (checks.some((c) => !c.ok)) finish();
const integrity = JSON.parse(fs.readFileSync(files.integrity, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(files.manifest, 'utf8'));
add('identity.appId', integrity.appId === appId, integrity.appId);
add('identity.version', integrity.version === pkg.version, `${integrity.version}/${pkg.version}`);
add('identity.sourceCommit', isCommit(integrity.sourceCommit), integrity.sourceCommit);
add('identity.artifactDigest', isSha256(integrity.artifactDigest), integrity.artifactDigest);
add('identity.assuranceMode', integrity.assuranceMode === 'TRANSITIONAL', integrity.assuranceMode);
add('identity.releaseStage', ['PREP-VALIDATION', 'LIVE-PUBLIC-PAGES'].includes(integrity.releaseStage), integrity.releaseStage);
add('identity.signature-not-overclaimed', ['NOT_PRESENT', 'VERIFIED'].includes(integrity.signature?.status), integrity.signature?.status);
add('contract.pointer', manifest.releaseIdentity?.contract === 'ghrab-release-integrity-v2' && manifest.releaseIdentity?.url === './release-integrity.json', JSON.stringify(manifest.releaseIdentity || {}));
add('contract.app-version', manifest.id === appId && manifest.version === pkg.version, `${manifest.id}/${manifest.version}`);
add('contract.repository', String(manifest.repository || '').toLowerCase() === 'daniel22-dev/lesson-hub', manifest.repository);
for (const [field, file] of [['manifestSha256', files.manifest], ['sbomSha256', files.sbom], ['buildProvenanceSha256', files.provenance], ['evidenceManifestSha256', files.evidence]]) add(`link.${field}`, String(integrity[field] || '').toLowerCase() === sha256(file), `${integrity[field]} vs ${sha256(file)}`);
try {
  const p = JSON.parse(fs.readFileSync(files.provenance, 'utf8'));
  add('provenance.subject', String(p.subject?.sha256 || '').toLowerCase() === integrity.manifestSha256, p.subject?.sha256);
  add('provenance.source', p.source?.revision === integrity.sourceCommit, `${p.source?.revision}/${integrity.sourceCommit}`);
  add('provenance.repository', String(p.source?.repository || '').toLowerCase() === 'daniel22-dev/lesson-hub', p.source?.repository);
  add('provenance.no-false-slsa', p.assurance?.claimedSlsaLevel == null, p.assurance?.claimedSlsaLevel);
} catch (e) { add('provenance.readable', false, e.message); }
try {
  const e = JSON.parse(fs.readFileSync(files.evidence, 'utf8'));
  add('evidence.schema', e.schema === 'ghrab-security-evidence-manifest-v1', e.schema);
  add('evidence.release', e.appId === appId && e.version === pkg.version && e.sourceRevision === integrity.sourceCommit, `${e.appId}/${e.version}/${e.sourceRevision}`);
} catch (e) { add('evidence.readable', false, e.message); }
try {
  const s = JSON.parse(fs.readFileSync(files.sbom, 'utf8'));
  add('sbom.format', s.bomFormat === 'CycloneDX', s.bomFormat);
  add('sbom.version', s.metadata?.component?.version === pkg.version, s.metadata?.component?.version);
} catch (e) { add('sbom.readable', false, e.message); }
function runTool(id, script, args) {
  const r = spawnSync(process.execPath, [path.join(tools, script), ...args], { cwd: root, encoding: 'utf8' });
  add(id, r.status === 0, `exit=${r.status}; ${r.stdout || ''}${r.stderr || ''}`);
}
runTool('verify.release-integrity', 'verify-release-integrity.mjs', [dist, files.integrity]);
if (fs.existsSync(evidenceDir)) runTool('verify.evidence-manifest', 'verify-evidence-manifest.mjs', [evidenceDir, files.evidence]);
else add('verify.evidence-manifest', false, 'qa-results/release-current missing');
runTool('verify.deployment-leaks', 'scan-deployment-leaks.mjs', [dist]);
finish();
function finish() {
  const failed = checks.filter((c) => !c.ok);
  const report = { schema: 'ghrab-release-chain-verification-v1', appId, version: pkg.version, status: failed.length ? 'failed' : 'passed', summary: { total: checks.length, passed: checks.length - failed.length, failed: failed.length }, failed: failed.map((c) => c.id), checks };
  console[failed.length ? 'error' : 'log'](JSON.stringify(report, null, 2));
  process.exit(failed.length ? 1 : 0);
}

#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const identityPath = path.resolve(process.argv[2] || path.join(root, 'dist-pages', 'release-integrity.json'));
const deploymentDir = path.dirname(identityPath);
const sha256File = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const fail = (m) => { throw new Error(`LIVE release identity: ${m}`); };
if (!fs.existsSync(identityPath)) fail(`missing ${identityPath}`);
const ri = readJson(identityPath);
const expectedRepo = process.env.GHRAB_SOURCE_REPOSITORY;
const expectedCommit = String(process.env.GHRAB_SOURCE_COMMIT || '').toLowerCase();
if (!expectedRepo || !expectedCommit) fail('missing GHRAB_SOURCE_REPOSITORY or GHRAB_SOURCE_COMMIT');
if (ri.schema !== 'ghrab-release-integrity-v2') fail(`schema ${ri.schema}`);
if (ri.digestAlgorithmId !== 'ghrab-artifact-digest-v2' || ri.hashAlgorithm !== 'SHA-256') fail('digest/hash contract');
if (ri.appId !== 'lesson-hub' || ri.version !== pkg.version) fail(`app/version ${ri.appId}/${ri.version}`);
if (String(ri.sourceCommit || '').toLowerCase() !== expectedCommit) fail(`commit ${ri.sourceCommit} != ${expectedCommit}`);
if (ri.assuranceMode !== 'TRANSITIONAL') fail(`assuranceMode ${ri.assuranceMode}`);
for (const field of ['artifactDigest','manifestSha256','buildProvenanceSha256','sbomSha256','evidenceManifestSha256']) {
  if (!/^[a-f0-9]{64}$/i.test(String(ri[field] || ''))) fail(`invalid ${field}`);
}
if (!Number.isInteger(ri.fileCount) || ri.fileCount < 1) fail('invalid fileCount');
const files = {
  manifest: path.join(deploymentDir, 'studio-manifest.json'),
  provenance: path.join(deploymentDir, 'build-provenance.json'),
  sbom: path.join(deploymentDir, 'sbom.cdx.json'),
  evidence: path.join(deploymentDir, 'security-evidence-manifest.json'),
};
for (const f of Object.values(files)) if (!fs.existsSync(f)) fail(`missing ${path.basename(f)}`);
const manifest = readJson(files.manifest);
if (manifest.releaseIdentity?.contract !== 'ghrab-release-integrity-v2' || manifest.releaseIdentity?.url !== './release-integrity.json') fail('studio manifest release identity pointer mismatch');
if (String(manifest.releaseIdentity?.source?.repository || '').toLowerCase() !== String(expectedRepo).toLowerCase() || String(manifest.releaseIdentity?.source?.commit || '').toLowerCase() !== expectedCommit) fail('studio manifest source mismatch');
if (manifest.releaseIdentity?.appId !== 'lesson-hub' || manifest.releaseIdentity?.version !== pkg.version) fail('studio manifest release identity mismatch');
const provenance = readJson(files.provenance);
if (String(provenance.source?.repository || '').toLowerCase() !== String(expectedRepo).toLowerCase() || String(provenance.source?.revision || '').toLowerCase() !== expectedCommit) fail('provenance source mismatch');
for (const [field, file] of [['manifestSha256', files.manifest], ['buildProvenanceSha256', files.provenance], ['sbomSha256', files.sbom], ['evidenceManifestSha256', files.evidence]]) {
  if (String(ri[field]).toLowerCase() !== sha256File(file)) fail(`${field} mismatch`);
}
const evidence = readJson(files.evidence);
if (evidence.schema !== 'ghrab-security-evidence-manifest-v1') fail(`evidence schema ${evidence.schema}`);
if (evidence.appId !== 'lesson-hub' || evidence.version !== pkg.version || String(evidence.sourceRevision || '').toLowerCase() !== expectedCommit) fail('security evidence release mismatch');
const indexed = new Map((ri.files || []).map((entry) => [entry.path, entry]));
for (const rel of ['studio-manifest.json','build-provenance.json','sbom.cdx.json','security-evidence-manifest.json']) {
  const entry = indexed.get(rel);
  if (!entry) fail(`release-integrity missing ${rel}`);
  if (entry.sha256 !== sha256File(path.join(deploymentDir, rel))) fail(`hash mismatch ${rel}`);
}
console.log(JSON.stringify({ status: 'PASS', appId: ri.appId, version: ri.version, repository: expectedRepo, sourceCommit: ri.sourceCommit, artifactDigest: ri.artifactDigest, manifestSha256: ri.manifestSha256, sbomSha256: ri.sbomSha256, evidenceManifestSha256: ri.evidenceManifestSha256, buildProvenanceSha256: ri.buildProvenanceSha256, assuranceMode: ri.assuranceMode, fileCount: ri.fileCount }, null, 2));

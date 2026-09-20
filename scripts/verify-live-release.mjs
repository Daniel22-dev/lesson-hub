#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const env = (n, f = '') => String(process.env[n] ?? f).trim();
const sha256 = (t) => crypto.createHash('sha256').update(Buffer.from(t, 'utf8')).digest('hex');
const rawUrl = env('GHRAB_LIVE_URL');
const expected = {
  appId: env('GHRAB_LIVE_APP_ID'),
  version: env('GHRAB_LIVE_VERSION'),
  sourceCommit: env('GHRAB_LIVE_SOURCE_SHA').toLowerCase(),
  artifactDigest: env('GHRAB_LIVE_ARTIFACT_DIGEST').toLowerCase(),
  manifestSha256: env('GHRAB_LIVE_MANIFEST_SHA256').toLowerCase(),
};
const allowedOrigin = env('GHRAB_LIVE_ALLOWED_ORIGIN', 'https://daniel22-dev.github.io');
const attempts = Math.min(Math.max(Number(env('GHRAB_LIVE_ATTEMPTS', '8')) || 8, 1), 20);
const baseDelayMs = Math.min(Math.max(Number(env('GHRAB_LIVE_DELAY_MS', '5000')) || 5000, 0), 60000);
const maxDelayMs = Math.min(Math.max(Number(env('GHRAB_LIVE_MAX_DELAY_MS', '30000')) || 30000, baseDelayMs), 120000);
const requestTimeoutMs = Math.min(Math.max(Number(env('GHRAB_LIVE_TIMEOUT_MS', '15000')) || 15000, 1000), 60000);
const outPath = env('GHRAB_LIVE_OUT');
const fail = (reason, detail = {}) => { console.error(JSON.stringify({ schema: 'ghrab-live-release-verification-v1', status: 'FAIL', reason, ...detail }, null, 2)); process.exit(1); };
const missing = Object.entries(expected).filter(([, v]) => !v).map(([k]) => k);
if (!rawUrl) missing.push('url');
if (missing.length) fail('required-input-missing', { missing });
if (!/^[0-9a-f]{40}$/.test(expected.sourceCommit)) fail('invalid-source-commit');
for (const k of ['artifactDigest', 'manifestSha256']) if (!/^[0-9a-f]{64}$/.test(expected[k])) fail(`invalid-${k}`);
let base;
try { base = new URL(rawUrl.endsWith('/') ? rawUrl : `${rawUrl}/`); } catch { fail('unparsable-url'); }
if (base.protocol !== 'https:') fail('insecure-url', { origin: base.origin });
if (base.origin !== allowedOrigin) fail('unexpected-origin', { origin: base.origin, allowedOrigin });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchText(url) {
  const response = await fetch(url, { redirect: 'error', cache: 'no-store', headers: { 'cache-control': 'no-cache', accept: 'application/json' }, signal: AbortSignal.timeout(requestTimeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}
function evaluate(it, mt) {
  const problems = [];
  let integrity, manifest;
  try { integrity = JSON.parse(it); } catch { return { problems: ['release-integrity-unparsable'] }; }
  try { manifest = JSON.parse(mt); } catch { return { problems: ['studio-manifest-unparsable'] }; }
  const liveManifestSha256 = sha256(mt);
  if (integrity.appId !== expected.appId) problems.push(`appId:${integrity.appId}`);
  if (integrity.version !== expected.version) problems.push(`version:${integrity.version}`);
  if (String(integrity.sourceCommit || '').toLowerCase() !== expected.sourceCommit) problems.push(`sourceCommit:${integrity.sourceCommit}`);
  if (String(integrity.artifactDigest || '').toLowerCase() !== expected.artifactDigest) problems.push(`artifactDigest:${integrity.artifactDigest}`);
  if (String(integrity.manifestSha256 || '').toLowerCase() !== expected.manifestSha256) problems.push(`integrity.manifestSha256:${integrity.manifestSha256}`);
  if (liveManifestSha256 !== expected.manifestSha256) problems.push(`liveManifestSha256:${liveManifestSha256}`);
  if (manifest.id !== expected.appId || manifest.version !== expected.version) problems.push(`manifest:${manifest.id}/${manifest.version}`);
  if (manifest.releaseIdentity?.contract !== 'ghrab-release-integrity-v2') problems.push('manifest.releaseIdentity.contract');
  return { problems, integrity };
}
const integrityUrl = new URL('release-integrity.json', base).toString();
const manifestUrl = new URL('studio-manifest.json', base).toString();
const history = [];
for (let attempt = 1; attempt <= attempts; attempt += 1) {
  let outcome;
  try {
    const [it, mt] = await Promise.all([fetchText(integrityUrl), fetchText(manifestUrl)]);
    outcome = evaluate(it, mt);
  } catch (error) { outcome = { problems: [`fetch:${error.message}`] }; }
  if (!outcome.problems.length) {
    const v = {
      schema: 'ghrab-live-release-verification-v1', status: 'PASS', attempt, attempts,
      appId: expected.appId, version: expected.version, sourceCommit: expected.sourceCommit,
      artifactDigest: expected.artifactDigest, manifestSha256: expected.manifestSha256,
      sbomSha256: String(outcome.integrity.sbomSha256 || '').toLowerCase() || null,
      evidenceManifestSha256: String(outcome.integrity.evidenceManifestSha256 || '').toLowerCase() || null,
      buildProvenanceSha256: String(outcome.integrity.buildProvenanceSha256 || '').toLowerCase() || null,
      assuranceMode: outcome.integrity.assuranceMode || null, releaseStage: outcome.integrity.releaseStage || null,
      garpProfile: outcome.integrity.garpProfile || null, gate: outcome.integrity.gate || null,
      releaseIntegrityUrl: integrityUrl, deployedUrl: base.toString(), verifiedAt: new Date().toISOString(),
    };
    if (outPath) { fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true }); fs.writeFileSync(path.resolve(outPath), `${JSON.stringify(v, null, 2)}\n`, 'utf8'); }
    console.log(JSON.stringify(v, null, 2));
    process.exit(0);
  }
  history.push({ attempt, problems: outcome.problems });
  if (attempt < attempts) await sleep(Math.min(baseDelayMs * attempt, maxDelayMs));
}
fail('live-release-not-confirmed', { attempts, deployedUrl: base.toString(), history });

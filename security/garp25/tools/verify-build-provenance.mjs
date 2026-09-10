#!/usr/bin/env node
// GARP 2.5.1 GHRAB - verify-build-provenance
// Zmena proti 2.5: verifier uz neprojde provenance bez zdrojove revize a s vychozim
// builderem 'local-untrusted-builder'. SH-SC-06 vyzaduje shodu source + builder +
// artifact digest s ocekavanim, ne jen digest.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
const [artifact, provPath] = args.filter(a => !a.startsWith('--'));
if (!artifact || !provPath) {
  console.error('Usage: node verify-build-provenance.mjs <artifact-file> <provenance.json> [--allow-local-builder]');
  console.error('  --allow-local-builder: povoleno jen pro PREP/staging, nikdy pro skolni release.');
  process.exit(2);
}
const errors = [];
const warnings = [];
let p; try { p = JSON.parse(await readFile(provPath, 'utf8')); } catch { fail(['provenance-unreadable']); }
const sha = createHash('sha256').update(await readFile(artifact)).digest('hex');

if (p?.schema !== 'ghrab-build-provenance-v1') errors.push('schema');
if (p?.subject?.sha256 !== sha) errors.push('subject.sha256');
if (!p?.source?.revision && !p?.source?.sourcePackageSha256) errors.push('source-identity-missing');
if (p?.source?.baseCommit && !/^[0-9a-f]{40}$/i.test(p.source.baseCommit)) errors.push('source.baseCommit');
if (!p?.builder?.id) errors.push('builder.id');
else if (p.builder.id === 'local-untrusted-builder') {
  if (flags.has('--allow-local-builder')) warnings.push('builder=local-untrusted-builder (PREP only, nikdy skolni release)');
  else errors.push('builder-untrusted:local-untrusted-builder');
}
if (!p?.invocation?.finishedAt) errors.push('invocation.finishedAt');
if (p?.assurance?.claimedSlsaLevel) errors.push('claimedSlsaLevel-self-asserted');
if (process.env.GHRAB_EXPECT_SOURCE_COMMIT && p?.source?.revision !== process.env.GHRAB_EXPECT_SOURCE_COMMIT)
  errors.push('source.revision != GHRAB_EXPECT_SOURCE_COMMIT');
if (process.env.GHRAB_EXPECT_BASE_COMMIT && p?.source?.baseCommit !== process.env.GHRAB_EXPECT_BASE_COMMIT)
  errors.push('source.baseCommit != GHRAB_EXPECT_BASE_COMMIT');
if (process.env.GHRAB_EXPECT_BUILDER_ID && p?.builder?.id !== process.env.GHRAB_EXPECT_BUILDER_ID)
  errors.push('builder.id != GHRAB_EXPECT_BUILDER_ID');
if (process.env.GHRAB_EXPECT_ARTIFACT_DIGEST && p?.releaseIntegrity?.artifactDigest !== process.env.GHRAB_EXPECT_ARTIFACT_DIGEST)
  errors.push('releaseIntegrity.artifactDigest != GHRAB_EXPECT_ARTIFACT_DIGEST');

if (errors.length) fail(errors);
console.log(JSON.stringify({ status: 'PASS', subjectSha256: sha, builderId: p.builder.id, sourceRevision: p.source.revision ?? null, sourceBaseCommit: p.source.baseCommit ?? null, warnings }, null, 2));

function fail(errs) { console.error(JSON.stringify({ status: 'FAIL', errors: errs }, null, 2)); process.exit(1); }

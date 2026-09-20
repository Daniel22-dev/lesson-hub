#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildDispatchPayload, MAX_TOP_LEVEL_PROPERTIES } from './build-ai-studio-dispatch.mjs';
const env = {
  APP_VERSION: '1.2.24',
  SOURCE_REPOSITORY: 'Daniel22-dev/lesson-hub',
  SOURCE_SHA: 'a'.repeat(40),
  DEPLOYED_URL: 'https://daniel22-dev.github.io/lesson-hub/',
  ARTIFACT_DIGEST: 'b'.repeat(64),
  MANIFEST_SHA256: 'c'.repeat(64),
  SBOM_SHA256: 'd'.repeat(64),
  EVIDENCE_MANIFEST_SHA256: 'e'.repeat(64),
  BUILD_PROVENANCE_SHA256: 'f'.repeat(64),
  ASSURANCE_MODE: 'TRANSITIONAL',
  RELEASE_STAGE: 'LIVE-PUBLIC-PAGES',
  GARP_PROFILE: 'GARP-2.5.1-SHIELD-PREP',
  RELEASE_GATE: 'P5-R2',
};
const live = { status: 'PASS', version: env.APP_VERSION, artifactDigest: env.ARTIFACT_DIGEST, releaseIntegrityUrl: 'https://daniel22-dev.github.io/lesson-hub/release-integrity.json', verifiedAt: '2026-09-20T10:00:00Z' };
const p = buildDispatchPayload({ env, live });
assert.equal(p.event_type, 'app-updated');
assert.equal(p.client_payload.app_id, 'lesson-hub');
assert.equal(p.client_payload.canonical_app_id, 'lesson-hub');
assert.ok(Object.keys(p.client_payload).length <= MAX_TOP_LEVEL_PROPERTIES);
assert.equal(p.client_payload.release.manifest_sha256, env.MANIFEST_SHA256);
assert.throws(() => buildDispatchPayload({ env: { ...env, RELEASE_STAGE: 'PREP-VALIDATION' }, live }), /non-live/);
assert.throws(() => buildDispatchPayload({ env, live: { ...live, status: 'FAIL' } }), /not verified/);
console.log(`AI Studio dispatch contract: PASS (${Object.keys(p.client_payload).length}/${MAX_TOP_LEVEL_PROPERTIES} top-level properties).`);

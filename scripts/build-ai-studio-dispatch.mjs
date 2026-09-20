#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

export const MAX_TOP_LEVEL_PROPERTIES = 10;
export function buildDispatchPayload({ env = {}, live = {} } = {}) {
  const required = {
    APP_VERSION: env.APP_VERSION,
    SOURCE_REPOSITORY: env.SOURCE_REPOSITORY,
    SOURCE_SHA: env.SOURCE_SHA,
    DEPLOYED_URL: env.DEPLOYED_URL,
    ARTIFACT_DIGEST: env.ARTIFACT_DIGEST,
    MANIFEST_SHA256: env.MANIFEST_SHA256,
    SBOM_SHA256: env.SBOM_SHA256,
    EVIDENCE_MANIFEST_SHA256: env.EVIDENCE_MANIFEST_SHA256,
    BUILD_PROVENANCE_SHA256: env.BUILD_PROVENANCE_SHA256,
    ASSURANCE_MODE: env.ASSURANCE_MODE,
    RELEASE_STAGE: env.RELEASE_STAGE,
    GARP_PROFILE: env.GARP_PROFILE,
    RELEASE_GATE: env.RELEASE_GATE,
  };
  const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`Dispatch payload is incomplete: ${missing.join(', ')}`);
  if (live.status !== 'PASS') throw new Error('Live release was not verified; refusing dispatch.');
  if (required.RELEASE_STAGE !== 'LIVE-PUBLIC-PAGES') throw new Error(`Refusing non-live release (releaseStage=${required.RELEASE_STAGE}).`);
  if (live.version !== required.APP_VERSION || live.artifactDigest !== required.ARTIFACT_DIGEST) throw new Error('Verified live release does not match exported release identity.');
  const payload = {
    event_type: 'app-updated',
    client_payload: {
      app_id: 'lesson-hub',
      canonical_app_id: 'lesson-hub',
      version: required.APP_VERSION,
      source_repository: required.SOURCE_REPOSITORY,
      source_sha: required.SOURCE_SHA,
      deployed_url: required.DEPLOYED_URL,
      release_integrity_url: live.releaseIntegrityUrl,
      artifact_digest: required.ARTIFACT_DIGEST,
      release: {
        manifest_sha256: required.MANIFEST_SHA256,
        sbom_sha256: required.SBOM_SHA256,
        evidence_manifest_sha256: required.EVIDENCE_MANIFEST_SHA256,
        build_provenance_sha256: required.BUILD_PROVENANCE_SHA256,
        assurance_mode: required.ASSURANCE_MODE,
        release_stage: required.RELEASE_STAGE,
        garp_profile: required.GARP_PROFILE,
        release_gate: required.RELEASE_GATE,
        live_verified_at: live.verifiedAt || null,
        run_id: env.GITHUB_RUN_ID || null,
        run_attempt: env.GITHUB_RUN_ATTEMPT || null,
      },
    },
  };
  const count = Object.keys(payload.client_payload).length;
  if (count > MAX_TOP_LEVEL_PROPERTIES) throw new Error(`client_payload has ${count} top-level properties; GitHub allows at most ${MAX_TOP_LEVEL_PROPERTIES}.`);
  return payload;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [liveFile, outFile] = process.argv.slice(2);
  if (!liveFile || !outFile) { console.error('Usage: node scripts/build-ai-studio-dispatch.mjs <live-release.json> <out.json>'); process.exit(2); }
  try {
    const live = JSON.parse(fs.readFileSync(liveFile, 'utf8'));
    const payload = buildDispatchPayload({ env: process.env, live });
    fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
    fs.writeFileSync(path.resolve(outFile), JSON.stringify(payload), 'utf8');
    console.log(`Dispatch payload built: ${Object.keys(payload.client_payload).length}/${MAX_TOP_LEVEL_PROPERTIES} top-level properties.`);
  } catch (error) { console.error(`::error::${error.message}`); process.exit(1); }
}

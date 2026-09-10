#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [artifactArg, outArg='build-provenance.json'] = process.argv.slice(2);
if (!artifactArg) {
  console.error('Usage: node create-build-provenance.mjs <artifact-file> [output]');
  process.exit(2);
}
const artifact=path.resolve(artifactArg);
const data=await readFile(artifact);
const sha256=createHash('sha256').update(data).digest('hex');
let lockfileSha256=null;
if (process.env.GHRAB_LOCKFILE) {
  const lock=await readFile(process.env.GHRAB_LOCKFILE);
  lockfileSha256=createHash('sha256').update(lock).digest('hex');
}
const now=new Date().toISOString();
const provenance={
  schema:'ghrab-build-provenance-v1',
  subject:{name:path.basename(artifact),sha256},
  source:{
    repository:process.env.GHRAB_SOURCE_REPOSITORY||null,
    revision:process.env.GHRAB_SOURCE_COMMIT||null,
    baseCommit:process.env.GHRAB_SOURCE_BASE_COMMIT||null,
    sourcePackageSha256:process.env.GHRAB_SOURCE_PACKAGE_SHA256||null
  },
  builder:{
    id:process.env.GHRAB_BUILDER_ID||'local-untrusted-builder',
    workflow:process.env.GHRAB_WORKFLOW_REF||null,
    entrypoint:process.env.GHRAB_BUILD_ENTRYPOINT||null
  },
  invocation:{
    startedAt:process.env.GHRAB_BUILD_STARTED_AT||null,
    finishedAt:process.env.GHRAB_BUILD_FINISHED_AT||now,
    lockfileSha256,
    parameters:{profile:process.env.GHRAB_BUILD_PROFILE||null}
  },
  releaseIntegrity:{artifactDigest:process.env.GHRAB_ARTIFACT_DIGEST||null},
  assurance:{
    slsaReference:'v1.2',
    claimedSlsaLevel:null,
    note:'Custom GARP provenance is not by itself a SLSA level attestation.'
  }
};
await writeFile(outArg,JSON.stringify(provenance,null,2)+'\n','utf8');
console.log(JSON.stringify({status:'PASS',output:outArg,subjectSha256:sha256},null,2));

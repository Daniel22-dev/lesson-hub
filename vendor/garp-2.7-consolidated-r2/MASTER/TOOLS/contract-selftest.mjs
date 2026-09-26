#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const tools=path.join(root,'TOOLS');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'garp27-contract-'));
const w=(name,obj)=>{const f=path.join(tmp,name);fs.writeFileSync(f,JSON.stringify(obj,null,2));return f;};
const sha='a'.repeat(64), sha2='b'.repeat(64), sha3='d'.repeat(64), commit='c'.repeat(40);

const profile={schema:'garp27-application-migration-profile-v1',garpVersion:'2.7',appId:'demo',appVersion:'1.0.0',serverApproval:'DEFERRED_BY_OWNER_DECISION',maxEvidenceAgeHours:168,releaseIdentity:{appId:'demo',appVersion:'1.0.0',sourceCommit:commit},requiredComponents:[{componentId:'AG-01-policy',required:true,serverDependent:false},{componentId:'AG-10-live-health',required:true,serverDependent:true}],trustedEvidence:{policy:sha,live:sha2}};
const assuranceGood={schema:'garp27-assurance-status-v1',garpVersion:'2.7',environment:'local-ci',releaseIdentity:profile.releaseIdentity,overall:'DERIVE',components:[{componentId:'AG-01-policy',presence:'PRESENT',health:'HEALTHY',effectiveness:'PASS',evidenceFreshness:'FRESH',observedAt:new Date().toISOString(),evidenceRefs:[{id:'policy',sha256:sha}]}]};
const assuranceBad=structuredClone(assuranceGood); assuranceBad.overall='PASS'; assuranceBad.components[0].effectiveness='FAIL'; assuranceBad.components[0].evidenceRefs=[];
const assuranceNoEvidence=structuredClone(assuranceGood); assuranceNoEvidence.components[0].evidenceRefs=[];
const assuranceDuplicate=structuredClone(assuranceGood); assuranceDuplicate.components.push(structuredClone(assuranceDuplicate.components[0]));
const assuranceMissingEnv=structuredClone(assuranceGood); delete assuranceMissingEnv.environment;
const assuranceForged=structuredClone(assuranceGood); assuranceForged.components[0].evidenceRefs=[{id:'policy',sha256:sha3}];
const trust={schema:'garp27-auto-patch-trust-v1',garpVersion:'2.7',target:{appId:'demo',version:'1.0.0',commitSha:commit,artifactSha256:sha,policySha256:sha2},source:{repository:'owner/demo',allowlisted:true},requiredGates:[{id:'foundation',allowNA:false},{id:'architecture',allowNA:false}],trustedEvidence:{gate1:sha,gate2:sha2},replay:{minimumSequence:3,previousReleaseId:'rel-previous'}};
const apGood={schema:'garp27-auto-patch-manifest-v1',garpVersion:'2.7',state:'COMMITTED',releaseId:'rel-4',sequence:3,previousReleaseId:'rel-previous',target:trust.target,source:trust.source,gates:[{id:'foundation',status:'PASS',evidenceRefs:[{id:'gate1',sha256:sha}]},{id:'architecture',status:'PASS',evidenceRefs:[{id:'gate2',sha256:sha2}]}]};
const apEmpty=structuredClone(apGood); apEmpty.gates=[];
const apAllNA=structuredClone(apGood); apAllNA.gates=apAllNA.gates.map(g=>({...g,status:'N/A',evidenceRefs:[]}));
const apForged=structuredClone(apGood); apForged.source.allowlisted=false; apForged.gates[0].evidenceRefs=[{id:'gate1',sha256:sha3}];
const apReplay=structuredClone(apGood); apReplay.sequence=2;
const liveFalse={schema:'garp27-live-status-v1',garpVersion:'2.7',environment:'school-runtime',overall:'PASS',controls:[{id:'x',status:'PASS'}],runtimeEvidence:[{id:'live',sha256:sha2}]};
const liveDeferred={schema:'garp27-live-status-v1',garpVersion:'2.7',environment:'school-runtime',overall:'NOT_TESTED',controls:[],runtimeEvidence:[]};
const runtimeUnsafe={schema:'garp27-runtime-test-request-v1',garpVersion:'2.7',testId:'RVP-01',safetyClass:'PROD_SAFE_CONDITIONAL',environment:'production',target:{id:'x',allowlisted:false,dedicatedSink:false},approval:{approved:false,expiresAt:'2000-01-01T00:00:00Z'},limits:{requests:999,bytes:99999999}};
const runtimeSafe={schema:'garp27-runtime-test-request-v1',garpVersion:'2.7',testId:'RVP-01',safetyClass:'PROD_SAFE_CONDITIONAL',environment:'production',target:{id:'approved-synthetic-sink',allowlisted:true,dedicatedSink:true},approval:{approved:true,approvedBy:'security-owner',expiresAt:'2099-01-01T00:00:00Z'},limits:{requests:2,bytes:4096}};

const policyGood={
  schema:'garp27-policy-v1',garpVersion:'2.7',appId:'demo',appVersion:'1.0.0',
  identity:{rule:'server-authoritative identity'},
  requestApiAi:{controls:'schema-bound requests'},
  egress:{defaultDeny:true},
  files:{uploads:{enabled:false}},
  dataLifecycle:{classification:'D0'},
  release:{activeAuthority:'GARP-2.7'},
  inventory:{source:'contract-selftest'},
  securityHealth:{checks:['contract-selftest']},
  incident:{response:'fail-closed'},
  recovery:{rollback:'required'}
};
const policyBad=structuredClone(policyGood); policyBad.identity={}; policyBad.garpVersion='2.6';
const policyPlaceholder=structuredClone(policyGood); policyPlaceholder.incident={response:'TBD'};
const policySubstring=structuredClone(policyGood); policySubstring.incident={response:'replace-with-incident-plan'};
const policyUnknown=structuredClone(policyGood); policyUnknown.appId='ghost-app';
const policyZero=structuredClone(policyGood); policyZero.appVersion='0.0.0';
const policyModeOnly=structuredClone(policyGood);
for(const key of ['identity','requestApiAi','egress','files','dataLifecycle','release','inventory','securityHealth','incident','recovery']) policyModeOnly[key]={mode:'explicit-app-policy'};
const inventory={schema:'garp27-ecosystem-app-inventory-v1',garpVersion:'2.7',revision:'selftest',apps:[{appId:'demo'}]};

const prepared={...structuredClone(apGood),state:'PREPARED'};
const validated={...structuredClone(apGood),state:'VALIDATED'};
const committed={...structuredClone(apGood),state:'COMMITTED'};
const core=path.resolve(root,'CONTRACTS/garp27-core.json');
const pf=w('profile.json',profile), tf=w('trust.json',trust), invf=w('inventory.json',inventory);
const untouchedTemplate=path.resolve(root,'TEMPLATES/garp-policy.template.json');
const policyArgs=f=>[f,'--core',core,'--inventory',invf];

const cases=[
 ['A01-positive-foundation-with-live-deferred','validate-assurance.mjs',[w('assurance-good.json',assuranceGood),'--profile',pf],0],
 ['A01-reject-contradictory-pass','validate-assurance.mjs',[w('assurance-bad.json',assuranceBad),'--profile',pf],1],
 ['A01-reject-pass-without-evidence','validate-assurance.mjs',[w('assurance-no-evidence.json',assuranceNoEvidence),'--profile',pf],1],
 ['A01-reject-duplicate-components','validate-assurance.mjs',[w('assurance-duplicate.json',assuranceDuplicate),'--profile',pf],1],
 ['A01-A04-reject-missing-environment','validate-assurance.mjs',[w('assurance-missing-env.json',assuranceMissingEnv),'--profile',pf],1],
 ['A01-reject-untrusted-evidence','validate-assurance.mjs',[w('assurance-forged.json',assuranceForged),'--profile',pf],1],
 ['A02-A03-positive-committed','validate-auto-patch.mjs',[w('ap-good.json',apGood),'--trust',tf,'--require-committed'],0],
 ['A02-reject-empty-gates','validate-auto-patch.mjs',[w('ap-empty.json',apEmpty),'--trust',tf,'--require-committed'],1],
 ['A02-reject-all-gates-na','validate-auto-patch.mjs',[w('ap-na.json',apAllNA),'--trust',tf,'--require-committed'],1],
 ['A03-reject-untrusted-source-and-evidence','validate-auto-patch.mjs',[w('ap-forged.json',apForged),'--trust',tf,'--require-committed'],1],
 ['A03-reject-replay-sequence','validate-auto-patch.mjs',[w('ap-replay.json',apReplay),'--trust',tf,'--require-committed'],1],
 ['A03-valid-transition-prepared-validated','validate-auto-patch-transition.mjs',[w('prepared.json',prepared),w('validated.json',validated)],0],
 ['A03-reject-direct-prepared-committed','validate-auto-patch-transition.mjs',[w('prepared2.json',prepared),w('committed.json',committed)],1],
 ['A04-A05-policy-positive-2.7','validate-policy.mjs',policyArgs(w('policy-good.json',policyGood)),0],
 ['A04-A05-policy-reject-empty-and-2.6','validate-policy.mjs',policyArgs(w('policy-bad.json',policyBad)),1],
 ['A04-policy-reject-placeholder','validate-policy.mjs',policyArgs(w('policy-placeholder.json',policyPlaceholder)),1],
 ['G02-reject-untouched-template','validate-policy.mjs',policyArgs(untouchedTemplate),1],
 ['G02-reject-unknown-app-id','validate-policy.mjs',policyArgs(w('policy-unknown.json',policyUnknown)),1],
 ['G02-reject-zero-version','validate-policy.mjs',policyArgs(w('policy-zero.json',policyZero)),1],
 ['G02-reject-mode-only-sections','validate-policy.mjs',policyArgs(w('policy-mode-only.json',policyModeOnly)),1],
 ['G02-reject-placeholder-substring','validate-policy.mjs',policyArgs(w('policy-substring.json',policySubstring)),1],
 ['A04-live-false-pass-rejected','validate-live-status.mjs',[w('live-false.json',liveFalse),'--profile',pf],1],
 ['A04-live-deferred-is-not-tested','validate-live-status.mjs',[w('live-deferred.json',liveDeferred),'--profile',pf],3],
 ['A06-unsafe-production-is-not-tested','validate-runtime-test-request.mjs',[w('runtime-unsafe.json',runtimeUnsafe)],3],
 ['A06-safe-approved-production-request','validate-runtime-test-request.mjs',[w('runtime-safe.json',runtimeSafe)],0]
];

const results=[];
for(const [id,tool,args,expected] of cases){
  const r=spawnSync(process.execPath,[path.join(tools,tool),...args],{encoding:'utf8'});
  results.push({id,expectedExit:expected,actualExit:r.status,pass:r.status===expected,stdout:r.stdout.trim(),stderr:r.stderr.trim()});
}
const ok=results.every(r=>r.pass);
console.log(JSON.stringify({classification:'CONTRACT_TEST',status:ok?'PASS':'FAIL',checks:results.length,passed:results.filter(r=>r.pass).length,scope:'reference-validator-positive-negative-tests',appBehaviorTest:false,liveTest:false,g02:{status:results.filter(r=>r.id.startsWith('G02-')).every(r=>r.pass)?'PASS':'FAIL',checks:results.filter(r=>r.id.startsWith('G02-')).length},results},null,2));
fs.rmSync(tmp,{recursive:true,force:true});
process.exit(ok?0:1);

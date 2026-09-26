#!/usr/bin/env node
import {readJson, parseArgs, isObject, fail, pass, harnessError, validateIdentity, uniqueBy, isFresh, SHA256_RE} from './lib.mjs';
try {
  const a=parseArgs(process.argv.slice(2)); const file=a._[0]; if(!file || !a.profile) throw new Error('usage: validate-assurance.mjs STATUS.json --profile TRUSTED_PROFILE.json [--now ISO]');
  const x=readJson(file), p=readJson(a.profile), errors=[];
  let structuralFail=false;
  if(x.schema!=='garp27-assurance-status-v1') {errors.push('schema'); structuralFail=true;}
  if(x.garpVersion!=='2.7' || p.garpVersion!=='2.7') {errors.push('garpVersion'); structuralFail=true;}
  if(!x.environment) {errors.push('environment required'); structuralFail=true;}
  validateIdentity(x.releaseIdentity,p.releaseIdentity,errors);
  if(!Array.isArray(x.components) || !uniqueBy(x.components,'componentId')) {errors.push('components must be unique'); structuralFail=true;}
  const by=new Map((x.components||[]).map(c=>[c.componentId,c]));
  const nowMs=a.now?Date.parse(a.now):Date.now(); if(!Number.isFinite(nowMs)) {errors.push('invalid now'); structuralFail=true;}
  let localFail=false, liveNotTested=false, degraded=false;
  for(const req of p.requiredComponents||[]) {
    if(req.required!==true) continue;
    const c=by.get(req.componentId);
    if(!c) { if(req.serverDependent && p.serverApproval!=='APPROVED') {liveNotTested=true; continue;} errors.push(`${req.componentId}: missing`); localFail=true; continue; }
    const axes={presence:'PRESENT',health:'HEALTHY',effectiveness:'PASS',evidenceFreshness:'FRESH'};
    const good=Object.entries(axes).every(([k,v])=>c[k]===v);
    if(!good) {
      if(req.serverDependent && p.serverApproval!=='APPROVED' && ['NOT_TESTED','UNKNOWN','MISSING'].includes(c.effectiveness)) liveNotTested=true;
      else { localFail=true; errors.push(`${req.componentId}: failing assurance axes`); }
      continue;
    }
    if(!Array.isArray(c.evidenceRefs) || c.evidenceRefs.length===0) {errors.push(`${req.componentId}: evidence required`); localFail=true; continue;}
    if(!isFresh(c.observedAt,p.maxEvidenceAgeHours||168,nowMs)) {errors.push(`${req.componentId}: evidence stale/invalid`); degraded=true;}
    for(const ref of c.evidenceRefs) {
      if(!isObject(ref) || !ref.id || !SHA256_RE.test(String(ref.sha256||''))) {errors.push(`${req.componentId}: invalid evidence ref`); localFail=true; continue;}
      const trusted=p.trustedEvidence?.[ref.id];
      if(!trusted || String(trusted).toLowerCase()!==String(ref.sha256).toLowerCase()) {errors.push(`${req.componentId}: untrusted evidence ${ref.id}`); localFail=true;}
    }
  }
  const derived=(structuralFail||localFail)?'FAIL':degraded?'DEGRADED':liveNotTested?'FOUNDATION_PASS_LIVE_NOT_TESTED':'PASS';
  if(x.overall && x.overall!=='DERIVE' && x.overall!==derived) errors.push(`overall mismatch: declared=${x.overall} derived=${derived}`);
  if(errors.length && (structuralFail||localFail)) fail('Assurance admission failed',{derivedOverall:derived,errors});
  if(errors.length && degraded) fail('Assurance evidence is not fresh',{derivedOverall:derived,errors});
  pass({derivedOverall:derived,foundationPass:!localFail,liveStatus:liveNotTested?'NOT_TESTED':'PASS',notes:errors});
} catch(e){ harnessError(e); }

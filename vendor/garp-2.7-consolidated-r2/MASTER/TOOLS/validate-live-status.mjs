#!/usr/bin/env node
import {readJson, parseArgs, fail, pass, notTested, harnessError, SHA256_RE} from './lib.mjs';
try {
  const a=parseArgs(process.argv.slice(2)); const file=a._[0]; if(!file || !a.profile) throw new Error('usage: validate-live-status.mjs STATUS.json --profile MIGRATION_PROFILE.json');
  const x=readJson(file), p=readJson(a.profile), errors=[];
  if(x.schema!=='garp27-live-status-v1' || x.garpVersion!=='2.7') errors.push('schema/version');
  if(p.serverApproval!=='APPROVED') {
    if(x.overall==='PASS') fail('False LIVE PASS is forbidden while server phase is deferred',['serverApproval is not APPROVED']);
    notTested({reason:'SERVER_PHASE_DEFERRED',serverApproval:p.serverApproval||'DEFERRED'});
  }
  if(x.overall!=='PASS') errors.push('approved LIVE admission requires overall PASS');
  if(!Array.isArray(x.controls)||x.controls.length===0) errors.push('controls required');
  for(const c of x.controls||[]) if(c.status!=='PASS') errors.push(`control ${c.id||'?'} not PASS`);
  if(!Array.isArray(x.runtimeEvidence)||x.runtimeEvidence.length===0) errors.push('runtimeEvidence required');
  for(const ref of x.runtimeEvidence||[]) if(!ref.id||!SHA256_RE.test(String(ref.sha256||''))||String(p.trustedEvidence?.[ref.id]||'').toLowerCase()!==String(ref.sha256).toLowerCase()) errors.push(`untrusted runtime evidence ${ref.id||'?'}`);
  if(errors.length) fail('LIVE admission failed',errors);
  pass({classification:'LIVE_TEST',live:'PASS'});
} catch(e){ harnessError(e); }

#!/usr/bin/env node
import {readJson, parseArgs, fail, pass, harnessError, SHA256_RE, SHA1_RE, uniqueBy, isObject} from './lib.mjs';
try {
  const a=parseArgs(process.argv.slice(2)); const file=a._[0]; if(!file || !a.trust) throw new Error('usage: validate-auto-patch.mjs MANIFEST.json --trust TRUST.json [--require-committed]');
  const x=readJson(file), t=readJson(a.trust), errors=[];
  if(x.schema!=='garp27-auto-patch-manifest-v1') errors.push('schema');
  if(x.garpVersion!=='2.7' || t.garpVersion!=='2.7') errors.push('garpVersion');
  if(!['PREPARED','VALIDATED','COMMITTED','ROLLED_BACK'].includes(x.state)) errors.push('state');
  if(a['require-committed'] && x.state!=='COMMITTED') errors.push('state must be COMMITTED');
  if(!x.releaseId || !Number.isInteger(x.sequence) || x.sequence<1) errors.push('release identity/sequence');
  if(x.sequence < Number(t.replay?.minimumSequence||1)) errors.push('replay sequence below trusted minimum');
  if(String(x.previousReleaseId??'')!==String(t.replay?.previousReleaseId??'')) errors.push('previousReleaseId mismatch');
  for(const key of ['appId','version','commitSha','artifactSha256','policySha256']) if(String(x.target?.[key]||'')!==String(t.target?.[key]||'')) errors.push(`target.${key}: mismatch`);
  if(!SHA1_RE.test(String(x.target?.commitSha||''))) errors.push('target.commitSha invalid');
  for(const key of ['artifactSha256','policySha256']) if(!SHA256_RE.test(String(x.target?.[key]||''))) errors.push(`target.${key} invalid`);
  if(x.source?.allowlisted!==true || t.source?.allowlisted!==true || x.source?.repository!==t.source?.repository) errors.push('source not trusted/allowlisted');
  if(!Array.isArray(x.gates) || !uniqueBy(x.gates,'id')) errors.push('gates must be unique array');
  const by=new Map((x.gates||[]).map(g=>[g.id,g]));
  for(const req of t.requiredGates||[]) {
    const g=by.get(req.id); if(!g) {errors.push(`gate ${req.id}: missing`); continue;}
    if(g.status==='N/A' && req.allowNA!==true) errors.push(`gate ${req.id}: N/A forbidden`);
    else if(g.status!=='PASS' && !(g.status==='N/A'&&req.allowNA===true)) errors.push(`gate ${req.id}: ${g.status}`);
    if(g.status==='PASS') {
      if(!Array.isArray(g.evidenceRefs)||g.evidenceRefs.length===0) errors.push(`gate ${req.id}: evidence required`);
      for(const ref of g.evidenceRefs||[]) {
        if(!isObject(ref)||!ref.id||!SHA256_RE.test(String(ref.sha256||''))) {errors.push(`gate ${req.id}: invalid evidence`);continue;}
        const expected=t.trustedEvidence?.[ref.id]; if(!expected||String(expected).toLowerCase()!==String(ref.sha256).toLowerCase()) errors.push(`gate ${req.id}: untrusted evidence ${ref.id}`);
      }
    }
  }
  const allowedIds=new Set((t.requiredGates||[]).map(g=>g.id));
  for(const g of x.gates||[]) if(!allowedIds.has(g.id)) errors.push(`unknown gate ${g.id}`);
  if(x.state==='COMMITTED' && (t.requiredGates||[]).length===0) errors.push('COMMITTED requires non-empty trusted gate set');
  if(errors.length) fail('Auto-patch admission failed',errors);
  pass({state:x.state,releaseId:x.releaseId,sequence:x.sequence,gates:x.gates.length});
} catch(e){ harnessError(e); }

#!/usr/bin/env node
import {readJson, parseArgs, fail, pass, harnessError} from './lib.mjs';
try {
  const a=parseArgs(process.argv.slice(2)); const prevFile=a._[0], nextFile=a._[1];
  if(!prevFile || !nextFile) throw new Error('usage: validate-auto-patch-transition.mjs PREVIOUS.json NEXT.json');
  const prev=readJson(prevFile), next=readJson(nextFile), errors=[];
  const allowed=new Set(['PREPARED>VALIDATED','VALIDATED>COMMITTED','COMMITTED>ROLLED_BACK']);
  const edge=`${prev.state}>${next.state}`;
  if(!allowed.has(edge)) errors.push(`forbidden transition ${edge}`);
  if(prev.releaseId!==next.releaseId) errors.push('releaseId must not change during one transition chain');
  if(prev.sequence!==next.sequence) errors.push('sequence must remain stable during one release transition chain');
  if(String(prev.previousReleaseId??'')!==String(next.previousReleaseId??'')) errors.push('previousReleaseId must not change during one release transition chain');
  if(JSON.stringify(prev.target)!==JSON.stringify(next.target)) errors.push('target identity must not change during transition');
  if(errors.length) fail('Auto-patch state transition rejected',errors);
  pass({transition:edge,releaseId:next.releaseId,sequence:next.sequence});
} catch(e){ harnessError(e); }

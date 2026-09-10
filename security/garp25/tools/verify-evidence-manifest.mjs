#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';

const argv=process.argv.slice(2); const dirArg=argv.shift(),manifestArg=argv.shift();
if(!dirArg||!manifestArg){console.error('Usage: node verify-evidence-manifest.mjs <evidence-dir> <manifest> [--project-root <root>]');process.exit(2);}
let projectRoot=process.cwd();
for(let i=0;i<argv.length;i++){if(argv[i]==='--project-root'){projectRoot=path.resolve(argv[++i]||'.');continue;}console.error(`Unknown option: ${argv[i]}`);process.exit(2);}
const root=path.resolve(dirArg), manifest=JSON.parse(await readFile(manifestArg,'utf8')); const errors=[];
if(!['ghrab-security-evidence-manifest-v1','ghrab-security-evidence-manifest-v2'].includes(manifest.schema)) errors.push(`schema:${manifest.schema||'missing'}`);
const expected=new Map((manifest.files||[]).map(x=>[x.path,x])); const seen=new Set(); const hex=b=>createHash('sha256').update(b).digest('hex');
async function walk(dir,base=''){
 for(const name of (await readdir(dir)).sort((a,b)=>a.localeCompare(b,'en'))){
  const abs=path.join(dir,name),rel=path.posix.join(base,name),st=await lstat(abs);
  if(st.isSymbolicLink()){errors.push(`symlink:${rel}`);continue;}
  if(st.isDirectory()) await walk(abs,rel);
  else if(st.isFile()){
    seen.add(rel); const e=expected.get(rel),d=await readFile(abs);
    if(!e) errors.push(`unexpected:${rel}`);
    else { if(e.size!==d.length) errors.push(`size:${rel}`); if(e.sha256!==hex(d)) errors.push(`sha256:${rel}`); }
  }
 }
}
await walk(root); for(const rel of expected.keys()) if(!seen.has(rel)) errors.push(`missing:${rel}`);
for(const e of manifest.externalFiles||[]){
  const rel=String(e.path||'').replaceAll('\\','/').replace(/^\.\//,'');
  if(!rel||rel.startsWith('/')||rel.split('/').includes('..')){errors.push(`external-invalid:${e.path}`);continue;}
  const abs=path.resolve(projectRoot,rel); if(abs!==projectRoot&&!abs.startsWith(projectRoot+path.sep)){errors.push(`external-escape:${rel}`);continue;}
  try{const st=await lstat(abs);if(st.isSymbolicLink()||!st.isFile()){errors.push(`external-not-file:${rel}`);continue;}const d=await readFile(abs);if(e.size!==d.length)errors.push(`external-size:${rel}`);if(e.sha256!==hex(d))errors.push(`external-sha256:${rel}`);}catch{errors.push(`external-missing:${rel}`)}
}
if(errors.length){console.error(JSON.stringify({status:'FAIL',errors},null,2));process.exit(1);}
console.log(JSON.stringify({status:'PASS',files:seen.size,externalFiles:(manifest.externalFiles||[]).length},null,2));

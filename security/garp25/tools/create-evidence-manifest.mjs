#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readdir, readFile, lstat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const argv=process.argv.slice(2); const dirArg=argv.shift();
if(!dirArg){console.error('Usage: node create-evidence-manifest.mjs <evidence-dir> [output] [--project-root <root>] [--extra <root-relative-file>]...');process.exit(2);}
let outArg='security-evidence-manifest.json'; if(argv[0]&&!argv[0].startsWith('--')) outArg=argv.shift();
let projectRoot=process.cwd(); const extras=[];
for(let i=0;i<argv.length;i++){
  if(argv[i]==='--project-root'){projectRoot=path.resolve(argv[++i]||'.');continue;}
  if(argv[i]==='--extra'){extras.push(String(argv[++i]||''));continue;}
  console.error(`Unknown option: ${argv[i]}`);process.exit(2);
}
const root=path.resolve(dirArg); const out=path.resolve(outArg); const hex=b=>createHash('sha256').update(b).digest('hex');
async function walk(dir,base=''){
  const rows=[];
  for(const name of (await readdir(dir)).sort((a,b)=>a.localeCompare(b,'en'))){
    const abs=path.join(dir,name),rel=path.posix.join(base,name),st=await lstat(abs);
    if(st.isSymbolicLink()) throw new Error(`Symlink forbidden: ${rel}`);
    if(st.isDirectory()) rows.push(...await walk(abs,rel));
    else if(st.isFile()) { const d=await readFile(abs); rows.push({path:rel,size:d.length,sha256:hex(d)}); }
  }
  return rows;
}
function safeExtra(rel){
  const n=String(rel||'').replaceAll('\\','/').replace(/^\.\//,''); if(!n||n.startsWith('/')||n.split('/').includes('..')) throw new Error(`Invalid external evidence path: ${rel}`); return n;
}
const files=await walk(root); const externalFiles=[];
for(const raw of [...new Set(extras.map(safeExtra))].sort()){
  const abs=path.resolve(projectRoot,raw); if(abs!==projectRoot&&!abs.startsWith(projectRoot+path.sep)) throw new Error(`External path escape: ${raw}`);
  const st=await lstat(abs); if(st.isSymbolicLink()||!st.isFile()) throw new Error(`External evidence must be a regular file: ${raw}`);
  const d=await readFile(abs); externalFiles.push({path:raw,size:d.length,sha256:hex(d)});
}
const manifest={schema:externalFiles.length?'ghrab-security-evidence-manifest-v2':'ghrab-security-evidence-manifest-v1',appId:process.env.GHRAB_APP_ID||null,version:process.env.GHRAB_APP_VERSION||null,sourceRevision:process.env.GHRAB_SOURCE_COMMIT||null,sourcePackageSha256:process.env.GHRAB_SOURCE_PACKAGE_SHA256||null,createdAt:new Date().toISOString(),files,...(externalFiles.length?{externalFiles}: {})};
await writeFile(out,JSON.stringify(manifest,null,2)+'\n','utf8');
console.log(JSON.stringify({status:'PASS',files:files.length,externalFiles:externalFiles.length,output:out},null,2));

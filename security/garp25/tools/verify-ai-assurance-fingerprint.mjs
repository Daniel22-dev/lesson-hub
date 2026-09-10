#!/usr/bin/env node
// GARP 2.5.1 - verify explicit AI boundary inventory, source bytes, and inventory drift.
import { createHash } from 'node:crypto';
import { readFile, lstat, readdir } from 'node:fs/promises';
import path from 'node:path';

const [fingerprintArg, inventoryArg, rootArg='.'] = process.argv.slice(2);
if(!fingerprintArg||!inventoryArg){
  console.error('Usage: node verify-ai-assurance-fingerprint.mjs <fingerprint.json> <inventory.json> [project-root]');
  process.exit(2);
}
const root=path.resolve(rootArg), fingerprint=JSON.parse(await readFile(fingerprintArg,'utf8')), inventoryRaw=JSON.parse(await readFile(inventoryArg,'utf8'));
const errors=[]; const norm=p=>String(p||'').replaceAll('\\','/').replace(/^\.\//,''); const sha=b=>createHash('sha256').update(b).digest('hex');
if(!Array.isArray(inventoryRaw)||!inventoryRaw.length||inventoryRaw.some(x=>typeof x!=='string'||!x.trim())) errors.push('inventory-invalid');
const inventory=[...new Set((Array.isArray(inventoryRaw)?inventoryRaw:[]).map(norm))].sort();
if(inventory.length!==(Array.isArray(inventoryRaw)?inventoryRaw.length:0)) errors.push('inventory-duplicates');
if(!['ghrab-ai-assurance-fingerprint-v2'].includes(fingerprint.schema)) errors.push(`schema:${fingerprint.schema||'missing'}`);
const declared=(fingerprint.files||[]).map(x=>norm(x.path));
if(JSON.stringify(declared)!==JSON.stringify(inventory)) errors.push('inventory-fingerprint-file-list-mismatch');
const rows=[];
for(const rel of inventory){
  const abs=path.resolve(root,rel); if(abs!==root&&!abs.startsWith(root+path.sep)){errors.push(`path-escape:${rel}`);continue;}
  try{
    const st=await lstat(abs); if(!st.isFile()){errors.push(`not-file:${rel}`);continue;}
    const bytes=await readFile(abs), digest=sha(bytes), expected=(fingerprint.files||[]).find(x=>norm(x.path)===rel)?.sha256;
    if(digest!==expected) errors.push(`sha256:${rel}`); rows.push({path:rel,sha256:digest});
  }catch{errors.push(`missing:${rel}`)}
}
const aggregate=sha(Buffer.from(rows.map(r=>`${r.sha256}  ${r.path}`).join('\n')+'\n'));
if(aggregate!==fingerprint.aggregate) errors.push('aggregate-mismatch');
try{const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));if(fingerprint.appVersion&&pkg.version!==fingerprint.appVersion)errors.push(`appVersion:${fingerprint.appVersion}:${pkg.version}`)}catch{}

// N15 hardening: the release verifier must detect newly introduced AI-boundary candidates,
// not merely re-hash the already-declared inventory. This detector mirrors the GHRAB app
// generator but lives in canonical tooling, so release-gate coverage is ecosystem-wide.
const boundaryTokens=/GHRAB_AI|dplData\s*\(|callGemini|school-gateway|direct-gemini|systemInstruction|system_instruction|prompt|aiTransport|wrapUntrusted|AIR-/i;
async function walk(absDir){
  const out=[]; let entries=[];
  try{entries=await readdir(absDir,{withFileTypes:true});}catch{return out;}
  for(const e of entries){
    const abs=path.join(absDir,e.name);
    if(e.isSymbolicLink?.()) continue;
    if(e.isDirectory()) out.push(...await walk(abs));
    else if(e.isFile()) out.push(abs);
  }
  return out;
}
async function candidatePool(){
  const abs=[];
  abs.push(...await walk(path.join(root,'src','js')));
  abs.push(...await walk(path.join(root,'src','config')));
  for(const rel of ['src/runtime-config.js','src/runtime-config.school-server.js','src/ai-operations.json','ghrab-ai-core.consumer.json']){
    const a=path.join(root,rel); try{if((await lstat(a)).isFile())abs.push(a)}catch{}
  }
  const vendorRoot=path.join(root,'vendor');
  let vendors=[]; try{vendors=await readdir(vendorRoot,{withFileTypes:true})}catch{}
  for(const e of vendors){if(e.isDirectory()&&/ghrab-ai-core|ai-core/i.test(e.name))abs.push(...await walk(path.join(vendorRoot,e.name)))}
  return [...new Set(abs)].sort();
}
const detected=[];
for(const abs of await candidatePool()){
  let text=''; try{text=await readFile(abs,'utf8')}catch{continue}
  if(!boundaryTokens.test(text)) continue;
  const rel=norm(path.relative(root,abs));
  if(rel.startsWith('../')||path.isAbsolute(rel)){errors.push(`candidate-path-escape:${rel}`);continue;}
  detected.push(rel);
}
const detectedUnique=[...new Set(detected)].sort();
const untracked=detectedUnique.filter(rel=>!inventory.includes(rel));
const inventoryMissingCandidates=inventory.filter(rel=>!detectedUnique.includes(rel));
for(const rel of untracked) errors.push(`inventory-drift-untracked:${rel}`);

const result={status:errors.length?'FAIL':'PASS',errors,files:rows.length,aggregate,expected:fingerprint.aggregate,inventory:path.resolve(inventoryArg),detectedCandidates:detectedUnique.length,untracked,inventoryEntriesNotDetectorMatched:inventoryMissingCandidates,verifierRevision:'garp-2.5.1-r3-ai-inventory-drift-hotfix'};
console[errors.length?'error':'log'](JSON.stringify(result,null,2));
process.exit(errors.length?1:0);

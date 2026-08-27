#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
const pkg=JSON.parse(await readFile('package.json','utf8'));
const lock=JSON.parse(await readFile('package-lock.json','utf8'));
const failures=[];
if(lock.lockfileVersion!==3) failures.push(`lockfileVersion=${lock.lockfileVersion}`);
const root=lock.packages?.['']||{};
for(const group of ['dependencies','devDependencies','optionalDependencies']){
  const deps=pkg[group]||{};
  const lockedRoot=root[group]||{};
  for(const [name,spec] of Object.entries(deps)){
    if(!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(spec)) failures.push(`${group}.${name} není přesně připnut: ${spec}`);
    if(lockedRoot[name]!==spec) failures.push(`${group}.${name} se neshoduje s root lockem`);
    const entry=lock.packages?.[`node_modules/${name}`];
    if(!entry) failures.push(`chybí node_modules/${name}`);
    else if(entry.version!==spec) failures.push(`${name}: lock ${entry.version} != ${spec}`);
  }
}
for(const [key,entry] of Object.entries(lock.packages||{})){
  if(key===''||!entry?.resolved) continue;
  if(!String(entry.resolved).startsWith('https://registry.npmjs.org/')) failures.push(`${key}: nedůvěryhodný resolved ${entry.resolved}`);
  if(!entry.integrity) failures.push(`${key}: chybí integrity`);
}
const serialized=JSON.stringify(lock);
if(serialized.includes('applied-caas-gateway')||serialized.includes('.internal.api.openai.org')) failures.push('lockfile obsahuje interní registr');
if(failures.length){console.error(JSON.stringify({schema:'ghrab-p5-lock-audit-v1',status:'failed',failures},null,2));process.exit(1)}
console.log(JSON.stringify({schema:'ghrab-p5-lock-audit-v1',status:'passed',package:pkg.name,version:pkg.version,directDependencies:Object.keys(pkg.dependencies||{}).length+Object.keys(pkg.devDependencies||{}).length,lockedPackages:Object.keys(lock.packages||{}).length-1,registry:'https://registry.npmjs.org'},null,2));

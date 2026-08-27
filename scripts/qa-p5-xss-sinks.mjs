#!/usr/bin/env node
import fs from 'node:fs'; import path from 'node:path';
const root=path.resolve('.'); const baseline=JSON.parse(fs.readFileSync(path.join(root,'config/qa-p5-xss-baseline.json'),'utf8'));
const roots=['src','public','engines','runtime'].map(x=>path.join(root,x)).filter(fs.existsSync); const files=[];
for(const r of roots) walk(r); function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name); if(e.isDirectory())walk(p); else if(/\.(?:html?|m?js|css)$/i.test(e.name))files.push(p)}}
const patterns={innerHTML:/\.innerHTML\s*=/g,insertAdjacentHTML:/\.insertAdjacentHTML\s*\(/g,outerHTML:/\.outerHTML\s*=/g,documentWrite:/document\.write\s*\(/g,eval:/\beval\s*\(/g,newFunction:/\bnew\s+Function\s*\(/g};
const counts=Object.fromEntries(Object.keys(patterns).map(k=>[k,0])); const evidence=[];
for(const f of files){const t=fs.readFileSync(f,'utf8');for(const [k,re] of Object.entries(patterns)){const n=[...t.matchAll(re)].length;counts[k]+=n;if(n)evidence.push({file:path.relative(root,f),kind:k,count:n})}}
const failures=[]; for(const [k,n] of Object.entries(counts)){const allowed=Number(baseline.counts?.[k]??0); if(n>allowed)failures.push(`${k}: ${n} > baseline ${allowed}`)}
const distHtml=path.join(root,'dist/index.html'); let csp=null;if(fs.existsSync(distHtml)){const t=fs.readFileSync(distHtml,'utf8');csp={unsafeInlineScript:/script-src[^;]*'unsafe-inline'/.test(t),unsafeInlineStyle:/style-src[^;]*'unsafe-inline'/.test(t)}}
const report={schema:'ghrab-p5-xss-sink-audit-v1',appId:baseline.appId,counts,baseline:baseline.counts,csp,evidence,limitations:['This is a regression inventory, not proof that every HTML sink is safe.','Current inline-script architecture may still require unsafe-inline until CSP refactoring.'],failures,status:failures.length?'failed':'passed'};
fs.mkdirSync(path.join(root,'dist'),{recursive:true});fs.writeFileSync(path.join(root,'dist/qa-p5-xss-sinks-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(failures.length)process.exit(1);

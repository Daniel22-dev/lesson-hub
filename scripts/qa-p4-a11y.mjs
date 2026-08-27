#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const root=path.resolve('.');
const dist=path.join(root,'dist');
const consumer=JSON.parse(await fsp.readFile(path.join(root,'ghrab-platform.consumer.json'),'utf8'));
const maxPages=Number(process.env.GHRAB_A11Y_MAX_PAGES||50);
function chromiumPath(){for(const p of [process.env.CHROMIUM_PATH,'/usr/lib/chromium/chromium','/usr/bin/chromium','/usr/bin/google-chrome'].filter(Boolean))if(fs.existsSync(p))return p;throw new Error('Chromium není dostupné');}
async function waitJson(url){for(let i=0;i<600;i++){try{const r=await fetch(url);if(r.ok)return await r.json();}catch{}await sleep(50)}throw new Error('Chromium debug timeout');}
class Cdp{constructor(url){this.ws=new WebSocket(url);this.seq=0;this.pending=new Map();this.ready=new Promise((res,rej)=>{this.ws.onopen=res;this.ws.onerror=rej});this.ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&this.pending.has(m.id)){const p=this.pending.get(m.id);this.pending.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result)}};this.ws.onclose=()=>{for(const p of this.pending.values())p.reject(new Error('CDP closed'));this.pending.clear()}}async call(method,params={}){await this.ready;return new Promise((resolve,reject)=>{const id=++this.seq;const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`CDP timeout: ${method}`))},30000);this.pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v)},reject:e=>{clearTimeout(timer);reject(e)}});this.ws.send(JSON.stringify({id,method,params}))})}async eval(expression){const r=await this.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value}close(){try{this.ws.close()}catch{}}}
async function walk(dir){if(!fs.existsSync(dir))return[];const out=[];for(const e of await fsp.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);e.isDirectory()?out.push(...await walk(p)):out.push(p)}return out}
const posix=v=>v.split(path.sep).join('/');
const localRef=v=>v&&!/^(?:https?:|\/\/|data:|blob:|#|javascript:)/i.test(v);
const escStyle=s=>s.replace(/<\/style/gi,'<\\/style');
function prepareHtml(source,file){let html=source
 .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')
 .replace(/<script\b[^>]*\/?>/gi,'')
 .replace(/<meta\b[^>]*http-equiv=["'](?:refresh|content-security-policy)["'][^>]*>/gi,'')
 .replace(/\s(?:src|srcset)=["'](?:https?:|\/\/)[^"']*["']/gi,'')
 .replace(/\shref=["']javascript:[^"']*["']/gi,' href="#"');
 html=html.replace(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi,tag=>{const m=tag.match(/href=["']([^"']+)["']/i);if(!m||!localRef(m[1]))return'';const clean=m[1].split(/[?#]/)[0];const target=path.resolve(path.dirname(file),clean);if(!target.startsWith(dist)||!fs.existsSync(target)||!fs.statSync(target).isFile())return'';try{return`<style data-ghrab-a11y-inline="${clean.replace(/"/g,'&quot;')}">${escStyle(fs.readFileSync(target,'utf8'))}</style>`}catch{return''}});
 const deterministic=`<style data-ghrab-p4-a11y-harness>*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}[hidden]{display:none!important}</style>`;
 return /<\/head>/i.test(html)?html.replace(/<\/head>/i,`${deterministic}</head>`):html.replace(/<body/i,`<head>${deterministic}</head><body`);
}
const files=(await walk(dist)).filter(f=>f.toLowerCase().endsWith('.html'));
const pages=[];for(const file of files){const rel=posix(path.relative(dist,file));if(/(^|\/)tests?\//i.test(rel))continue;const source=await fsp.readFile(file,'utf8');if(/<html\b[^>]*>[\s\S]*<\/html>/i.test(source))pages.push({file,rel,source})}
pages.sort((a,b)=>(path.basename(a.file)==='index.html'?0:1)-(path.basename(b.file)==='index.html'?0:1)||a.rel.localeCompare(b.rel));
const selected=pages.slice(0,maxPages);if(!selected.length)throw new Error('Nenalezena distribuovaná HTML stránka.');
const port=11800+(process.pid%500),profile=`/tmp/ghrab-p4-a11y-${process.pid}`;fs.rmSync(profile,{recursive:true,force:true});
const chrome=spawn(chromiumPath(),['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-background-networking','--disable-extensions','--no-first-run','--disable-features=Translate,MediaRouter','--mute-audio','--remote-allow-origins=*',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore',detached:true});
const base=`http://127.0.0.1:${port}`;
async function target(){const r=await fetch(`${base}/json/new?about:blank`,{method:'PUT'});if(!r.ok)throw new Error(`target ${r.status}`);return r.json()}
async function close(id){try{await fetch(`${base}/json/close/${encodeURIComponent(id)}`)}catch{}}
const auditExpression=`(()=>{
 const issues=[],review=[];
 const visible=el=>{if(!el||!el.isConnected)return false;const s=getComputedStyle(el);if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0)return false;const r=el.getBoundingClientRect();return r.width>0&&r.height>0};
 const text=el=>String(el?.textContent||'').replace(/\\s+/g,' ').trim();
 const selector=el=>{if(el.id)return '#'+CSS.escape(el.id);const p=[];let n=el;while(n&&n.nodeType===1&&p.length<4){let s=n.tagName.toLowerCase();if(n.classList.length)s+='.'+[...n.classList].slice(0,2).map(CSS.escape).join('.');p.unshift(s);n=n.parentElement}return p.join(' > ')};
 const add=(severity,id,el,detail)=>issues.push({severity,id,selector:el?selector(el):'document',detail});
 const name=el=>{const aria=el.getAttribute('aria-label');if(aria&&aria.trim())return aria.trim();const by=el.getAttribute('aria-labelledby');if(by){const t=by.split(/\\s+/).map(id=>text(document.getElementById(id))).filter(Boolean).join(' ');if(t)return t}if(el.id){const lab=document.querySelector('label[for="'+CSS.escape(el.id)+'"]');if(lab&&text(lab))return text(lab)}if(el.closest('label')&&text(el.closest('label')))return text(el.closest('label'));if(el.getAttribute('alt'))return el.getAttribute('alt').trim();if(el.getAttribute('title'))return el.getAttribute('title').trim();if(['INPUT'].includes(el.tagName)&&['submit','reset','button'].includes((el.type||'').toLowerCase()))return el.value||'';return text(el)};
 const html=document.documentElement;
 if(!html.lang?.trim())add('serious','document-lang',html,'Chybí jazyk dokumentu.');
 if(!document.title.trim())add('serious','document-title',document.head,'Chybí titulek stránky.');
 const vp=document.querySelector('meta[name="viewport"]');if(!vp)add('serious','viewport',document.head,'Chybí viewport.');else if(/user-scalable\\s*=\\s*no|maximum-scale\\s*=\\s*[01](?:\\.0+)?(?:[,;]|$)/i.test(vp.content))add('serious','zoom-disabled',vp,'Stránka omezuje zoom.');
 if(!document.querySelector('main,[role="main"]'))add('serious','main-landmark',document.body,'Chybí hlavní landmark.');
 if(!document.querySelector('h1'))review.push({id:'heading-one',selector:'document',detail:'Chybí H1; ověřit strukturu nadpisů.'});
 const ids=new Map();for(const el of document.querySelectorAll('[id]')){const id=el.id;if(!id)continue;if(ids.has(id))add('serious','duplicate-id',el,'Duplicitní id: '+id);else ids.set(id,el)}
 for(const img of document.querySelectorAll('img'))if(visible(img)&&!img.hasAttribute('alt'))add('serious','image-alt',img,'Viditelný obrázek nemá alt.');
 for(const area of document.querySelectorAll('area[href]'))if(!name(area))add('serious','area-name',area,'Oblast mapy nemá název.');
 for(const el of document.querySelectorAll('button,a[href],input:not([type="hidden"]),select,textarea,[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="switch"],[role="tab"]'))if(visible(el)&&!name(el))add('serious','control-name',el,'Ovládací prvek nemá přístupný název.');
 for(const frame of document.querySelectorAll('iframe'))if(visible(frame)&&!frame.getAttribute('title')?.trim())add('serious','frame-title',frame,'Iframe nemá title.');
 for(const dlg of document.querySelectorAll('[role="dialog"],dialog'))if(visible(dlg)&&!name(dlg))add('serious','dialog-name',dlg,'Dialog nemá přístupný název.');
 for(const el of document.querySelectorAll('[tabindex]'))if(Number(el.getAttribute('tabindex'))>0)add('serious','positive-tabindex',el,'Kladný tabindex narušuje pořadí fokusu.');
 for(const el of document.querySelectorAll('[aria-hidden="true"]'))if(!el.inert&&el.querySelector('a[href],button,input:not([type="hidden"]),select,textarea,[tabindex]:not([tabindex="-1"])'))add('serious','aria-hidden-focus',el,'aria-hidden obsahuje fokusovatelný prvek.');
 for(const media of document.querySelectorAll('audio[autoplay],video[autoplay]'))add('serious','media-autoplay',media,'Média se spouštějí automaticky.');
 for(const a of document.querySelectorAll('a[target="_blank"]')){const rel=(a.getAttribute('rel')||'').toLowerCase();if(!rel.includes('noopener'))add('moderate','noopener',a,'Externí okno bez noopener.');}
 for(const input of document.querySelectorAll('input[type="image"]'))if(!input.getAttribute('alt')?.trim())add('serious','input-image-alt',input,'Obrázkové tlačítko nemá alt.');
 for(const table of document.querySelectorAll('table'))if(visible(table)&&!table.querySelector('th'))review.push({id:'table-headers',selector:selector(table),detail:'Tabulka nemá záhlaví; ověřit datovou strukturu.'});
 const headings=[...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible);for(let i=1;i<headings.length;i++){const a=Number(headings[i-1].tagName[1]),b=Number(headings[i].tagName[1]);if(b>a+1)review.push({id:'heading-order',selector:selector(headings[i]),detail:'Skok H'+a+' → H'+b+'.'})}
 const focusable=[...document.querySelectorAll('a[href],button,input:not([type="hidden"]),select,textarea,[tabindex]:not([tabindex="-1"])')].filter(visible);let focusVisible=true;if(focusable.length){focusable[0].focus();const s=getComputedStyle(focusable[0]);let focusRule=false;try{for(const sheet of document.styleSheets){for(const rule of [...(sheet.cssRules||[])]){const sel=String(rule.selectorText||'');if(sel.includes(':focus')){focusRule=true;break}}if(focusRule)break}}catch{}focusVisible=(parseFloat(s.outlineWidth)||0)>0||s.boxShadow!=='none'||parseFloat(s.borderWidth)>0||focusRule}if(!focusVisible)review.push({id:'focus-visible',selector:selector(focusable[0]),detail:'Nebyl detekován viditelný fokus ani odpovídající CSS focus rule.'});
 const counts={critical:0,serious:0,moderate:0,minor:0};for(const i of issues)counts[i.severity]=(counts[i.severity]||0)+1;
 return {issues,review,counts,domNodes:document.querySelectorAll('*').length,focusable:focusable.length};
})()`;
const results=[];try{await waitJson(`${base}/json/version`);for(const page of selected){const t=await target();const c=new Cdp(t.webSocketDebuggerUrl);try{await c.call('Runtime.enable');await c.call('Page.enable');const tree=await c.call('Page.getFrameTree');await c.call('Page.setDocumentContent',{frameId:tree.frameTree.frame.id,html:prepareHtml(page.source,page.file)});for(let i=0;i<100;i++){if(await c.eval("document.readyState==='complete'&&Boolean(document.body)"))break;await sleep(20)}await sleep(40);results.push({page:page.rel,...await c.eval(auditExpression)});}finally{c.close();await close(t.id)}}}finally{if(chrome.exitCode===null){try{process.kill(-chrome.pid,'SIGTERM')}catch{}}await Promise.race([new Promise(r=>chrome.once('exit',r)),sleep(1500)]);if(chrome.exitCode===null){try{process.kill(-chrome.pid,'SIGKILL')}catch{}}await sleep(100);fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100})}
const totals={critical:0,serious:0,moderate:0,minor:0,review:0};for(const p of results){for(const [k,v] of Object.entries(p.counts))totals[k]+=v;totals.review+=p.review.length}
const blockers=totals.critical+totals.serious;
const report={schema:'ghrab-p4-a11y-result-v1',contract:'ghrab-a11y-v1',method:'deterministic-browser-dom-audit',appId:consumer.appId,appVersion:consumer.appVersion,chromium:chromiumPath(),pages:results.length,totals,status:blockers?'failed':'passed',results,limitations:['Automatická kontrola nenahrazuje ruční WCAG audit ani test s asistivní technologií.','Kontrast a význam dynamických stavů zůstávají v ručním checklistu.']};
await fsp.writeFile(path.join(dist,'qa-p4-a11y-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({appId:report.appId,appVersion:report.appVersion,pages:report.pages,totals:report.totals,status:report.status},null,2));if(blockers)process.exitCode=1;

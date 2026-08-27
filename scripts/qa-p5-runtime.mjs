#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const root = path.resolve('.');
const dist = path.join(root, 'dist');
const consumer = JSON.parse(await fsp.readFile(path.join(root, 'ghrab-platform.consumer.json'), 'utf8'));
const widths = [1280, 390, 320];
const maxPages = Number(process.env.GHRAB_RUNTIME_MAX_PAGES || 50);
const configuredPages = Array.isArray(consumer?.quality?.runtimeAudit?.pages) ? consumer.quality.runtimeAudit.pages : [];
const settleMs = Number(process.env.GHRAB_RUNTIME_SETTLE_MS || 900);
const outPath = path.join(dist, 'qa-p5-runtime-report.json');

function chromiumPath() {
  for (const candidate of [process.env.CHROMIUM_PATH, '/usr/bin/chromium', '/usr/lib/chromium/chromium', '/usr/bin/google-chrome'].filter(Boolean)) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Chromium není dostupné. Nastavte CHROMIUM_PATH nebo nainstalujte Chromium.');
}
async function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  const result = [];
  for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(target));
    else result.push(target);
  }
  return result;
}
function mime(file) {
  const ext = path.extname(file).toLowerCase();
  return ({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.mp3':'audio/mpeg','.mp4':'video/mp4','.woff2':'font/woff2'})[ext] || 'application/octet-stream';
}
const qaPrelude = `<style data-ghrab-runtime-audit-style>html[data-ghrab-qa-runtime=\"true\"] body{visibility:visible!important;opacity:1!important}</style><script data-ghrab-runtime-audit-prelude>
(()=>{
  window.__GHRAB_QA_RUNTIME__ = true;
  document.documentElement.dataset.ghrabAccess = 'granted';
  document.documentElement.dataset.ghrabQaRuntime = 'true';
  try { Object.defineProperty(navigator, 'webdriver', { get: () => true, configurable: true }); } catch {}
  window.alert = () => {};
  window.confirm = () => true;
  window.prompt = () => '';
  window.open = () => null;
  try {
    if (globalThis.ServiceWorkerContainer?.prototype?.register) {
      globalThis.ServiceWorkerContainer.prototype.register = async () => ({
        update: async () => {}, addEventListener: () => {}, installing: null, waiting: null, active: null,
      });
    }
  } catch {}
  addEventListener('error', e => { (window.__GHRAB_QA_ERRORS__ ||= []).push(String(e.error?.stack || e.message || e.error || 'error')); });
  addEventListener('unhandledrejection', e => { (window.__GHRAB_QA_ERRORS__ ||= []).push(String(e.reason?.stack || e.reason || 'rejection')); });
})();
<\/script>`;
function transformHtml(source, relative) {
  let html = source
    .replace(/data-ghrab-access=["']checking["']/gi, 'data-ghrab-access="granted"')
    .replace(/<script\b(?=[^>]*data-ghrab-access-bootstrap)[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/type=["']application\/ghrab-protected["']/gi, 'type="text/javascript"')
    .replace(/\sdata-ghrab-protected(?:=["'][^"']*["'])?/gi, '')
    .replace(/<meta\b[^>]*http-equiv=["'](?:refresh|content-security-policy)["'][^>]*>/gi, '');
  if (/<head\b[^>]*>/i.test(html)) html = html.replace(/<head\b[^>]*>/i, m => `${m}\n${qaPrelude}`);
  else html = html.replace(/<html\b[^>]*>/i, m => `${m}<head>${qaPrelude}</head>`);
  return html.replace(/<base(?=\s|\/?>)[^>]*>/gi, '');
}
const transformSentinel = '<!doctype html><html><head></head><body><script type="application/ghrab-protected" data-ghrab-protected>for(var i=0;i<base.length;i++){base[i]=i;}</script></body></html>';
const transformedSentinel = transformHtml(transformSentinel, 'sentinel.html');
if (!transformedSentinel.includes('i<base.length') || !transformedSentinel.includes('base[i]=i')) {
  throw new Error('Runtime harness poškodil JavaScript při transformaci HTML.');
}
function qaAccessBootstrap(relative) {
  if (relative === 'access-bootstrap.js') {
    return `document.documentElement.dataset.ghrabAccess='granted';window.__GHRAB_STUDIO_ACCESS__={permit:{role:'admin',apps:['${consumer.appId}'],localDevelopment:true}};import('./app.js').catch(e=>{console.error(e);window.__GHRAB_QA_BOOT_ERROR__=String(e?.stack||e)});`;
  }
  return null;
}
const htmlFiles = (await walk(dist)).filter(file => file.toLowerCase().endsWith('.html')).filter(file => {
  const rel = path.relative(dist, file).split(path.sep).join('/');
  return !/(^|\/)(?:tests?|qa-results?|report)(\/|$)/i.test(rel);
}).sort((a,b) => {
  const ar = path.relative(dist,a), br = path.relative(dist,b);
  const ai = path.basename(a) === 'index.html' ? 0 : 1;
  const bi = path.basename(b) === 'index.html' ? 0 : 1;
  return ai - bi || ar.localeCompare(br);
}).filter(file => !configuredPages.length || configuredPages.includes(path.relative(dist,file).split(path.sep).join('/'))).slice(0, maxPages);
if (!htmlFiles.length) throw new Error('V dist nebyla nalezena žádná HTML stránka.');

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (!rel || rel.endsWith('/')) rel += 'index.html';
    rel = path.posix.normalize(rel).replace(/^\.\.\//g, '');
    const file = path.resolve(dist, ...rel.split('/'));
    if (!file.startsWith(dist + path.sep) && file !== dist) { res.writeHead(403); res.end('forbidden'); return; }
    const replacement = qaAccessBootstrap(rel);
    if (replacement !== null) {
      res.writeHead(200, {'content-type':'text/javascript; charset=utf-8','cache-control':'no-store'}); res.end(replacement); return;
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404, {'cache-control':'no-store'}); res.end('not found'); return; }
    if (file.toLowerCase().endsWith('.html')) {
      const source = await fsp.readFile(file, 'utf8');
      res.writeHead(200, {'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
      res.end(transformHtml(source, rel)); return;
    }
    res.writeHead(200, {'content-type':mime(file),'cache-control':'no-store','access-control-allow-origin':'*'});
    fs.createReadStream(file).pipe(res);
  } catch (error) { res.writeHead(500); res.end(String(error?.stack || error)); }
});
await new Promise((resolve,reject) => { server.once('error', reject); server.listen(0,'127.0.0.1',resolve); });
const listenPort = server.address().port;

async function waitJson(url) {
  for (let i=0;i<400;i++) { try { const r=await fetch(url); if (r.ok) return await r.json(); } catch {} await sleep(50); }
  throw new Error('Chromium debug timeout');
}
class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url); this.seq=0; this.pending=new Map(); this.events=[];
    this.ready = new Promise((resolve,reject)=>{this.ws.onopen=resolve;this.ws.onerror=reject;});
    this.ws.onmessage = e => {
      const m=JSON.parse(e.data);
      if(m.id && this.pending.has(m.id)){const p=this.pending.get(m.id);this.pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);return;}
      this.events.push(m);
    };
  }
  async call(method,params={}) { await this.ready; return new Promise((resolve,reject)=>{const id=++this.seq;const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`CDP timeout ${method}`));},30000);this.pending.set(id,{resolve,reject,timer});this.ws.send(JSON.stringify({id,method,params}));}); }
  async eval(expression) { const r=await this.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value; }
  clearEvents(){this.events=[];}
  close(){try{this.ws.close();}catch{}}
}
const debugPort=12100+(process.pid%500), profile=`/tmp/ghrab-p5-runtime-${process.pid}`;
fs.rmSync(profile,{recursive:true,force:true});
const chrome=spawn(chromiumPath(),['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-background-networking','--disable-extensions','--no-first-run','--mute-audio','--remote-allow-origins=*',`--remote-debugging-port=${debugPort}`,`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore',detached:true});
let client;
const pageReports=[];
const auditExpr = `(()=>{
 const issues=[]; const add=(severity,id,el,detail)=>issues.push({severity,id,selector:sel(el),detail});
 const sel=el=>{if(!el)return'document';if(el.id)return'#'+CSS.escape(el.id);const p=[];let n=el;while(n&&n.nodeType===1&&p.length<4){let s=n.tagName.toLowerCase();if(n.classList?.length)s+='.'+[...n.classList].slice(0,2).map(CSS.escape).join('.');p.unshift(s);n=n.parentElement}return p.join(' > ')};
 const text=el=>String(el?.textContent||'').replace(/\\s+/g,' ').trim();
 const visible=el=>{if(!el||!el.isConnected)return false;const s=getComputedStyle(el);if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0)return false;const r=el.getBoundingClientRect();return r.width>0&&r.height>0};
 const name=el=>{const a=el.getAttribute('aria-label');if(a?.trim())return a.trim();const by=el.getAttribute('aria-labelledby');if(by){const t=by.split(/\\s+/).map(id=>text(document.getElementById(id))).filter(Boolean).join(' ');if(t)return t}if(el.id){const l=document.querySelector('label[for="'+CSS.escape(el.id)+'"]');if(l&&text(l))return text(l)}if(el.closest('label')&&text(el.closest('label')))return text(el.closest('label'));if(el.getAttribute('alt'))return el.getAttribute('alt').trim();if(el.getAttribute('title'))return el.getAttribute('title').trim();if(el.tagName==='INPUT'&&['submit','reset','button'].includes((el.type||'').toLowerCase()))return el.value||'';return text(el)};
 if(!document.documentElement.lang?.trim())add('serious','document-lang',document.documentElement,'Chybí jazyk dokumentu.');
 if(!document.title.trim())add('serious','document-title',document.documentElement,'Chybí titul dokumentu.');
 if(!document.querySelector('main,[role="main"]'))add('serious','main-landmark',document.body,'Chybí hlavní landmark.');
 if(!document.querySelector('h1'))add('moderate','page-h1',document.body,'Chybí hlavní nadpis h1.');
 const ids=new Map();document.querySelectorAll('[id]').forEach(el=>{ids.set(el.id,(ids.get(el.id)||0)+1)});for(const [id,c] of ids)if(c>1)add('serious','duplicate-id',document.getElementById(id),'Duplicitní id: '+id+' ('+c+').');
 document.querySelectorAll('img').forEach(el=>{if(!el.hasAttribute('alt'))add('serious','image-alt',el,'Obrázek nemá alt.');});
 document.querySelectorAll('button,a[href],input,select,textarea,[role="button"],[tabindex]').forEach(el=>{if(visible(el)&&!name(el))add('serious','control-name',el,'Viditelný ovládací prvek nemá přístupný název.');});
 document.querySelectorAll('input:not([type="hidden"]),select,textarea').forEach(el=>{if(visible(el)&&!name(el))add('serious','form-label',el,'Formulářový prvek nemá popisek.');});
 document.querySelectorAll('[aria-hidden="true"]').forEach(el=>{const f=el.matches('button,a[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')?el:el.querySelector('button,a[href],input,select,textarea,[tabindex]:not([tabindex="-1"])');if(f&&visible(f))add('serious','aria-hidden-focus',f,'Fokusovatelný prvek je v aria-hidden oblasti.');});
 document.querySelectorAll('[role="dialog"],dialog').forEach(el=>{if(!name(el))add('serious','dialog-name',el,'Dialog nemá přístupný název.');if(visible(el)&&el.getAttribute('aria-modal')!=='true'&&!el.hasAttribute('open'))add('moderate','dialog-modal',el,'Viditelný dialog nemá aria-modal=true.');});
 document.querySelectorAll('a[target="_blank"]').forEach(el=>{if(!/\\bnoopener\\b/i.test(el.getAttribute('rel')||''))add('moderate','noopener',el,'Odkaz target=_blank nemá rel=noopener.');});
 const main=document.querySelector('main,[role="main"]');
 return {issues,domNodes:document.getElementsByTagName('*').length,scriptCount:document.scripts.length,mainTextLength:text(main).length,access:document.documentElement.dataset.ghrabAccess||'',qaErrors:window.__GHRAB_QA_ERRORS__||[],bootError:window.__GHRAB_QA_BOOT_ERROR__||'',ready:document.readyState};
})()`;
const dialogStateExpr = `(()=>{const results=[];const all=[...document.querySelectorAll('[role="dialog"],dialog')];for(const d of all.slice(0,30)){const snapshot={hidden:d.hidden,style:d.getAttribute('style'),class:d.getAttribute('class'),inert:d.inert,ariaHidden:d.getAttribute('aria-hidden'),open:d.hasAttribute('open')};try{d.hidden=false;d.inert=false;d.removeAttribute('aria-hidden');d.setAttribute('aria-modal','true');d.classList.remove('hidden');if(d.tagName==='DIALOG')d.setAttribute('open','');d.style.display=d.tagName==='DIALOG'?'block':'flex';d.style.visibility='visible';d.style.opacity='1';const overflow=Math.max(0,document.documentElement.scrollWidth-document.documentElement.clientWidth,document.body?.scrollWidth-document.documentElement.clientWidth);results.push({id:d.id||'',overflow,width:d.getBoundingClientRect().width,scrollWidth:d.scrollWidth,clientWidth:d.clientWidth});}finally{d.hidden=snapshot.hidden;d.inert=snapshot.inert;if(snapshot.ariaHidden===null)d.removeAttribute('aria-hidden');else d.setAttribute('aria-hidden',snapshot.ariaHidden);if(!snapshot.open)d.removeAttribute('open');if(snapshot.class===null)d.removeAttribute('class');else d.setAttribute('class',snapshot.class);if(snapshot.style===null)d.removeAttribute('style');else d.setAttribute('style',snapshot.style);}}return results;})()`;
try {
  await waitJson(`http://127.0.0.1:${debugPort}/json/version`);
  const targets=await waitJson(`http://127.0.0.1:${debugPort}/json`);
  client=new Cdp(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await client.call('Runtime.enable'); await client.call('Page.enable'); await client.call('Log.enable');
  for (const file of htmlFiles) {
    const rel=path.relative(dist,file).split(path.sep).join('/');
    const widthsReport=[];
    let pageLoaded=false;
    const url=`http://127.0.0.1:${listenPort}/${rel}?qa=1&runtimeAudit=1`;
    for (const width of widths) {
      console.error(`[runtime] ${rel} @ ${width}px`);
      client.clearEvents();
      await client.call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<=390,screenWidth:width,screenHeight:900});
      if (!pageLoaded) {
        await client.call('Page.navigate',{url});
        let ready=false;
        for(let i=0;i<240;i++){ready=Boolean(await client.eval("document.readyState==='complete'&&window.__GHRAB_QA_RUNTIME__===true"));if(ready)break;await sleep(50);}
        if(!ready)throw new Error(`Runtime page timeout: ${rel}`);
        pageLoaded=true;
      } else {
        await client.eval("dispatchEvent(new Event('resize'));document.dispatchEvent(new Event('ghrab:qa-viewport-change'))");
      }
      await sleep(settleMs);
      for (let i=0;i<20;i++) {
        const meaningful = await client.eval(`(()=>{const m=document.querySelector('main,[role=\"main\"]');const s=getComputedStyle(document.body);return Boolean(m&&String(m.textContent||'').replace(/\s+/g,' ').trim().length>0&&s.visibility!=='hidden'&&Number(s.opacity)!==0)})()`);
        if (meaningful) break;
        await sleep(50);
      }
      const audit=await client.eval(auditExpr);
      const layout=await client.eval(`(()=>{const de=document.documentElement,b=document.body;const offenders=[...document.querySelectorAll('*')].map(el=>{const r=el.getBoundingClientRect();return {tag:el.tagName,id:el.id||'',cls:String(el.className||'').slice(0,120),left:Math.round(r.left),right:Math.round(r.right),width:Math.round(r.width),scrollWidth:el.scrollWidth,clientWidth:el.clientWidth};}).filter(x=>x.right>innerWidth+1||x.left<-1||x.scrollWidth>x.clientWidth+1).sort((a,b)=>(b.right-innerWidth)-(a.right-innerWidth)).slice(0,20);return {viewport:innerWidth,scrollWidth:Math.max(de.scrollWidth,b?.scrollWidth||0),clientWidth:de.clientWidth,overflow:Math.max(0,de.scrollWidth-de.clientWidth,(b?.scrollWidth||0)-de.clientWidth),bodyVisibility:getComputedStyle(document.body).visibility,bodyOpacity:getComputedStyle(document.body).opacity,activeElement:document.activeElement?.tagName||'',offenders};})()`);
      const dialogs=await client.eval(dialogStateExpr);
      const exceptions=client.events.filter(e=>e.method==='Runtime.exceptionThrown').map(e=>e.params?.exceptionDetails?.exception?.description||e.params?.exceptionDetails?.text||'exception');
      widthsReport.push({width,url,audit,layout,dialogs,exceptions});
    }
    pageReports.push({page:rel,widths:widthsReport});
  }
} finally {
  client?.close(); server.close();
  if(chrome.exitCode===null){try{process.kill(-chrome.pid,'SIGTERM')}catch{}}
  await Promise.race([new Promise(resolve=>chrome.once('exit',resolve)),sleep(1500)]);
  if(chrome.exitCode===null){try{process.kill(-chrome.pid,'SIGKILL')}catch{}}
  await sleep(100); fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
const issueRows=pageReports.flatMap(p=>p.widths.flatMap(w=>w.audit.issues.map(i=>({...i,page:p.page,width:w.width}))));
const exceptionRows=pageReports.flatMap(p=>p.widths.flatMap(w=>w.exceptions.map(detail=>({page:p.page,width:w.width,detail}))));
const qaErrorRows=pageReports.flatMap(p=>p.widths.flatMap(w=>(w.audit.qaErrors||[]).map(detail=>({page:p.page,width:w.width,detail}))));
const overflowRows=pageReports.flatMap(p=>p.widths.filter(w=>w.layout.overflow>1||w.dialogs.some(d=>d.overflow>1)).map(w=>({page:p.page,width:w.width,baseline:w.layout.overflow,dialogs:w.dialogs.filter(d=>d.overflow>1)})));
const initFailures=pageReports.flatMap(p=>p.widths.filter(w=>w.audit.scriptCount<1||w.audit.mainTextLength<1||w.audit.access==='denied'||w.layout.bodyVisibility==='hidden'||Number(w.layout.bodyOpacity)===0||w.audit.bootError).map(w=>({page:p.page,width:w.width,audit:w.audit,layout:w.layout})));
const severity={critical:0,serious:0,moderate:0,minor:0};for(const i of issueRows)severity[i.severity]=(severity[i.severity]||0)+1;
const blockers=severity.critical+severity.serious+overflowRows.length+initFailures.length+exceptionRows.length;
const report={schema:'ghrab-p5-runtime-audit-v2',appId:consumer.appId,appVersion:consumer.appVersion,chromium:chromiumPath(),scriptsExecuted:true,transport:'local-http',protectedScriptsUnlocked:true,viewportWidths:widths,pagesScanned:pageReports.length,statesScanned:pageReports.length*widths.length+pageReports.reduce((n,p)=>n+p.widths.reduce((m,w)=>m+w.dialogs.length,0),0),summary:{...severity,overflows:overflowRows.length,initFailures:initFailures.length,browserExceptions:exceptionRows.length,qaErrors:qaErrorRows.length,blockers},status:blockers?'failed':'passed',issues:issueRows,overflows:overflowRows,initFailures,browserExceptions:exceptionRows,qaErrors:qaErrorRows,pages:pageReports};
await fsp.writeFile(outPath,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({schema:report.schema,appId:report.appId,appVersion:report.appVersion,status:report.status,pagesScanned:report.pagesScanned,statesScanned:report.statesScanned,summary:report.summary},null,2));
if(blockers)process.exitCode=1;

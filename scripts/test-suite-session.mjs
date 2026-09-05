#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const root = path.resolve('.');
const dist = path.join(root, 'dist');
const output = path.join(dist, 'qa-suite-session-report.json');
const APP_URL = '?qa=1';
const GEN_KEY = 'ghrab.platform.suite-session-generation.v1';
const SEEN_KEY = 'ghrab.lesson-hub.suite-session-seen.v1';
const PROGRESS_KEY = 'ghrab.lesson-hub.suite-session-progress.v1';
const DRAFT_KEY = 'ghrab.lesson-hub.lesson-draft.v1.qa-canary';
const BACKUP_KEY = 'ghrab.lesson-hub.migration.p2-storage-namespace-v1.backup';
const SESSION_KEY = 'ghrab.lesson-hub.server-session.v1';
const DB_NAME = 'lesson-hub-db';
const CANARY = 'SYNTHETIC-GHRAB-SUITE-CANARY-2026';

function managedUrlBlockReason() {
  for (const file of ['/etc/chromium/policies/managed/000_policy_merge.json', '/etc/opt/chrome/policies/managed/000_policy_merge.json']) {
    if (!fs.existsSync(file)) continue;
    try {
      const policy = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(policy.URLBlocklist) && policy.URLBlocklist.includes('*')) return `Managed Chromium URLBlocklist blocks local test pages (${file}).`;
    } catch {}
  }
  return '';
}

if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('Nejprve vytvořte dist pomocí npm run build.');
const managedBlock = managedUrlBlockReason();
if (managedBlock) {
  const report = {
    schema: 'ghrab-suite-session-browser-test-v1',
    appId: 'lesson-hub',
    appVersion: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version,
    platformVersion: '1.1.2',
    syntheticCanary: CANARY,
    status: 'not-tested',
    reason: managedBlock,
    scenarios: { openChild: 'NOT TESTED', delayedOpenReplay: 'NOT TESTED', multiTab: 'NOT TESTED', browserBackForward: 'NOT TESTED', failClosed: 'NOT TESTED', negativeControl: 'NOT TESTED', trustBoundaryProbe: 'NOT TESTED' },
    requiredFollowUp: 'Run this browser suite in CI/E2E Chromium without URLBlocklist before release approval.',
  };
  await fsp.writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

function chromiumPath() {
  for (const candidate of [process.env.CHROMIUM_PATH, '/usr/bin/chromium', '/usr/lib/chromium/chromium', '/usr/bin/google-chrome'].filter(Boolean)) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Chromium není dostupné.');
}

function mime(file) {
  return ({
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  })[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

async function startServer(rootDir) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (url.pathname === '/__qa_coordinator.html') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end('<!doctype html><html><head><meta charset="utf-8"><title>Suite coordinator QA</title></head><body>coordinator</body></html>');
        return;
      }
      let relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
      let target = path.resolve(rootDir, relative);
      if (target !== rootDir && !target.startsWith(`${rootDir}${path.sep}`)) { res.writeHead(403).end('forbidden'); return; }
      try { if ((await fsp.stat(target)).isDirectory()) target = path.join(target, 'index.html'); }
      catch { if (!path.extname(relative)) target = path.join(rootDir, 'index.html'); }
      const body = await fsp.readFile(target);
      res.writeHead(200, { 'content-type': mime(target), 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      res.end('not found');
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  return { server, baseUrl: `http://127.0.0.1:${port}/` };
}

async function waitJson(url, attempts = 300) {
  for (let index = 0; index < attempts; index += 1) {
    try { const response = await fetch(url); if (response.ok) return await response.json(); } catch {}
    await sleep(40);
  }
  throw new Error(`Timeout při čekání na ${url}`);
}

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.seq = 0;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; });
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
      else pending.resolve(message.result);
    };
  }
  async call(method, params = {}) {
    await this.ready;
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const result = await this.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate selhal.');
    return result.result?.value;
  }
  close() { try { this.ws.close(); } catch {} }
}

async function launchBrowser() {
  const profile = await fsp.mkdtemp(path.join(os.tmpdir(), 'lesson-hub-suite-'));
  const port = 10200 + Math.floor(Math.random() * 1800);
  const chrome = spawn(chromiumPath(), [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-background-networking', '--no-first-run', '--enable-automation',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore', detached: true });
  const version = await waitJson(`http://127.0.0.1:${port}/json/version`);
  const browser = new Cdp(version.webSocketDebuggerUrl);
  return { chrome, profile, port, browser };
}

async function closeBrowser(instance) {
  instance.browser?.close();
  if (instance.chrome?.exitCode === null) { try { process.kill(-instance.chrome.pid, 'SIGTERM'); } catch {} }
  await Promise.race([new Promise((resolve) => instance.chrome?.once('exit', resolve)), sleep(1200)]);
  if (instance.chrome?.exitCode === null) { try { process.kill(-instance.chrome.pid, 'SIGKILL'); } catch {} }
  await sleep(80);
  await fsp.rm(instance.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 80 });
}

async function pageForTarget(port, targetId) {
  for (let index = 0; index < 120; index += 1) {
    const pages = await waitJson(`http://127.0.0.1:${port}/json`);
    const page = pages.find((item) => item.id === targetId && item.type === 'page' && item.webSocketDebuggerUrl);
    if (page) return page;
    await sleep(25);
  }
  throw new Error('Page target nebyl zpřístupněn přes CDP.');
}

async function createPage(instance, url = 'about:blank') {
  const { targetId } = await instance.browser.call('Target.createTarget', { url });
  const target = await pageForTarget(instance.port, targetId);
  const client = new Cdp(target.webSocketDebuggerUrl);
  await client.call('Page.enable');
  await client.call('Runtime.enable');
  return { targetId, client };
}

async function closePage(instance, page) {
  page.client?.close();
  try { await instance.browser.call('Target.closeTarget', { targetId: page.targetId }); } catch {}
}

async function navigate(client, url) {
  await client.call('Page.navigate', { url });
  for (let index = 0; index < 300; index += 1) {
    const ready = await client.eval("document.readyState === 'complete'").catch(() => false);
    if (ready) return;
    await sleep(30);
  }
  throw new Error(`Navigace nedokončena: ${url}`);
}

async function waitFor(client, expression, label, attempts = 320) {
  for (let index = 0; index < attempts; index += 1) {
    if (await client.eval(`Boolean(${expression})`).catch(() => false)) return;
    await sleep(30);
  }
  const debug = await client.eval(`({href:location.href,access:document.documentElement.dataset.ghrabAccess,suite:document.documentElement.dataset.ghrabSuiteSession,body:document.body.innerText.slice(0,500),generation:localStorage.getItem(${JSON.stringify(GEN_KEY)}),seen:localStorage.getItem(${JSON.stringify(SEEN_KEY)}),progress:localStorage.getItem(${JSON.stringify(PROGRESS_KEY)})})`).catch(() => ({}));
  throw new Error(`${label}: timeout ${JSON.stringify(debug)}`);
}

async function waitAppReady(client) {
  await waitFor(client, `window.GHRAB_PLATFORM?.version === '1.1.2' && document.documentElement.dataset.ghrabAccess === 'granted' && document.querySelector('#app')?.children?.length > 0`, 'Lesson Hub ready');
}

async function seedCanaries(client, suffix = '') {
  return client.eval(`(async()=>{
    const suffix=${JSON.stringify(suffix)};
    localStorage.setItem(${JSON.stringify(DRAFT_KEY)}, JSON.stringify({schema:'qa-canary',value:${JSON.stringify(CANARY)},suffix}));
    localStorage.setItem(${JSON.stringify(BACKUP_KEY)}, JSON.stringify({schema:'qa-migration-backup',entries:[{value:${JSON.stringify(CANARY)}}],suffix}));
    sessionStorage.setItem(${JSON.stringify(SESSION_KEY)}, JSON.stringify({token:'synthetic-token-'+suffix,user:{id:'synthetic-user'}}));
    await new Promise((resolve,reject)=>{
      const request=indexedDB.open(${JSON.stringify(DB_NAME)});
      request.onerror=()=>reject(request.error||new Error('open failed'));
      request.onsuccess=()=>{
        const db=request.result;
        try{
          const tx=db.transaction('appMeta','readwrite');
          tx.objectStore('appMeta').put({key:'suite-canary',value:${JSON.stringify(CANARY)},suffix,updatedAt:new Date().toISOString()});
          tx.oncomplete=()=>{db.close();resolve(true)};
          tx.onerror=()=>{db.close();reject(tx.error||new Error('tx failed'))};
        }catch(e){db.close();reject(e)}
      };
    });
    return true;
  })()`);
}

async function instrumentAckOrder(client) {
  return client.eval(`(()=>{
    window.__suiteWriteEvents=[];
    const original=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){
      try{window.__suiteWriteEvents.push({key:String(key),value:String(value),at:performance.now()})}catch{}
      return original.call(this,key,value);
    };
    return true;
  })()`);
}

async function triggerSuiteEnd(client, reason) {
  return client.eval(`(()=>window.GHRAB_PLATFORM.session.end({reason:${JSON.stringify(reason)},clearApplicationData:true}))()`);
}

async function cleanupSnapshot(client, generation) {
  return client.eval(`(async()=>{
    const generation=${JSON.stringify(generation)};
    const progressRaw=localStorage.getItem(${JSON.stringify(PROGRESS_KEY)});
    let progress=null; try{progress=JSON.parse(progressRaw||'null')}catch{}
    const dbs=typeof indexedDB.databases==='function'?await indexedDB.databases():[];
    const dbPresent=dbs.some(db=>db.name===${JSON.stringify(DB_NAME)});
    let dbCanary=null;
    if(dbPresent){
      dbCanary=await new Promise((resolve)=>{
        const request=indexedDB.open(${JSON.stringify(DB_NAME)});
        request.onerror=()=>resolve({qaReadError:String(request.error?.message||'open-failed')});
        request.onsuccess=()=>{
          const db=request.result;
          try{
            if(!db.objectStoreNames.contains('appMeta')){db.close();resolve(null);return;}
            const tx=db.transaction('appMeta','readonly');
            const get=tx.objectStore('appMeta').get('suite-canary');
            get.onsuccess=()=>{const value=get.result??null;db.close();resolve(value)};
            get.onerror=()=>{const message=String(get.error?.message||'read-failed');db.close();resolve({qaReadError:message})};
          }catch(error){db.close();resolve({qaReadError:String(error?.message||error)})}
        };
      });
    }
    const events=window.__suiteWriteEvents||[];
    const completedIndex=events.findIndex(e=>e.key===${JSON.stringify(PROGRESS_KEY)}&&(()=>{try{return JSON.parse(e.value).status==='cleanup-completed'}catch{return false}})());
    const ackIndex=events.findIndex(e=>e.key===${JSON.stringify(SEEN_KEY)}&&e.value===generation);
    return {
      generation,
      draft:localStorage.getItem(${JSON.stringify(DRAFT_KEY)}),
      backup:localStorage.getItem(${JSON.stringify(BACKUP_KEY)}),
      session:sessionStorage.getItem(${JSON.stringify(SESSION_KEY)}),
      seen:localStorage.getItem(${JSON.stringify(SEEN_KEY)}),
      progress,
      dbPresent,
      dbCanary,
      ended:document.documentElement.dataset.ghrabSuiteSession==='ended',
      blocked:Boolean(window.__LESSON_HUB_PERSISTENCE_BLOCKED__),
      completedIndex,ackIndex,
    };
  })()`);
}

function requireCheck(condition, message, detail = null) {
  if (!condition) throw new Error(`${message}${detail == null ? '' : `: ${JSON.stringify(detail)}`}`);
}

async function openChildScenario(rootDir, { expectSuccess = true } = {}) {
  const { server, baseUrl } = await startServer(rootDir);
  const browser = await launchBrowser();
  let page;
  try {
    page = await createPage(browser);
    await navigate(page.client, `${baseUrl}${APP_URL}`);
    await waitAppReady(page.client);
    await seedCanaries(page.client, 'open');
    await instrumentAckOrder(page.client);
    const end = await triggerSuiteEnd(page.client, 'qa-open-child');
    requireCheck(end?.ok === true && end.generation, 'Suite coordinator nevytvořil generation', end);
    if (!expectSuccess) {
      await sleep(900);
      const snapshot = await cleanupSnapshot(page.client, end.generation);
      requireCheck(snapshot.draft !== null && snapshot.seen !== end.generation, 'Negative control neočekávaně prošel', snapshot);
      return { status: 'expected-fail-observed', generation: end.generation, snapshot };
    }
    await waitFor(page.client, `localStorage.getItem(${JSON.stringify(SEEN_KEY)}) === ${JSON.stringify(end.generation)} && JSON.parse(localStorage.getItem(${JSON.stringify(PROGRESS_KEY)})||'null')?.status === 'cleanup-completed'`, 'open-child acknowledgement');
    const snapshot = await cleanupSnapshot(page.client, end.generation);
    requireCheck(snapshot.draft === null && snapshot.backup === null && snapshot.session === null, 'Open-child storage canary zůstal', snapshot);
    requireCheck(snapshot.dbCanary === null, 'Open-child IndexedDB canary zůstal', snapshot);
    requireCheck(snapshot.seen === end.generation && snapshot.progress?.generation === end.generation, 'Open-child acknowledgement nesedí', snapshot);
    requireCheck(snapshot.completedIndex >= 0 && snapshot.ackIndex > snapshot.completedIndex, 'Acknowledgement vznikl dříve než cleanup-completed evidence', snapshot);
    requireCheck(snapshot.ended && snapshot.blocked, 'Otevřený kontext nebyl po suite end uzamčen', snapshot);
    return { status: 'passed', generation: end.generation, snapshot };
  } finally {
    if (page) await closePage(browser, page);
    await closeBrowser(browser);
    await new Promise((resolve) => server.close(resolve));
  }
}

async function delayedOpenScenario(rootDir) {
  const { server, baseUrl } = await startServer(rootDir);
  const browser = await launchBrowser();
  let first, coordinator, reopened;
  try {
    first = await createPage(browser);
    await navigate(first.client, `${baseUrl}${APP_URL}`);
    await waitAppReady(first.client);
    await seedCanaries(first.client, 'delayed');
    await closePage(browser, first); first = null;

    coordinator = await createPage(browser);
    await navigate(coordinator.client, `${baseUrl}__qa_coordinator.html`);
    const generation = `qa-delayed-${Date.now()}-synthetic`;
    await coordinator.client.eval(`(()=>{localStorage.removeItem(${JSON.stringify(SEEN_KEY)});localStorage.setItem(${JSON.stringify(GEN_KEY)},${JSON.stringify(generation)});return true})()`);
    await closePage(browser, coordinator); coordinator = null;

    reopened = await createPage(browser);
    await navigate(reopened.client, `${baseUrl}${APP_URL}`);
    await waitFor(reopened.client, `localStorage.getItem(${JSON.stringify(SEEN_KEY)}) === ${JSON.stringify(generation)} && JSON.parse(localStorage.getItem(${JSON.stringify(PROGRESS_KEY)})||'null')?.status === 'cleanup-completed'`, 'delayed-open replay');
    const firstSnapshot = await cleanupSnapshot(reopened.client, generation);
    requireCheck(firstSnapshot.draft === null && firstSnapshot.backup === null && firstSnapshot.dbCanary === null, 'Delayed-open canary zůstal', firstSnapshot);
    const progressBefore = await reopened.client.eval(`localStorage.getItem(${JSON.stringify(PROGRESS_KEY)})`);

    await reopened.client.call('Page.reload', { ignoreCache: true });
    await waitAppReady(reopened.client);
    const progressAfter = await reopened.client.eval(`localStorage.getItem(${JSON.stringify(PROGRESS_KEY)})`);
    const stateAfter = await reopened.client.eval(`({ended:document.documentElement.dataset.ghrabSuiteSession||'',access:document.documentElement.dataset.ghrabAccess,blocked:Boolean(window.__LESSON_HUB_PERSISTENCE_BLOCKED__)})`);
    requireCheck(progressAfter === progressBefore, 'Reload po acknowledgement zbytečně zopakoval cleanup evidence', { progressBefore, progressAfter });
    requireCheck(stateAfter.ended !== 'ended' && stateAfter.access === 'granted' && stateAfter.blocked === false, 'Nový dokument po acknowledgement zůstal chybně zablokovaný', stateAfter);
    return { status: 'passed', generation, firstSnapshot, reload: stateAfter };
  } finally {
    for (const page of [first, coordinator, reopened].filter(Boolean)) await closePage(browser, page);
    await closeBrowser(browser);
    await new Promise((resolve) => server.close(resolve));
  }
}

async function multiTabScenario(rootDir) {
  const { server, baseUrl } = await startServer(rootDir);
  const browser = await launchBrowser();
  let one, two;
  try {
    one = await createPage(browser); two = await createPage(browser);
    await Promise.all([navigate(one.client, `${baseUrl}${APP_URL}`), navigate(two.client, `${baseUrl}${APP_URL}`)]);
    await Promise.all([waitAppReady(one.client), waitAppReady(two.client)]);
    await seedCanaries(one.client, 'multi');
    await two.client.eval(`sessionStorage.setItem(${JSON.stringify(SESSION_KEY)},JSON.stringify({token:'synthetic-tab-2'}))`);
    const tabTwoNonce = `qa-multi-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await two.client.eval(`(async()=>{window.__suiteMultiNonce=${JSON.stringify(tabTwoNonce)};const m=await import('/src/core/draftStorage.js');setTimeout(()=>{window.__lateDraftResult=m.saveLessonDraft(${JSON.stringify(DRAFT_KEY)},{value:${JSON.stringify(CANARY)},late:true})},650);return true})()`);
    const end = await triggerSuiteEnd(one.client, 'qa-multi-tab');
    requireCheck(end?.ok === true, 'Multi-tab suite end nevznikl', end);
    await Promise.all([
      waitFor(one.client, `document.documentElement.dataset.ghrabSuiteSession === 'ended'`, 'multi-tab first locked'),
      waitFor(two.client, `document.documentElement.dataset.ghrabSuiteSession === 'ended'`, 'multi-tab second locked'),
    ]);
    await waitFor(one.client, `localStorage.getItem(${JSON.stringify(SEEN_KEY)}) === ${JSON.stringify(end.generation)}`, 'multi-tab ack');
    await sleep(850);
    const [snapOne, snapTwo, lateState] = await Promise.all([
      cleanupSnapshot(one.client, end.generation),
      cleanupSnapshot(two.client, end.generation),
      two.client.eval(`({late:window.__lateDraftResult||null,sameDocument:window.__suiteMultiNonce===${JSON.stringify(tabTwoNonce)}})`),
    ]);
    requireCheck(snapOne.draft === null && snapTwo.draft === null && snapOne.backup === null && snapTwo.backup === null && snapOne.dbCanary === null && snapTwo.dbCanary === null, 'Multi-tab canary se obnovil', { snapOne, snapTwo });
    requireCheck(snapOne.session === null && snapTwo.session === null, 'Multi-tab sessionStorage nebylo uklizeno v obou kartách', { snapOne, snapTwo });
    requireCheck(lateState?.sameDocument === false || lateState?.late?.blocked === true, 'Stale autosave nebyl po suite end odmítnut ani bezpečně zrušen navigací/reloadem', lateState);
    return { status: 'passed', generation: end.generation, tabOne: snapOne, tabTwo: snapTwo, lateAutosave: lateState?.late || null, staleContextSurvived: lateState?.sameDocument === true };
  } finally {
    for (const page of [one, two].filter(Boolean)) await closePage(browser, page);
    await closeBrowser(browser);
    await new Promise((resolve) => server.close(resolve));
  }
}

async function historyScenario(rootDir) {
  const { server, baseUrl } = await startServer(rootDir);
  const browser = await launchBrowser();
  let page;
  try {
    page = await createPage(browser);
    await navigate(page.client, `${baseUrl}${APP_URL}`);
    await waitAppReady(page.client);
    await seedCanaries(page.client, 'history');
    await navigate(page.client, `${baseUrl}__qa_coordinator.html`);
    const generation = `qa-history-${Date.now()}-synthetic`;
    await page.client.eval(`(()=>{localStorage.removeItem(${JSON.stringify(SEEN_KEY)});localStorage.setItem(${JSON.stringify(GEN_KEY)},${JSON.stringify(generation)});return true})()`);
    await page.client.eval('history.back()');
    await waitFor(page.client, `location.search.includes('qa=1')`, 'history back returned to child');
    await waitFor(page.client, `localStorage.getItem(${JSON.stringify(SEEN_KEY)}) === ${JSON.stringify(generation)} && document.documentElement.dataset.ghrabSuiteSession === 'ended'`, 'history cleanup');
    const snapshot = await cleanupSnapshot(page.client, generation);
    requireCheck(snapshot.draft === null && snapshot.backup === null && snapshot.dbCanary === null, 'Browser Back obnovil starý canary', snapshot);
    return { status: 'passed', generation, snapshot };
  } finally {
    if (page) await closePage(browser, page);
    await closeBrowser(browser);
    await new Promise((resolve) => server.close(resolve));
  }
}

async function failClosedScenario(rootDir) {
  const { server, baseUrl } = await startServer(rootDir);
  const browser = await launchBrowser();
  let page;
  try {
    page = await createPage(browser);
    await navigate(page.client, `${baseUrl}${APP_URL}`);
    await waitAppReady(page.client);
    await seedCanaries(page.client, 'fail-closed');
    await page.client.eval(`(()=>{const original=Storage.prototype.removeItem;Storage.prototype.removeItem=function(key){if(String(key)===${JSON.stringify(DRAFT_KEY)})throw new Error('synthetic-delete-failure');return original.call(this,key)};return true})()`);
    const end = await triggerSuiteEnd(page.client, 'qa-fail-closed');
    requireCheck(end?.ok === true, 'Fail-closed suite generation nevznikl', end);
    await waitFor(page.client, `JSON.parse(localStorage.getItem(${JSON.stringify(PROGRESS_KEY)})||'null')?.status === 'cleanup-failed'`, 'fail-closed evidence');
    const snapshot = await cleanupSnapshot(page.client, end.generation);
    requireCheck(snapshot.seen !== end.generation, 'Cleanup selhal, ale acknowledgement byl přesto zapsán', snapshot);
    requireCheck(snapshot.draft !== null, 'Synteticky neodstranitelný canary neočekávaně zmizel', snapshot);
    requireCheck(snapshot.progress?.status === 'cleanup-failed' && snapshot.blocked, 'Fail-closed stav nebyl zachován', snapshot);
    return { status: 'passed', generation: end.generation, snapshot };
  } finally {
    if (page) await closePage(browser, page);
    await closeBrowser(browser);
    await new Promise((resolve) => server.close(resolve));
  }
}

async function trustBoundaryProbe(rootDir) {
  const { server, baseUrl } = await startServer(rootDir);
  const browser = await launchBrowser();
  let page;
  try {
    page = await createPage(browser);
    await navigate(page.client, `${baseUrl}__qa_coordinator.html`);
    const result = await page.client.eval(`(()=>{
      const generation='qa-forged-suite-'+Date.now();
      const forgedAck='qa-forged-other-ack';
      let globalWrite=false,otherAckWrite=false;
      try{localStorage.setItem(${JSON.stringify(GEN_KEY)},generation);globalWrite=localStorage.getItem(${JSON.stringify(GEN_KEY)})===generation}catch{}
      try{localStorage.setItem('ghrab.synthetic-other-app.suite-session-seen.v1',forgedAck);otherAckWrite=localStorage.getItem('ghrab.synthetic-other-app.suite-session-seen.v1')===forgedAck}catch{}
      return {globalWrite,otherAckWrite};
    })()`);
    requireCheck(result.globalWrite && result.otherAckWrite, 'F-03 trust-boundary probe nedoložil očekávanou same-origin zapisovatelnost', result);
    return { status: 'confirmed-ecosystem-risk', ...result };
  } finally {
    if (page) await closePage(browser, page);
    await closeBrowser(browser);
    await new Promise((resolve) => server.close(resolve));
  }
}

async function manifestParity() {
  const manifest = JSON.parse(await fsp.readFile(path.join(root, 'src/config/data-manifest.json'), 'utf8'));
  const module = await import(new URL('../src/core/suiteSession.js', import.meta.url));
  const indexed = manifest.stores.filter((item) => item.kind === 'indexedDB' && item.clearOnEndWork).flatMap((item) => item.names || []);
  requireCheck(indexed.includes(DB_NAME), 'Data manifest nepokrývá skutečnou IndexedDB lesson-hub-db', indexed);
  requireCheck(JSON.stringify(module.INDEXED_DB_NAMES_CLEAR_ON_END_WORK) === JSON.stringify([DB_NAME]), 'Runtime cleanup a manifest se rozcházejí v IndexedDB', module.INDEXED_DB_NAMES_CLEAR_ON_END_WORK);
  const nonClear = manifest.stores.filter((item) => item.clearOnEndWork === false).flatMap((item) => item.patterns || []);
  for (const key of [GEN_KEY, SEEN_KEY, PROGRESS_KEY]) requireCheck(nonClear.includes(key), `Lifecycle key ${key} musí být v manifestu explicitně clearOnEndWork:false`, nonClear);
  return { status: 'passed', indexedDB: indexed, lifecyclePreserved: [GEN_KEY, SEEN_KEY, PROGRESS_KEY] };
}

async function negativeControl() {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'lesson-hub-negative-control-'));
  try {
    await fsp.cp(dist, tempRoot, { recursive: true });
    const suiteFile = path.join(tempRoot, 'src', 'core', 'suiteSession.js');
    let source = await fsp.readFile(suiteFile, 'utf8');
    const original = "removePlatformHandler = session.onEnd((detail) => performCleanup(detail), { replay: true });";
    requireCheck(source.includes(original), 'Negative control nenašel suite-session handler v dist.');
    source = source.replace(original, "removePlatformHandler = () => {}; // QA NEGATIVE CONTROL: handler intentionally disabled");
    await fsp.writeFile(suiteFile, source);
    return await openChildScenario(tempRoot, { expectSuccess: false });
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 80 });
  }
}

const startedAt = new Date().toISOString();
const scenarios = {};
let failed = null;
try {
  scenarios.manifestParity = await manifestParity();
  scenarios.openChild = await openChildScenario(dist);
  scenarios.delayedOpenReplay = await delayedOpenScenario(dist);
  scenarios.multiTab = await multiTabScenario(dist);
  scenarios.browserBack = await historyScenario(dist);
  scenarios.failClosed = await failClosedScenario(dist);
  scenarios.negativeControl = await negativeControl();
  scenarios.f03TrustBoundary = await trustBoundaryProbe(dist);
} catch (error) {
  failed = error?.stack || String(error);
}

const report = {
  schema: 'lesson-hub-suite-session-qa-v1', appId: 'lesson-hub', appVersion: '1.2.17', platformVersion: '1.1.2',
  contract: 'ghrab-suite-session-v1', syntheticDataOnly: true, startedAt, finishedAt: new Date().toISOString(),
  scenarios, status: failed ? 'failed' : 'passed', failure: failed,
};
await fsp.writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (failed) process.exit(1);

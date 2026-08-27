#!/usr/bin/env node
import { existsSync, rmSync, statSync } from 'node:fs';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const root = path.resolve('.');
const dist = path.join(root, 'dist');
const out = path.join(dist, 'qa-p3-axe-report.json');
const requestedVersion = '4.12.1';
const required = process.env.AXE_REQUIRED === '1';
const consumer = JSON.parse(await readFile(path.join(root, 'ghrab-platform.consumer.json'), 'utf8'));
const axePkgPath = path.join(root, 'node_modules', 'axe-core', 'package.json');
const axePath = path.join(root, 'node_modules', 'axe-core', 'axe.min.js');
let installedVersion = '';
try { installedVersion = JSON.parse(await readFile(axePkgPath, 'utf8')).version || ''; } catch {}

async function finish(report, code = 0) {
  await writeFile(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (code) process.exitCode = code;
}

if (installedVersion !== requestedVersion || !existsSync(axePath)) {
  await finish({
    schema: 'ghrab-p3-axe-result-v1',
    appId: consumer.appId,
    appVersion: consumer.appVersion,
    requestedVersion,
    installedVersion: installedVersion || null,
    status: required ? 'failed' : 'not-ready-environment',
    pages: [],
    summary: { scanned: 0, critical: 0, serious: 0, moderate: 0, minor: 0 },
    note: 'CI musí nainstalovat přesně axe-core@4.12.1. Nezajištěný CDN runtime není povolen.',
  }, required ? 1 : 0);
  process.exit(required ? 1 : 0);
}

function chromiumPath() {
  for (const candidate of [process.env.CHROMIUM_PATH, '/usr/lib/chromium/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].filter(Boolean)) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('Chromium není dostupné');
}
async function waitJson(url) {
  for (let i = 0; i < 180; i += 1) {
    try { const response = await fetch(url); if (response.ok) return await response.json(); } catch {}
    await sleep(50);
  }
  throw new Error('Chromium debug timeout');
}
class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url); this.seq = 0; this.pending = new Map();
    this.ready = new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; });
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id); this.pending.delete(message.id);
        message.error ? pending.reject(new Error(JSON.stringify(message.error))) : pending.resolve(message.result);
      }
    };
  }
  async call(method, params = {}) {
    await this.ready;
    return new Promise((resolve, reject) => {
      const id = ++this.seq; this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const response = await this.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    return response.result?.value;
  }
  close() { try { this.ws.close(); } catch {} }
}
async function walk(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(target));
    else result.push(target);
  }
  return result;
}
function escapeScript(source) { return source.replace(/<\/script/gi, '<\\/script'); }
function injectLocalStyles(html, htmlFile) {
  return html.replace(/<link\b([^>]*?)rel=["']stylesheet["']([^>]*?)>/gi, (tag) => {
    const match = tag.match(/href=["']([^"']+)["']/i);
    if (!match || /^(?:https?:|\/\/|data:|blob:)/i.test(match[1])) return '';
    const clean = match[1].split(/[?#]/)[0];
    const target = path.resolve(path.dirname(htmlFile), clean);
    if (!target.startsWith(dist) || !existsSync(target) || !statSync(target).isFile()) return '';
    try { return `<style data-ghrab-axe-inline="${clean.replace(/"/g, '&quot;')}">${requireRead(target)}</style>`; } catch { return ''; }
  });
}
function requireRead(file) {
  return globalThis.__ghrabFileCache.get(file) || '';
}
const files = (await walk(dist)).filter((file) => file.toLowerCase().endsWith('.html'));
const fullHtml = [];
for (const file of files) {
  const text = await readFile(file, 'utf8');
  if (/<html\b[^>]*>[\s\S]*<\/html>/i.test(text)) fullHtml.push({ file, text });
}
// Keep the gate deterministic and bounded while covering the entry page and every independent engine/page.
const selected = fullHtml
  .sort((a, b) => (path.basename(a.file) === 'index.html' ? -1 : 0) - (path.basename(b.file) === 'index.html' ? -1 : 0) || a.file.localeCompare(b.file))
  .slice(0, 40);

globalThis.__ghrabFileCache = new Map();
for (const { file, text } of selected) {
  for (const match of text.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi)) {
    if (/^(?:https?:|\/\/|data:|blob:)/i.test(match[1])) continue;
    const target = path.resolve(path.dirname(file), match[1].split(/[?#]/)[0]);
    if (target.startsWith(dist) && existsSync(target) && statSync(target).isFile()) {
      try { globalThis.__ghrabFileCache.set(target, await readFile(target, 'utf8')); } catch {}
    }
  }
}

const platformJs = escapeScript((await readFile(path.join(dist, 'ghrab', 'ghrab-platform.js'), 'utf8'))
  .replace("new URL('./ghrab/ghrab-platform.js', location.href)", "new URL('https://example.test/app/ghrab/ghrab-platform.js')"));
const platformCss = await readFile(path.join(dist, 'ghrab', 'ghrab-platform.css'), 'utf8');
const axeSource = escapeScript(await readFile(axePath, 'utf8'));
const platformConfig = {
  appId: consumer.appId,
  appVersion: consumer.appVersion,
  requiredPlatformRange: consumer.platform.requiredRange || '>=1.1.0 <2.0.0',
  supportedThemeModes: ['light', 'dark', 'system'],
  defaultTheme: 'system',
  autoFooter: false,
};
const memory = `<script>(()=>{class M{constructor(){this.m=new Map()}get length(){return this.m.size}key(i){return [...this.m.keys()][i]??null}getItem(k){return this.m.has(String(k))?this.m.get(String(k)):null}setItem(k,v){this.m.set(String(k),String(v))}removeItem(k){this.m.delete(String(k))}clear(){this.m.clear()}};Object.defineProperty(window,'localStorage',{value:new M(),configurable:true});Object.defineProperty(window,'sessionStorage',{value:new M(),configurable:true});window.matchMedia=window.matchMedia||(()=>({matches:false,addEventListener(){},removeEventListener(){}}));})();<\/script>`;

function prepareHtml(source, htmlFile) {
  let html = source
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<script\b[^>]*\/?>/gi, '')
    .replace(/<meta\b[^>]*http-equiv=["'](?:refresh|content-security-policy)["'][^>]*>/gi, '')
    .replace(/\s(?:src|srcset)=["'](?:https?:|\/\/)[^"']*["']/gi, '')
    .replace(/\s(?:href)=["']javascript:[^"']*["']/gi, ' href="#"');
  html = injectLocalStyles(html, htmlFile);
  const injected = `${memory}<script id="ghrab-platform-config" type="application/json">${JSON.stringify(platformConfig)}</script><style>${platformCss}</style><script>${platformJs}<\/script><script>${axeSource}<\/script>`;
  if (/<\/head>/i.test(html)) html = html.replace(/<\/head>/i, `${injected}</head>`);
  else html = html.replace(/<body/i, `<head>${injected}</head><body`);
  return html;
}

const port = 10300 + (process.pid % 500);
const profile = `/tmp/ghrab-p3-axe-${process.pid}`;
rmSync(profile, { recursive: true, force: true });
const chrome = spawn(chromiumPath(), [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--disable-background-networking', '--no-first-run', `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore', detached: true });
let client;
try {
  await waitJson(`http://127.0.0.1:${port}/json/version`);
  const pages = await waitJson(`http://127.0.0.1:${port}/json`);
  client = new Cdp(pages.find((item) => item.type === 'page').webSocketDebuggerUrl);
  await client.call('Runtime.enable'); await client.call('Page.enable');
  const tree = await client.call('Page.getFrameTree');
  const reports = [];
  for (const page of selected) {
    await client.call('Page.setDocumentContent', { frameId: tree.frameTree.frame.id, html: prepareHtml(page.text, page.file) });
    let ready = false;
    for (let i = 0; i < 100; i += 1) {
      ready = Boolean(await client.eval("Boolean(window.axe && window.axe.version === '4.12.1' && window.GHRAB_PLATFORM && document.documentElement.dataset.ghrabA11y)"));
      if (ready) break;
      await sleep(30);
    }
    if (!ready) throw new Error(`axe/platform timeout: ${path.relative(dist, page.file)}`);
    const result = await client.eval(`(async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']},resultTypes:['violations','incomplete']});return {axeVersion:axe.version,violations:r.violations.map(v=>({id:v.id,impact:v.impact,help:v.help,helpUrl:v.helpUrl,nodes:v.nodes.slice(0,20).map(n=>({impact:n.impact,target:n.target,summary:n.failureSummary}))})),incomplete:r.incomplete.map(v=>({id:v.id,impact:v.impact,help:v.help,nodes:v.nodes.length}))};})()`);
    reports.push({ page: path.relative(dist, page.file).split(path.sep).join('/'), ...result });
  }
  const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const page of reports) for (const violation of page.violations) counts[violation.impact] = (counts[violation.impact] || 0) + violation.nodes.length;
  const blockers = counts.critical + counts.serious;
  await finish({
    schema: 'ghrab-p3-axe-result-v1',
    appId: consumer.appId,
    appVersion: consumer.appVersion,
    requestedVersion,
    installedVersion,
    status: blockers ? 'failed' : 'passed',
    policy: 'WCAG 2.0/2.1 A+AA and WCAG 2.2 AA; critical/serious findings block release, moderate/minor are retained for review.',
    pages: reports,
    summary: { scanned: reports.length, ...counts, blockers },
  }, blockers ? 1 : 0);
} finally {
  client?.close();
  if (chrome.exitCode === null) { try { process.kill(-chrome.pid, 'SIGTERM'); } catch {} }
  await Promise.race([new Promise((resolve) => chrome.once('exit', resolve)), sleep(1500)]);
  if (chrome.exitCode === null) { try { process.kill(-chrome.pid, 'SIGKILL'); } catch {} }
  await sleep(100);
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

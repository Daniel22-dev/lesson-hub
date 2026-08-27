#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { performance as nodePerformance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';

const root = path.resolve('.');
const dist = path.join(root, 'dist');
const consumer = JSON.parse(await fsp.readFile(path.join(root, 'ghrab-platform.consumer.json'), 'utf8'));
const quality = consumer.quality || {};
const budget = quality.runtimeBudget || {};
const widths = [1280, 390, 320];
const maxPages = Number(process.env.GHRAB_REFLOW_MAX_PAGES || 40);

function chromiumPath() {
  for (const candidate of [process.env.CHROMIUM_PATH, '/usr/lib/chromium/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].filter(Boolean)) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Chromium není dostupné');
}
async function waitJson(url) {
  for (let i = 0; i < 600; i += 1) {
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
    this.ws.onclose = () => {
      for (const pending of this.pending.values()) pending.reject(new Error('Chromium CDP spojení bylo ukončeno.'));
      this.pending.clear();
    };
  }
  async call(method, params = {}) {
    await this.ready;
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Chromium CDP timeout: ${method}`));
      }, 30000);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
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
  if (!fs.existsSync(directory)) return [];
  const result = [];
  for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(target));
    else result.push(target);
  }
  return result;
}
function posix(value) { return value.split(path.sep).join('/'); }
function isLocalRef(value) { return value && !/^(?:https?:|\/\/|data:|blob:|#|javascript:)/i.test(value); }
function escapeStyle(source) { return source.replace(/<\/style/gi, '<\\/style'); }
function prepareHtml(source, htmlFile) {
  let html = source
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<script\b[^>]*\/?>/gi, '')
    .replace(/<meta\b[^>]*http-equiv=["'](?:refresh|content-security-policy)["'][^>]*>/gi, '')
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '<div data-ghrab-reflow-iframe-placeholder></div>')
    .replace(/\s(?:src|srcset)=["'](?:https?:|\/\/)[^"']*["']/gi, '')
    .replace(/\shref=["']javascript:[^"']*["']/gi, ' href="#"');
  html = html.replace(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi, (tag) => {
    const match = tag.match(/href=["']([^"']+)["']/i);
    if (!match || !isLocalRef(match[1])) return '';
    const clean = match[1].split(/[?#]/)[0];
    const target = path.resolve(path.dirname(htmlFile), clean);
    if (!target.startsWith(dist) || !fs.existsSync(target) || !fs.statSync(target).isFile()) return '';
    try { return `<style data-ghrab-reflow-inline="${clean.replace(/"/g, '&quot;')}">${escapeStyle(fs.readFileSync(target, 'utf8'))}</style>`; } catch { return ''; }
  });
  const deterministic = `<style data-ghrab-reflow-harness>
    *,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important;filter:none!important;backdrop-filter:none!important;box-shadow:none!important;text-shadow:none!important;will-change:auto!important}
    [data-ghrab-reflow-iframe-placeholder]{display:none!important}
  </style>`;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${deterministic}</head>`);
  return html.replace(/<body/i, `<head>${deterministic}</head><body`);
}
function metricMap(metrics) { return Object.fromEntries((metrics || []).map((item) => [item.name, item.value])); }
function roundedBudget(value, floor, step = 1000, multiplier = 1.35) {
  const raw = Math.max(floor, Number(value || 0) * multiplier);
  return Math.ceil(raw / step) * step;
}

const allHtml = (await walk(dist)).filter((file) => file.toLowerCase().endsWith('.html'));
const pages = [];
for (const file of allHtml) {
  const source = await fsp.readFile(file, 'utf8');
  if (!/<html\b[^>]*>[\s\S]*<\/html>/i.test(source)) continue;
  if (/(^|\/)tests?\//i.test(posix(path.relative(dist, file)))) continue;
  pages.push({ file, source });
}
pages.sort((a, b) => {
  const ai = path.basename(a.file) === 'index.html' ? 0 : 1;
  const bi = path.basename(b.file) === 'index.html' ? 0 : 1;
  return ai - bi || a.file.localeCompare(b.file);
});
const selected = pages.slice(0, maxPages);
if (!selected.length) throw new Error('Nebyla nalezena žádná distribuovaná HTML stránka pro reflow test.');

const port = 10800 + (process.pid % 500);
const profile = `/tmp/ghrab-p3-reflow-${process.pid}`;
fs.rmSync(profile, { recursive: true, force: true });
const chrome = spawn(chromiumPath(), [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--disable-background-networking', '--disable-extensions', '--no-first-run',
  '--disable-features=Translate,MediaRouter', '--mute-audio',
  '--remote-allow-origins=*',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore', detached: true });
const results = [];
const debugBase = `http://127.0.0.1:${port}`;

async function createTarget() {
  const response = await fetch(`${debugBase}/json/new?about:blank`, { method: 'PUT' });
  if (!response.ok) throw new Error(`Chromium target create failed: ${response.status}`);
  return response.json();
}
async function closeTarget(targetId) {
  if (!targetId) return;
  try { await fetch(`${debugBase}/json/close/${encodeURIComponent(targetId)}`); } catch {}
}
async function measurePage(page, attempt = 1) {
  const target = await createTarget();
  const client = new Cdp(target.webSocketDebuggerUrl);
  try {
    await client.call('Runtime.enable');
    await client.call('Page.enable');
    await client.call('Performance.enable');
    const slowRate = Number(quality.referenceProfile?.cpuSlowdown || 4);
    const tree = await client.call('Page.getFrameTree');
    const rel = posix(path.relative(dist, page.file));
    const prepared = prepareHtml(page.source, page.file);
    const pageResult = { page: rel, widths: [] };
    const layoutExpression = `(()=>{
      const vw=window.innerWidth||document.documentElement.clientWidth;
      const root=(document.scrollingElement||document.documentElement).scrollWidth;
      const offenders=[];
      for(const el of document.querySelectorAll('body *')){
        const cs=getComputedStyle(el); if(cs.display==='none'||cs.visibility==='hidden'||Number(cs.opacity)===0) continue;
        const r=el.getBoundingClientRect(); if(!r.width||!r.height) continue;
        if(r.right>vw+2||r.left<-2){
          let p=el.parentElement, contained=false;
          while(p&&p!==document.body){const ps=getComputedStyle(p);if(/auto|scroll|hidden|clip/.test(ps.overflowX)){contained=true;break}p=p.parentElement}
          if(!contained) offenders.push({tag:el.tagName.toLowerCase(),id:el.id||'',className:String(el.className||'').slice(0,120),left:Math.round(r.left),right:Math.round(r.right),width:Math.round(r.width),text:String(el.textContent||'').trim().replace(/\s+/g,' ').slice(0,90)});
        }
        if(offenders.length>=20) break;
      }
      const rawOverflowPx=Math.max(0,root-vw);
      const rootClip=/^(?:hidden|clip)$/.test(getComputedStyle(document.documentElement).overflowX)||/^(?:hidden|clip)$/.test(getComputedStyle(document.body).overflowX);
      const overflowPx=rawOverflowPx>2&&!(rootClip&&offenders.length===0)?rawOverflowPx:0;
      return {viewport:vw,scrollWidth:root,rawOverflowPx,overflowPx,domNodes:document.querySelectorAll('*').length,bodyHeight:Math.max(document.body?.scrollHeight||0,document.documentElement.scrollHeight),offenders};
    })()`;
    await client.call('Emulation.setDeviceMetricsOverride', { width: widths[0], height: 900, deviceScaleFactor: 1, mobile: false });
    await client.call('Emulation.setCPUThrottlingRate', { rate: slowRate });
    const before = metricMap((await client.call('Performance.getMetrics')).metrics);
    const started = nodePerformance.now();
    await client.call('Page.setDocumentContent', { frameId: tree.frameTree.frame.id, html: prepared });
    for (let i = 0; i < 80; i += 1) {
      if (await client.eval("document.readyState === 'complete' && Boolean(document.documentElement && document.body)")) break;
      await sleep(10);
    }
    await sleep(15);
    const renderReadyMs = nodePerformance.now() - started;
    const after = metricMap((await client.call('Performance.getMetrics')).metrics);
    const runtime = {
      renderReadyMs: Number(renderReadyMs.toFixed(2)),
      jsHeapUsedBytes: Math.round(after.JSHeapUsedSize || 0),
      layoutDurationMs: Number((Math.max(0, (after.LayoutDuration || 0) - (before.LayoutDuration || 0)) * 1000).toFixed(3)),
      recalcStyleDurationMs: Number((Math.max(0, (after.RecalcStyleDuration || 0) - (before.RecalcStyleDuration || 0)) * 1000).toFixed(3)),
      taskDurationMs: Number((Math.max(0, (after.TaskDuration || 0) - (before.TaskDuration || 0)) * 1000).toFixed(3)),
    };
    await client.call('Emulation.setCPUThrottlingRate', { rate: 1 });
    for (const width of widths) {
      await client.call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width <= 390 });
      await sleep(12);
      const layout = await client.eval(layoutExpression);
      pageResult.widths.push({
        width,
        ...runtime,
        domNodes: layout.domNodes,
        scrollWidth: layout.scrollWidth,
        rawOverflowPx: layout.rawOverflowPx,
        overflowPx: layout.overflowPx,
        bodyHeight: layout.bodyHeight,
        offenders: layout.offenders,
      });
    }
    return pageResult;
  } catch (error) {
    if (attempt < 2) {
      await sleep(100);
      return measurePage(page, attempt + 1);
    }
    throw error;
  } finally {
    client.close();
    await closeTarget(target.id);
  }
}

try {
  await waitJson(`${debugBase}/json/version`);
  for (const page of selected) results.push(await measurePage(page));
} finally {
  if (chrome.exitCode === null) { try { process.kill(-chrome.pid, 'SIGTERM'); } catch {} }
  await Promise.race([new Promise((resolve) => chrome.once('exit', resolve)), sleep(1500)]);
  if (chrome.exitCode === null) { try { process.kill(-chrome.pid, 'SIGKILL'); } catch {} }
  await sleep(100);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch (error) { console.warn(`[P3 reflow] Dočasný profil se nepodařilo odstranit: ${error.message}`); }
}

const allRuns = results.flatMap((page) => page.widths.map((run) => ({ page: page.page, ...run })));
const aggregate = {
  pages: results.length,
  runs: allRuns.length,
  maxOverflowPx: Math.max(...allRuns.map((run) => run.overflowPx)),
  maxDomNodes: Math.max(...allRuns.map((run) => run.domNodes)),
  maxRenderReadyMs: Math.max(...allRuns.map((run) => run.renderReadyMs)),
  maxJsHeapUsedBytes: Math.max(...allRuns.map((run) => run.jsHeapUsedBytes)),
  maxLayoutDurationMs: Math.max(...allRuns.map((run) => run.layoutDurationMs)),
  maxTaskDurationMs: Math.max(...allRuns.map((run) => run.taskDurationMs)),
};
const suggestedBudget = {
  maxDomNodes: roundedBudget(aggregate.maxDomNodes, 1000, 250),
  maxRenderReadyMs: roundedBudget(aggregate.maxRenderReadyMs, 500, 100),
  maxJsHeapUsedBytes: roundedBudget(aggregate.maxJsHeapUsedBytes, 8_000_000, 1_000_000),
  maxLayoutDurationMs: roundedBudget(aggregate.maxLayoutDurationMs, 100, 25),
  maxTaskDurationMs: roundedBudget(aggregate.maxTaskDurationMs, 250, 50),
};
const checks = [
  { id: 'reflow.no-horizontal-overflow', ok: aggregate.maxOverflowPx <= 2, detail: `${aggregate.maxOverflowPx}px` },
  { id: 'runtime.pages-covered', ok: aggregate.pages >= 1, detail: aggregate.pages },
];
for (const [key, limit] of Object.entries(budget)) {
  if (!Number.isFinite(Number(limit))) continue;
  const metricKey = key;
  const value = aggregate[metricKey];
  checks.push({ id: `runtime-budget.${key}`, ok: Number(value) <= Number(limit), detail: `${value} <= ${limit}` });
}
if (quality.requireRuntimeBudget === true) checks.push({ id: 'runtime-budget.minimum-count', ok: Object.keys(budget).length >= 5, detail: Object.keys(budget).length });
const failures = checks.filter((item) => !item.ok);
const report = {
  schema: 'ghrab-p3-reflow-runtime-result-v1',
  appId: consumer.appId,
  appVersion: consumer.appVersion,
  platformVersion: consumer.platform?.version || '',
  profile: {
    cpuSlowdown: Number(quality.referenceProfile?.cpuSlowdown || 4),
    viewportWidths: widths,
    height: 900,
    scriptsExecuted: false,
    description: 'Skutečné distribuované HTML a lokální CSS; aplikační skripty jsou z bezpečnostních a deterministických důvodů odstraněny. Funkční JavaScript pokrývají samostatné projektové/browser testy.',
  },
  aggregate,
  budget,
  suggestedBudget,
  checks,
  status: failures.length ? 'failed' : 'passed',
  pages: results,
};
fs.mkdirSync(path.join(dist, 'config'), { recursive: true });
fs.writeFileSync(path.join(dist, 'qa-p3-reflow-runtime-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
process.exit(failures.length ? 1 : 0);

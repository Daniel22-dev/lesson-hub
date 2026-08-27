#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const consumerPath = path.join(root, 'ghrab-platform.consumer.json');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const consumer = readJson(consumerPath);
const quality = consumer.quality || {};
const budget = quality.performanceBudget || {};
const checks = [];
const warnings = [];
const check = (ok, id, detail = '') => checks.push({ id, ok: Boolean(ok), detail: String(detail || '') });
const warn = (id, detail = '') => warnings.push({ id, detail: String(detail || '') });
const posix = (value) => value.split(path.sep).join('/');
const walk = (dir) => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const target = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(target) : [target];
}) : [];
const generatedQualityArtifacts = new Set(['quality-report.json', 'config/quality-manifest.json']);
const files = walk(dist).filter((file) => !generatedQualityArtifacts.has(posix(path.relative(dist, file))));
const rel = (file) => posix(path.relative(dist, file));
const size = (file) => fs.statSync(file).size;
const sumExt = (extensions) => files.filter((file) => extensions.some((ext) => file.toLowerCase().endsWith(ext))).reduce((sum, file) => sum + size(file), 0);
const htmlFiles = files.filter((file) => file.toLowerCase().endsWith('.html'));
const fullHtml = htmlFiles.filter((file) => /<html\b[^>]*>[\s\S]*<\/html>/i.test(fs.readFileSync(file, 'utf8')));
const entry = path.join(dist, 'index.html');
const entryHtml = fs.existsSync(entry) ? fs.readFileSync(entry, 'utf8') : '';
const allText = files.filter((file) => /\.(?:html|js|css|json|webmanifest)$/i.test(file)).map((file) => fs.readFileSync(file, 'utf8')).join('\n');

function localAssetBytesFromHtml(html, htmlPath) {
  const seen = new Set();
  let total = Buffer.byteLength(html);
  const regex = /<(?:script|link|img)\b[^>]*(?:src|href)=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = regex.exec(html))) {
    const raw = match[1];
    if (!raw || /^(?:data:|blob:|https?:|\/\/|#)/i.test(raw)) continue;
    const clean = raw.split(/[?#]/)[0];
    const target = path.resolve(path.dirname(htmlPath), clean);
    if (!target.startsWith(dist) || !fs.existsSync(target) || !fs.statSync(target).isFile()) continue;
    const key = path.resolve(target);
    if (seen.has(key)) continue;
    seen.add(key);
    total += size(target);
  }
  return total;
}

function precacheMetrics() {
  const sw = path.join(dist, 'sw.js');
  if (!fs.existsSync(sw)) return { bytes: 0, assets: [] };
  const text = fs.readFileSync(sw, 'utf8');
  const assets = new Set();
  const regex = /["'`](\.\/?[^"'`\s]+)["'`]/g;
  let match;
  while ((match = regex.exec(text))) {
    const clean = match[1].split(/[?#]/)[0];
    const target = path.resolve(dist, clean.replace(/^\.\//, ''));
    if (target.startsWith(dist) && fs.existsSync(target) && fs.statSync(target).isFile()) assets.add(target);
  }
  return { bytes: [...assets].reduce((sum, file) => sum + size(file), 0), assets: [...assets].map(rel).sort() };
}

function largestInlineScript(html) {
  let largest = 0;
  const regex = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html))) largest = Math.max(largest, Buffer.byteLength(match[1] || ''));
  return largest;
}

function duplicateBytes() {
  const groups = new Map();
  for (const file of files) {
    if (size(file) < 4096) continue;
    const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (!groups.has(hash)) groups.set(hash, []);
    groups.get(hash).push(file);
  }
  const duplicates = [...groups.values()].filter((group) => group.length > 1);
  return {
    avoidableBytes: duplicates.reduce((sum, group) => sum + (group.length - 1) * size(group[0]), 0),
    groups: duplicates.map((group) => group.map(rel)),
  };
}

const precache = precacheMetrics();
const duplicate = duplicateBytes();
const largestFile = files.slice().sort((a, b) => size(b) - size(a))[0] || null;
const metrics = {
  schema: 'ghrab-performance-report-v1',
  appId: consumer.appId,
  appVersion: consumer.appVersion,
  platformVersion: consumer.platform?.version || '',
  measuredAt: new Date().toISOString(),
  distBytes: files.reduce((sum, file) => sum + size(file), 0),
  jsBytes: sumExt(['.js', '.mjs']),
  cssBytes: sumExt(['.css']),
  htmlBytes: sumExt(['.html']),
  fileCount: files.length,
  fullHtmlCount: fullHtml.length,
  entryHtmlBytes: fs.existsSync(entry) ? size(entry) : 0,
  entryCriticalBytes: fs.existsSync(entry) ? localAssetBytesFromHtml(entryHtml, entry) : 0,
  largestInlineScriptBytes: largestInlineScript(entryHtml),
  precacheBytes: precache.bytes,
  precacheAssetCount: precache.assets.length,
  largestFileBytes: largestFile ? size(largestFile) : 0,
  largestFilePath: largestFile ? rel(largestFile) : '',
  duplicateLargeBytes: duplicate.avoidableBytes,
};

check(fs.existsSync(dist), 'dist.exists');
check(consumer.platform?.version === '1.1.0', 'platform.version', consumer.platform?.version);
check(quality.accessibilityContract === 'ghrab-a11y-v1', 'contract.a11y', quality.accessibilityContract);
check(quality.performanceContract === 'ghrab-performance-v1', 'contract.performance', quality.performanceContract);
check(quality.moduleContract === 'ghrab-lazy-modules-v1', 'contract.modules', quality.moduleContract);
check(fs.existsSync(path.join(dist, 'ghrab', 'ghrab-platform.js')), 'platform.runtime');
check(fs.existsSync(path.join(dist, 'ghrab', 'ghrab-platform.css')), 'platform.styles');
const platformCss = fs.existsSync(path.join(dist, 'ghrab', 'ghrab-platform.css')) ? fs.readFileSync(path.join(dist, 'ghrab', 'ghrab-platform.css'), 'utf8') : '';
check(platformCss.includes('prefers-reduced-motion'), 'a11y.reduced-motion');
check(platformCss.includes(':focus-visible'), 'a11y.focus-visible');
check(platformCss.includes('.ghrab-skip-link'), 'a11y.skip-link');
check(fullHtml.length > 0, 'a11y.html-documents', fullHtml.length);
for (const file of fullHtml) {
  const text = fs.readFileSync(file, 'utf8');
  const name = rel(file);
  check(/<html\b[^>]*\blang=["'][a-z]{2}(?:-[A-Z]{2})?["']/i.test(text), `a11y.lang:${name}`);
  check(/<meta\b[^>]*name=["']viewport["']/i.test(text), `a11y.viewport:${name}`);
  check(!/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:[.,]0*)?/i.test(text), `a11y.zoom:${name}`);
  check(/<title>[\s\S]*?<\/title>/i.test(text), `a11y.title:${name}`);
  check(/<main\b|role=["']main["']/i.test(text) || name.includes('tests/'), `a11y.main:${name}`);
  const platformRuntimeCount = (text.match(/data-ghrab-platform-loader/g) || []).length;
  const engineRuntimeCount = (text.match(/data-ludus-(?:engine|shared)-runtime/g) || []).length;
  const runtimeOk = name.includes('tests/') || platformRuntimeCount === 1 || engineRuntimeCount === 1;
  check(runtimeOk, `a11y.runtime:${name}`, `platform=${platformRuntimeCount}; engine=${engineRuntimeCount}`);
  const missingAlt = [...text.matchAll(/<img\b(?![^>]*\balt=)[^>]*>/gi)].length;
  if (missingAlt) warn(`a11y.auto-alt:${name}`, missingAlt);
  const unnamedDialogs = [...text.matchAll(/<(?:dialog|[a-z0-9-]+)\b[^>]*(?:role=["']dialog["']|aria-modal=["']true["'])[^>]*>/gi)]
    .filter((item) => !/aria-label(?:ledby)?=/.test(item[0])).length;
  if (unnamedDialogs) warn(`a11y.auto-dialog-name:${name}`, unnamedDialogs);
}

const requiredModules = quality.modules?.required || [];
for (const modulePath of requiredModules) {
  const target = path.join(dist, modulePath);
  check(fs.existsSync(target), `module.exists:${modulePath}`);
  check(allText.includes(modulePath) || allText.includes(path.basename(modulePath)), `module.referenced:${modulePath}`);
}
const requiredContentPacks = quality.modules?.contentPacks || [];
for (const packPath of requiredContentPacks) check(fs.existsSync(path.join(dist, packPath)), `module.content-pack:${packPath}`);

for (const [key, limit] of Object.entries(budget)) {
  if (!Number.isFinite(Number(limit))) continue;
  check(Number(metrics[key]) <= Number(limit), `budget.${key}`, `${metrics[key]} <= ${limit}`);
}
if (quality.requireBudget === true) check(Object.keys(budget).length >= 5, 'budget.minimum-count', Object.keys(budget).length);

const result = {
  schema: 'ghrab-p3-quality-result-v1',
  appId: consumer.appId,
  appVersion: consumer.appVersion,
  contracts: {
    accessibility: quality.accessibilityContract,
    performance: quality.performanceContract,
    modules: quality.moduleContract,
  },
  metrics,
  budget,
  precacheAssets: precache.assets,
  duplicateGroups: duplicate.groups,
  checks,
  warnings,
  summary: {
    total: checks.length,
    passed: checks.filter((item) => item.ok).length,
    failed: checks.filter((item) => !item.ok).length,
    warnings: warnings.length,
  },
};
fs.mkdirSync(path.join(dist, 'config'), { recursive: true });
fs.writeFileSync(path.join(dist, 'quality-report.json'), `${JSON.stringify(result, null, 2)}\n`);
fs.writeFileSync(path.join(dist, 'config', 'quality-manifest.json'), `${JSON.stringify({
  schema: 'ghrab-quality-manifest-v1',
  appId: consumer.appId,
  appVersion: consumer.appVersion,
  platformVersion: consumer.platform.version,
  contracts: result.contracts,
  metrics,
  budget,
  status: result.summary.failed ? 'failed' : 'passed',
}, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
if (result.summary.failed) process.exit(1);

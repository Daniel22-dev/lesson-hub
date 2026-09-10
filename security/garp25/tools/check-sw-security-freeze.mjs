#!/usr/bin/env node
// GARP 2.5.1 GHRAB - service-worker security freeze checker, tooling hardening R2.
// Goal: fail closed against security-critical assets entering Cache API write paths.
// This is intentionally conservative static analysis. Unknown install/precache writes are AMBER,
// never silent PASS. Runtime cache writes are accepted only when structurally behind the
// isSecurityCriticalRequest -> networkOnlyNoStore early-return boundary.
import { readFile, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { Script, createContext } from 'node:vm';

const [swPath, deployDirArg, listArg] = process.argv.slice(2);
if (!swPath || !deployDirArg) {
  console.error('Usage: node check-sw-security-freeze.mjs <sw.js> <deployment-dir> [security-critical-list.json]');
  process.exit(2);
}

const DEFAULT_CRITICAL = [
  'app-guard', 'access-control', 'platform-runtime', 'revoked-access.json',
  'release-integrity.json', 'release-integrity.sig', 'integrity-status', 'runtime-config'
];
let critical = DEFAULT_CRITICAL;
if (listArg) {
  try {
    const parsed = JSON.parse(await readFile(listArg, 'utf8'));
    if (!Array.isArray(parsed) || !parsed.length || parsed.some(x => typeof x !== 'string' || !x.trim())) {
      throw new Error('critical list must be a non-empty JSON array of strings');
    }
    critical = parsed;
  } catch (e) {
    console.error(JSON.stringify({ status: 'ERROR', error: 'critical-asset-list-invalid', detail: String(e) }, null, 2));
    process.exit(2);
  }
}

const rawSw = await readFile(swPath, 'utf8');
const sw = stripComments(rawSw);
const deployRoot = path.resolve(deployDirArg);
const findings = [];
const unresolvedCacheWrites = [];

const norm = value => String(value || '').replace(/^\.\//, '').replace(/^\//, '');
const matchesCritical = value => { const v=norm(value); if (!v) return false; return critical.some(c => { const cc=norm(c); return cc && (v.includes(cc) || cc.includes(v)); }); };

async function walk(dir, base = '') {
  const out = [];
  for (const name of (await readdir(dir)).sort()) {
    const abs = path.join(dir, name), rel = path.posix.join(base, name);
    const st = await lstat(abs);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) out.push(...await walk(abs, rel));
    else if (st.isFile()) out.push(rel);
  }
  return out;
}
let files;
try { files = await walk(deployRoot); }
catch (e) { console.error(JSON.stringify({ status: 'ERROR', error: String(e) })); process.exit(2); }

const criticalFiles = files.filter(f => matchesCritical(f));
if (!criticalFiles.length) {
  findings.push({ severity: 'INFO', issue: 'zadny security-critical asset nenalezen - overit seznam rucne', detail: critical.join(',') });
}

function stripComments(text) {
  let out = '', i = 0, quote = null;
  while (i < text.length) {
    const ch = text[i], next = text[i + 1];
    if (quote) {
      out += ch;
      if (ch === '\\') { if (i + 1 < text.length) out += text[++i]; }
      else if (ch === quote) quote = null;
      i++; continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; out += ch; i++; continue; }
    if (ch === '/' && next === '/') {
      out += '  '; i += 2;
      while (i < text.length && text[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (ch === '/' && next === '*') {
      out += '  '; i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        out += text[i] === '\n' ? '\n' : ' '; i++;
      }
      if (i < text.length) { out += '  '; i += 2; }
      continue;
    }
    out += ch; i++;
  }
  return out;
}

function scanBalanced(text, openIndex, openChar = '(', closeChar = ')') {
  let depth = 0, quote = null;
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitTopLevel(text, sep = ',') {
  const out = []; let start = 0, round = 0, square = 0, curly = 0, quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '(') round++; else if (ch === ')') round--;
    else if (ch === '[') square++; else if (ch === ']') square--;
    else if (ch === '{') curly++; else if (ch === '}') curly--;
    else if (ch === sep && round === 0 && square === 0 && curly === 0) {
      out.push(text.slice(start, i).trim()); start = i + 1;
    }
  }
  out.push(text.slice(start).trim());
  return out.filter(Boolean);
}

function decodeString(expr) {
  const t = expr.trim();
  if (t.length < 2 || !['"', "'", '`'].includes(t[0]) || t[t.length - 1] !== t[0]) return null;
  if (t[0] === '`' && t.includes('${')) return null;
  try {
    if (t[0] === '"') return JSON.parse(t);
    const inner = t.slice(1, -1).replace(/\\([\\'"`])/g, '$1');
    return inner;
  } catch { return null; }
}

const env = new Map();
function captureStaticAssignments(text) {
  const starts = [
    ...text.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/g),
    ...text.matchAll(/\b(self\.[A-Za-z_$][\w$]*)\s*=\s*/g)
  ].sort((a,b) => a.index - b.index);
  for (const m of starts) {
    const name = m[1], start = m.index + m[0].length;
    let round=0, square=0, curly=0, quote=null, end=start;
    for (let i=start; i<text.length; i++) {
      const ch=text[i];
      if (quote) { if (ch==='\\') i++; else if (ch===quote) quote=null; end=i+1; continue; }
      if (ch==='\"'||ch==="'"||ch==='`') { quote=ch; end=i+1; continue; }
      if (ch==='(') round++; else if (ch===')') round--;
      else if (ch==='[') square++; else if (ch===']') square--;
      else if (ch==='{') curly++; else if (ch==='}') curly--;
      if ((ch===';' || ch==='\n') && round===0 && square===0 && curly===0) { end=i; break; }
      end=i+1;
    }
    const expr=text.slice(start,end).trim();
    if (expr) env.set(name, expr);
  }
}
captureStaticAssignments(sw);

function resolveObjectValues(expr, seen, depth) {
  const m = expr.match(/^Object\.values\s*\(\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\)$/);
  if (!m) return null;
  const raw = env.get(m[1]);
  if (!raw || !raw.trim().startsWith('{') || !raw.trim().endsWith('}')) return null;
  const body = raw.trim().slice(1, -1);
  const vals = [];
  for (const part of splitTopLevel(body)) {
    const idx = part.indexOf(':'); if (idx < 0) return null;
    const r = resolveExpr(part.slice(idx + 1), seen, depth + 1); if (!r) return null;
    vals.push(...r);
  }
  return vals;
}

function resolveExpr(expr, seen = new Set(), depth = 0) {
  if (depth > 12) return null;
  let t = String(expr || '').trim();
  while (t.startsWith('(') && t.endsWith(')')) {
    const end = scanBalanced(t, 0); if (end !== t.length - 1) break; t = t.slice(1, -1).trim();
  }
  const lit = decodeString(t); if (lit !== null) return [lit];
  if (/^new\s+Request\s*\(/.test(t)) {
    const open = t.indexOf('('), end = scanBalanced(t, open); if (end < 0) return null;
    const first = splitTopLevel(t.slice(open + 1, end))[0]; return resolveExpr(first, seen, depth + 1);
  }
  if (t.startsWith('[') && t.endsWith(']')) {
    const vals = [];
    for (const part of splitTopLevel(t.slice(1, -1))) {
      if (part.startsWith('...')) { const r = resolveExpr(part.slice(3), seen, depth + 1); if (!r) return null; vals.push(...r); }
      else { const r = resolveExpr(part, seen, depth + 1); if (!r) return null; vals.push(...r); }
    }
    return vals;
  }
  const concat = t.match(/^(.+?)\.concat\s*\((.*)\)$/s);
  if (concat) {
    const base = resolveExpr(concat[1], seen, depth + 1); if (!base) return null;
    const vals = [...base];
    for (const arg of splitTopLevel(concat[2])) { const r = resolveExpr(arg, seen, depth + 1); if (!r) return null; vals.push(...r); }
    return vals;
  }
  const split = t.match(/^(.+?)\.split\s*\((.*)\)$/s);
  if (split) {
    const base = resolveExpr(split[1], seen, depth + 1), sep = resolveExpr(split[2], seen, depth + 1);
    if (!base || base.length !== 1 || !sep || sep.length !== 1) return null;
    return base[0].split(sep[0]);
  }
  const ov = resolveObjectValues(t, seen, depth); if (ov) return ov;
  if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(t)) {
    if (seen.has(t)) return null;
    const raw = env.get(t); if (!raw) return null;
    const nextSeen = new Set(seen); nextSeen.add(t);
    return resolveExpr(raw, nextSeen, depth + 1);
  }
  return null;
}

function enclosingFunctionName(pos) {
  const prefix = sw.slice(0, pos);
  const matches = [...prefix.matchAll(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g)];
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i], open = m.index + m[0].lastIndexOf('{');
    const end = scanBalanced(sw, open, '{', '}');
    if (end >= pos) return m[1];
  }
  return null;
}

function installRanges() {
  const ranges = [];
  for (const m of sw.matchAll(/addEventListener\s*\(\s*['"]install['"]\s*,/g)) {
    const start = m.index, open = sw.indexOf('(', start), end = scanBalanced(sw, open);
    if (end > start) ranges.push([start, end]);
  }
  return ranges;
}
const installs = installRanges();
const isInstallPos = pos => installs.some(([a,b]) => pos >= a && pos <= b);

const precached = new Set();
const precacheSources = [];
function addResolved(values, source) {
  const uniq = [...new Set((values || []).filter(Boolean))];
  for (const v of uniq) precached.add(v);
  if (uniq.length) precacheSources.push({ source, entries: uniq });
}
function noteUnresolved(pos, method, expr, source) {
  unresolvedCacheWrites.push({ method, expression: expr.slice(0, 180), source, installOrPrecache: isInstallPos(pos), function: enclosingFunctionName(pos) });
}

const iteratorAddVars = new Set();
for (const m of sw.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s+of\s+([^)]*)\)\s*\{/g)) {
  const openBrace = m.index + m[0].lastIndexOf('{'), endBrace = scanBalanced(sw, openBrace, '{', '}');
  if (endBrace < 0) continue;
  const body = sw.slice(openBrace + 1, endBrace);
  if (new RegExp(`\\.\\s*add\\s*\\(\\s*${m[1]}\\s*\\)`).test(body)) iteratorAddVars.add(m[1]);
}
for (const m of sw.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s+of\s+Object\.values\s*\(\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\)\s*\)\s*\{/g)) {
  const openBrace = m.index + m[0].lastIndexOf('{'), endBrace = scanBalanced(sw, openBrace, '{', '}');
  if (endBrace < 0) continue;
  const body = sw.slice(openBrace + 1, endBrace);
  if (new RegExp(`\\.\\s*add\\s*\\(\\s*${m[1]}\\s*\\)`).test(body)) iteratorAddVars.add(m[1]);
}
for (const m of sw.matchAll(/(?:([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)|Object\.values\s*\([^)]*\))\.(?:map|forEach)\s*\(\s*([A-Za-z_$][\w$]*)\s*=>[\s\S]{0,260}?\.\s*add\s*\(\s*\2\s*\)/g)) iteratorAddVars.add(m[2]);

// Direct Cache API writes. Parse the first argument, not the variable name.
for (const m of sw.matchAll(/\.\s*(addAll|add|put)\s*\(/g)) {
  const method = m[1], open = m.index + m[0].lastIndexOf('('), close = scanBalanced(sw, open);
  if (close < 0) { noteUnresolved(m.index, method, '<unbalanced>', 'direct-call'); continue; }
  const args = splitTopLevel(sw.slice(open + 1, close));
  const first = args[0] || '';
  const values = resolveExpr(first);
  if (values) addResolved(values, `${method}:expression`);
  else {
    const fn = enclosingFunctionName(m.index);
    // Dynamic request cache writes are structurally safe only if they live in runtime helpers
    // whose callers sit behind the security-critical early return. Verified below.
    const idOnly = /^[A-Za-z_$][\w$]*$/.test(first.trim());
    if (method === 'add' && idOnly && iteratorAddVars.has(first.trim())) {
      // resolved by the iterator pass below
    } else if (!(method === 'put' && first.trim() === 'request' && ['networkFirst','cacheFirst'].includes(fn))) {
      noteUnresolved(m.index, method, first, 'direct-call');
    }
  }
}

// Iterated add paths where the cache.add argument is a loop variable.
for (const m of sw.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s+of\s+Object\.values\s*\(\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\)\s*\)\s*\{/g)) {
  const openBrace = m.index + m[0].lastIndexOf('{'), endBrace = scanBalanced(sw, openBrace, '{', '}');
  if (endBrace < 0) continue;
  const body = sw.slice(openBrace + 1, endBrace), varName = m[1];
  if (new RegExp(`\\.\\s*add\\s*\\(\\s*${varName}\\s*\\)`).test(body)) {
    const expr = `Object.values(${m[2]})`, values = resolveExpr(expr);
    if (values) addResolved(values, `for-of-add:${expr}`); else noteUnresolved(m.index, 'add', expr, 'for-of');
  }
}
for (const m of sw.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s+of\s+([^)]*)\)\s*\{/g)) {
  const openBrace = m.index + m[0].lastIndexOf('{'), endBrace = scanBalanced(sw, openBrace, '{', '}');
  if (endBrace < 0) continue;
  const body = sw.slice(openBrace + 1, endBrace);
  const varName = m[1];
  if (new RegExp(`\\.\\s*add\\s*\\(\\s*${varName}\\s*\\)`).test(body)) {
    const values = resolveExpr(m[2]);
    if (values) addResolved(values, `for-of-add:${m[2].trim()}`);
    else noteUnresolved(m.index, 'add', m[2], 'for-of');
  }
}

// map/forEach receiver paths. Resolve the receiver expression, including Object.values(...).
for (const m of sw.matchAll(/((?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)|(?:Object\.values\s*\([^)]*\)))\.(map|forEach)\s*\(\s*([A-Za-z_$][\w$]*)\s*=>[\s\S]{0,260}?\.\s*add\s*\(\s*\3\s*\)/g)) {
  const receiver = m[1].trim();
  const values = resolveExpr(receiver);
  if (values) addResolved(values, `${m[2]}-add:${receiver}`);
  else noteUnresolved(m.index, 'add', receiver, `${m[2]}-receiver`);
}

for (const p of precached) {
  for (const c of critical) {
    const pp=norm(p), cc=norm(c);
    if (pp && cc && (pp.includes(cc) || cc.includes(pp))) {
      findings.push({ severity: 'CRITICAL', issue: 'security-critical asset je v Cache API write/precache ceste', detail: `${p} (vzor: ${c})` });
    }
  }
}

// Structural + bounded behavioral exemption. Comments/proximity never count.
function extractFunction(name) {
  const re = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`);
  const m = re.exec(sw); if (!m) return '';
  const open = m.index + m[0].lastIndexOf('{'), end = scanBalanced(sw, open, '{', '}');
  return end > open ? sw.slice(open + 1, end) : '';
}
function extractFunctionSource(name) {
  const re = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`);
  const m = re.exec(sw); if (!m) return '';
  const open = m.index + m[0].lastIndexOf('{'), end = scanBalanced(sw, open, '{', '}');
  return end > open ? sw.slice(m.index, end + 1) : '';
}
function criticalRepresentativePath(entry) {
  const c = norm(entry);
  const special = {
    'app-guard': 'access/app-guard.js',
    'access-control': 'access/access-control.js',
    'platform-runtime': 'ghrab/ghrab-platform.js',
    'revoked-access.json': 'access/revoked-access.json',
    'integrity-status': 'integrity-status.json',
    'runtime-config': 'runtime-config.js'
  };
  if (special[c]) return special[c];
  if (c.includes('/') || /\.[A-Za-z0-9_-]+$/.test(c)) return c;
  return `access/${c}.js`;
}
function criticalBehaviorCases() {
  const byPath = new Map();
  for (const entry of critical) {
    const rel = criticalRepresentativePath(entry);
    byPath.set(rel, { path: rel, authority: entry, source: 'authoritative-list', inDeployment: files.includes(rel) });
  }
  for (const file of criticalFiles) {
    if (!byPath.has(file)) byPath.set(file, { path: file, authority: file, source: 'deployment-match', inDeployment: true });
    else byPath.get(file).inDeployment = true;
  }
  return [...byPath.values()];
}
const criticalCases = criticalBehaviorCases();
const securityCriticalFn = extractFunction('isSecurityCriticalRequest');
function behavioralCriticalGuard() {
  const source = extractFunctionSource('isSecurityCriticalRequest');
  const cases = [];
  if (!source) return { status: 'FAIL', reason: 'guard-function-missing', cases, checkedAuthoritative: 0 };
  const forbidden = /\b(?:eval|Function|process|require|globalThis|WebAssembly|Proxy|Reflect|constructor|__proto__|Promise|queueMicrotask|setTimeout|setInterval|setImmediate|Atomics|async|await)\b/;
  if (forbidden.test(source)) return { status: 'FAIL', reason: 'guard-function-not-safe-for-bounded-eval', cases, checkedAuthoritative: 0 };
  try {
    const context = createContext(Object.create(null));
    new Script(`${source}; this.__ghrabGuard = isSecurityCriticalRequest;`).runInContext(context, { timeout: 50 });
    const fn = context.__ghrabGuard;
    if (typeof fn !== 'function') return { status: 'FAIL', reason: 'guard-function-not-callable', cases, checkedAuthoritative: 0 };
    const scopePath = '/__ghrab_scope__/';
    for (const spec of criticalCases) {
      const pathname = scopePath + norm(spec.path);
      let actual = false;
      try { actual = fn({ pathname }, scopePath) === true; }
      catch (e) { cases.push({ ...spec, expected: true, actual: 'ERROR', error: String(e) }); continue; }
      cases.push({ ...spec, expected: true, actual });
    }
    for (const file of ['index.html', 'assets/app.js', 'manual/index.html']) {
      if (criticalCases.some(c => norm(c.path) === norm(file))) continue;
      const pathname = scopePath + file;
      let actual = false;
      try { actual = fn({ pathname }, scopePath) === true; }
      catch (e) { cases.push({ path: file, source: 'negative-control', expected: false, actual: 'ERROR', error: String(e) }); continue; }
      cases.push({ path: file, source: 'negative-control', expected: false, actual });
    }
    const falseNegatives = cases.filter(c => c.expected === true && c.actual !== true);
    const falsePositives = cases.filter(c => c.expected === false && c.actual !== false);
    return {
      status: falseNegatives.length ? 'FAIL' : (falsePositives.length ? 'AMBER' : 'PASS'),
      checkedAuthoritative: criticalCases.length,
      checkedDeployed: criticalCases.filter(c => c.inDeployment).length,
      cases, falseNegatives, falsePositives
    };
  } catch (e) {
    return { status: 'FAIL', reason: 'guard-behavior-eval-error', error: String(e), cases, checkedAuthoritative: criticalCases.length };
  }
}
const behavioralGuard = behavioralCriticalGuard();
for (const c of behavioralGuard.falseNegatives || []) findings.push({
  severity: 'HIGH', issue: 'security-critical predicate behavioralne nechrani autoritativni kriticky asset', detail: c
});
if (behavioralGuard.status === 'FAIL' && !(behavioralGuard.falseNegatives || []).length) findings.push({
  severity: 'HIGH', issue: 'security-critical predicate nelze behavioralne overit', detail: behavioralGuard
});
for (const c of behavioralGuard.falsePositives || []) findings.push({
  severity: 'MEDIUM', issue: 'security-critical predicate je behavioralne prilis siroky', detail: c
});
const behaviorallyProtected = new Set((behavioralGuard.cases || []).filter(c => c.expected === true && c.actual === true).map(c => norm(c.path)));

function extractFetchHandlerSource() {
  let m = /addEventListener\s*\(\s*['"]fetch['"]\s*,\s*\(([^)]*)\)\s*=>\s*\{/.exec(sw);
  if (m) {
    const open = m.index + m[0].lastIndexOf('{'), end = scanBalanced(sw, open, '{', '}');
    if (end > open) return `(${m[1]}) => ${sw.slice(open, end + 1)}`;
  }
  m = /addEventListener\s*\(\s*['"]fetch['"]\s*,\s*([A-Za-z_$][\w$]*)\s*=>\s*\{/.exec(sw);
  if (m) {
    const open = m.index + m[0].lastIndexOf('{'), end = scanBalanced(sw, open, '{', '}');
    if (end > open) return `(${m[1]}) => ${sw.slice(open, end + 1)}`;
  }
  m = /addEventListener\s*\(\s*['"]fetch['"]\s*,\s*function\s*\(([^)]*)\)\s*\{/.exec(sw);
  if (m) {
    const open = m.index + m[0].lastIndexOf('{'), end = scanBalanced(sw, open, '{', '}');
    if (end > open) return `function(${m[1]}) ${sw.slice(open, end + 1)}`;
  }
  return '';
}
function makeTrackedURLConstructor(state) {
  const allowedPreGuard = new Set(['origin', 'pathname']);
  return function TrackedURL(input, base) {
    const url = new URL(input, base);
    return new Proxy(url, {
      get(target, prop) {
        if (state.phase === 'pre-guard' && typeof prop === 'string' && !allowedPreGuard.has(prop)) {
          state.preGuardReads.add(`url.${prop}`);
        } else if (state.phase === 'guard-or-later' && typeof prop === 'string') {
          state.postGuardReads.add(`url.${prop}`);
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
  };
}
function makeTrackedRequest(state, spec) {
  const allowedPreGuard = new Set(['method', 'url']);
  const headers = Object.freeze({ get(){ return null; }, has(){ return false; }, entries(){ return [][Symbol.iterator](); } });
  const base = {
    method: 'GET',
    url: `https://example.invalid/__ghrab_scope__/${norm(spec.path)}`,
    headers,
    destination: 'script',
    referrer: 'https://example.invalid/__ghrab_scope__/',
    referrerPolicy: 'strict-origin-when-cross-origin',
    mode: 'no-cors',
    credentials: 'same-origin',
    cache: 'default',
    redirect: 'follow',
    integrity: '',
    keepalive: false,
    signal: null,
    body: null,
    bodyUsed: false,
    duplex: 'half'
  };
  return new Proxy(Object.freeze(base), {
    get(target, prop, receiver) {
      if (state.phase === 'pre-guard' && typeof prop === 'string' && !allowedPreGuard.has(prop)) {
        state.preGuardReads.add(`request.${prop}`);
      } else if (state.phase === 'guard-or-later' && typeof prop === 'string') {
        state.postGuardReads.add(`request.${prop}`);
      }
      return Reflect.get(target, prop, receiver);
    }
  });
}
function makeTrackedEvent(state, request, respondCalls) {
  const allowedPreGuard = new Set(['request']);
  const base = {
    request,
    clientId: 'client-1',
    resultingClientId: '',
    replacesClientId: '',
    preloadResponse: Promise.resolve(undefined),
    handled: Promise.resolve(undefined),
    respondWith(value) {
      const route = value && value.__ghrabRoute ? value.__ghrabRoute : 'unknown';
      if (state.phase === 'pre-guard') state.preGuardEffects.add(`event.respondWith:${route}`);
      respondCalls.push(route);
    },
    waitUntil() {}
  };
  return new Proxy(base, {
    get(target, prop, receiver) {
      if (state.phase === 'pre-guard' && typeof prop === 'string' && !allowedPreGuard.has(prop)) {
        state.preGuardReads.add(`event.${prop}`);
      } else if (state.phase === 'guard-or-later' && typeof prop === 'string' && prop !== 'respondWith') {
        state.postGuardReads.add(`event.${prop}`);
      }
      return Reflect.get(target, prop, receiver);
    }
  });
}
function fetchHandlerRegistrationSummary() {
  const registrations = [], onfetchAssignments = [], topLevelEffects = [];
  const addEventListener = (type, handler) => registrations.push({ type: String(type), callable: typeof handler === 'function' });
  const selfTarget = {
    location: Object.freeze({ origin: 'https://example.invalid', href: 'https://example.invalid/__ghrab_scope__/sw.js' }),
    registration: Object.freeze({ scope: 'https://example.invalid/__ghrab_scope__/' }),
    addEventListener,
    skipWaiting(){ topLevelEffects.push('self.skipWaiting'); }
  };
  const selfProxy = new Proxy(selfTarget, {
    set(target, prop, value, receiver) {
      if (String(prop) === 'onfetch') onfetchAssignments.push({ callable: typeof value === 'function', source: 'self.set' });
      if (String(prop) === 'addEventListener') topLevelEffects.push('self.addEventListener-mutated');
      return Reflect.set(target, prop, value, receiver);
    },
    defineProperty(target, prop, descriptor) {
      if (String(prop) === 'onfetch') onfetchAssignments.push({ callable: typeof descriptor?.value === 'function', source: 'self.defineProperty' });
      if (String(prop) === 'addEventListener') topLevelEffects.push('self.addEventListener-redefined');
      return Reflect.defineProperty(target, prop, descriptor);
    }
  });
  const cacheEffect = method => (...args) => { topLevelEffects.push(`caches.${method}`); return method === 'keys' ? [] : null; };
  const sandbox = {
    self: selfProxy,
    addEventListener,
    URL,
    console: Object.freeze({ log(){}, warn(){}, error(){} }),
    fetch(){ topLevelEffects.push('fetch'); return null; },
    caches: Object.freeze({ open: cacheEffect('open'), match: cacheEffect('match'), delete: cacheEffect('delete'), keys: cacheEffect('keys') })
  };
  Object.defineProperty(sandbox, 'onfetch', {
    configurable: true,
    get(){ return undefined; },
    set(value){ onfetchAssignments.push({ callable: typeof value === 'function', source: 'global.set' }); }
  });
  let error = null;
  try { new Script(sw).runInContext(createContext(sandbox), { timeout: 50 }); }
  catch (e) { error = String(e); }
  const fetchRegistrations = registrations.filter(r => r.type === 'fetch');
  const invalidFetchHandlers = fetchRegistrations.filter(r => !r.callable).length + onfetchAssignments.filter(r => !r.callable).length;
  const total = fetchRegistrations.length + onfetchAssignments.length;
  return {
    addEventListenerCount: fetchRegistrations.length,
    onfetchAssignments: onfetchAssignments.length,
    total,
    invalidFetchHandlers,
    topLevelEffects,
    error,
    pass: !error && topLevelEffects.length === 0 && total === 1 && invalidFetchHandlers === 0
  };
}
const fetchHandlerRegistrations = fetchHandlerRegistrationSummary();
function behavioralFetchRouteGuard() {
  if (!fetchHandlerRegistrations.pass) return { status: 'FAIL', reason: 'fetch-handler-registration-ambiguous', registrations: fetchHandlerRegistrations, cases: [], checkedAuthoritative: criticalCases.length };
  const handlerSource = extractFetchHandlerSource();
  const predicateSource = extractFunctionSource('isSecurityCriticalRequest');
  const runtimeSource = extractFunctionSource('isRuntimeRequest') || 'function isRuntimeRequest(){ return false; }';
  const cases = [];
  if (!handlerSource) return { status: 'FAIL', reason: 'fetch-handler-not-recognized', cases, checkedAuthoritative: criticalCases.length };
  if (!predicateSource) return { status: 'FAIL', reason: 'guard-function-missing', cases, checkedAuthoritative: criticalCases.length };
  const trackedHandlerSource = handlerSource.replace(/\bisSecurityCriticalRequest\s*\(/g, '__ghrabTrackedSecurityCriticalRequest(');
  const evalSource = `${predicateSource}\n${runtimeSource}\nfunction __ghrabTrackedSecurityCriticalRequest(...args){ __ghrabBeginGuard(); try { return isSecurityCriticalRequest(...args); } finally { __ghrabEndGuard(); } }\nthis.__ghrabFetchHandler = (${trackedHandlerSource});`;
  const forbidden = /\b(?:eval|Function|process|require|globalThis|WebAssembly|Proxy|Reflect|constructor|__proto__|Promise|queueMicrotask|setTimeout|setInterval|setImmediate|Atomics|async|await)\b/;
  if (forbidden.test(evalSource)) return { status: 'FAIL', reason: 'fetch-handler-not-safe-for-bounded-eval', cases, checkedAuthoritative: criticalCases.length };
  try {
    for (const spec of criticalCases) {
      const state = { phase: 'pre-guard', preGuardReads: new Set(), postGuardReads: new Set(), preGuardEffects: new Set(), routeEffects: [] };
      const respondCalls = [];
      const request = makeTrackedRequest(state, spec);
      const event = makeTrackedEvent(state, request, respondCalls);
      const context = createContext({
        URL: makeTrackedURLConstructor(state),
        console: Object.freeze({ log(){}, warn(){}, error(){} }),
        self: Object.freeze({
          location: Object.freeze({ origin: 'https://example.invalid', href: 'https://example.invalid/__ghrab_scope__/sw.js' }),
          registration: Object.freeze({ scope: 'https://example.invalid/__ghrab_scope__/' })
        }),
        __ghrabBeginGuard: () => { state.phase = 'guard-eval'; },
        __ghrabEndGuard: () => { state.phase = 'guard-or-later'; },
        networkOnlyNoStore: () => { state.routeEffects.push({ phase: state.phase, route: 'networkOnlyNoStore' }); if (state.phase === 'pre-guard') state.preGuardEffects.add('networkOnlyNoStore'); return Object.freeze({ __ghrabRoute: 'networkOnlyNoStore' }); },
        cacheFirst: () => { state.routeEffects.push({ phase: state.phase, route: 'cacheFirst' }); if (state.phase === 'pre-guard') state.preGuardEffects.add('cacheFirst'); return Object.freeze({ __ghrabRoute: 'cacheFirst' }); },
        networkFirst: () => { state.routeEffects.push({ phase: state.phase, route: 'networkFirst' }); if (state.phase === 'pre-guard') state.preGuardEffects.add('networkFirst'); return Object.freeze({ __ghrabRoute: 'networkFirst' }); },
        fetch: () => { state.routeEffects.push({ phase: state.phase, route: 'fetch' }); if (state.phase === 'pre-guard') state.preGuardEffects.add('fetch'); return Object.freeze({ __ghrabRoute: 'directFetch' }); },
        caches: Object.freeze({
          match: () => { state.routeEffects.push({ phase: state.phase, route: 'caches.match' }); if (state.phase === 'pre-guard') state.preGuardEffects.add('caches.match'); return Object.freeze({ __ghrabRoute: 'cacheMatch' }); },
          open: () => { state.routeEffects.push({ phase: state.phase, route: 'caches.open' }); if (state.phase === 'pre-guard') state.preGuardEffects.add('caches.open'); return Object.freeze({ __ghrabRoute: 'cacheOpen' }); },
          delete: () => { state.routeEffects.push({ phase: state.phase, route: 'caches.delete' }); if (state.phase === 'pre-guard') state.preGuardEffects.add('caches.delete'); return false; },
          keys: () => { state.routeEffects.push({ phase: state.phase, route: 'caches.keys' }); if (state.phase === 'pre-guard') state.preGuardEffects.add('caches.keys'); return []; }
        })
      });
      new Script(evalSource).runInContext(context, { timeout: 50 });
      const handler = context.__ghrabFetchHandler;
      if (typeof handler !== 'function') return { status: 'FAIL', reason: 'fetch-handler-not-callable', cases, checkedAuthoritative: criticalCases.length };
      let returned = null, error = null;
      try { returned = handler(event); }
      catch (e) { error = String(e); }
      const asyncUnsupported = returned && typeof returned.then === 'function';
      const preGuardReads = [...state.preGuardReads].sort();
      const postGuardReads = [...state.postGuardReads].sort();
      const preGuardEffects = [...state.preGuardEffects].sort();
      const routeEffects = [...state.routeEffects];
      const exactCriticalRoute = routeEffects.length === 1 && routeEffects[0].route === 'networkOnlyNoStore' && routeEffects[0].phase === 'guard-or-later';
      const pass = !error && !asyncUnsupported && preGuardReads.length === 0 && postGuardReads.length === 0 && preGuardEffects.length === 0 && exactCriticalRoute && respondCalls.length === 1 && respondCalls[0] === 'networkOnlyNoStore';
      cases.push({ ...spec, expectedRoute: 'networkOnlyNoStore', respondCalls, preGuardReads, postGuardReads, preGuardEffects, routeEffects, exactCriticalRoute, returnedAsync: !!asyncUnsupported, error, pass });
    }
    const failed = cases.filter(c => !c.pass);
    return {
      status: failed.length ? 'FAIL' : 'PASS',
      checkedAuthoritative: criticalCases.length,
      checkedDeployed: criticalCases.filter(c => c.inDeployment).length,
      preGuardPolicy: {
        requestAllowed: ['method', 'url'],
        eventAllowed: ['request'],
        urlAllowed: ['origin', 'pathname'],
        rule: 'Exactly one fetch handler registration is permitted. Before the guard, routing-sensitive reads and all network/cache/respondWith effects are fail-closed. After a positive guard, the critical branch may read only event.respondWith and must produce exactly one total route effect: networkOnlyNoStore.'
      },
      cases, failed
    };
  } catch (e) {
    return { status: 'FAIL', reason: 'fetch-handler-behavior-eval-error', error: String(e), cases, checkedAuthoritative: criticalCases.length };
  }
}
const fetchRouteBehavior = behavioralFetchRouteGuard();
for (const c of fetchRouteBehavior.failed || []) findings.push({
  severity: 'HIGH', issue: 'fetch handler neroutuje kriticky asset fail-closed pres networkOnlyNoStore', detail: c
});
if (fetchRouteBehavior.status === 'FAIL' && !(fetchRouteBehavior.failed || []).length) findings.push({
  severity: 'HIGH', issue: 'fetch handler nelze behavioralne overit', detail: fetchRouteBehavior
});

const fetchMatch = /addEventListener\s*\(\s*['"]fetch['"]\s*,/.exec(sw);
let fetchBody = '';
if (fetchMatch) {
  const open = sw.indexOf('(', fetchMatch.index), end = scanBalanced(sw, open);
  fetchBody = end > open ? sw.slice(open + 1, end) : '';
}
function analyzeStructuralNetworkOnlyGuard() {
  const m = /if\s*\(\s*isSecurityCriticalRequest\s*\(/.exec(fetchBody);
  if (!m) return { pass: false, reason: 'positive-guard-if-not-found' };
  const conditionOpen = fetchBody.indexOf('(', m.index), conditionEnd = scanBalanced(fetchBody, conditionOpen);
  if (conditionEnd < 0) return { pass: false, reason: 'guard-condition-unbalanced' };
  const condition = fetchBody.slice(conditionOpen + 1, conditionEnd).trim();
  if (!/^isSecurityCriticalRequest\s*\(/.test(condition)) return { pass: false, reason: 'guard-negated-or-wrapped', condition };
  let branchOpen = conditionEnd + 1;
  while (/\s/.test(fetchBody[branchOpen] || '')) branchOpen++;
  if (fetchBody[branchOpen] !== '{') return { pass: false, reason: 'guard-branch-not-block' };
  const branchEnd = scanBalanced(fetchBody, branchOpen, '{', '}');
  if (branchEnd < 0) return { pass: false, reason: 'guard-branch-unbalanced' };
  const branch = fetchBody.slice(branchOpen + 1, branchEnd);
  const preGuardBody = fetchBody.slice(0, m.index);
  const preGuardRespondWith = /\.\s*respondWith\s*\(/.test(preGuardBody);
  const hasRespondWithNetworkOnly = /\.\s*respondWith\s*\(\s*networkOnlyNoStore\s*\(/.test(branch);
  const hasReturn = /\breturn\b/.test(branch);
  const cacheFirstIdx = fetchBody.indexOf('cacheFirst');
  const pass = !preGuardRespondWith && hasRespondWithNetworkOnly && hasReturn && (cacheFirstIdx < 0 || branchEnd < cacheFirstIdx);
  return { pass, condition, preGuardRespondWith, hasRespondWithNetworkOnly, hasReturn, branchBeforeCacheFirst: cacheFirstIdx < 0 || branchEnd < cacheFirstIdx };
}
async function behavioralNetworkOnlyNoStoreGuard() {
  const source = extractFunctionSource('networkOnlyNoStore');
  if (!source) return { status: 'FAIL', reason: 'network-only-sink-missing', fetchCalls: [], cacheCalls: [] };
  const forbidden = /\b(?:eval|Function|process|require|globalThis|WebAssembly|Proxy|Reflect|constructor|__proto__)\b/;
  if (forbidden.test(source)) return { status: 'FAIL', reason: 'network-only-sink-not-safe-for-bounded-eval', fetchCalls: [], cacheCalls: [] };
  const fetchCalls = [], cacheCalls = [];
  const cache = Object.freeze({
    put(...args){ cacheCalls.push({ method: 'put', argc: args.length }); },
    add(...args){ cacheCalls.push({ method: 'add', argc: args.length }); },
    addAll(...args){ cacheCalls.push({ method: 'addAll', argc: args.length }); },
    match(...args){ cacheCalls.push({ method: 'match', argc: args.length }); return null; }
  });
  const cachesMock = Object.freeze({
    open(...args){ cacheCalls.push({ method: 'open', argc: args.length }); return cache; },
    match(...args){ cacheCalls.push({ method: 'match', argc: args.length }); return null; },
    delete(...args){ cacheCalls.push({ method: 'delete', argc: args.length }); return false; },
    keys(...args){ cacheCalls.push({ method: 'keys', argc: args.length }); return []; }
  });
  const request = Object.freeze({ url: 'https://example.invalid/__ghrab_scope__/runtime-config.js', method: 'GET' });
  try {
    const context = createContext({
      CACHE_NAME: '__ghrab-security-test-cache__',
      caches: cachesMock,
      fetch: (req, options) => { fetchCalls.push({ sameRequest: req === request, options: options ? { cache: options.cache } : null }); return Object.freeze({ ok: true, __ghrabFetch: true }); }
    });
    new Script(`${source}; this.__ghrabNetworkOnlyNoStore = networkOnlyNoStore;`).runInContext(context, { timeout: 50 });
    const fn = context.__ghrabNetworkOnlyNoStore;
    if (typeof fn !== 'function') return { status: 'FAIL', reason: 'network-only-sink-not-callable', fetchCalls, cacheCalls };
    let result, error = null;
    try { result = await fn(request); } catch (e) { error = String(e); }
    const cacheWrites = cacheCalls.filter(c => ['put','add','addAll'].includes(c.method));
    const pass = !error && fetchCalls.length === 1 && fetchCalls[0].sameRequest && fetchCalls[0].options?.cache === 'no-store' && cacheCalls.length === 0;
    return { status: pass ? 'PASS' : 'FAIL', error, fetchCalls, cacheCalls, cacheWrites, resultObserved: !!result };
  } catch (e) {
    return { status: 'FAIL', reason: 'network-only-sink-behavior-eval-error', error: String(e), fetchCalls, cacheCalls, cacheWrites: cacheCalls.filter(c => ['put','add','addAll'].includes(c.method)) };
  }
}
const networkOnlySinkBody = extractFunction('networkOnlyNoStore');
const networkOnlySinkStaticWrites = [...networkOnlySinkBody.matchAll(/\.\s*(put|add|addAll)\s*\(/g)].map(m => m[1]);
if (networkOnlySinkStaticWrites.length) findings.push({
  severity: 'CRITICAL', issue: 'networkOnlyNoStore obsahuje Cache API write', detail: networkOnlySinkStaticWrites
});
const networkOnlySink = await behavioralNetworkOnlyNoStoreGuard();
if ((networkOnlySink.cacheWrites || []).length) findings.push({
  severity: 'CRITICAL', issue: 'networkOnlyNoStore zapisuje do Cache API', detail: networkOnlySink
});
else if (networkOnlySink.status !== 'PASS') findings.push({
  severity: 'MEDIUM', issue: 'networkOnlyNoStore neprokazuje fetch s cache:no-store bez Cache API', detail: networkOnlySink
});

const structuralGuard = analyzeStructuralNetworkOnlyGuard();
const structuralNetworkOnlyGuard = structuralGuard.pass;
const criticalLiterals = [...securityCriticalFn.matchAll(/(['"`])((?:\\.|(?!\1)[\s\S])*)\1/g)]
  .filter(m => !(m[1] === '`' && m[2].includes('${'))).map(m => norm(m[2]));
const structurallyExempt = file => structuralNetworkOnlyGuard
  && fetchRouteBehavior.status === 'PASS'
  && networkOnlySink.status === 'PASS'
  && behaviorallyProtected.has(norm(file))
  && criticalLiterals.some(l => norm(file).includes(l) || l.includes(norm(file)));

const hasCacheFirst = /\bcacheFirst\s*\(/.test(sw)
  || /CacheFirst|StaleWhileRevalidate|staleWhileRevalidate/.test(sw)
  || /const\s+cached\s*=\s*await\s+cache(?:s)?\.match[\s\S]{0,240}if\s*\(\s*cached\s*\)\s*return\s+cached/.test(sw);
if (hasCacheFirst) {
  for (const f of criticalFiles) {
    if (!structurallyExempt(f)) findings.push({
      severity: 'HIGH', issue: 'security-critical asset nema strukturani isSecurityCriticalRequest -> networkOnlyNoStore vyjimku pred cache-first', detail: f
    });
  }
}

// Dynamic request writes in cacheFirst/networkFirst are accepted only with the proven early-return guard.
if (!structuralNetworkOnlyGuard) {
  for (const m of sw.matchAll(/\.\s*put\s*\(\s*request\s*,/g)) {
    const fn = enclosingFunctionName(m.index);
    if (['networkFirst','cacheFirst'].includes(fn)) noteUnresolved(m.index, 'put', 'request', 'unguarded-runtime-helper');
  }
}

// Any unresolved install/precache write is AMBER, never silent PASS. Unknown writes elsewhere are also
// AMBER unless explicitly recognized as the guarded runtime-request pattern above.
for (const u of unresolvedCacheWrites) findings.push({ severity: 'MEDIUM', issue: 'unresolved-cache-write', detail: u });

for (const p of precached) if (/release-integrity\.(json|sig)$/.test(p))
  findings.push({ severity: 'CRITICAL', issue: 'integritni artefakt je precachovan - integrity check by overoval zmrazenou verzi', detail: p });

const blocking = findings.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH');
const amber = findings.filter(f => f.severity === 'MEDIUM');
const status = blocking.length ? 'FAIL' : (amber.length ? 'AMBER' : 'PASS');
const out = {
  status,
  serviceWorker: swPath,
  criticalListSource: listArg || 'DEFAULT_CRITICAL(ad-hoc only; release gate must supply authoritative list)',
  precachedEntries: precached.size,
  precacheSources,
  unresolvedCacheWrites,
  cacheFirstDetected: hasCacheFirst,
  structuralNetworkOnlyGuard,
  structuralGuard,
  behavioralGuard,
  fetchHandlerRegistrations,
  fetchRouteBehavior,
  networkOnlySink,
  criticalAssetsInDeployment: criticalFiles,
  authoritativeCriticalAssets: critical,
  findings,
  checkerRevision: 'garp-2.5.1-r4-minimal-critical-branch-hotfix',
  note: 'Static bounded Cache API analysis plus bounded behavioral evaluation of service-worker registration, isSecurityCriticalRequest, the complete unique fetch handler, and networkOnlyNoStore. PASS requires exactly one dynamically observed fetch handler registration; no pre-guard routing-sensitive read or network/cache/respondWith side effect; after a positive guard no Request/URL/FetchEvent read except event.respondWith; exactly one total routing/network/cache effect (networkOnlyNoStore); and a sink that performs exactly one fetch with cache:no-store and zero Cache API accesses. Does not replace SIM-07 or live revocation tests.'
};
console[status === 'PASS' ? 'log' : 'error'](JSON.stringify(out, null, 2));
process.exit(status === 'PASS' ? 0 : (status === 'AMBER' ? 2 : 1));

#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = path.resolve('.');
const modulePath = path.join(root, 'src', 'core', 'suiteSession.js');
const output = path.join(root, 'dist', 'qa-suite-session-node-report.json');
const GEN_KEY = 'ghrab.platform.suite-session-generation.v1';
const SEEN_KEY = 'ghrab.lesson-hub.suite-session-seen.v1';
const PROGRESS_KEY = 'ghrab.lesson-hub.suite-session-progress.v1';
const DRAFT_KEY = 'ghrab.lesson-hub.lesson-draft.v1.node-canary';
const BACKUP_KEY = 'ghrab.lesson-hub.migration.p2-storage-namespace-v1.backup';
const SESSION_KEY = 'ghrab.lesson-hub.server-session.v1';
const CANARY = 'GARP-STUDENT-CANARY-SUITE-NODE-20260905';

function fail(message, detail = null) {
  const error = new Error(message);
  error.detail = detail;
  throw error;
}
function requireCheck(condition, message, detail = null) {
  if (!condition) fail(message, detail);
}

class StorageMock {
  constructor(events, label) { this.map = new Map(); this.events = events; this.label = label; this.failRemoveKey = ''; this.failSetKey = ''; }
  get length() { return this.map.size; }
  key(index) { return [...this.map.keys()][index] ?? null; }
  getItem(key) { return this.map.has(String(key)) ? this.map.get(String(key)) : null; }
  setItem(key, value) {
    key = String(key); value = String(value);
    if (key === this.failSetKey) throw new Error('synthetic-set-failure');
    this.map.set(key, value);
    this.events.push({ op: 'set', store: this.label, key, value });
  }
  removeItem(key) {
    key = String(key);
    if (key === this.failRemoveKey) throw new Error('synthetic-delete-failure');
    this.map.delete(key);
    this.events.push({ op: 'remove', store: this.label, key });
  }
  clear() { this.map.clear(); }
}

class ElementMock {
  constructor(tag) { this.tagName = String(tag).toUpperCase(); this.dataset = {}; this.style = {}; this.children = []; this.className = ''; this.textContent = ''; }
  setAttribute(name, value) { this[name] = String(value); }
  addEventListener() {}
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
}

function setupEnvironment({ generation = '', seen = '' } = {}) {
  const events = [];
  const localStorage = new StorageMock(events, 'local');
  const sessionStorage = new StorageMock(events, 'session');
  if (generation) localStorage.map.set(GEN_KEY, generation);
  if (seen) localStorage.map.set(SEEN_KEY, seen);
  let dbPresent = true;
  const documentElement = new ElementMock('html');
  const body = new ElementMock('body');
  globalThis.localStorage = localStorage;
  globalThis.sessionStorage = sessionStorage;
  globalThis.document = {
    documentElement,
    body,
    createElement: (tag) => new ElementMock(tag),
    querySelector: () => null,
  };
  globalThis.location = { reload() {} };
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  globalThis.indexedDB = {
    deleteDatabase(name) {
      const request = {};
      setTimeout(() => { dbPresent = false; request.onsuccess?.(); }, 0);
      return request;
    },
  };

  let handler = null;
  let currentGeneration = generation;
  const session = {
    contract: 'ghrab-suite-session-v1',
    generation: () => currentGeneration,
    seen: () => localStorage.getItem(SEEN_KEY) || '',
    pending: () => Boolean(currentGeneration && localStorage.getItem(SEEN_KEY) !== currentGeneration),
    acknowledge(gen) { localStorage.setItem(SEEN_KEY, String(gen)); return localStorage.getItem(SEEN_KEY) === String(gen); },
    onEnd(fn, { replay = true } = {}) {
      handler = fn;
      if (replay && currentGeneration && localStorage.getItem(SEEN_KEY) !== currentGeneration) {
        queueMicrotask(async () => {
          const result = await handler({ schema: 'ghrab-suite-session-v1', generation: currentGeneration, reason: 'replay', clearApplicationData: true, appId: 'lesson-hub' });
          if (result !== false && result?.ok !== false) session.acknowledge(currentGeneration);
        });
      }
      return () => { if (handler === fn) handler = null; };
    },
    async emit(gen, reason = 'node-test') {
      currentGeneration = String(gen);
      localStorage.setItem(GEN_KEY, currentGeneration);
      if (!handler) return { ok: false, reason: 'no-handler', generation: currentGeneration };
      const result = await handler({ schema: 'ghrab-suite-session-v1', generation: currentGeneration, reason, clearApplicationData: true, appId: 'lesson-hub' });
      const ok = result !== false && result?.ok !== false;
      if (ok) session.acknowledge(currentGeneration);
      return { ok, generation: currentGeneration, handlerResult: result };
    },
  };
  globalThis.GHRAB_PLATFORM = { version: '1.1.2', session };
  return { events, localStorage, sessionStorage, session, dbPresent: () => dbPresent };
}

async function runWorker(scenario, targetModule) {
  const env = setupEnvironment(scenario === 'delayed' ? { generation: 'node-delayed-generation' } : {});
  env.localStorage.setItem(DRAFT_KEY, JSON.stringify({ canary: CANARY }));
  env.localStorage.setItem(BACKUP_KEY, JSON.stringify({ canary: CANARY }));
  env.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: 'synthetic-token' }));
  let runtimeCanary = CANARY;
  const mod = await import(`${pathToFileURL(targetModule).href}?worker=${process.pid}-${Date.now()}`);
  mod.registerSuiteRuntimeCleanup(() => { runtimeCanary = ''; return { ok: true }; });

  if (scenario === 'failclosed') env.localStorage.failRemoveKey = DRAFT_KEY;
  const installed = await mod.installSuiteSessionLifecycle();

  if (scenario === 'delayed') {
    await new Promise((resolve) => setTimeout(resolve, 30));
    const generation = 'node-delayed-generation';
    const progress = JSON.parse(env.localStorage.getItem(PROGRESS_KEY) || 'null');
    requireCheck(env.localStorage.getItem(SEEN_KEY) === generation, 'Delayed replay did not acknowledge after cleanup', { installed, progress });
    requireCheck(progress?.status === 'cleanup-completed', 'Delayed replay did not complete cleanup', progress);
    requireCheck(env.localStorage.getItem(DRAFT_KEY) === null && env.localStorage.getItem(BACKUP_KEY) === null, 'Delayed replay left local canary');
    requireCheck(env.sessionStorage.getItem(SESSION_KEY) === null && env.dbPresent() === false && runtimeCanary === '', 'Delayed replay left session/db/runtime canary');
    console.log(JSON.stringify({ scenario, status: 'passed', generation, progressStatus: progress.status }));
    return;
  }

  const generation = `node-${scenario}-generation`;
  const result = await env.session.emit(generation, scenario);
  const progress = JSON.parse(env.localStorage.getItem(PROGRESS_KEY) || 'null');

  if (scenario === 'failclosed') {
    requireCheck(result.ok === false, 'Fail-closed handler incorrectly reported success', result);
    requireCheck(env.localStorage.getItem(SEEN_KEY) !== generation, 'Fail-closed path wrote acknowledgement', { result, progress });
    requireCheck(progress?.status === 'cleanup-failed', 'Fail-closed progress was not cleanup-failed', progress);
    requireCheck(env.localStorage.getItem(DRAFT_KEY) !== null, 'Synthetic undeletable canary disappeared unexpectedly');
    requireCheck(globalThis.__LESSON_HUB_PERSISTENCE_BLOCKED__?.generation === generation, 'Persistence was not blocked after failure');
    console.log(JSON.stringify({ scenario, status: 'passed', generation, progressStatus: progress.status }));
    return;
  }

  requireCheck(result.ok === true, 'Suite handler did not complete', result);
  requireCheck(env.localStorage.getItem(DRAFT_KEY) === null && env.localStorage.getItem(BACKUP_KEY) === null, 'Local canary remained after cleanup');
  requireCheck(env.sessionStorage.getItem(SESSION_KEY) === null, 'Session canary remained after cleanup');
  requireCheck(env.dbPresent() === false, 'IndexedDB delete was not requested/completed');
  requireCheck(runtimeCanary === '', 'Runtime cleanup hook did not clear memory canary');
  requireCheck(progress?.status === 'cleanup-completed' && progress?.generation === generation, 'Cleanup completion evidence missing', progress);
  requireCheck(env.localStorage.getItem(SEEN_KEY) === generation, 'Acknowledgement missing after cleanup');
  const seenIndex = env.events.findIndex((item) => item.op === 'set' && item.key === SEEN_KEY && item.value === generation);
  const completedIndex = env.events.findIndex((item) => item.op === 'set' && item.key === PROGRESS_KEY && item.value.includes('cleanup-completed'));
  requireCheck(completedIndex >= 0 && seenIndex > completedIndex, 'Acknowledgement was written before cleanup-completed evidence', { completedIndex, seenIndex, events: env.events });
  const draft = await import(`${pathToFileURL(path.join(path.dirname(targetModule), 'draftStorage.js')).href}?worker=${process.pid}-${Date.now()}`).catch(() => null);
  if (draft) {
    const late = draft.saveLessonDraft(DRAFT_KEY, { canary: CANARY, late: true });
    requireCheck(late?.blocked === true && env.localStorage.getItem(DRAFT_KEY) === null, 'Late autosave was not blocked', late);
  }
  if (scenario === 'idempotent') {
    const before = env.events.filter((item) => item.op === 'set' && item.key === PROGRESS_KEY && item.value.includes('cleanup-completed')).length;
    const repeated = await env.session.emit(generation, 'repeat');
    const after = env.events.filter((item) => item.op === 'set' && item.key === PROGRESS_KEY && item.value.includes('cleanup-completed')).length;
    requireCheck(repeated.ok === true && before === after, 'Repeated signal re-ran cleanup completion write', { before, after, repeated });
  }
  console.log(JSON.stringify({ scenario, status: 'passed', generation, progressStatus: progress.status, ackAfterCleanup: true }));
}

function runChild(scenario, target) {
  const child = spawnSync(process.execPath, [new URL(import.meta.url).pathname, '--worker', scenario, target], { cwd: root, encoding: 'utf8' });
  return { scenario, status: child.status === 0 ? 'passed' : 'failed', exitCode: child.status, stdout: child.stdout.trim(), stderr: child.stderr.trim() };
}

if (process.argv[2] === '--worker') {
  try { await runWorker(process.argv[3], process.argv[4]); }
  catch (error) { console.error(JSON.stringify({ scenario: process.argv[3], status: 'failed', message: error.message, detail: error.detail || null })); process.exitCode = 1; }
} else {
  await fsp.mkdir(path.dirname(output), { recursive: true });
  const scenarios = ['open', 'delayed', 'failclosed', 'idempotent'].map((scenario) => runChild(scenario, modulePath));
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'lesson-hub-suite-negative-'));
  const tempCore = path.join(temp, 'core');
  await fsp.mkdir(tempCore, { recursive: true });
  for (const name of ['suiteSession.js', 'persistenceGuard.js', 'draftStorage.js']) await fsp.copyFile(path.join(root, 'src', 'core', name), path.join(tempCore, name));
  const negativePath = path.join(tempCore, 'suiteSession.js');
  let negativeSource = await fsp.readFile(negativePath, 'utf8');
  const needle = "removePlatformHandler = session.onEnd((detail) => performCleanup(detail), { replay: true });";
  if (!negativeSource.includes(needle)) fail('Negative-control patch point not found');
  negativeSource = negativeSource.replace(needle, "removePlatformHandler = () => {}; /* NEGATIVE CONTROL: handler intentionally disabled */");
  await fsp.writeFile(negativePath, negativeSource);
  const negativeRaw = runChild('open', negativePath);
  const negativeControl = { status: negativeRaw.status === 'failed' ? 'passed' : 'failed', expectedTestResult: 'FAIL', observedExitCode: negativeRaw.exitCode, stderr: negativeRaw.stderr };
  await fsp.rm(temp, { recursive: true, force: true });

  const failed = scenarios.filter((item) => item.status !== 'passed');
  if (negativeControl.status !== 'passed') failed.push({ scenario: 'negative-control' });
  const report = {
    schema: 'ghrab-suite-session-node-test-v1',
    appId: 'lesson-hub',
    appVersion: JSON.parse(await fsp.readFile(path.join(root, 'package.json'), 'utf8')).version,
    platformVersion: '1.1.2',
    syntheticCanary: CANARY,
    scenarios,
    negativeControl,
    limitations: ['Node integration harness validates actual child cleanup module and fail-closed acknowledgement ordering, but it is not a substitute for real multi-tab, BFCache, or browser storage lifecycle testing.'],
    status: failed.length ? 'failed' : 'passed',
  };
  await fsp.writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ schema: report.schema, status: report.status, scenarios: scenarios.map((x) => ({ scenario: x.scenario, status: x.status })), negativeControl }, null, 2));
  if (failed.length) process.exitCode = 1;
}

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createStore, assertStoreAdapter, STORE_ADAPTER_CONTRACT } from './lib/storeFactory.mjs';

const dir = await mkdtemp(path.join(os.tmpdir(), 'lesson-hub-capacity-'));
const file = path.join(dir, 'store.json');
const qaFile = path.resolve('qa/lesson-hub-capacity-baseline.json');
const config = { storageDriver: 'json', dataFile: file };
const thresholds = Object.freeze({ seedRecords: 9000, concurrentSaves: 120, maxFileBytes: 18 * 1024 * 1024, maxSeedSaveMs: 20_000, maxConcurrentMs: 30_000, maxReopenMs: 8_000 });
const started = new Date().toISOString();
const store = assertStoreAdapter(createStore(config));
try {
  const openStart = performance.now();
  await store.open();
  const initialOpenMs = performance.now() - openStart;
  assert.equal(STORE_ADAPTER_CONTRACT, 'lesson-hub-store-adapter-v1');

  const now = new Date().toISOString();
  const lessons = store.resource('lessons');
  const students = store.resource('students');
  const materials = store.resource('materials');
  for (let i = 0; i < 6000; i += 1) lessons[`lesson_${i}`] = { id: `lesson_${i}`, ownerId: 'capacity_owner', title: `Lekce ${i}`, note: 'x'.repeat(120), createdAt: now, updatedAt: now };
  for (let i = 0; i < 2000; i += 1) students[`student_${i}`] = { id: `student_${i}`, ownerId: 'capacity_owner', pseudonym: `S-${i}`, note: 'y'.repeat(64), createdAt: now, updatedAt: now };
  for (let i = 0; i < 1000; i += 1) materials[`material_${i}`] = { id: `material_${i}`, ownerId: 'capacity_owner', title: `Materiál ${i}`, body: 'z'.repeat(256), createdAt: now, updatedAt: now };
  const seedStart = performance.now();
  await store.save();
  const seedSaveMs = performance.now() - seedStart;

  const concurrentStart = performance.now();
  const saves = [];
  for (let i = 0; i < thresholds.concurrentSaves; i += 1) {
    store.resource('quickNotes')[`concurrent_${i}`] = { id: `concurrent_${i}`, ownerId: 'capacity_owner', text: `Souběžná změna ${i}`, createdAt: now, updatedAt: new Date().toISOString() };
    saves.push(store.save());
  }
  await Promise.all(saves);
  const concurrentMs = performance.now() - concurrentStart;

  const payload = JSON.parse(await readFile(file, 'utf8'));
  const info = await stat(file);
  assert.equal(Object.keys(payload.resources.lessons).length, 6000);
  assert.equal(Object.keys(payload.resources.students).length, 2000);
  assert.equal(Object.keys(payload.resources.materials).length, 1000);
  assert.equal(Object.keys(payload.resources.quickNotes).length, thresholds.concurrentSaves);
  assert.equal(payload.schema, 'lesson-hub-server-store-v3');

  const reopened = createStore(config);
  const reopenStart = performance.now();
  await reopened.open();
  const reopenMs = performance.now() - reopenStart;
  assert.equal(Object.keys(reopened.resource('quickNotes')).length, thresholds.concurrentSaves);

  reopened.freeze();
  await assert.rejects(() => reopened.save(), (error) => error?.status === 503 && error?.code === 'store_frozen');
  reopened.unfreeze();
  reopened.resource('quickNotes').afterUnfreeze = { id: 'afterUnfreeze', ownerId: 'capacity_owner', text: 'ok', createdAt: now, updatedAt: now };
  await reopened.save();

  assert.ok(info.size <= thresholds.maxFileBytes, `Datový soubor je příliš velký: ${info.size}`);
  assert.ok(seedSaveMs <= thresholds.maxSeedSaveMs, `Seed save je příliš pomalý: ${seedSaveMs.toFixed(1)} ms`);
  assert.ok(concurrentMs <= thresholds.maxConcurrentMs, `Souběžné zápisy jsou příliš pomalé: ${concurrentMs.toFixed(1)} ms`);
  assert.ok(reopenMs <= thresholds.maxReopenMs, `Reopen je příliš pomalý: ${reopenMs.toFixed(1)} ms`);

  const report = {
    schema: 'lesson-hub-capacity-report-v1', appVersion: '1.2.11', storageContract: STORE_ADAPTER_CONTRACT,
    startedAt: started, completedAt: new Date().toISOString(), profile: { node: process.version, platform: process.platform, architecture: process.arch },
    dataset: { lessons: 6000, students: 2000, materials: 1000, concurrentNotes: thresholds.concurrentSaves, totalSeedRecords: thresholds.seedRecords },
    measurements: { initialOpenMs, seedSaveMs, concurrentMs, reopenMs, fileBytes: info.size }, thresholds,
    assertions: { jsonValid: true, queuedAtomicWrites: true, allConcurrentMutationsPersisted: true, freezeFailClosed: true, reopenValid: true }, status: 'passed',
  };
  await import('node:fs/promises').then(({ mkdir, writeFile }) => mkdir(path.dirname(qaFile), { recursive: true }).then(() => writeFile(qaFile, `${JSON.stringify(report, null, 2)}\n`)));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await rm(dir, { recursive: true, force: true });
}

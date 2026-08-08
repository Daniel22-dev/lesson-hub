#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { JsonStore } from './lib/store.mjs';
import { exportMigrationBundle } from './lib/persistence.mjs';

const RESOURCE_COUNT = Number(process.env.LESSON_HUB_CAPACITY_RESOURCES || 5000);
const CONCURRENT_MUTATIONS = Number(process.env.LESSON_HUB_CAPACITY_MUTATIONS || 120);
const MAX_FILE_BYTES = Number(process.env.LESSON_HUB_CAPACITY_MAX_BYTES || 25 * 1024 * 1024);
const MAX_TOTAL_MS = Number(process.env.LESSON_HUB_CAPACITY_MAX_MS || 60000);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lesson-hub-capacity-'));
const file = path.join(temp, 'store.json');
const output = path.join(temp, 'migration');
const store = await new JsonStore(file).open();
const started = performance.now();

await store.transact((data) => {
  data.users = Array.from({ length: 300 }, (_, index) => ({ id: `user-${index + 1}`, role: index < 20 ? 'admin' : 'teacher', active: true }));
  data.resources.lessons = Object.fromEntries(Array.from({ length: RESOURCE_COUNT }, (_, index) => {
    const id = `lesson-${index + 1}`;
    return [id, { id, ownerId: `user-${(index % 300) + 1}`, title: `Lesson ${index + 1}`, tags: ['capacity', `group-${index % 20}`], updatedAt: new Date(1700000000000 + index * 1000).toISOString() }];
  }));
});

const mutationStarted = performance.now();
const latencies = await Promise.all(Array.from({ length: CONCURRENT_MUTATIONS }, (_, index) => {
  const begin = performance.now();
  return store.transact((data) => {
    const key = `concurrent-${index + 1}`;
    data.resources.capacity = data.resources.capacity || {};
    data.resources.capacity[key] = { id: key, sequence: index + 1, checksum: `value-${index + 1}` };
    data.nextCursor += 1;
  }).then(() => performance.now() - begin);
}));
const mutationMs = performance.now() - mutationStarted;

const reloaded = await new JsonStore(file).open();
assert.equal(Object.keys(reloaded.data.resources.lessons || {}).length, RESOURCE_COUNT, 'Bulk resources were not persisted.');
assert.equal(Object.keys(reloaded.data.resources.capacity || {}).length, CONCURRENT_MUTATIONS, 'Concurrent mutations were lost.');
assert.equal(new Set(Object.values(reloaded.data.resources.capacity).map((row) => row.sequence)).size, CONCURRENT_MUTATIONS, 'Concurrent mutation values are not unique.');
const migration = await exportMigrationBundle(reloaded.data, output);
const fileBytes = fs.statSync(file).size;
const totalMs = performance.now() - started;
const sorted = [...latencies].sort((a, b) => a - b);
const percentile = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] || 0;
const report = {
  schema: 'lesson-hub-capacity-report-v1',
  measuredAt: new Date().toISOString(),
  referenceProfile: { cpu: 'CI/container', storage: 'local atomic JSON', node: process.version },
  dataset: { users: 300, resources: RESOURCE_COUNT, concurrentMutations: CONCURRENT_MUTATIONS },
  metrics: {
    fileBytes,
    totalMs: Number(totalMs.toFixed(2)),
    mutationPhaseMs: Number(mutationMs.toFixed(2)),
    mutationsPerSecond: Number((CONCURRENT_MUTATIONS / (mutationMs / 1000)).toFixed(2)),
    transactionLatencyP50Ms: Number(percentile(0.50).toFixed(2)),
    transactionLatencyP95Ms: Number(percentile(0.95).toFixed(2)),
    transactionLatencyMaxMs: Number(percentile(1).toFixed(2)),
    migrationArtifacts: Object.keys(migration.artifacts).length,
  },
  thresholds: { maxFileBytes: MAX_FILE_BYTES, maxTotalMs: MAX_TOTAL_MS, noLostMutations: true },
  status: fileBytes <= MAX_FILE_BYTES && totalMs <= MAX_TOTAL_MS ? 'passed' : 'failed',
  guidance: {
    jsonPilotCeiling: '300 users / 5000 lesson resources / one Node process',
    databaseMigrationTrigger: 'Migrate before multi-process deployment, sustained file size above 25 MiB, more than 10000 active resources, or p95 write latency above 1000 ms in production telemetry.',
  },
};
fs.mkdirSync(path.join('server', 'output'), { recursive: true });
fs.writeFileSync(path.join('server', 'output', 'capacity-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
fs.rmSync(temp, { recursive: true, force: true });
if (report.status !== 'passed') process.exit(1);

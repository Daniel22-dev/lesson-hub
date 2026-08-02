import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, utimes } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLessonHubServer } from './app.mjs';
import { hashPassword } from './lib/security.mjs';

const dir = await mkdtemp(path.join(os.tmpdir(), 'lesson-hub-operations-'));
const config = {
  host: '127.0.0.1', port: 0,
  dataFile: path.join(dir, 'server.json'),
  attachmentsDir: path.join(dir, 'attachments'),
  backupDir: path.join(dir, 'backups'),
  backupEnabled: false,
  backupIntervalHours: 24,
  backupRetentionCount: 2,
  operationsIntervalMs: 60_000,
  allowedOrigins: ['http://localhost:4173'], sessionHours: 1,
  bodyLimitBytes: 12 * 1024 * 1024, attachmentLimitBytes: 8 * 1024 * 1024,
  loginWindowMs: 60_000, loginAttempts: 5,
  mailMode: 'disabled', mailSchedulerEnabled: false,
};
const { server, store, operations } = await createLessonHubServer({ config });
const now = new Date().toISOString();
store.data.users.push({
  id: 'user_owner', email: ['owner', 'example.test'].join('@'), displayName: 'Owner', role: 'owner', status: 'active',
  passwordHash: hashPassword('OperationsTest1234'), createdAt: now, updatedAt: now, lastLoginAt: null,
});
store.resource('lessons').baseline = { id: 'baseline', ownerId: 'user_owner', title: 'Původní stav', createdAt: now, updatedAt: now };
await store.save();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

async function request(route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  return { response, payload };
}

async function login() {
  const result = await request('/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: ['owner', 'example.test'].join('@'), password: 'OperationsTest1234' }) });
  assert.equal(result.response.status, 200);
  return { authorization: `Bearer ${result.payload.token}` };
}

try {
  let auth = await login();
  const statusBefore = await request('/v1/operations/status', { headers: auth });
  assert.equal(statusBefore.response.status, 200);
  assert.equal(statusBefore.payload.status.backups.count, 0);
  assert.equal(statusBefore.payload.status.records.resources.lessons, 1);

  const created = await request('/v1/operations/backups', { method: 'POST', headers: auth, body: JSON.stringify({ reason: 'operations-test' }) });
  assert.equal(created.response.status, 201);
  assert.equal(created.payload.backup.reason, 'operations-test');
  const backupId = created.payload.backup.id;

  const listed = await request('/v1/operations/backups', { headers: auth });
  assert.equal(listed.payload.items.some((item) => item.id === backupId), true);

  store.resource('lessons').temporary = { id: 'temporary', ownerId: 'user_owner', title: 'Dočasný stav', createdAt: now, updatedAt: now };
  await store.save();
  assert.equal(Boolean(store.resource('lessons').temporary), true);

  const maintenance = await request('/v1/operations/maintenance', { method: 'POST', headers: auth, body: JSON.stringify({ createBackup: true, processMessages: false }) });
  assert.equal(maintenance.response.status, 200);
  assert.equal(Boolean(maintenance.payload.result.backup?.id), true);

  const restored = await request(`/v1/operations/backups/${encodeURIComponent(backupId)}/restore`, { method: 'POST', headers: auth, body: '{}' });
  assert.equal(restored.response.status, 200);
  assert.equal(restored.payload.restored.id, backupId);
  assert.equal(Boolean(restored.payload.safetyBackup.id), true);
  assert.equal(Boolean(store.resource('lessons').baseline), true);
  assert.equal(Boolean(store.resource('lessons').temporary), false);
  assert.equal(store.data.sessions.length, 0);

  const deniedOldSession = await request('/v1/operations/status', { headers: auth });
  assert.equal(deniedOldSession.response.status, 401);
  auth = await login();

  const afterRestore = await request('/v1/operations/status', { headers: auth });
  assert.equal(afterRestore.response.status, 200);
  assert.ok(afterRestore.payload.status.backups.count >= 2);
  assert.equal(restored.payload.sessionsInvalidated, true);
  assert.equal(afterRestore.payload.status.storage.dataBytes > 0, true);

  const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000);
  const orphanTemporary = path.join(config.backupDir, '.tmp-backup_orphan');
  const orphanBackup = path.join(config.backupDir, 'backup_orphan');
  await mkdir(orphanTemporary, { recursive: true });
  await mkdir(orphanBackup, { recursive: true });
  await utimes(orphanTemporary, oldTime, oldTime);
  await utimes(orphanBackup, oldTime, oldTime);
  const prunedOrphans = await operations.pruneBackups();
  assert.equal(prunedOrphans.includes('.tmp-backup_orphan'), true);
  assert.equal(prunedOrphans.includes('backup_orphan'), true);

  const remaining = await request('/v1/operations/backups', { headers: auth });
  const removableId = remaining.payload.items[0].id;
  const deleted = await request(`/v1/operations/backups/${encodeURIComponent(removableId)}`, { method: 'DELETE', headers: auth });
  assert.equal(deleted.response.status, 200);
  assert.equal(deleted.payload.backup.id, removableId);

  console.log('Provozní testy prošly: status, snapshot, údržba, bezpečnostní snapshot, obnova, ukončení relací, úklid osiřelých adresářů a odstranění zálohy.');
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
}

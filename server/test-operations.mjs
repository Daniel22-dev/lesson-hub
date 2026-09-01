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
store.data.users.push(
  { id: 'user_b', email: 'restore-b@example.invalid', displayName: 'Restore B', role: 'teacher', status: 'active', passwordHash: hashPassword('RestoreBPassword123'), createdAt: now, updatedAt: now, lastLoginAt: null },
  { id: 'user_s', email: 'restore-s@example.invalid', displayName: 'Restore S', role: 'substitute', status: 'active', passwordHash: hashPassword('RestoreSPassword123'), createdAt: now, updatedAt: now, lastLoginAt: null },
);
store.resource('lessons').baseline = { id: 'baseline', ownerId: 'user_owner', title: 'Původní stav', createdAt: now, updatedAt: now };
// Deliberately create a pre-hardening state after server startup so the backup
// contains legacy values that must be normalized on restore.
store.resource('students').legacy_restore_student = { id: 'legacy_restore_student', ownerId: 'user_owner', displayName: 'GARP-STUDENT-CANARY-K3-RESTORE-STUDENT', visibility: 'shared', createdAt: now, updatedAt: now };
store.resource('messages').legacy_restore_message = { id: 'legacy_restore_message', ownerId: 'user_owner', subject: 'GARP-STUDENT-CANARY-K3-RESTORE-MESSAGE', body: 'Synthetic only', status: 'draft', visibility: 'shared', createdAt: now, updatedAt: now };
store.resource('materials').legacy_restore_material = { id: 'legacy_restore_material', ownerId: 'user_owner', title: 'Legitimate shared restore material', visibility: 'shared', createdAt: now, updatedAt: now };
store.data.changes.push({ cursor: store.nextCursor(), id: 'legacy_restore_change', schema: 'lesson-hub-sync-v1', resource: 'students', entityId: 'legacy_restore_student', operation: 'upsert', payload: { ...store.resource('students').legacy_restore_student }, ownerId: 'user_owner', actorId: 'user_owner', clientId: 'legacy', clientChangeId: 'legacy', timestamp: now });
store.data.audit.push({ id: 'legacy_restore_audit', actorId: null, action: 'auth-login-failed', entityType: 'attachment', entityId: 'legacy_attachment', metadata: { fileName: 'GARP-SYNTH-K3-RESTORE-FILENAME', email: 'legacy-restore@example.invalid', emailHash: 'legacy-unsalted-hash-placeholder' }, ip: '', timestamp: now });
await store.save();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

async function request(route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  return { response, payload };
}

async function login(email = ['owner', 'example.test'].join('@'), password = 'OperationsTest1234') {
  const result = await request('/v1/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
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

  // Current live state is cleaned before restore; the backup remains the legacy source.
  store.resource('students').legacy_restore_student.visibility = 'private';
  store.resource('messages').legacy_restore_message.visibility = 'private';
  store.data.audit = store.data.audit.filter((item) => item.id !== 'legacy_restore_audit');
  await store.save();

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
  assert.equal(restored.payload.normalization.changed > 0, true, 'Restore musí po store.open() provést normalizaci legacy stavu.');
  assert.equal(store.resource('students').legacy_restore_student.visibility, 'private', 'Legacy shared student musí být po restore normalizován na private.');
  assert.equal(store.resource('messages').legacy_restore_message.visibility, 'private', 'Legacy shared message musí být po restore normalizována na private.');
  assert.equal(store.resource('materials').legacy_restore_material.visibility, 'shared', 'Legitimní shared material musí po restore zůstat shared.');
  const restoredChange = store.data.changes.find((item) => item.id === 'legacy_restore_change');
  assert.equal(restoredChange?.payload?.visibility, 'private', 'Legacy sync payload nesmí po restore znovu nést broad shared visibility pro studenty.');
  const restoredAudit = store.data.audit.find((item) => item.id === 'legacy_restore_audit');
  assert.equal(Boolean(restoredAudit), true);
  assert.equal(Object.prototype.hasOwnProperty.call(restoredAudit.metadata || {}, 'fileName'), false, 'Restore musí odstranit legacy fileName z auditu.');
  assert.equal(Object.prototype.hasOwnProperty.call(restoredAudit.metadata || {}, 'email'), false, 'Restore musí odstranit legacy raw e-mail z auditu.');
  assert.equal(Object.prototype.hasOwnProperty.call(restoredAudit.metadata || {}, 'emailHash'), false, 'Restore musí odstranit i legacy nesolený emailHash.');

  const deniedOldSession = await request('/v1/operations/status', { headers: auth });
  assert.equal(deniedOldSession.response.status, 401);
  auth = await login();
  const authB = await login('restore-b@example.invalid', 'RestoreBPassword123');
  const authS = await login('restore-s@example.invalid', 'RestoreSPassword123');
  assert.equal((await request('/v1/students/legacy_restore_student', { headers: authB })).response.status, 404, 'Cizí učitel nesmí po restore číst legacy shared student record.');
  assert.equal((await request('/v1/students/legacy_restore_student', { headers: authS })).response.status, 404, 'Substitute nesmí po restore číst legacy shared student record.');
  assert.equal((await request('/v1/messages/legacy_restore_message', { headers: authB })).response.status, 404, 'Cizí učitel nesmí po restore číst legacy shared message.');
  assert.equal((await request('/v1/materials/legacy_restore_material', { headers: authB })).response.status, 200, 'Restore normalizace nesmí rozbít legitimní shared material.');

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

  console.log('Provozní testy prošly: status, snapshot, údržba, bezpečnostní snapshot, obnova, normalizace legacy visibility/auditu, ukončení relací, úklid osiřelých adresářů a odstranění zálohy.');
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
}

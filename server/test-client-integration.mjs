import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLessonHubServer, SYNC_CONTRACT } from './app.mjs';
import { hashPassword } from './lib/security.mjs';
import { createDatabase } from '../src/core/database.js';
import { createRepositories } from '../src/repositories/repositoryFactory.js';
import { ServerService } from '../src/services/serverService.js';
import { SyncService } from '../src/services/syncService.js';

const dir = await mkdtemp(path.join(os.tmpdir(), 'lesson-hub-integration-'));
const config = {
  host: '127.0.0.1', port: 0, dataFile: path.join(dir, 'server.json'), allowedOrigins: [],
  sessionHours: 1, bodyLimitBytes: 12 * 1024 * 1024, attachmentLimitBytes: 8 * 1024 * 1024, attachmentsDir: path.join(dir, 'attachments'), loginWindowMs: 60_000, loginAttempts: 5,
};
const { server, store } = await createLessonHubServer({ config });
const email = ['integration', 'example.test'].join('@');
const password = 'IntegrationTest1234';
const now = new Date().toISOString();
store.data.users.push({ id: 'user_integration', email, displayName: 'Integration', role: 'owner', status: 'active', passwordHash: hashPassword(password), createdAt: now, updatedAt: now, lastLoginAt: null });
await store.save();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

try {
  const database = await createDatabase();
  const repositories = createRepositories(database);
  const serverService = new ServerService({ fetchImpl: fetch });
  serverService.configure({ baseUrl });
  await serverService.login({ email, password });
  const sync = new SyncService(repositories, serverService);

  const year = await repositories.schoolYears.create({ label: '2030/2031', startDate: '2030-09-01', endDate: '2031-08-31', status: 'active', isCurrent: true });
  await repositories.auditEvents.create({ entityType: 'schoolYear', entityId: year.id, action: 'school-year-created', timestamp: new Date().toISOString(), metadata: { label: year.label } });
  const first = await sync.synchronize();
  assert.equal(first.pushed.accepted, 1);
  assert.equal(store.resource('schoolYears')[year.id].label, '2030/2031');

  const remoteSubject = { id: 'subject_remote', name: 'Vzdálený předmět', shortName: 'VP', status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const remoteResponse = await fetch(`${baseUrl}/v1/sync/push`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${serverService.session.token}` },
    body: JSON.stringify({ schema: SYNC_CONTRACT, clientId: 'other-device', changes: [{ id: 'remote_change_1', resource: 'subjects', entityId: remoteSubject.id, operation: 'upsert', payload: remoteSubject }] }),
  });
  assert.equal(remoteResponse.status, 200);
  const pulled = await sync.pullRemote();
  assert.equal(pulled.applied >= 1, true);
  assert.equal((await repositories.subjects.get(remoteSubject.id)).name, 'Vzdálený předmět');

  await serverService.logout();
  await database.close();
  console.log('Klient-server integrační test prošel: login, push, pull a aplikace vzdálené změny.');
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
}

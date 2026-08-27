import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLessonHubServer, SYNC_CONTRACT } from './app.mjs';
import { SERVER_API_CONTRACT } from '../src/server/dataGateway.js';
import { JsonStore } from './lib/store.mjs';
import { hashPassword } from './lib/security.mjs';
import { updateItemProgress } from './lib/substitution.mjs';
import { MessageDispatcher } from './lib/messageDispatcher.mjs';

const dir = await mkdtemp(path.join(os.tmpdir(), 'lesson-hub-audit-regressions-'));
try {
  const recoverFile = path.join(dir, 'recover', 'server.json');
  const recoverStore = new JsonStore(recoverFile);
  await mkdir(path.dirname(recoverFile), { recursive: true });
  await recoverStore.open();
  recoverStore.filePath = path.join(dir, 'temporarily-missing', 'server.json');
  await assert.rejects(() => recoverStore.save());
  await mkdir(path.dirname(recoverStore.filePath), { recursive: true });
  await recoverStore.save();
  assert.equal(recoverStore.consecutiveWriteFailures, 0, 'Zápisová fronta se musí po odstranění chyby zotavit.');

  const config = {
    host: '127.0.0.1', port: 0, dataFile: path.join(dir, 'api.json'), attachmentsDir: path.join(dir, 'attachments'),
    allowedOrigins: ['http://localhost:4173'], sessionHours: 1, bodyLimitBytes: 2_000_000, attachmentLimitBytes: 1_000_000,
    loginWindowMs: 60_000, loginAttempts: 5, mailMode: 'disabled', mailSchedulerEnabled: false,
    mailSchedulerIntervalMs: 60_000, mailMaxAttempts: 3, mailRetryMinutes: 1,
    backupDir: path.join(dir, 'backups'), backupEnabled: false, backupRetentionCount: 3, backupIntervalHours: 24, operationsIntervalMs: 60_000,
  };
  const { server, store } = await createLessonHubServer({ config });
  const now = new Date().toISOString();
  store.data.users.push({ id: 'owner', email: 'owner@example.test', displayName: 'Owner', role: 'owner', status: 'active', passwordHash: hashPassword('OwnerPassword123'), createdAt: now, updatedAt: now });
  await store.save();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (route, { token = '', ...options } = {}) => {
    const response = await fetch(`${base}${route}`, { ...options, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) } });
    const payload = response.status === 204 ? null : await response.json().catch(() => null);
    return { response, payload };
  };
  try {
    const health = await api('/health');
    assert.deepEqual(Object.keys(health.payload).sort(), ['status', 'version']);
    assert.equal(health.response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(health.response.headers.get('x-frame-options'), 'DENY');

    const ownerLogin = await api('/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: 'owner@example.test', password: 'OwnerPassword123' }) });
    const ownerToken = ownerLogin.payload.token;
    const ownerAuth = { token: ownerToken };

    const weak = await api('/v1/users', { ...ownerAuth, method: 'POST', body: JSON.stringify({ email: 'weak@example.test', password: 'short1', role: 'teacher' }) });
    assert.equal(weak.response.status, 400);
    assert.equal(weak.payload.error, 'password_weak');

    const unsafeUrlRecord = await api('/v1/materials', { ...ownerAuth, method: 'POST', body: JSON.stringify({ id: 'unsafe_url_material', title: 'Probe', url: 'javascript:alert(1)', visibility: 'shared' }) });
    assert.equal(unsafeUrlRecord.response.status, 400, 'Server nesmí přijmout nebezpečný URL protokol do sdíleného záznamu.');
    assert.equal(unsafeUrlRecord.payload.error, 'record_schema_invalid');
    const prototypeRecord = await api('/v1/materials', { ...ownerAuth, method: 'POST', body: '{"id":"prototype_material","title":"Probe","__proto__":{"polluted":true}}' });
    assert.equal(prototypeRecord.response.status, 400, 'Server nesmí přijmout prototype-pollution klíč.');
    assert.equal(prototypeRecord.payload.error, 'record_schema_invalid');
    const aliasUrlRecord = await api('/v1/materials', { ...ownerAuth, method: 'POST', body: JSON.stringify({ id: 'unsafe_alias_material', title: 'Probe', link: 'javascript:alert(1)', visibility: 'shared' }) });
    assert.equal(aliasUrlRecord.response.status, 400, 'Server nesmí přijmout nebezpečný protokol ani v URL alias poli.');
    assert.equal(aliasUrlRecord.payload.error, 'record_schema_invalid');
    const textWithColon = await api('/v1/materials', { ...ownerAuth, method: 'POST', body: JSON.stringify({ id: 'safe_text_colon', title: 'Data: interpretace výsledků', visibility: 'private' }) });
    assert.equal(textWithColon.response.status, 201, 'Běžný pedagogický text s dvojtečkou nesmí být URL hardeningem odmítnut.');
    const guardRecord = await api('/v1/materials', { ...ownerAuth, method: 'POST', body: JSON.stringify({ id: 'prototype_guard', title: 'Zachovat', visibility: 'private' }) });
    assert.equal(guardRecord.response.status, 201);
    assert.equal(Object.getPrototypeOf(store.resource('materials')), null, 'Serverové resource mapy musí být bez prototypu.');
    const prototypeIdPush = await api('/v1/sync/push', { ...ownerAuth, method: 'POST', body: JSON.stringify({ schema: SYNC_CONTRACT, clientId: 'prototype-probe', changes: [{ id: 'prototype-change', resource: 'materials', entityId: '__proto__', operation: 'upsert', payload: { id: '__proto__', title: 'Probe', visibility: 'shared', updatedAt: now } }] }) });
    assert.equal(prototypeIdPush.response.status, 400, 'Samostatný entityId __proto__ musí být odmítnut před zápisem.');
    assert.equal(prototypeIdPush.payload.error, 'record_schema_invalid');
    assert.equal(store.resource('materials').prototype_guard.title, 'Zachovat', 'Odmítnutý prototype-pollution pokus nesmí poškodit existující resource mapu.');

    for (const [id, email] of [['a', 'a@example.test'], ['b', 'b@example.test']]) {
      const created = await api('/v1/users', { ...ownerAuth, method: 'POST', body: JSON.stringify({ email, displayName: id.toUpperCase(), role: 'teacher', password: `Teacher${id.toUpperCase()}Password123` }) });
      assert.equal(created.response.status, 201);
    }
    const loginA = await api('/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: 'a@example.test', password: 'TeacherAPassword123' }) });
    const loginB = await api('/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: 'b@example.test', password: 'TeacherBPassword123' }) });
    const tokenA = loginA.payload.token;
    const tokenB = loginB.payload.token;
    const userA = store.data.users.find((item) => item.email === 'a@example.test');
    const userB = store.data.users.find((item) => item.email === 'b@example.test');

    const foreignReadyMessage = { id: 'foreign_ready', ownerId: userA.id, subject: 'Cizí zpráva', body: 'Nesmí ji spustit jiný učitel.', recipients: [{ email: 'recipient@example.test' }], status: 'ready', requireApproval: false, updatedAt: now, createdAt: now };
    store.resource('messages')[foreignReadyMessage.id] = foreignReadyMessage;
    const crossUserProcess = await api('/v1/messages/process-due', { token: tokenB, method: 'POST', body: '{}' });
    assert.equal(crossUserProcess.response.status, 200);
    assert.equal(store.resource('messages')[foreignReadyMessage.id].status, 'ready', 'Učitel nesmí přes process-due spustit cizí zprávu.');
    assert.equal(crossUserProcess.payload.items.some((item) => item.id === foreignReadyMessage.id), false, 'Výsledek učitele nesmí obsahovat cizí zprávu.');

    const shared = await api('/v1/students', { token: tokenA, method: 'POST', body: JSON.stringify({ id: 'shared_student', displayName: 'Sdílený', visibility: 'shared', updatedAt: now }) });
    assert.equal(shared.response.status, 201);
    assert.equal((await api('/v1/students/shared_student', { token: tokenB })).response.status, 200);
    assert.equal((await api('/v1/students/shared_student', { token: tokenB, method: 'PATCH', body: JSON.stringify({ displayName: 'Přepsáno' }) })).response.status, 403);
    assert.equal((await api('/v1/students/shared_student', { token: tokenB, method: 'DELETE' })).response.status, 403);

    await api('/v1/messages', { token: tokenA, method: 'POST', body: JSON.stringify({ id: 'shared_message', subject: 'Test', body: 'Text', status: 'approval_required', requireApproval: true, visibility: 'shared', updatedAt: now }) });
    assert.equal((await api('/v1/messages/shared_message/approve', { token: tokenB, method: 'POST', body: '{}' })).response.status, 404);

    const oldDate = new Date(Date.now() - 100 * 86_400_000).toISOString();
    await api('/v1/privacy/policy', { token: tokenA, method: 'PUT', body: JSON.stringify({ studentRetentionDays: 3650, communicationRetentionDays: 3650, orphanAttachmentRetentionDays: 3650 }) });
    await api('/v1/students', { token: tokenA, method: 'POST', body: JSON.stringify({ id: 'retained_student', displayName: 'Zachovat', status: 'archived', archivedAt: oldDate, updatedAt: oldDate }) });
    await api('/v1/privacy/policy', { token: ownerToken, method: 'PUT', body: JSON.stringify({ studentRetentionDays: 30, communicationRetentionDays: 30, orphanAttachmentRetentionDays: 30 }) });
    const purge = await api('/v1/privacy/purge', { token: ownerToken, method: 'POST', body: JSON.stringify({ commit: true }) });
    assert.equal(purge.response.status, 200);
    assert.equal(purge.payload.summary.scope, 'self');
    assert.equal(Boolean(store.resource('students').retained_student), true, 'Výchozí retenční úklid vlastníka smí zasáhnout pouze jeho vlastní data.');
    assert.equal(Boolean(purge.payload.summary.byOwner[userA.id]), false);
    const globalPreview = await api('/v1/privacy/purge', { token: ownerToken, method: 'POST', body: JSON.stringify({ commit: false, scope: 'all' }) });
    assert.equal(globalPreview.response.status, 200);
    assert.equal(globalPreview.payload.summary.scope, 'all');
    assert.equal(globalPreview.payload.summary.byOwner[userA.id].students, 0, 'Globální náhled musí použít politiku konkrétního vlastníka.');
    const forbiddenGlobal = await api('/v1/privacy/purge', { token: tokenA, method: 'POST', body: JSON.stringify({ commit: false, scope: 'all' }) });
    assert.equal(forbiddenGlobal.response.status, 403);

    const missingPatch = await api('/v1/lessons/does-not-exist', { token: ownerToken, method: 'PATCH', body: JSON.stringify({ title: 'Nope' }) });
    assert.equal(missingPatch.response.status, 404);

    store.data.oldestCursor = 10;
    const staleCursor = await api('/v1/sync/pull?since=1', { token: ownerToken });
    assert.equal(staleCursor.response.status, 409);
    assert.equal(staleCursor.payload.error, 'cursor_too_old');
    store.data.oldestCursor = 1;

    const info = await api('/v1/server/info', { token: ownerToken });
    assert.deepEqual([...info.payload.resources].sort(), [...SERVER_API_CONTRACT.resources].sort());

    const firstRevision = await api('/v1/sync/push', { token: ownerToken, method: 'POST', body: JSON.stringify({ schema: SYNC_CONTRACT, clientId: 'same-client', changes: [{ id: 'revision-first', resource: 'lessons', entityId: 'revision_lesson', operation: 'upsert', payload: { id: 'revision_lesson', title: 'První', serverRevision: 0, updatedAt: now } }] }) });
    assert.equal(firstRevision.payload.accepted.length, 1);
    const staleSameClient = await api('/v1/sync/push', { token: ownerToken, method: 'POST', body: JSON.stringify({ schema: SYNC_CONTRACT, clientId: 'same-client', changes: [{ id: 'revision-stale', resource: 'lessons', entityId: 'revision_lesson', operation: 'upsert', payload: { id: 'revision_lesson', title: 'Stará verze', serverRevision: 0, updatedAt: now } }] }) });
    assert.equal(staleSameClient.payload.conflicts.length, 1, 'Stejný clientId nesmí obejít revizní konflikt.');

    const changePassword = await api(`/v1/users/${userB.id}`, { token: ownerToken, method: 'PATCH', body: JSON.stringify({ password: 'TeacherBNewPassword123' }) });
    assert.equal(changePassword.response.status, 200);
    assert.equal((await api('/v1/auth/me', { token: tokenB })).response.status, 401, 'Změna hesla musí zneplatnit staré relace.');

    const item = { id: 'sub', status: 'partial', substituteNote: 'Důležitá poznámka', realizedAt: oldDate, updatedAt: oldDate };
    updateItemProgress(item, { id: 'substitute', displayName: 'Suplující' }, { status: 'completed' });
    assert.equal(item.substituteNote, 'Důležitá poznámka');
    assert.equal(item.realizedAt, oldDate);

    const fakeAdapter = { mode: 'test', async send({ to }) { return { provider: 'test', providerMessageId: to }; } };
    const dispatcher = new MessageDispatcher({ store, config: { ...config, mailMaxAttempts: 3, mailRetryMinutes: 1 }, mailAdapter: fakeAdapter, audit: () => {} });
    const message = { id: 'recipient_test', ownerId: userA.id, subject: 'S', body: 'B', recipients: [{ email: 'one@example.test' }, { email: 'two@example.test' }], status: 'ready', requireApproval: false, updatedAt: now };
    store.resource('messages')[message.id] = message;
    dispatcher.ensureDeliveries(message);
    message.recipients = [{ email: 'one@example.test' }];
    const deliveries = dispatcher.ensureDeliveries(message);
    assert.equal(deliveries.find((item) => item.recipientEmail === 'two@example.test').status, 'cancelled');

    const stale = { id: 'stale_sending', ownerId: userA.id, subject: 'S', body: 'B', recipients: [{ email: 'stale@example.test' }], status: 'sending', sendingStartedAt: new Date(Date.now() - 180_000).toISOString(), requireApproval: false, updatedAt: now };
    store.resource('messages')[stale.id] = stale;
    const staleResult = await dispatcher.processDue({ actorId: userA.id });
    assert.equal(staleResult.dispatched.some((item) => item.message.id === stale.id), true);
    assert.equal(stale.status, 'sent');

    console.log('Auditní serverové regrese prošly: validace nedůvěryhodných záznamů, oprávnění, zotavení zápisu, retence, hesla, kurzory, zastupování, doručenky a hlavičky.');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createLessonHubServer, SYNC_CONTRACT } from './app.mjs';
import { hashPassword } from './lib/security.mjs';

const dir = await mkdtemp(path.join(os.tmpdir(), 'lesson-hub-server-'));
const dataFile = path.join(dir, 'server.json');
const config = {
  host: '127.0.0.1', port: 0, dataFile, allowedOrigins: ['http://localhost:4173'],
  upstreamAuthSecret: 'trusted-ghrab-upstream-secret', sessionHours: 1, bodyLimitBytes: 12 * 1024 * 1024, attachmentLimitBytes: 8 * 1024 * 1024, attachmentsDir: path.join(dir, 'attachments'), loginWindowMs: 60_000, loginAttempts: 5,
};
const { server, store } = await createLessonHubServer({ config });
const now = new Date().toISOString();
store.data.users.push({
  id: 'user_owner', email: ['owner', 'example.test'].join('@'), displayName: 'Owner', role: 'owner', status: 'active',
  passwordHash: hashPassword('ServerTest1234'), createdAt: now, updatedAt: now, lastLoginAt: null,
});
await store.save();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

async function request(route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const contentType = response.headers.get('content-type') || '';
  const payload = response.status === 204 ? null : contentType.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer());
  return { response, payload };
}

try {
  const health = await request('/health');
  assert.equal(health.response.status, 200);
  assert.equal(health.payload.version, '1.2.16');

  const login = await request('/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: ['owner', 'example.test'].join('@'), password: 'ServerTest1234' }) });
  assert.equal(login.response.status, 200);
  const auth = { authorization: `Bearer ${login.payload.token}` };

  const me = await request('/v1/auth/me', { headers: auth });
  assert.equal(me.payload.user.role, 'owner');
  const trustedHeaders = {
    'x-ghrab-upstream-secret': 'trusted-ghrab-upstream-secret',
    'x-ghrab-user-id': encodeURIComponent('teacher-central-id'),
    'x-ghrab-user-name': encodeURIComponent('Centrální učitel'),
    'x-ghrab-user-roles': 'teacher',
    'x-ghrab-session-expires-at': new Date(Date.now() + 600000).toISOString(),
  };
  const trustedMe = await request('/v1/auth/me', { headers: trustedHeaders });
  assert.equal(trustedMe.response.status, 200);
  assert.equal(trustedMe.payload.user.displayName, 'Centrální učitel');
  assert.equal(store.data.sessions.some((item) => item.userId === trustedMe.payload.user.id), false);
  const trustedCreate = await request('/v1/quickNotes', { method: 'POST', headers: trustedHeaders, body: JSON.stringify({ id: 'trusted_note', title: 'Dočasná poznámka', updatedAt: now }) });
  assert.equal(trustedCreate.response.status, 201);
  assert.equal(store.resource('quickNotes').trusted_note.ownerId, trustedMe.payload.user.id);
  const trustedDelete = await request('/v1/privacy/delete-my-data', { method: 'DELETE', headers: trustedHeaders });
  assert.equal(trustedDelete.response.status, 200);
  assert.equal(trustedDelete.payload.ok, true);
  assert.equal(Boolean(store.resource('quickNotes').trusted_note), false);
  assert.equal(store.data.users.some((item) => item.id === trustedMe.payload.user.id), false);

  const createUser = await request('/v1/users', { method: 'POST', headers: auth, body: JSON.stringify({ email: ['teacher', 'example.test'].join('@'), displayName: 'Teacher', role: 'teacher', password: 'TeacherTest1234' }) });
  assert.equal(createUser.response.status, 201);

  const changeId = `sync_${randomUUID()}`;
  const push = await request('/v1/sync/push', {
    method: 'POST', headers: auth,
    body: JSON.stringify({ schema: SYNC_CONTRACT, clientId: 'test-client', changes: [{ id: changeId, resource: 'lessons', entityId: 'lesson_test', operation: 'upsert', payload: { id: 'lesson_test', title: 'Server test', updatedAt: now } }] }),
  });
  assert.equal(push.response.status, 200);
  assert.equal(push.payload.accepted.length, 1);
  const pull = await request('/v1/sync/pull?since=0', { headers: auth });
  assert.equal(pull.payload.items.some((item) => item.entityId === 'lesson_test'), true);



  const attachmentContent = Buffer.from('Lesson Hub attachment test');
  const upload = await request('/v1/attachments/upload', {
    method: 'POST', headers: auth,
    body: JSON.stringify({ fileName: 'test.pdf', mimeType: 'application/pdf', contentBase64: attachmentContent.toString('base64'), purpose: 'student', visibility: 'private' }),
  });
  assert.equal(upload.response.status, 201);
  assert.equal(upload.payload.attachment.size, attachmentContent.length);
  const attachmentId = upload.payload.attachment.id;
  const duplicateUpload = await request('/v1/attachments/upload', {
    method: 'POST', headers: auth,
    body: JSON.stringify({ fileName: 'test-copy.pdf', mimeType: 'application/pdf', contentBase64: attachmentContent.toString('base64'), purpose: 'student', visibility: 'private' }),
  });
  assert.equal(duplicateUpload.payload.duplicate, true);
  const attachmentDownload = await request(`/v1/attachments/${attachmentId}/content`, { headers: auth });
  assert.deepEqual(attachmentDownload.payload, attachmentContent);

  const scheduledMessage = await request('/v1/messages', {
    method: 'POST', headers: auth,
    body: JSON.stringify({ id: 'message_due', subject: 'Test', body: 'Text', status: 'scheduled', scheduledAt: '2020-01-01T10:00:00.000Z', requireApproval: false, updatedAt: now }),
  });
  assert.equal(scheduledMessage.response.status, 201);
  const processDue = await request('/v1/messages/process-due', { method: 'POST', headers: auth, body: '{}' });
  assert.equal(processDue.payload.items.length, 1);
  assert.equal(processDue.payload.items[0].status, 'ready');

  const privacyPolicy = await request('/v1/privacy/policy', { headers: auth });
  assert.equal(privacyPolicy.payload.policy.studentRetentionDays, 730);
  const privacyUpdate = await request('/v1/privacy/policy', { method: 'PUT', headers: auth, body: JSON.stringify({ studentRetentionDays: 365, communicationRetentionDays: 500, orphanAttachmentRetentionDays: 90 }) });
  assert.equal(privacyUpdate.payload.policy.studentRetentionDays, 365);
  const purgePreview = await request('/v1/privacy/purge', { method: 'POST', headers: auth, body: JSON.stringify({ commit: false }) });
  assert.equal(purgePreview.payload.committed, false);

  const audit = await request('/v1/audit?limit=20', { headers: auth });
  assert.equal(audit.response.status, 200);
  assert.equal(audit.payload.items.length > 0, true);

  const teacherLogin = await request('/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: ['teacher', 'example.test'].join('@'), password: 'TeacherTest1234' }) });
  assert.equal(teacherLogin.response.status, 200);
  const teacherAuth = { authorization: `Bearer ${teacherLogin.payload.token}` };
  const teacherAudit = await request('/v1/audit', { headers: teacherAuth });
  assert.equal(teacherAudit.response.status, 403);
  const teacherUsers = await request('/v1/users', { headers: teacherAuth });
  assert.equal(teacherUsers.response.status, 403);
  const teacherPull = await request('/v1/sync/pull?since=0', { headers: teacherAuth });
  assert.equal(teacherPull.payload.items.some((item) => item.entityId === 'lesson_test'), false);

  const deleteAttachment = await request(`/v1/attachments/${attachmentId}`, { method: 'DELETE', headers: auth });
  assert.equal(deleteAttachment.response.status, 204);

  const logout = await request('/v1/auth/logout', { method: 'POST', headers: auth });
  assert.equal(logout.response.status, 204);
  const denied = await request('/v1/auth/me', { headers: auth });
  assert.equal(denied.response.status, 401);
  console.log('Serverové testy prošly: health, auth, users, sync, přílohy, komunikace, retence, audit a logout.');
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
}

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
  const apiStore = new JsonStore(config.dataFile);
  await apiStore.open();
  apiStore.data.audit.push({ id: 'legacy_audit_probe', actorId: null, action: 'legacy-probe', entityType: 'attachment', entityId: 'legacy_attachment', metadata: { fileName: 'GARP-SYNTH-LEGACY-FILENAME', email: 'legacy-audit@example.invalid', size: 1 }, ip: '', timestamp: new Date().toISOString() });
  apiStore.resource('students').startup_legacy_student = { id: 'startup_legacy_student', ownerId: 'legacy-owner', displayName: 'GARP-STUDENT-CANARY-K3-STARTUP-LEGACY', visibility: 'shared', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  apiStore.resource('messages').startup_legacy_message = { id: 'startup_legacy_message', ownerId: 'legacy-owner', subject: 'Synthetic legacy message', body: 'Synthetic', status: 'draft', visibility: 'shared', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  apiStore.resource('materials').startup_legacy_material = { id: 'startup_legacy_material', ownerId: 'legacy-owner', title: 'Synthetic shared material', visibility: 'shared', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  apiStore.data.changes.push({ cursor: apiStore.nextCursor(), id: 'startup_legacy_change', schema: SYNC_CONTRACT, resource: 'students', entityId: 'startup_legacy_student', operation: 'upsert', payload: { ...apiStore.resource('students').startup_legacy_student }, ownerId: 'legacy-owner', actorId: 'legacy-owner', clientId: 'legacy', clientChangeId: 'legacy', timestamp: new Date().toISOString() });
  await apiStore.save();
  const { server, store } = await createLessonHubServer({ config, store: apiStore });
  assert.equal(JSON.stringify(store.data.audit).includes('GARP-SYNTH-LEGACY-FILENAME'), false, 'Start serveru musí migračně odstranit legacy raw fileName z auditních metadat.');
  assert.equal(JSON.stringify(store.data.audit).includes('legacy-audit@example.invalid'), false, 'Start serveru musí migračně odstranit legacy raw e-mail z auditních metadat.');
  assert.equal(Object.prototype.hasOwnProperty.call(store.data.audit.find((item) => item.id === 'legacy_audit_probe')?.metadata || {}, 'emailHash'), false, 'Legacy e-mail nesmí přežívat ani jako nesolený korelační hash.');
  assert.equal(store.resource('students').startup_legacy_student.visibility, 'private', 'Start musí normalizovat legacy shared student na private.');
  assert.equal(store.resource('messages').startup_legacy_message.visibility, 'private', 'Start musí normalizovat legacy shared message na private.');
  assert.equal(store.resource('materials').startup_legacy_material.visibility, 'shared', 'Start nesmí zrušit legitimní shared material.');
  assert.equal(store.data.changes.find((item) => item.id === 'startup_legacy_change')?.payload?.visibility, 'private', 'Start musí normalizovat i legacy sync payload.');
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
    const substituteCreate = await api('/v1/users', { ...ownerAuth, method: 'POST', body: JSON.stringify({ email: 'substitute@example.test', displayName: 'Substitute', role: 'substitute', password: 'SubstitutePassword123' }) });
    assert.equal(substituteCreate.response.status, 201);
    const loginA = await api('/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: 'a@example.test', password: 'TeacherAPassword123' }) });
    const loginB = await api('/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: 'b@example.test', password: 'TeacherBPassword123' }) });
    const loginSubstitute = await api('/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: 'substitute@example.test', password: 'SubstitutePassword123' }) });
    const tokenA = loginA.payload.token;
    const tokenB = loginB.payload.token;
    const tokenSubstitute = loginSubstitute.payload.token;
    const userA = store.data.users.find((item) => item.email === 'a@example.test');
    const userB = store.data.users.find((item) => item.email === 'b@example.test');

    // GARP 2.3 round 3 K2-N01: stored legacy visibility='shared' is not an authorization capability.
    // Simulate records created by a pre-1.2.13 server by inserting them directly after startup.
    const legacyStudentMarker = 'GARP-STUDENT-CANARY-K3-LEGACY-SHARED-STUDENT';
    const legacyMessageMarker = 'GARP-STUDENT-CANARY-K3-LEGACY-SHARED-MESSAGE';
    store.resource('students').legacy_shared_student = { id: 'legacy_shared_student', ownerId: userA.id, displayName: legacyStudentMarker, visibility: 'shared', createdAt: now, updatedAt: now };
    store.resource('messages').legacy_shared_message = { id: 'legacy_shared_message', ownerId: userA.id, subject: legacyMessageMarker, body: 'Synthetic only', status: 'draft', visibility: 'shared', createdAt: now, updatedAt: now };
    store.resource('materials').legacy_shared_material = { id: 'legacy_shared_material', ownerId: userA.id, title: 'Legacy shared material', visibility: 'shared', createdAt: now, updatedAt: now };
    await store.save();
    assert.equal((await api('/v1/students/legacy_shared_student', { token: tokenB })).response.status, 404, 'Legacy shared student nesmí být čitelný cizím učitelem.');
    assert.equal((await api('/v1/students/legacy_shared_student', { token: tokenSubstitute })).response.status, 404, 'Legacy shared student nesmí být čitelný rolí substitute.');
    assert.equal(JSON.stringify((await api('/v1/students', { token: tokenB })).payload).includes(legacyStudentMarker), false);
    assert.equal((await api('/v1/messages/legacy_shared_message', { token: tokenB })).response.status, 404, 'Legacy shared message nesmí být čitelná cizím učitelem.');
    assert.equal(JSON.stringify((await api('/v1/messages', { token: tokenSubstitute })).payload).includes(legacyMessageMarker), false);
    assert.equal((await api('/v1/materials/legacy_shared_material', { token: tokenB })).response.status, 200, 'Oprava nesmí rozbít legitimní shared materiály.');

    const foreignReadyMessage = { id: 'foreign_ready', ownerId: userA.id, subject: 'Cizí zpráva', body: 'Nesmí ji spustit jiný učitel.', recipients: [{ email: 'recipient@example.test' }], status: 'ready', requireApproval: false, updatedAt: now, createdAt: now };
    store.resource('messages')[foreignReadyMessage.id] = foreignReadyMessage;
    const crossUserProcess = await api('/v1/messages/process-due', { token: tokenB, method: 'POST', body: '{}' });
    assert.equal(crossUserProcess.response.status, 200);
    assert.equal(store.resource('messages')[foreignReadyMessage.id].status, 'ready', 'Učitel nesmí přes process-due spustit cizí zprávu.');
    assert.equal(crossUserProcess.payload.items.some((item) => item.id === foreignReadyMessage.id), false, 'Výsledek učitele nesmí obsahovat cizí zprávu.');

    const privateStudent = await api('/v1/students', { token: tokenA, method: 'POST', body: JSON.stringify({ id: 'private_student_probe', displayName: 'Soukromý', visibility: 'shared', updatedAt: now }) });
    assert.equal(privateStudent.response.status, 201);
    assert.equal(privateStudent.payload.visibility, 'private', 'Studentský záznam musí být serverově vynucen jako soukromý.');
    assert.equal((await api('/v1/students/private_student_probe', { token: tokenB })).response.status, 404, 'Jiný učitel nesmí číst studentský záznam ani po klientském pokusu o visibility=shared.');
    assert.equal((await api('/v1/students/private_student_probe', { token: tokenB, method: 'PATCH', body: JSON.stringify({ displayName: 'Přepsáno' }) })).response.status, 404);
    assert.equal((await api('/v1/students/private_student_probe', { token: tokenB, method: 'DELETE' })).response.status, 403);
    const sensitiveMarker = 'GARP-STUDENT-CANARY-DELETE-HISTORY';
    await api('/v1/students/private_student_probe', { token: tokenA, method: 'PATCH', body: JSON.stringify({ notes: sensitiveMarker, updatedAt: new Date().toISOString() }) });
    assert.equal(store.data.changes.some((item) => JSON.stringify(item).includes(sensitiveMarker)), true);
    assert.equal((await api('/v1/students/private_student_probe', { token: tokenA, method: 'DELETE' })).response.status, 204);
    assert.equal(store.data.changes.some((item) => JSON.stringify(item).includes(sensitiveMarker)), false, 'Po výmazu nesmí historická sync payload kopie držet studentský canary.');
    assert.equal(store.data.changes.some((item) => item.resource === 'students' && item.entityId === 'private_student_probe' && item.operation === 'delete'), true, 'Výmaz musí zachovat pouze bezpečný sync tombstone.');

    const privateMessage = await api('/v1/messages', { token: tokenA, method: 'POST', body: JSON.stringify({ id: 'private_message_probe', subject: 'Test', body: 'Text', status: 'approval_required', requireApproval: true, visibility: 'shared', updatedAt: now }) });
    assert.equal(privateMessage.payload.visibility, 'private', 'Komunikační zpráva musí být serverově vynucena jako soukromá.');
    assert.equal((await api('/v1/messages/private_message_probe', { token: tokenB })).response.status, 404, 'Jiný učitel nesmí číst cizí komunikační zprávu.');
    assert.equal((await api('/v1/messages/private_message_probe/approve', { token: tokenB, method: 'POST', body: '{}' })).response.status, 404);

    const sharedMaterial = await api('/v1/materials', { token: tokenA, method: 'POST', body: JSON.stringify({ id: 'shared_material_probe', title: 'Sdílený materiál', visibility: 'shared', updatedAt: now }) });
    assert.equal(sharedMaterial.payload.visibility, 'shared', 'Výslovně sdílitelný materiál musí zůstat sdílitelný.');
    assert.equal((await api('/v1/materials/shared_material_probe', { token: tokenB })).response.status, 200);
    const substitutionMaterial = await api('/v1/materials', { token: tokenA, method: 'POST', body: JSON.stringify({ id: 'substitution_material_probe', title: 'Materiál pro suplování', visibility: 'substitution', updatedAt: now }) });
    assert.equal(substitutionMaterial.payload.visibility, 'substitution');
    assert.equal((await api('/v1/materials/substitution_material_probe', { token: tokenSubstitute })).response.status, 200, 'Bezpečnostní oprava nesmí rozbít explicitně sdílený materiál pro zastupování.');

    // GARP 2.3 round 2: N-01. Dedicated substitution authorization must not be bypassable via generic resources.
    const substitutionMarker = 'GARP-SYNTH-N01-PRIVATE-NOTES';
    const draftPeriod = await api('/v1/substitution/periods', { token: tokenA, method: 'POST', body: JSON.stringify({
      title: 'Synthetic draft', startDate: '2026-09-01', endDate: '2026-09-02', status: 'draft', accessMode: 'selected', allowedUserIds: [], privateNotes: 'owner-only'
    }) });
    assert.equal(draftPeriod.response.status, 201);
    const draftPlan = await api('/v1/substitution/plans', { token: tokenA, method: 'POST', body: JSON.stringify({
      periodId: draftPeriod.payload.period.id, groupName: 'Synthetic group', title: 'Synthetic plan', privateNotes: substitutionMarker
    }) });
    assert.equal(draftPlan.response.status, 201);
    const dedicatedB = await api('/v1/substitution/periods', { token: tokenB });
    assert.equal(JSON.stringify(dedicatedB.payload).includes(substitutionMarker), false, 'Cizí učitel nesmí vidět draft přes vyhrazené substitution API.');
    const genericPlansB = await api('/v1/substitutionPlans', { token: tokenB });
    assert.equal(JSON.stringify(genericPlansB.payload).includes(substitutionMarker), false, 'Generický resource endpoint nesmí obejít period-scoped autorizaci substitution plánů.');
    assert.equal((await api(`/v1/substitutionPlans/${draftPlan.payload.plan.id}`, { token: tokenB })).response.status, 404);
    assert.equal((await api(`/v1/substitutionPlans/${draftPlan.payload.plan.id}`, { token: tokenSubstitute })).response.status, 404);
    const genericInjectedPlan = await api('/v1/substitutionPlans', { token: tokenA, method: 'POST', body: JSON.stringify({ id: 'synthetic_generic_sub_plan', periodId: draftPeriod.payload.period.id, title: 'Injected plan', privateNotes: substitutionMarker, visibility: 'shared', updatedAt: now }) });
    assert.equal(genericInjectedPlan.response.status, 201);
    assert.equal(genericInjectedPlan.payload.visibility, 'private', 'Generická substitution data nesmějí získat globální shared visibility.');
    assert.equal((await api('/v1/substitutionPlans/synthetic_generic_sub_plan', { token: tokenB })).response.status, 404);

    // GARP 2.3 round 2: N-03. Sensitive attachments are private and dedupe cannot reuse broader access.
    const attachmentMarker = 'GARP-SYNTH-N03-STUDENT-FILE';
    const sharedBytes = Buffer.from('GARP-SYNTH-ATTACHMENT-BYTES');
    const publicMaterialUpload = await api('/v1/attachments/upload', { token: tokenA, method: 'POST', body: JSON.stringify({ fileName: 'shared-material.pdf', mimeType: 'application/pdf', contentBase64: sharedBytes.toString('base64'), purpose: 'material', visibility: 'shared' }) });
    assert.equal(publicMaterialUpload.response.status, 201);
    assert.equal(publicMaterialUpload.payload.attachment.visibility, 'shared');
    const sensitiveUpload = await api('/v1/attachments/upload', { token: tokenA, method: 'POST', body: JSON.stringify({ fileName: `${attachmentMarker}.pdf`, mimeType: 'application/pdf', contentBase64: sharedBytes.toString('base64'), purpose: 'student', visibility: 'shared' }) });
    assert.equal(sensitiveUpload.response.status, 201, 'Jiný privacy context stejného obsahu nesmí být deduplikován na širší záznam.');
    assert.equal(sensitiveUpload.payload.duplicate, false);
    assert.equal(sensitiveUpload.payload.attachment.visibility, 'private', 'purpose=student musí server vynutit jako private.');
    assert.notEqual(sensitiveUpload.payload.attachment.id, publicMaterialUpload.payload.attachment.id);
    assert.equal(store.data.audit.some((item) => JSON.stringify(item).includes(attachmentMarker)), false, 'Audit nesmí ukládat původní název přílohy s potenciálním osobním údajem.');
    const attachmentsB = await api('/v1/attachments', { token: tokenB });
    assert.equal(JSON.stringify(attachmentsB.payload).includes(attachmentMarker), false, 'Cizí učitel nesmí v seznamu vidět studentskou přílohu.');
    assert.equal((await api(`/v1/attachments/${sensitiveUpload.payload.attachment.id}/content`, { token: tokenB })).response.status, 404);
    assert.equal((await api(`/v1/attachments/${sensitiveUpload.payload.attachment.id}/content`, { token: tokenSubstitute })).response.status, 404);
    const unscopedSubUpload = await api('/v1/attachments/upload', { token: tokenA, method: 'POST', body: JSON.stringify({ fileName: 'unscoped-substitution.pdf', mimeType: 'application/pdf', contentBase64: Buffer.from('unscoped-substitution').toString('base64'), purpose: 'material', visibility: 'substitution' }) });
    assert.equal(unscopedSubUpload.payload.attachment.visibility, 'private', 'Unscoped substitution attachment se musí fail-closed uložit jako private.');

    // GARP 2.3 round 2: N-02. Attachment-link history must be scrubbed and replaced by a safe tombstone.
    const historyMarker = 'GARP-SYNTH-N02-ATTACHMENT-LINK-HISTORY';
    const link = await api('/v1/attachmentLinks', { token: tokenA, method: 'POST', body: JSON.stringify({ id: 'synthetic_attachment_link', attachmentId: sensitiveUpload.payload.attachment.id, label: historyMarker, updatedAt: now }) });
    assert.equal(link.response.status, 201);
    assert.equal(store.data.changes.some((item) => JSON.stringify(item).includes(historyMarker)), true);
    assert.equal((await api(`/v1/attachments/${sensitiveUpload.payload.attachment.id}`, { token: tokenA, method: 'DELETE' })).response.status, 204);
    assert.equal(Boolean(store.resource('attachmentLinks').synthetic_attachment_link), false);
    assert.equal(store.data.changes.some((item) => JSON.stringify(item).includes(historyMarker)), false, 'Smazání přílohy nesmí ponechat historický attachmentLink payload.');
    assert.equal(store.data.changes.some((item) => item.resource === 'attachmentLinks' && item.entityId === 'synthetic_attachment_link' && item.operation === 'delete'), true, 'Smazání navázaného attachmentLink musí vytvořit sync tombstone.');
    assert.equal(store.data.audit.some((item) => JSON.stringify(item).includes(attachmentMarker)), false, 'Po smazání přílohy nesmí audit držet citlivý název souboru.');

    const failedLoginEmail = 'synthetic-login-marker@example.invalid';
    const failedLogin = await api('/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: failedLoginEmail, password: 'SyntheticWrongPassword123' }) });
    assert.equal(failedLogin.response.status, 401);
    assert.equal(store.data.audit.some((item) => JSON.stringify(item).includes(failedLoginEmail)), false, 'Audit neúspěšného loginu nesmí ukládat raw e-mail.');
    const failedLoginAudit = store.data.audit.find((item) => item.action === 'auth-login-failed' && item.metadata?.accountMatched === false);
    assert.equal(Boolean(failedLoginAudit), true, 'Audit může zachovat pouze neidentifikující informaci, zda účet existoval.');
    assert.equal(Object.prototype.hasOwnProperty.call(failedLoginAudit?.metadata || {}, 'emailHash'), false, 'Audit neúspěšného loginu nesmí ukládat slovníkově dohledatelný hash e-mailu.');

    const oldDate = new Date(Date.now() - 100 * 86_400_000).toISOString();
    await api('/v1/privacy/policy', { token: tokenA, method: 'PUT', body: JSON.stringify({ studentRetentionDays: 3650, communicationRetentionDays: 3650, orphanAttachmentRetentionDays: 3650 }) });
    await api('/v1/students', { token: tokenA, method: 'POST', body: JSON.stringify({ id: 'retained_student', displayName: 'Zachovat', status: 'archived', archivedAt: oldDate, updatedAt: oldDate }) });
    await api('/v1/privacy/policy', { token: ownerToken, method: 'PUT', body: JSON.stringify({ studentRetentionDays: 30, communicationRetentionDays: 30, orphanAttachmentRetentionDays: 30 }) });
    const oldMessage = await api('/v1/messages', { token: ownerToken, method: 'POST', body: JSON.stringify({ id: 'old_message_for_purge', subject: 'Staré', body: 'Starý obsah', status: 'cancelled', cancelledAt: oldDate, updatedAt: oldDate }) });
    store.resource('messageDeliveries').old_delivery_for_purge = { id: 'old_delivery_for_purge', ownerId: 'owner', messageId: oldMessage.payload.id, recipientEmail: 'garp.retention@example.invalid', status: 'sent', sentAt: oldDate, updatedAt: oldDate };
    await store.save();
    const purge = await api('/v1/privacy/purge', { token: ownerToken, method: 'POST', body: JSON.stringify({ commit: true }) });
    assert.equal(purge.response.status, 200);
    assert.equal(Boolean(store.resource('messageDeliveries').old_delivery_for_purge), false, 'Retenční výmaz zprávy musí odstranit i doručenku s adresou příjemce.');
    assert.equal(JSON.stringify(store.data.changes).includes('garp.retention@example.invalid'), false, 'Retenční výmaz nesmí ponechat PII v historických sync payloadech.');
    assert.equal(purge.payload.summary.scope, 'self');
    assert.equal(Boolean(store.resource('students').retained_student), true, 'Výchozí retenční úklid vlastníka smí zasáhnout pouze jeho vlastní data.');
    assert.equal(Boolean(purge.payload.summary.byOwner[userA.id]), false);
    const globalPreview = await api('/v1/privacy/purge', { token: ownerToken, method: 'POST', body: JSON.stringify({ commit: false, scope: 'all' }) });
    assert.equal(globalPreview.response.status, 200);
    assert.equal(globalPreview.payload.summary.scope, 'all');
    assert.equal(globalPreview.payload.summary.byOwner[userA.id].students, 0, 'Globální náhled musí použít politiku konkrétního vlastníka.');
    const forbiddenGlobal = await api('/v1/privacy/purge', { token: tokenA, method: 'POST', body: JSON.stringify({ commit: false, scope: 'all' }) });
    assert.equal(forbiddenGlobal.response.status, 403);

    const deleteTargetCreate = await api('/v1/users', { ...ownerAuth, method: 'POST', body: JSON.stringify({ email: 'delete-target@example.test', displayName: 'Delete Target', role: 'teacher', password: 'DeleteTargetPassword123' }) });
    assert.equal(deleteTargetCreate.response.status, 201);
    const deleteTargetId = deleteTargetCreate.payload.user.id;
    assert.equal(store.data.audit.some((item) => item.entityType === 'user' && item.entityId === deleteTargetId), true, 'Kontrolní audit cílového účtu musí před výmazem existovat.');
    const deleteTargetLogin = await api('/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: 'delete-target@example.test', password: 'DeleteTargetPassword123' }) });
    const deleteTargetResult = await api('/v1/privacy/delete-my-data', { token: deleteTargetLogin.payload.token, method: 'DELETE' });
    assert.equal(deleteTargetResult.response.status, 200);
    assert.equal(store.data.audit.some((item) => item.actorId === deleteTargetId || (item.entityType === 'user' && item.entityId === deleteTargetId)), false, 'Úplný výmaz účtu nesmí ponechat auditní vazbu na interní ID smazaného uživatele.');

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

    // RT-04: manipulate the application clock source. Expiry must fail closed and clock rollback must not resurrect a pruned session.
    const clockUser = await api('/v1/users', { ...ownerAuth, method: 'POST', body: JSON.stringify({ email: 'clock@example.test', displayName: 'Clock', role: 'teacher', password: 'ClockPassword123' }) });
    assert.equal(clockUser.response.status, 201);
    const clockLogin = await api('/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: 'clock@example.test', password: 'ClockPassword123' }) });
    const clockToken = clockLogin.payload.token;
    assert.equal((await api('/v1/auth/me', { token: clockToken })).response.status, 200);
    const realNow = Date.now;
    const expiresMs = new Date(clockLogin.payload.expiresAt).getTime();
    try {
      Date.now = () => expiresMs + 60_000;
      assert.equal((await api('/v1/auth/me', { token: clockToken })).response.status, 401, 'Relace musí po posunu času za expiraci selhat uzavřeně.');
      Date.now = () => expiresMs - 60_000;
      assert.equal((await api('/v1/auth/me', { token: clockToken })).response.status, 401, 'Zpětný skok času nesmí již odstraněnou relaci obnovit.');
    } finally { Date.now = realNow; }

    console.log('Auditní serverové regrese prošly: validace nedůvěryhodných záznamů, oprávnění, legacy shared K2-N01, N-01/N-02/N-03, K2-N03, RT-04, zotavení zápisu, retence, hesla, kurzory, zastupování, doručenky a hlavičky.');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}

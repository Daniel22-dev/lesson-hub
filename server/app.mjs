import { createServer as createHttpServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { URL } from 'node:url';
import { loadServerConfig } from './lib/config.mjs';
import { createStore } from './lib/storeFactory.mjs';
import { constantTimeTokenEqual, createSessionToken, hashPasswordAsync, normalizeEmail, safeUser, tokenDigest, verifyPasswordAsync } from './lib/security.mjs';
import { canAccessRecord, isShareableResource, normalizeRole, normalizeVisibility, requirePermission } from './lib/permissions.mjs';
import { normalizeOpenedStore } from './lib/storeNormalization.mjs';
import { binary, json, noContent, readJson, requestIp } from './lib/http.mjs';
import { SlidingWindowLimiter } from './lib/rateLimit.mjs';
import { createMailAdapter } from './lib/mailer.mjs';
import { MessageDispatcher } from './lib/messageDispatcher.mjs';
import { OperationsManager } from './lib/operations.mjs';
import { canEditPeriod, canViewPeriod, createItem, createPeriod, createPlan, listSubstitutionBundles, publicItem, publicPeriod, publicPlan, updateItemByOwner, updateItemProgress, updatePeriod, updatePlan } from './lib/substitution.mjs';
import { assertSafeUntrustedIdentifier, assertSafeUntrustedRecord } from './lib/untrustedData.mjs';

export const SERVER_VERSION = '1.2.17';
export const API_CONTRACT = 'lesson-hub-api-v1';
export const SYNC_CONTRACT = 'lesson-hub-sync-v1';
export const RESOURCE_NAMES = Object.freeze([
  'schoolYears', 'subjects', 'groupIdentities', 'groupInstances', 'lessons', 'quickNotes',
  'tasks', 'reminders', 'materials', 'materialLinks', 'tags', 'entityTags', 'students',
  'lessonTemplates', 'teachingCycles', 'messageTemplates', 'messages', 'messageDeliveries', 'attachmentLinks',
  'substitutionPeriods', 'substitutionPlans', 'substitutionItems',
]);


function visibilityForResource(resource, requested, fallback = 'private') {
  if (!isShareableResource(resource)) return 'private';
  return normalizeVisibility(requested, fallback);
}


const ATTACHMENT_PURPOSES = new Set(['material', 'student', 'teacher', 'solution']);
const SENSITIVE_ATTACHMENT_PURPOSES = new Set(['student', 'solution']);

function attachmentPolicy(purpose, requestedVisibility) {
  const normalizedPurpose = ATTACHMENT_PURPOSES.has(String(purpose || '')) ? String(purpose) : 'material';
  if (SENSITIVE_ATTACHMENT_PURPOSES.has(normalizedPurpose)) return { purpose: normalizedPurpose, visibility: 'private' };
  // Unscoped 'substitution' is deliberately fail-closed. A future implementation must bind it
  // to a concrete substitution period and canViewPeriod() before enabling cross-user access.
  return { purpose: normalizedPurpose, visibility: requestedVisibility === 'shared' ? 'shared' : 'private' };
}

const ALLOWED_ATTACHMENT_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv',
  'image/jpeg', 'image/png', 'image/webp',
  'audio/mpeg', 'audio/wav', 'audio/ogg',
]);
const DEFAULT_PRIVACY_POLICY = Object.freeze({
  studentRetentionDays: 730,
  communicationRetentionDays: 1095,
  orphanAttachmentRetentionDays: 180,
});

function sanitizeFileName(value) {
  const normalized = path.basename(String(value || 'soubor')).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim();
  return normalized.slice(0, 180) || 'soubor';
}

function safeRetentionDays(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(3650, Math.max(30, parsed)) : fallback;
}

function privacyPolicyFor(store, userId) {
  return { ...DEFAULT_PRIVACY_POLICY, ...(store.data.privacyPolicies[userId] || {}) };
}

function canAccessAttachment(user, attachment, { write = false } = {}) {
  if (!user || !attachment) return false;
  if (user.role === 'owner' || user.role === 'admin') return true;
  if (attachment.ownerId === user.id) return user.role !== 'substitute' || !write;
  if (write) return false;
  const purpose = String(attachment.purpose || 'material');
  if (SENSITIVE_ATTACHMENT_PURPOSES.has(purpose)) return false;
  if (purpose === 'teacher' && user.role === 'substitute') return false;
  // Legacy unscoped substitution attachments are intentionally not shared cross-user.
  return attachment.visibility === 'shared';
}

function deleteAllUserData(store, user) {
  const removed = { resources: {}, attachments: 0, sessions: 0, changes: 0, audit: 0, account: 0 };
  const attachmentIds = new Set(Object.values(store.data.attachments || {}).filter((item) => item.ownerId === user.id).map((item) => item.id));
  for (const resource of RESOURCE_NAMES) {
    const records = store.resource(resource);
    let count = 0;
    for (const [id, record] of Object.entries(records)) {
      if (record?.ownerId === user.id || (resource === 'attachmentLinks' && attachmentIds.has(record?.attachmentId || record?.serverId))) { delete records[id]; count += 1; }
    }
    if (count) removed.resources[resource] = count;
  }
  removed.attachments = attachmentIds.size;
  removed.sessions = store.data.sessions.filter((item) => item.userId === user.id).length;
  store.data.sessions = store.data.sessions.filter((item) => item.userId !== user.id);
  removed.changes = store.data.changes.filter((item) => item.ownerId === user.id || item.actorId === user.id).length;
  store.data.changes = store.data.changes.filter((item) => item.ownerId !== user.id && item.actorId !== user.id);
  const auditBelongsToUser = (item) => item.actorId === user.id || (item.entityType === 'user' && item.entityId === user.id);
  removed.audit = store.data.audit.filter(auditBelongsToUser).length;
  store.data.audit = store.data.audit.filter((item) => !auditBelongsToUser(item));
  delete store.data.privacyPolicies[user.id];
  const before = store.data.users.length;
  store.data.users = store.data.users.filter((item) => item.id !== user.id);
  removed.account = before - store.data.users.length;
  return { removed, attachmentIds };
}

function purgeCandidates(store, user, { scope = 'self', now = Date.now() } = {}) {
  const privileged = user.role === 'owner' || user.role === 'admin';
  const normalizedScope = scope === 'all' && privileged ? 'all' : 'self';
  const ownerIds = normalizedScope === 'all'
    ? new Set([
        ...store.data.users.map((item) => item.id),
        ...Object.values(store.resource('students')).map((item) => item.ownerId),
        ...Object.values(store.resource('messages')).map((item) => item.ownerId),
        ...Object.values(store.data.attachments).map((item) => item.ownerId),
      ].filter(Boolean))
    : new Set([user.id]);
  const olderThan = (record, days) => {
    const value = record.archivedAt || record.cancelledAt || record.sentAt || record.updatedAt || record.createdAt;
    return value && new Date(value).getTime() < now - days * 86_400_000;
  };
  const linkedAttachmentIds = new Set(Object.values(store.resource('attachmentLinks')).map((item) => item.attachmentId || item.serverId).filter(Boolean));
  const result = { scope: normalizedScope, students: [], messages: [], attachments: [], byOwner: {} };
  for (const ownerId of ownerIds) {
    const policy = privacyPolicyFor(store, ownerId);
    const owner = store.data.users.find((item) => item.id === ownerId);
    const students = Object.values(store.resource('students')).filter((item) => item.ownerId === ownerId && item.status === 'archived' && olderThan(item, policy.studentRetentionDays));
    const messages = Object.values(store.resource('messages')).filter((item) => item.ownerId === ownerId && ['sent', 'cancelled'].includes(item.status) && olderThan(item, policy.communicationRetentionDays));
    const attachments = Object.values(store.data.attachments).filter((item) => item.ownerId === ownerId && !linkedAttachmentIds.has(item.id) && olderThan(item, policy.orphanAttachmentRetentionDays));
    result.students.push(...students);
    result.messages.push(...messages);
    result.attachments.push(...attachments);
    result.byOwner[ownerId] = {
      ownerId,
      displayName: owner?.displayName || owner?.email || ownerId,
      policy,
      students: students.length,
      messages: messages.length,
      attachments: attachments.length,
    };
  }
  return result;
}


function safeMessagePayload(payload = {}, current = null) {
  const allowedClientStatuses = new Set(['draft', 'scheduled', 'approval_required', 'ready', 'cancelled']);
  const requested = String(payload.status || current?.status || 'draft');
  return {
    ...payload,
    status: allowedClientStatuses.has(requested) ? requested : (current?.status || 'draft'),
    deliverySummary: current?.deliverySummary || payload.deliverySummary || null,
    sentAt: current?.sentAt || null,
  };
}

function ownedMessage(store, user, id) {
  const message = store.resource('messages')[id];
  if (!message || !canAccessRecord(user, message, { write: true, resource: 'messages' })) throw httpError(404, 'Zpráva nebyla nalezena.', 'message_missing');
  return message;
}

function uid(prefix) {
  return `${prefix}_${randomUUID()}`;
}

function httpError(status, message, code = 'request_error') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function corsHeaders(request, config) {
  const origin = request.headers.origin;
  if (!origin) return {};
  if (!config.allowedOrigins.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'authorization,content-type,x-lesson-hub-client',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    vary: 'Origin',
  };
}

function audit(store, { actorId = null, action, entityType, entityId = null, metadata = {}, ip = '' }) {
  store.data.audit.push({
    id: uid('serverAudit'), actorId, action, entityType, entityId,
    metadata, ip, timestamp: new Date().toISOString(),
  });
  if (store.data.audit.length > 10_000) store.data.audit.splice(0, store.data.audit.length - 10_000);
}

async function authenticate(request, store, config) {
  const upstreamSecret = String(request.headers['x-ghrab-upstream-secret'] || '');
  if (config.upstreamAuthSecret && upstreamSecret && constantTimeTokenEqual(upstreamSecret, config.upstreamAuthSecret)) {
    const decode = (value) => { try { return decodeURIComponent(String(value || '')); } catch { return String(value || ''); } };
    const externalId = decode(request.headers['x-ghrab-user-id']).trim();
    if (!externalId) throw httpError(401, 'Centrální identita chybí.', 'ghrab_identity_missing');
    const roles = String(request.headers['x-ghrab-user-roles'] || 'teacher').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
    const role = roles.includes('admin') || roles.includes('owner') ? 'admin' : roles.includes('substitute') ? 'substitute' : 'teacher';
    const id = `ghrab_${tokenDigest(externalId).slice(0, 24)}`;
    const email = externalId.includes('@') ? normalizeEmail(externalId) : `${id}@ghrab.local`;
    const displayName = decode(request.headers['x-ghrab-user-name']).trim() || externalId;
    let user = store.data.users.find((item) => item.id === id || (item.authSource === 'ghrab-sso' && item.externalIdHash === tokenDigest(externalId)));
    let changed = false;
    if (!user) {
      user = { id, email, displayName, role, status: 'active', passwordHash: '', authSource: 'ghrab-sso', externalIdHash: tokenDigest(externalId), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastLoginAt: new Date().toISOString() };
      store.data.users.push(user); changed = true;
    } else {
      if (user.displayName !== displayName) { user.displayName = displayName; changed = true; }
      if (user.role !== role && user.role !== 'owner') { user.role = role; changed = true; }
      if (user.status !== 'active') throw httpError(401, 'Uživatelský účet není aktivní.', 'user_inactive');
      if (changed) user.updatedAt = new Date().toISOString();
      user.lastLoginAt = new Date().toISOString();
    }
    if (changed) await store.save();
    const expiresAt = String(request.headers['x-ghrab-session-expires-at'] || new Date(Date.now() + 10 * 60 * 1000).toISOString());
    return { user, session: { id: `ghrab:${id}`, userId: id, expiresAt, lastSeenAt: new Date().toISOString(), upstream: true }, tokenDigest: null, upstream: true };
  }
  const header = String(request.headers.authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw httpError(401, 'Serverová relace chybí.', 'session_missing');
  store.pruneSessions();
  const digest = tokenDigest(match[1]);
  const session = store.data.sessions.find((item) => item.tokenDigest === digest);
  if (!session) throw httpError(401, 'Serverová relace je neplatná nebo vypršela.', 'session_invalid');
  const user = store.data.users.find((item) => item.id === session.userId && item.status === 'active');
  if (!user) throw httpError(401, 'Uživatelský účet není aktivní.', 'user_inactive');
  session.lastSeenAt = new Date().toISOString();
  return { user, session, tokenDigest: digest, upstream: false };
}

function visibleRecords(store, resource, user) {
  return Object.values(store.resource(resource)).filter((record) => canAccessRecord(user, record, { resource }));
}

function scrubHistoricalChangesForEntity(store, resource, entityId) {
  const before = store.data.changes.length;
  store.data.changes = store.data.changes.filter((item) => !(item.resource === resource && item.entityId === entityId));
  return before - store.data.changes.length;
}

function deleteWithSyncTombstone(store, { resource, entityId, ownerId, actorId, clientId = '', clientChangeId = '' }) {
  scrubHistoricalChangesForEntity(store, resource, entityId);
  delete store.resource(resource)[entityId];
  return changeFor(store, { resource, entityId, operation: 'delete', payload: { id: entityId }, ownerId, actorId, clientId, clientChangeId });
}

function changeFor(store, { resource, entityId, operation, payload, ownerId, actorId, clientId = '', clientChangeId = '' }) {
  const change = {
    cursor: store.nextCursor(),
    id: uid('change'),
    schema: SYNC_CONTRACT,
    resource,
    entityId,
    operation,
    payload,
    ownerId,
    actorId,
    clientId,
    clientChangeId,
    timestamp: new Date().toISOString(),
  };
  store.data.changes.push(change);
  if (store.data.changes.length > 25_000) {
    store.data.changes.splice(0, store.data.changes.length - 25_000);
    store.data.oldestCursor = Number(store.data.changes[0]?.cursor || store.data.nextCursor);
  }
  return change;
}

function upsertResource(store, { resource, entityId, payload, user, clientId = '', clientChangeId = '' }) {
  if (!RESOURCE_NAMES.includes(resource)) throw httpError(404, 'Neznámý datový zdroj.', 'resource_unknown');
  try {
    assertSafeUntrustedIdentifier(entityId, { label: 'entityId' });
    assertSafeUntrustedRecord(payload, { label: `payload.${resource}` });
  } catch (error) {
    throw httpError(400, `Datový záznam neprošel bezpečnostní validací: ${error.message}`, 'record_schema_invalid');
  }
  const records = store.resource(resource);
  const current = records[entityId] || null;
  if (current && !canAccessRecord(user, current, { write: true, resource })) throw httpError(403, 'Záznam patří jinému uživateli.', 'record_forbidden');
  const now = new Date().toISOString();
  const incomingUpdatedAt = String(payload?.updatedAt || payload?.createdAt || '');
  const incomingRevision = Number(payload?.serverRevision);
  const currentRevision = Number(current?.serverRevision || 0);
  if (current && Number.isFinite(incomingRevision) && incomingRevision < currentRevision) {
    return { conflict: true, serverRecord: current };
  }
  const requestedVisibility = payload && Object.prototype.hasOwnProperty.call(payload, 'visibility')
    ? visibilityForResource(resource, payload.visibility, current?.visibility || 'private')
    : visibilityForResource(resource, current?.visibility || 'private', 'private');
  const record = {
    ...(current || {}),
    ...(payload || {}),
    id: entityId,
    ownerId: current?.ownerId || user.id,
    visibility: requestedVisibility,
    serverRevision: Number(current?.serverRevision || 0) + 1,
    serverUpdatedAt: now,
    updatedAt: incomingUpdatedAt || now,
    createdAt: current?.createdAt || payload?.createdAt || now,
    lastClientId: clientId,
  };
  records[entityId] = record;
  const change = changeFor(store, { resource, entityId, operation: 'upsert', payload: record, ownerId: record.ownerId, actorId: user.id, clientId, clientChangeId });
  return { conflict: false, record, change };
}

function deleteResource(store, { resource, entityId, user, clientId = '', clientChangeId = '' }) {
  if (!RESOURCE_NAMES.includes(resource)) throw httpError(404, 'Neznámý datový zdroj.', 'resource_unknown');
  try {
    assertSafeUntrustedIdentifier(entityId, { label: 'entityId' });
  } catch (error) {
    throw httpError(400, `Identifikátor záznamu neprošel bezpečnostní validací: ${error.message}`, 'record_schema_invalid');
  }
  const records = store.resource(resource);
  const current = records[entityId];
  if (!current) return { deleted: false, change: null };
  if (!canAccessRecord(user, current, { write: true, resource })) throw httpError(403, 'Záznam patří jinému uživateli.', 'record_forbidden');
  const change = deleteWithSyncTombstone(store, { resource, entityId, ownerId: current.ownerId, actorId: user.id, clientId, clientChangeId });
  return { deleted: true, change };
}

export async function createLessonHubServer({ config = loadServerConfig(), store = createStore(config) } = {}) {
  await store.open();
  const startupNormalization = normalizeOpenedStore(store);
  if (startupNormalization.changed > 0) await store.save();
  const ipLimiter = new SlidingWindowLimiter({ windowMs: config.loginWindowMs, maxAttempts: config.loginAttempts * 4 });
  const accountLimiter = new SlidingWindowLimiter({ windowMs: config.loginWindowMs, maxAttempts: config.loginAttempts });
  const mailAdapter = createMailAdapter(config);
  const dispatcher = new MessageDispatcher({ store, config, mailAdapter, audit: (details) => audit(store, details) });
  const operations = await new OperationsManager({ store, config, serverVersion: SERVER_VERSION, audit: (details) => audit(store, details), normalizeStore: normalizeOpenedStore }).initialize();

  const handler = async (request, response) => {
    const headers = corsHeaders(request, config);
    if (request.headers.origin && !config.allowedOrigins.includes(request.headers.origin)) return json(response, 403, { error: 'origin_forbidden', message: 'Původ požadavku není povolen.' });
    if (request.method === 'OPTIONS') return noContent(response, headers);
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    const segments = url.pathname.split('/').filter(Boolean);
    const ip = requestIp(request);

    try {
      if (request.method === 'GET' && url.pathname === '/health') {
        return json(response, 200, { status: 'ok', version: SERVER_VERSION }, headers);
      }
      if (store.frozen) throw httpError(503, 'Server právě obnovuje data ze zálohy.', 'store_frozen');

      if (request.method === 'POST' && url.pathname === '/v1/auth/login') {
        const body = await readJson(request, config.bodyLimitBytes);
        const email = normalizeEmail(body.email);
        const ipKey = `ip:${ip}`;
        const accountKey = `account:${email}`;
        ipLimiter.assert(ipKey);
        accountLimiter.assert(accountKey);
        const user = store.data.users.find((item) => item.email === email && item.status === 'active');
        if (!user || !(await verifyPasswordAsync(body.password, user.passwordHash))) {
          audit(store, { action: 'auth-login-failed', entityType: 'user', entityId: user?.id || null, metadata: { accountMatched: Boolean(user) }, ip });
          await store.save();
          throw httpError(401, 'E-mail nebo heslo není správné.', 'credentials_invalid');
        }
        accountLimiter.reset(accountKey);
        ipLimiter.reset(ipKey);
        const token = createSessionToken();
        const now = Date.now();
        const session = {
          id: uid('session'), userId: user.id, tokenDigest: tokenDigest(token),
          createdAt: new Date(now).toISOString(), expiresAt: new Date(now + config.sessionHours * 60 * 60 * 1000).toISOString(),
          lastSeenAt: new Date(now).toISOString(), ip,
        };
        store.data.sessions.push(session);
        user.lastLoginAt = new Date(now).toISOString();
        audit(store, { actorId: user.id, action: 'auth-login', entityType: 'user', entityId: user.id, ip });
        await store.save();
        return json(response, 200, { token, expiresAt: session.expiresAt, user: safeUser(user) }, headers);
      }

      const auth = await authenticate(request, store, config);
      const user = auth.user;

      if (request.method === 'POST' && url.pathname === '/v1/auth/logout') {
        if (!auth.upstream) store.data.sessions = store.data.sessions.filter((item) => item.tokenDigest !== auth.tokenDigest);
        audit(store, { actorId: user.id, action: auth.upstream ? 'auth-central-logout-request' : 'auth-logout', entityType: 'user', entityId: user.id, ip });
        await store.save();
        return noContent(response, headers);
      }
      if (request.method === 'GET' && url.pathname === '/v1/auth/me') return json(response, 200, { user: safeUser(user), expiresAt: auth.session.expiresAt }, headers);
      if (request.method === 'GET' && url.pathname === '/v1/server/info') {
        requirePermission(user, 'server:read');
        return json(response, 200, {
          version: SERVER_VERSION, apiContract: API_CONTRACT, syncContract: SYNC_CONTRACT,
          resources: RESOURCE_NAMES, role: user.role, currentCursor: Math.max(0, store.data.nextCursor - 1), attachmentLimitBytes: config.attachmentLimitBytes,
          mail: mailAdapter.status,
        }, headers);
      }

      if (segments[0] === 'v1' && segments[1] === 'operations') {
        if (request.method === 'GET') requirePermission(user, 'operations:read');
        else requirePermission(user, segments[2] === 'backups' && segments[4] === 'restore' ? 'operations:restore' : 'operations:write');

        if (request.method === 'GET' && segments[2] === 'status') {
          return json(response, 200, { status: await operations.status() }, headers);
        }
        if (request.method === 'GET' && segments[2] === 'backups' && segments.length === 3) {
          return json(response, 200, { items: await operations.listBackups() }, headers);
        }
        if (request.method === 'POST' && segments[2] === 'backups' && segments.length === 3) {
          const body = await readJson(request, config.bodyLimitBytes);
          const backup = await operations.createBackup({ reason: body.reason || 'manual', actorId: user.id, metadata: { ip } });
          await store.save();
          return json(response, 201, { backup }, headers);
        }
        if (request.method === 'POST' && segments[2] === 'backups' && segments[3] && segments[4] === 'restore') {
          const result = await operations.restoreBackup(segments[3], { actorId: user.id });
          return json(response, 200, result, headers);
        }
        if (request.method === 'DELETE' && segments[2] === 'backups' && segments[3]) {
          const backup = await operations.deleteBackup(segments[3], { actorId: user.id });
          await store.save();
          return json(response, 200, { backup }, headers);
        }
        if (request.method === 'POST' && segments[2] === 'maintenance') {
          const body = await readJson(request, config.bodyLimitBytes);
          const before = store.data.sessions.length;
          store.pruneSessions();
          const result = {
            sessionsPruned: Math.max(0, before - store.data.sessions.length),
            messages: body.processMessages === false ? null : await dispatcher.processDue({ actorId: user.id }),
            backup: body.createBackup === true ? await operations.createBackup({ reason: 'maintenance', actorId: user.id }) : null,
          };
          operations.recordMaintenance({ sessionsPruned: result.sessionsPruned, preparedMessages: result.messages?.prepared?.length || 0, dispatchedMessages: result.messages?.dispatched?.length || 0, backupId: result.backup?.id || null });
          audit(store, { actorId: user.id, action: 'operations-maintenance-run', entityType: 'serverOperations', metadata: operations.lastMaintenanceResult, ip });
          await store.save();
          return json(response, 200, { result, status: await operations.status() }, headers);
        }
      }

      if (segments[0] === 'v1' && segments[1] === 'users') {
        requirePermission(user, segments.length === 2 && request.method === 'GET' ? 'users:read' : 'users:write');
        if (request.method === 'GET' && segments.length === 2) return json(response, 200, { items: store.data.users.map(safeUser) }, headers);
        if (request.method === 'POST' && segments.length === 2) {
          const body = await readJson(request, config.bodyLimitBytes);
          const email = normalizeEmail(body.email);
          if (!email || !email.includes('@')) throw httpError(400, 'E-mail není platný.', 'email_invalid');
          if (store.data.users.some((item) => item.email === email)) throw httpError(409, 'Účet s tímto e-mailem již existuje.', 'user_exists');
          const requestedRole = normalizeRole(body.role);
          if (requestedRole === 'owner' && user.role !== 'owner') throw httpError(403, 'Pouze vlastník může vytvořit dalšího vlastníka.', 'owner_role_forbidden');
          const created = {
            id: uid('user'), email, displayName: String(body.displayName || email).trim(),
            role: requestedRole, status: 'active', passwordHash: await hashPasswordAsync(body.password),
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastLoginAt: null,
          };
          store.data.users.push(created);
          audit(store, { actorId: user.id, action: 'user-created', entityType: 'user', entityId: created.id, metadata: { role: created.role }, ip });
          await store.save();
          return json(response, 201, { user: safeUser(created) }, headers);
        }
        if (request.method === 'PATCH' && segments.length === 3) {
          const target = store.data.users.find((item) => item.id === segments[2]);
          if (!target) throw httpError(404, 'Uživatel nebyl nalezen.', 'user_missing');
          const body = await readJson(request, config.bodyLimitBytes);
          if (target.role === 'owner' && user.role !== 'owner') throw httpError(403, 'Účet vlastníka může měnit pouze vlastník.', 'owner_account_forbidden');
          if (body.role != null && normalizeRole(body.role) === 'owner' && user.role !== 'owner') throw httpError(403, 'Roli vlastníka může přidělit pouze vlastník.', 'owner_role_forbidden');
          if (body.status === 'disabled' && target.id === user.id) throw httpError(400, 'Nelze zakázat vlastní aktivní relaci.', 'self_disable_forbidden');
          if (body.status === 'disabled' && target.role === 'owner' && store.data.users.filter((item) => item.role === 'owner' && item.status === 'active').length <= 1) throw httpError(400, 'Nelze zakázat posledního aktivního vlastníka.', 'last_owner_forbidden');
          if (body.displayName != null) target.displayName = String(body.displayName).trim();
          if (body.role != null) target.role = normalizeRole(body.role);
          if (body.status != null) target.status = body.status === 'disabled' ? 'disabled' : 'active';
          const passwordChanged = Boolean(body.password);
          if (passwordChanged) target.passwordHash = await hashPasswordAsync(body.password);
          if (passwordChanged || target.status === 'disabled') {
            store.data.sessions = store.data.sessions.filter((session) => session.userId !== target.id);
          }
          target.updatedAt = new Date().toISOString();
          audit(store, { actorId: user.id, action: 'user-updated', entityType: 'user', entityId: target.id, metadata: { role: target.role, status: target.status }, ip });
          await store.save();
          return json(response, 200, { user: safeUser(target) }, headers);
        }
      }


      if (segments[0] === 'v1' && segments[1] === 'attachments') {
        if (request.method === 'GET') requirePermission(user, 'attachments:read');
        else requirePermission(user, 'attachments:write');
        if (request.method === 'GET' && segments.length === 2) {
          const items = Object.values(store.data.attachments).filter((item) => canAccessAttachment(user, item));
          return json(response, 200, { items: items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))) }, headers);
        }
        if (request.method === 'POST' && segments[2] === 'upload') {
          const body = await readJson(request, Math.max(config.bodyLimitBytes, config.attachmentLimitBytes * 2));
          const fileName = sanitizeFileName(body.fileName);
          const mimeType = String(body.mimeType || 'application/octet-stream').toLowerCase();
          if (!ALLOWED_ATTACHMENT_TYPES.has(mimeType)) throw httpError(415, 'Tento typ přílohy není povolen.', 'attachment_type_forbidden');
          let content;
          try { content = Buffer.from(String(body.contentBase64 || ''), 'base64'); } catch { throw httpError(400, 'Obsah přílohy není platný.', 'attachment_invalid'); }
          if (!content.length) throw httpError(400, 'Příloha je prázdná.', 'attachment_empty');
          if (content.length > config.attachmentLimitBytes) throw httpError(413, 'Příloha překračuje povolenou velikost.', 'attachment_too_large');
          const id = uid('attachment');
          const checksum = createHash('sha256').update(content).digest('hex');
          const policy = attachmentPolicy(body.purpose, body.visibility);
          // Deduplicate only inside the same privacy context. Reusing a broader legacy record
          // for a sensitive/private upload would silently re-expand access to the bytes.
          const duplicate = Object.values(store.data.attachments).find((item) => item.ownerId === user.id && item.checksum === checksum && item.size === content.length && item.purpose === policy.purpose && item.visibility === policy.visibility);
          if (duplicate) return json(response, 200, { attachment: duplicate, duplicate: true }, headers);
          await mkdir(config.attachmentsDir, { recursive: true });
          const storageName = `${id}.bin`;
          await writeFile(path.join(config.attachmentsDir, storageName), content, { mode: 0o600 });
          const attachment = {
            id, ownerId: user.id, fileName, mimeType, size: content.length, checksum, storageName,
            purpose: policy.purpose, visibility: policy.visibility,
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          };
          store.data.attachments[id] = attachment;
          audit(store, { actorId: user.id, action: 'attachment-uploaded', entityType: 'attachment', entityId: id, metadata: { mimeType, size: content.length }, ip });
          await store.save();
          return json(response, 201, { attachment, duplicate: false }, headers);
        }
        const attachmentId = segments[2] || '';
        const attachment = store.data.attachments[attachmentId];
        if (!attachment || !canAccessAttachment(user, attachment, { write: request.method !== 'GET' })) throw httpError(404, 'Příloha nebyla nalezena.', 'attachment_missing');
        if (request.method === 'GET' && segments.length === 3) return json(response, 200, attachment, headers);
        if (request.method === 'GET' && segments[3] === 'content') {
          const content = await readFile(path.join(config.attachmentsDir, attachment.storageName)).catch(() => null);
          if (!content) throw httpError(404, 'Soubor přílohy na serveru chybí.', 'attachment_content_missing');
          return binary(response, 200, content, { contentType: attachment.mimeType, fileName: attachment.fileName, headers });
        }
        if (request.method === 'DELETE' && segments.length === 3) {
          await unlink(path.join(config.attachmentsDir, attachment.storageName)).catch(() => {});
          delete store.data.attachments[attachmentId];
          const relatedLinks = Object.values(store.resource('attachmentLinks')).filter((link) => link.attachmentId === attachmentId || link.serverId === attachmentId);
          for (const link of relatedLinks) {
            deleteWithSyncTombstone(store, { resource: 'attachmentLinks', entityId: link.id, ownerId: link.ownerId || attachment.ownerId, actorId: user.id });
          }
          audit(store, { actorId: user.id, action: 'attachment-deleted', entityType: 'attachment', entityId: attachmentId, ip });
          await store.save();
          return noContent(response, headers);
        }
      }

      if (request.method === 'GET' && url.pathname === '/v1/mail/status') {
        requirePermission(user, 'mail:read');
        return json(response, 200, { ...mailAdapter.status, maxAttempts: config.mailMaxAttempts, retryMinutes: config.mailRetryMinutes }, headers);
      }

      if (request.method === 'GET' && url.pathname === '/v1/deliveries') {
        requirePermission(user, 'communication:read');
        return json(response, 200, { items: dispatcher.listDeliveries({ user, messageId: url.searchParams.get('messageId') || '' }) }, headers);
      }

      if (request.method === 'POST' && url.pathname === '/v1/messages/process-due') {
        requirePermission(user, 'mail:send');
        const result = await dispatcher.processDue({ actorId: user.id, ownerId: ['owner', 'admin'].includes(user.role) ? null : user.id });
        audit(store, { actorId: user.id, action: 'messages-due-processed', entityType: 'messageBatch', metadata: { prepared: result.prepared.length, dispatched: result.dispatched.length }, ip });
        await store.save();
        return json(response, 200, { items: [...result.prepared, ...result.dispatched.map((item) => item.message)], ...result }, headers);
      }

      if (segments[0] === 'v1' && segments[1] === 'messages' && segments[2] && ['approve', 'send', 'retry', 'deliveries'].includes(segments[3])) {
        const message = ownedMessage(store, user, segments[2]);
        if (request.method === 'GET' && segments[3] === 'deliveries') {
          requirePermission(user, 'communication:read');
          return json(response, 200, { items: dispatcher.listDeliveries({ user, messageId: message.id }) }, headers);
        }
        requirePermission(user, 'mail:send');
        if (request.method === 'POST' && segments[3] === 'approve') {
          if (message.status !== 'approval_required') throw httpError(409, 'Zpráva nečeká na schválení.', 'message_not_waiting_approval');
          message.requireApproval = false;
          message.approvedAt = new Date().toISOString();
          message.approvedBy = user.id;
          message.status = message.scheduledAt && new Date(message.scheduledAt).getTime() > Date.now() ? 'scheduled' : 'ready';
          message.updatedAt = new Date().toISOString();
          audit(store, { actorId: user.id, action: 'message-approved', entityType: 'message', entityId: message.id, ip });
          await store.save();
          return json(response, 200, { message }, headers);
        }
        if (request.method === 'POST' && ['send', 'retry'].includes(segments[3])) {
          const result = await dispatcher.dispatchMessage(message, { actorId: user.id, force: true });
          return json(response, 200, result, headers);
        }
      }

      if (segments[0] === 'v1' && segments[1] === 'substitution') {
        if (request.method === 'GET') requirePermission(user, 'substitution:read');
        else if (user.role === 'substitute') requirePermission(user, 'substitution:update');
        else requirePermission(user, 'substitution:write');

        if (request.method === 'GET' && segments[2] === 'active') {
          return json(response, 200, { items: listSubstitutionBundles(store, user, { activeOnly: true }) }, headers);
        }
        if (request.method === 'GET' && segments[2] === 'periods' && !segments[3]) {
          return json(response, 200, { items: listSubstitutionBundles(store, user) }, headers);
        }
        if (request.method === 'POST' && segments[2] === 'periods' && !segments[3]) {
          if (user.role === 'substitute') throw httpError(403, 'Suplující účet nemůže vytvářet zastupovací období.', 'substitution_create_forbidden');
          const body = await readJson(request, config.bodyLimitBytes);
          const period = createPeriod(store, user, body);
          audit(store, { actorId: user.id, action: 'substitution-period-created', entityType: 'substitutionPeriod', entityId: period.id, metadata: { status: period.status }, ip });
          await store.save();
          return json(response, 201, { period: publicPeriod(period) }, headers);
        }
        if (segments[2] === 'periods' && segments[3]) {
          const period = store.resource('substitutionPeriods')[segments[3]];
          if (!period || !canViewPeriod(user, period)) throw httpError(404, 'Zastupovací období nebylo nalezeno.', 'substitution_period_missing');
          if (request.method === 'GET' && segments[4] === 'summary') {
            return json(response, 200, { item: listSubstitutionBundles(store, user).find((item) => item.id === period.id) }, headers);
          }
          if (request.method === 'PATCH' && !segments[4]) {
            if (!canEditPeriod(user, period)) throw httpError(403, 'Toto období nemůžete upravit.', 'substitution_period_forbidden');
            const body = await readJson(request, config.bodyLimitBytes);
            updatePeriod(period, body);
            audit(store, { actorId: user.id, action: 'substitution-period-updated', entityType: 'substitutionPeriod', entityId: period.id, metadata: { status: period.status }, ip });
            await store.save();
            return json(response, 200, { period: publicPeriod(period) }, headers);
          }
          if (request.method === 'POST' && segments[4] === 'imported') {
            if (!canEditPeriod(user, period)) throw httpError(403, 'Toto období nemůžete upravit.', 'substitution_period_forbidden');
            const body = await readJson(request, config.bodyLimitBytes);
            const ids = new Set(Array.isArray(body.itemIds) ? body.itemIds.map(String) : []);
            for (const item of Object.values(store.resource('substitutionItems'))) if (ids.has(item.id) && item.periodId === period.id) item.importedAt = new Date().toISOString();
            audit(store, { actorId: user.id, action: 'substitution-history-imported', entityType: 'substitutionPeriod', entityId: period.id, metadata: { count: ids.size }, ip });
            await store.save();
            return json(response, 200, { imported: ids.size }, headers);
          }
        }
        if (request.method === 'POST' && segments[2] === 'plans') {
          if (user.role === 'substitute') throw httpError(403, 'Suplující účet nemůže vytvářet plány.', 'substitution_plan_forbidden');
          const body = await readJson(request, config.bodyLimitBytes);
          const period = store.resource('substitutionPeriods')[String(body.periodId || '')];
          if (!period || !canEditPeriod(user, period)) throw httpError(404, 'Zastupovací období nebylo nalezeno.', 'substitution_period_missing');
          const plan = createPlan(store, user, period, body);
          audit(store, { actorId: user.id, action: 'substitution-plan-created', entityType: 'substitutionPlan', entityId: plan.id, metadata: { periodId: period.id }, ip });
          await store.save();
          return json(response, 201, { plan: publicPlan(plan) }, headers);
        }
        if (segments[2] === 'plans' && segments[3]) {
          const plan = store.resource('substitutionPlans')[segments[3]];
          const period = plan ? store.resource('substitutionPeriods')[plan.periodId] : null;
          if (!plan || !period || !canViewPeriod(user, period)) throw httpError(404, 'Zastupovací plán nebyl nalezen.', 'substitution_plan_missing');
          if (request.method === 'PATCH') {
            if (!canEditPeriod(user, period)) throw httpError(403, 'Tento plán nemůžete upravit.', 'substitution_plan_forbidden');
            updatePlan(plan, await readJson(request, config.bodyLimitBytes));
            await store.save();
            return json(response, 200, { plan: publicPlan(plan) }, headers);
          }
        }
        if (request.method === 'POST' && segments[2] === 'items') {
          if (user.role === 'substitute') throw httpError(403, 'Suplující účet nemůže vytvářet položky plánu.', 'substitution_item_forbidden');
          const body = await readJson(request, config.bodyLimitBytes);
          const plan = store.resource('substitutionPlans')[String(body.planId || '')];
          const period = plan ? store.resource('substitutionPeriods')[plan.periodId] : null;
          if (!plan || !period || !canEditPeriod(user, period)) throw httpError(404, 'Zastupovací plán nebyl nalezen.', 'substitution_plan_missing');
          const item = createItem(store, plan, body);
          audit(store, { actorId: user.id, action: 'substitution-item-created', entityType: 'substitutionItem', entityId: item.id, metadata: { planId: plan.id }, ip });
          await store.save();
          return json(response, 201, { item: publicItem(item) }, headers);
        }
        if (segments[2] === 'items' && segments[3] && request.method === 'PATCH') {
          const item = store.resource('substitutionItems')[segments[3]];
          const period = item ? store.resource('substitutionPeriods')[item.periodId] : null;
          if (!item || !period || !canViewPeriod(user, period)) throw httpError(404, 'Položka plánu nebyla nalezena.', 'substitution_item_missing');
          const body = await readJson(request, config.bodyLimitBytes);
          if (canEditPeriod(user, period)) {
            updateItemByOwner(item, body);
            if (body.status != null || body.substituteNote != null || body.realizedAt != null) updateItemProgress(item, user, body);
          } else {
            if (period.status !== 'active') throw httpError(409, 'Zastupovací období není aktivní.', 'substitution_not_active');
            updateItemProgress(item, user, body);
          }
          audit(store, { actorId: user.id, action: 'substitution-item-updated', entityType: 'substitutionItem', entityId: item.id, metadata: { status: item.status }, ip });
          await store.save();
          return json(response, 200, { item: publicItem(item) }, headers);
        }
      }

      if (url.pathname === '/v1/privacy/policy') {
        requirePermission(user, request.method === 'GET' ? 'privacy:read' : 'privacy:write');
        if (request.method === 'GET') return json(response, 200, { policy: privacyPolicyFor(store, user.id) }, headers);
        if (request.method === 'PUT') {
          const body = await readJson(request, config.bodyLimitBytes);
          const policy = {
            studentRetentionDays: safeRetentionDays(body.studentRetentionDays, DEFAULT_PRIVACY_POLICY.studentRetentionDays),
            communicationRetentionDays: safeRetentionDays(body.communicationRetentionDays, DEFAULT_PRIVACY_POLICY.communicationRetentionDays),
            orphanAttachmentRetentionDays: safeRetentionDays(body.orphanAttachmentRetentionDays, DEFAULT_PRIVACY_POLICY.orphanAttachmentRetentionDays),
            updatedAt: new Date().toISOString(), updatedBy: user.id,
          };
          store.data.privacyPolicies[user.id] = policy;
          audit(store, { actorId: user.id, action: 'privacy-policy-updated', entityType: 'privacyPolicy', entityId: user.id, metadata: policy, ip });
          await store.save();
          return json(response, 200, { policy }, headers);
        }
      }

      if (request.method === 'DELETE' && url.pathname === '/v1/privacy/delete-my-data') {
        const deletion = deleteAllUserData(store, user);
        for (const attachmentId of deletion.attachmentIds) {
          const attachment = store.data.attachments[attachmentId];
          if (attachment?.storageName) await unlink(path.join(config.attachmentsDir, attachment.storageName)).catch(() => {});
          delete store.data.attachments[attachmentId];
        }
        await store.save();
        return json(response, 200, { schema: 'lesson-hub-user-data-deletion-v1', ok: true, removed: deletion.removed, backupRetentionApplies: true }, headers);
      }

      if (request.method === 'POST' && url.pathname === '/v1/privacy/purge') {
        requirePermission(user, 'privacy:write');
        const body = await readJson(request, config.bodyLimitBytes);
        const requestedScope = body.scope === 'all' ? 'all' : 'self';
        if (requestedScope === 'all' && !['owner', 'admin'].includes(user.role)) throw httpError(403, 'Globální retenční úklid vyžaduje roli vlastníka nebo správce.', 'privacy_scope_forbidden');
        const candidates = purgeCandidates(store, user, { scope: requestedScope });
        const summary = { scope: candidates.scope, students: candidates.students.length, messages: candidates.messages.length, attachments: candidates.attachments.length, byOwner: candidates.byOwner };
        if (body.commit === true) {
          for (const item of candidates.students) {
            deleteWithSyncTombstone(store, { resource: 'students', entityId: item.id, ownerId: item.ownerId, actorId: user.id });
          }
          const removedMessageIds = new Set(candidates.messages.map((item) => item.id));
          const relatedDeliveries = Object.values(store.resource('messageDeliveries')).filter((item) => removedMessageIds.has(item.messageId));
          for (const item of candidates.messages) {
            deleteWithSyncTombstone(store, { resource: 'messages', entityId: item.id, ownerId: item.ownerId, actorId: user.id });
          }
          for (const delivery of relatedDeliveries) {
            deleteWithSyncTombstone(store, { resource: 'messageDeliveries', entityId: delivery.id, ownerId: delivery.ownerId, actorId: user.id });
          }
          summary.messageDeliveries = relatedDeliveries.length;
          const removedAttachmentIds = new Set(candidates.attachments.map((item) => item.id));
          for (const item of candidates.attachments) {
            await unlink(path.join(config.attachmentsDir, item.storageName)).catch(() => {});
            delete store.data.attachments[item.id];
          }
          const relatedAttachmentLinks = Object.values(store.resource('attachmentLinks')).filter((link) => removedAttachmentIds.has(link.attachmentId || link.serverId));
          for (const link of relatedAttachmentLinks) {
            deleteWithSyncTombstone(store, { resource: 'attachmentLinks', entityId: link.id, ownerId: link.ownerId || user.id, actorId: user.id });
          }
          audit(store, { actorId: user.id, action: 'privacy-retention-purge', entityType: 'privacyPolicy', entityId: user.id, metadata: summary, ip });
          await store.save();
        }
        return json(response, 200, { committed: body.commit === true, summary }, headers);
      }

      if (request.method === 'GET' && url.pathname === '/v1/audit') {
        requirePermission(user, 'audit:read');
        const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 100));
        return json(response, 200, { items: store.data.audit.slice(-limit).reverse() }, headers);
      }

      if (request.method === 'POST' && url.pathname === '/v1/sync/push') {
        requirePermission(user, 'sync:write');
        const body = await readJson(request, config.bodyLimitBytes);
        if (body.schema !== SYNC_CONTRACT || !Array.isArray(body.changes)) throw httpError(400, 'Synchronizační balíček nemá platné schéma.', 'sync_schema_invalid');
        const accepted = [];
        const conflicts = [];
        const knownChangeIds = new Set(store.data.changes.map((item) => item.clientChangeId).filter(Boolean));
        for (const item of body.changes.slice(0, 500)) {
          if (knownChangeIds.has(item.id)) {
            accepted.push({ id: item.id, duplicate: true });
            continue;
          }
          if (item.operation === 'delete') {
            const result = deleteResource(store, { resource: item.resource, entityId: item.entityId, user, clientId: body.clientId, clientChangeId: item.id });
            accepted.push({ id: item.id, deleted: result.deleted, cursor: result.change?.cursor || null });
          } else {
            const result = upsertResource(store, { resource: item.resource, entityId: item.entityId, payload: item.payload, user, clientId: body.clientId, clientChangeId: item.id });
            if (result.conflict) conflicts.push({ id: item.id, resource: item.resource, entityId: item.entityId, serverRecord: result.serverRecord });
            else accepted.push({ id: item.id, cursor: result.change.cursor, serverRecord: result.record });
          }
        }
        audit(store, { actorId: user.id, action: 'sync-push', entityType: 'sync', metadata: { accepted: accepted.length, conflicts: conflicts.length, clientId: body.clientId }, ip });
        await store.save();
        return json(response, 200, { accepted, conflicts, cursor: Math.max(0, store.data.nextCursor - 1) }, headers);
      }

      if (request.method === 'GET' && url.pathname === '/v1/sync/pull') {
        requirePermission(user, 'sync:read');
        const since = Math.max(0, Number(url.searchParams.get('since')) || 0);
        const oldestCursor = Number(store.data.oldestCursor || store.data.changes[0]?.cursor || 1);
        if (since > 0 && since < oldestCursor - 1) throw httpError(409, 'Synchronizační kurzor je příliš starý; je nutná úplná obnova.', 'cursor_too_old');
        const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit')) || 500));
        const items = store.data.changes
          .filter((change) => change.cursor > since && (change.ownerId === user.id || user.role === 'owner' || user.role === 'admin'))
          .slice(0, limit);
        const cursor = items.length ? items.at(-1).cursor : Math.max(since, Math.max(0, store.data.nextCursor - 1));
        return json(response, 200, { schema: SYNC_CONTRACT, items, cursor, hasMore: items.length === limit }, headers);
      }

      if (segments[0] === 'v1' && RESOURCE_NAMES.includes(segments[1])) {
        const resource = segments[1];
        const entityId = segments[2] || '';
        if (request.method === 'GET') requirePermission(user, 'resources:read');
        else requirePermission(user, 'resources:write');
        if (request.method === 'GET' && !entityId) return json(response, 200, { items: visibleRecords(store, resource, user) }, headers);
        if (request.method === 'GET' && entityId) {
          const record = store.resource(resource)[entityId];
          if (!record || !canAccessRecord(user, record, { resource })) throw httpError(404, 'Záznam nebyl nalezen.', 'record_missing');
          return json(response, 200, record, headers);
        }
        if (request.method === 'POST' && !entityId) {
          const body = await readJson(request, config.bodyLimitBytes);
          const id = String(body.id || uid(resource.slice(0, -1) || 'entity'));
          const payload = resource === 'messages' ? safeMessagePayload(body) : body;
          const result = upsertResource(store, { resource, entityId: id, payload, user, clientId: request.headers['x-lesson-hub-client'] || '' });
          audit(store, { actorId: user.id, action: 'resource-created', entityType: resource, entityId: id, ip });
          await store.save();
          return json(response, 201, result.record, headers);
        }
        if (request.method === 'PATCH' && entityId) {
          const current = store.resource(resource)[entityId];
          if (!current || !canAccessRecord(user, current, { write: true, resource })) throw httpError(404, 'Záznam nebyl nalezen.', 'record_missing');
          const body = await readJson(request, config.bodyLimitBytes);
          const payload = resource === 'messages' ? safeMessagePayload(body, current) : body;
          const result = upsertResource(store, { resource, entityId, payload, user, clientId: request.headers['x-lesson-hub-client'] || '' });
          if (result.conflict) return json(response, 409, { error: 'conflict', serverRecord: result.serverRecord }, headers);
          audit(store, { actorId: user.id, action: 'resource-updated', entityType: resource, entityId, ip });
          await store.save();
          return json(response, 200, result.record, headers);
        }
        if (request.method === 'DELETE' && entityId) {
          deleteResource(store, { resource, entityId, user, clientId: request.headers['x-lesson-hub-client'] || '' });
          audit(store, { actorId: user.id, action: 'resource-deleted', entityType: resource, entityId, ip });
          await store.save();
          return noContent(response, headers);
        }
      }

      throw httpError(404, 'Požadovaná serverová cesta neexistuje.', 'route_missing');
    } catch (error) {
      const status = Number(error.status) || 500;
      if (status >= 500) console.error(error);
      const errorHeaders = error.retryAfterSeconds ? { ...headers, 'retry-after': String(error.retryAfterSeconds) } : headers;
      return json(response, status, { error: error.code || 'server_error', message: status >= 500 ? 'Server operaci nedokončil.' : error.message }, errorHeaders);
    }
  };

  const server = createHttpServer(handler);
  return { server, store, config, mailAdapter, dispatcher, operations };
}

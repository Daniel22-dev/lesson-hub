import { ENTITY_STORES } from '../core/constants.js';
import { SERVER_API_CONTRACT } from '../server/dataGateway.js';

const ENTITY_RESOURCE_MAP = Object.freeze({
  schoolYear: 'schoolYears', subject: 'subjects', groupIdentity: 'groupIdentities', group: 'groupInstances', groupInstance: 'groupInstances',
  lesson: 'lessons', quickNote: 'quickNotes', task: 'tasks', reminder: 'reminders', material: 'materials', materialLink: 'materialLinks',
  tag: 'tags', entityTag: 'entityTags', student: 'students', lessonTemplate: 'lessonTemplates', teachingCycle: 'teachingCycles',
  messageTemplate: 'messageTemplates', message: 'messages', messageDelivery: 'messageDeliveries', attachment: 'attachments', attachmentLink: 'attachmentLinks',
  substitutionPeriod: 'substitutionPeriods', substitutionPlan: 'substitutionPlans', substitutionItem: 'substitutionItems',
});
const SYNC_RESOURCES = new Set(SERVER_API_CONTRACT.resources);
const PREPARED_MARKER_KEY = 'sync:lastPreparedAudit';
const MAX_ATTEMPTS = 5;
const SYNC_RETENTION_MS = 30 * 86_400_000;

function operationFromAction(action) { return /delete|remove/i.test(String(action || '')) ? 'delete' : 'upsert'; }
function afterMarker(event, marker) {
  if (!marker?.timestamp) return true;
  const byTime = String(event.timestamp || '').localeCompare(String(marker.timestamp));
  return byTime > 0 || (byTime === 0 && String(event.id).localeCompare(String(marker.id || '')) > 0);
}

export class SyncService {
  constructor(repositories, serverService = null) {
    this.repositories = repositories;
    this.database = repositories.syncQueue.database;
    this.serverService = serverService;
  }
  setServerService(serverService) { this.serverService = serverService; }

  async prepareFromAudit({ since = '', limit = 500 } = {}) {
    const [audits, marker] = await Promise.all([
      this.repositories.auditEvents.list(),
      this.database.get(ENTITY_STORES.appMeta, PREPARED_MARKER_KEY),
    ]);
    const candidates = audits
      .filter((event) => !since || event.timestamp > since)
      .filter((event) => afterMarker(event, marker))
      .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)) || String(a.id).localeCompare(String(b.id)))
      .slice(0, limit);
    const created = [];
    for (const event of candidates) {
      const resource = ENTITY_RESOURCE_MAP[event.entityType];
      if (!resource || !SYNC_RESOURCES.has(resource)) continue;
      const repository = this.repositories[resource];
      const operation = operationFromAction(event.action);
      const entity = operation === 'delete' ? null : await repository?.get(event.entityId);
      if (operation !== 'delete' && !entity) continue;
      const id = `sync_${event.id}`;
      if (await this.repositories.syncQueue.get(id)) continue;
      created.push(await this.repositories.syncQueue.create({
        id,
        schema: SERVER_API_CONTRACT.syncEnvelope.schema,
        auditEventId: event.id,
        resource,
        entityType: event.entityType,
        entityId: event.entityId,
        operation,
        payload: operation === 'delete' ? { id: event.entityId } : entity,
        status: 'pending', attemptCount: 0, lastAttemptAt: null, syncedAt: null,
      }));
    }
    const last = candidates.at(-1);
    if (last) await this.database.put(ENTITY_STORES.appMeta, { key: PREPARED_MARKER_KEY, timestamp: last.timestamp, id: last.id, updatedAt: new Date().toISOString() });
    return created;
  }

  async list({ status = '' } = {}) {
    const queue = await this.repositories.syncQueue.list();
    return queue.filter((item) => !status || item.status === status).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }
  async conflicts({ status = 'open' } = {}) {
    const items = await this.repositories.syncConflicts.list();
    return items.filter((item) => !status || item.status === status).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }
  async markSynced(id, cursor = null) {
    return this.repositories.syncQueue.update(id, { status: 'synced', serverCursor: cursor, syncedAt: new Date().toISOString(), lastAttemptAt: new Date().toISOString(), error: '', payload: null });
  }
  async markFailed(id, message) {
    const current = await this.repositories.syncQueue.get(id);
    if (!current) throw new Error('Položka synchronizační fronty nebyla nalezena.');
    const attemptCount = Number(current.attemptCount || 0) + 1;
    return this.repositories.syncQueue.update(id, {
      status: attemptCount >= MAX_ATTEMPTS ? 'blocked' : 'failed', attemptCount,
      lastAttemptAt: new Date().toISOString(), error: String(message || 'Neznámá chyba'),
    });
  }

  async pushPending({ limit = 200 } = {}) {
    if (!this.serverService?.isAuthenticated) throw new Error('Nejprve se přihlaste k Lesson Hub Serveru.');
    const pending = (await this.list()).filter((item) => ['pending', 'failed'].includes(item.status) && Number(item.attemptCount || 0) < MAX_ATTEMPTS && item.resource).slice(0, limit);
    if (!pending.length) return { accepted: 0, conflicts: 0, cursor: this.serverService.config.lastCursor };
    let response;
    try {
      response = await this.serverService.push(pending.map((item) => ({
        id: item.id, resource: item.resource, entityId: item.entityId, operation: item.operation, payload: item.payload,
      })));
    } catch (error) {
      for (const item of pending) await this.markFailed(item.id, error.message);
      throw error;
    }
    for (const accepted of response.accepted || []) await this.markSynced(accepted.id, accepted.cursor || response.cursor);
    for (const conflict of response.conflicts || []) {
      const localQueue = pending.find((item) => item.id === conflict.id);
      await this.repositories.syncConflicts.create({
        queueItemId: conflict.id, resource: conflict.resource, entityId: conflict.entityId,
        localRecord: localQueue?.payload || null, serverRecord: conflict.serverRecord || null,
        status: 'open', resolution: '', detectedAt: new Date().toISOString(),
      });
      await this.markFailed(conflict.id, 'Server obsahuje novější verzi záznamu.');
    }
    if (response.cursor != null) this.serverService.setCursor(Math.max(this.serverService.config.lastCursor, response.cursor));
    return { accepted: response.accepted?.length || 0, conflicts: response.conflicts?.length || 0, cursor: response.cursor };
  }

  async #applyChanges(items) {
    let applied = 0;
    let conflicts = 0;
    const outstanding = (await this.list()).filter((item) => ['pending', 'failed', 'blocked'].includes(item.status));
    for (const change of items) {
      const repository = this.repositories[change.resource];
      if (!repository) continue;
      const localPending = outstanding.find((item) => item.resource === change.resource && item.entityId === change.entityId);
      if (localPending) {
        await this.repositories.syncConflicts.create({
          queueItemId: localPending.id, resource: change.resource, entityId: change.entityId,
          localRecord: localPending.payload || await repository.get(change.entityId), serverRecord: change.payload || null,
          status: 'open', resolution: '', detectedAt: new Date().toISOString(), serverCursor: change.cursor,
        });
        conflicts += 1;
        continue;
      }
      if (change.operation === 'delete') await repository.remove(change.entityId);
      else if (await repository.get(change.entityId)) await repository.update(change.entityId, change.payload || {}, { preserveUpdatedAt: true });
      else await repository.create({ ...(change.payload || {}), id: change.entityId });
      applied += 1;
    }
    return { applied, conflicts };
  }

  async #fullRefresh() {
    let applied = 0;
    let conflicts = 0;
    for (const resource of SERVER_API_CONTRACT.resources) {
      const items = await this.serverService.listResource(resource);
      const result = await this.#applyChanges(items.map((payload) => ({ resource, entityId: payload.id, operation: 'upsert', payload, cursor: null })));
      applied += result.applied;
      conflicts += result.conflicts;
    }
    const info = await this.serverService.serverInfo();
    this.serverService.setCursor(info.currentCursor || 0);
    return { applied, conflicts, cursor: info.currentCursor || 0, fullRefresh: true, hasMore: false };
  }

  async pullRemote({ limit = 500, maxPages = 100 } = {}) {
    if (!this.serverService?.isAuthenticated) throw new Error('Nejprve se přihlaste k Lesson Hub Serveru.');
    let applied = 0;
    let conflicts = 0;
    let pages = 0;
    let response;
    try {
      do {
        response = await this.serverService.pull({ limit });
        const result = await this.#applyChanges(response.items || []);
        applied += result.applied;
        conflicts += result.conflicts;
        if (response.cursor != null) this.serverService.setCursor(response.cursor);
        pages += 1;
        if (pages >= maxPages && response.hasMore) throw new Error('Synchronizace překročila bezpečný počet dávek.');
      } while (response.hasMore);
    } catch (error) {
      if (error.code === 'cursor_too_old') return this.#fullRefresh();
      throw error;
    }
    return { applied, conflicts, cursor: response?.cursor ?? this.serverService.config.lastCursor, hasMore: false, pages };
  }

  async synchronize() {
    await this.prepareFromAudit();
    const pushed = await this.pushPending();
    const pulled = await this.pullRemote();
    const restoreOutstanding = (await this.list()).some((item) => item.restoreChecksum && ['pending', 'failed', 'blocked'].includes(item.status));
    if (!restoreOutstanding) await this.database.delete(ENTITY_STORES.appMeta, 'sync:restorePending');
    return { pushed, pulled, completedAt: new Date().toISOString() };
  }

  async resolveConflict(id, strategy) {
    const conflict = await this.repositories.syncConflicts.get(id);
    if (!conflict || conflict.status !== 'open') throw new Error('Konflikt nebyl nalezen.');
    const repository = this.repositories[conflict.resource];
    if (!repository) throw new Error('Konflikt odkazuje na neznámý datový zdroj.');
    if (strategy === 'server') {
      if (conflict.serverRecord) {
        if (await repository.get(conflict.entityId)) await repository.update(conflict.entityId, conflict.serverRecord, { preserveUpdatedAt: true });
        else await repository.create({ ...conflict.serverRecord, id: conflict.entityId });
      } else await repository.remove(conflict.entityId);
    } else if (strategy === 'local') {
      const queueItem = conflict.queueItemId ? await this.repositories.syncQueue.get(conflict.queueItemId) : null;
      const local = await repository.get(conflict.entityId);
      const refreshed = local || conflict.localRecord;
      if (queueItem) await this.repositories.syncQueue.update(queueItem.id, { status: 'pending', error: '', attemptCount: 0, payload: refreshed });
    } else throw new Error('Neznámý způsob řešení konfliktu.');
    return this.repositories.syncConflicts.update(id, { status: 'resolved', resolution: strategy, resolvedAt: new Date().toISOString() });
  }

  async clearSynced() {
    const synced = await this.list({ status: 'synced' });
    const cutoff = Date.now() - SYNC_RETENTION_MS;
    let removed = 0;
    for (const item of synced) {
      if (new Date(item.syncedAt || item.updatedAt || 0).getTime() < cutoff) { await this.repositories.syncQueue.remove(item.id); removed += 1; }
      else await this.repositories.syncQueue.update(item.id, { payload: null, compactedAt: new Date().toISOString() });
    }
    return removed;
  }

  async summary() {
    const [queue, conflicts] = await Promise.all([this.list(), this.conflicts({ status: '' })]);
    return {
      contractVersion: SERVER_API_CONTRACT.version,
      pending: queue.filter((item) => item.status === 'pending').length,
      failed: queue.filter((item) => item.status === 'failed').length,
      blocked: queue.filter((item) => item.status === 'blocked').length,
      synced: queue.filter((item) => item.status === 'synced').length,
      conflicts: conflicts.filter((item) => item.status === 'open').length,
      total: queue.length, serverConnected: Boolean(this.serverService?.isAuthenticated), lastCursor: this.serverService?.config.lastCursor || 0,
    };
  }
}

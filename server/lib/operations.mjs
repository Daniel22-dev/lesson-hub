import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const BACKUP_SCHEMA = 'lesson-hub-server-backup-v1';

function backupId() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `backup_${stamp}_${randomUUID().slice(0, 8)}`;
}

function assertBackupId(value) {
  const id = String(value || '');
  if (!/^backup_[A-Za-z0-9_-]+$/.test(id)) {
    const error = new Error('Identifikátor zálohy není platný.');
    error.status = 400;
    error.code = 'backup_id_invalid';
    throw error;
  }
  return id;
}

async function exists(target) {
  try { await stat(target); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function sha256File(target) {
  const hash = createHash('sha256');
  hash.update(await readFile(target));
  return hash.digest('hex');
}

async function treeStats(root) {
  if (!(await exists(root))) return { files: 0, bytes: 0 };
  let files = 0;
  let bytes = 0;
  const visit = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) {
        const info = await stat(target);
        files += 1;
        bytes += info.size;
      }
    }
  };
  await visit(root);
  return { files, bytes };
}

async function readManifest(directory) {
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  if (manifest.schema !== BACKUP_SCHEMA) throw new Error('Záloha má neznámé schéma.');
  return manifest;
}

function resourceCount(store) {
  return Object.values(store.data.resources || {}).reduce((sum, records) => sum + Object.keys(records || {}).length, 0);
}

export class OperationsManager {
  constructor({ store, config, serverVersion, audit = () => {} }) {
    this.store = store;
    this.config = {
      backupDir: path.join(path.dirname(config.dataFile), 'backups'),
      backupEnabled: false,
      backupIntervalHours: 24,
      backupRetentionCount: 14,
      ...config,
    };
    this.serverVersion = serverVersion;
    this.audit = audit;
    this.startedAt = Date.now();
    this.lastMaintenanceAt = null;
    this.lastMaintenanceResult = null;
    this.runningBackup = null;
  }

  async initialize() {
    await mkdir(this.config.backupDir, { recursive: true });
    return this;
  }

  async listBackups() {
    await mkdir(this.config.backupDir, { recursive: true });
    const result = [];
    for (const entry of await readdir(this.config.backupDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('backup_')) continue;
      try { result.push(await readManifest(path.join(this.config.backupDir, entry.name))); } catch { /* neúplný snapshot se nezobrazuje */ }
    }
    return result.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async pruneBackups({ protectedIds = [] } = {}) {
    const protectedSet = new Set(protectedIds.filter(Boolean));
    const backups = await this.listBackups();
    const retained = [];
    const removed = [];
    for (const item of backups) {
      if (protectedSet.has(item.id) || retained.length < this.config.backupRetentionCount) {
        retained.push(item);
        continue;
      }
      await rm(path.join(this.config.backupDir, item.id), { recursive: true, force: true });
      removed.push(item.id);
    }

    const orphanCutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const entry of await readdir(this.config.backupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const isTemporary = entry.name.startsWith('.tmp-backup_');
      const isBackup = entry.name.startsWith('backup_');
      if (!isTemporary && !isBackup) continue;
      if (protectedSet.has(entry.name) || backups.some((item) => item.id === entry.name)) continue;
      const directory = path.join(this.config.backupDir, entry.name);
      const info = await stat(directory).catch(() => null);
      if (info && info.mtimeMs < orphanCutoff) {
        await rm(directory, { recursive: true, force: true });
        removed.push(entry.name);
      }
    }
    return removed;
  }

  async createBackup({ reason = 'manual', actorId = null, metadata = {}, skipPrune = false } = {}) {
    const normalizedReason = String(reason || 'manual');
    if (this.runningBackup) {
      if (this.runningBackup.reason === normalizedReason) return this.runningBackup.promise;
      await this.runningBackup.promise.catch(() => {});
    }
    const promise = this.#createBackup({ reason: normalizedReason, actorId, metadata, skipPrune });
    this.runningBackup = { reason: normalizedReason, promise };
    try { return await promise; }
    finally { if (this.runningBackup?.promise === promise) this.runningBackup = null; }
  }

  async #createBackup({ reason, actorId, metadata, skipPrune }) {
    await this.store.save();
    await mkdir(this.config.backupDir, { recursive: true });
    const id = backupId();
    const temporary = path.join(this.config.backupDir, `.tmp-${id}`);
    const destination = path.join(this.config.backupDir, id);
    await rm(temporary, { recursive: true, force: true });
    await mkdir(temporary, { recursive: true });
    const storeTarget = path.join(temporary, 'store.json');
    await cp(this.config.dataFile, storeTarget);
    const attachmentsTarget = path.join(temporary, 'attachments');
    if (await exists(this.config.attachmentsDir)) await cp(this.config.attachmentsDir, attachmentsTarget, { recursive: true });
    else await mkdir(attachmentsTarget, { recursive: true });
    const attachmentStats = await treeStats(attachmentsTarget);
    const storeInfo = await stat(storeTarget);
    const manifest = {
      schema: BACKUP_SCHEMA,
      id,
      createdAt: new Date().toISOString(),
      reason: String(reason || 'manual').slice(0, 80),
      serverVersion: this.serverVersion,
      storeSchema: this.store.data.schema,
      storeChecksum: await sha256File(storeTarget),
      storeBytes: storeInfo.size,
      attachmentFiles: attachmentStats.files,
      attachmentBytes: attachmentStats.bytes,
      users: this.store.data.users.filter((user) => user.status === 'active').length,
      resources: resourceCount(this.store),
      actorId,
      metadata,
    };
    await writeFile(path.join(temporary, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, destination);
    const pruned = skipPrune ? [] : await this.pruneBackups();
    this.audit({ actorId, action: 'operations-backup-created', entityType: 'serverBackup', entityId: id, metadata: { reason: manifest.reason, pruned } });
    return { ...manifest, pruned };
  }

  async verifyBackup(id) {
    const safeId = assertBackupId(id);
    const directory = path.join(this.config.backupDir, safeId);
    const manifest = await readManifest(directory);
    const storeTarget = path.join(directory, 'store.json');
    const checksum = await sha256File(storeTarget);
    if (checksum !== manifest.storeChecksum) {
      const error = new Error('Kontrolní součet serverové zálohy nesouhlasí.');
      error.status = 409;
      error.code = 'backup_checksum_invalid';
      throw error;
    }
    const parsed = JSON.parse(await readFile(storeTarget, 'utf8'));
    if (!String(parsed.schema || '').startsWith('lesson-hub-server-store-v')) {
      const error = new Error('Datový soubor v záloze nemá podporované schéma.');
      error.status = 409;
      error.code = 'backup_store_invalid';
      throw error;
    }
    return { id: safeId, directory, manifest, parsed };
  }

  async restoreBackup(id, { actorId = null } = {}) {
    const verified = await this.verifyBackup(id);
    const safety = await this.createBackup({ reason: 'pre-restore', actorId, metadata: { restoring: verified.id }, skipPrune: true });
    const sourceStore = path.join(verified.directory, 'store.json');
    const sourceAttachments = path.join(verified.directory, 'attachments');
    const stamp = Date.now();
    const temporaryStore = `${this.config.dataFile}.restore-${stamp}.tmp`;
    const previousStore = `${this.config.dataFile}.before-restore-${stamp}`;
    const temporaryAttachments = `${this.config.attachmentsDir}.restore-${stamp}`;
    const previousAttachments = `${this.config.attachmentsDir}.before-restore-${stamp}`;
    await cp(sourceStore, temporaryStore);
    await rm(temporaryAttachments, { recursive: true, force: true });
    if (await exists(sourceAttachments)) await cp(sourceAttachments, temporaryAttachments, { recursive: true });
    else await mkdir(temporaryAttachments, { recursive: true });

    this.store.freeze();
    let storeMoved = false;
    let attachmentsMoved = false;
    try {
      if (await exists(this.config.dataFile)) {
        await rename(this.config.dataFile, previousStore);
        storeMoved = true;
      }
      if (await exists(this.config.attachmentsDir)) {
        await rename(this.config.attachmentsDir, previousAttachments);
        attachmentsMoved = true;
      }
      await rename(temporaryStore, this.config.dataFile);
      await rename(temporaryAttachments, this.config.attachmentsDir);
      await this.store.open();
      this.store.data.sessions = [];
      this.store.unfreeze();
      const pruned = await this.pruneBackups({ protectedIds: [verified.id, safety.id] });
      this.audit({ actorId, action: 'operations-backup-restored', entityType: 'serverBackup', entityId: verified.id, metadata: { safetyBackupId: safety.id, pruned, sessionsInvalidated: true } });
      await this.store.save();
      await rm(previousStore, { force: true });
      await rm(previousAttachments, { recursive: true, force: true });
      return { restored: verified.manifest, safetyBackup: safety, pruned, sessionsInvalidated: true };
    } catch (error) {
      this.store.unfreeze();
      await rm(this.config.dataFile, { force: true }).catch(() => {});
      await rm(this.config.attachmentsDir, { recursive: true, force: true }).catch(() => {});
      if (storeMoved && await exists(previousStore)) await rename(previousStore, this.config.dataFile).catch(() => {});
      if (attachmentsMoved && await exists(previousAttachments)) await rename(previousAttachments, this.config.attachmentsDir).catch(() => {});
      await rm(temporaryStore, { force: true }).catch(() => {});
      await rm(temporaryAttachments, { recursive: true, force: true }).catch(() => {});
      await this.store.open().catch(() => {});
      throw error;
    }
  }

  async deleteBackup(id, { actorId = null } = {}) {
    const safeId = assertBackupId(id);
    const directory = path.join(this.config.backupDir, safeId);
    const manifest = await readManifest(directory);
    await rm(directory, { recursive: true, force: true });
    this.audit({ actorId, action: 'operations-backup-deleted', entityType: 'serverBackup', entityId: safeId, metadata: { reason: manifest.reason } });
    return manifest;
  }

  async status() {
    const [backups, attachmentStats] = await Promise.all([this.listBackups(), treeStats(this.config.attachmentsDir)]);
    const dataInfo = await stat(this.config.dataFile).catch(() => ({ size: 0 }));
    const memory = process.memoryUsage();
    const resourceCounts = Object.fromEntries(Object.entries(this.store.data.resources || {}).map(([name, records]) => [name, Object.keys(records || {}).length]));
    return {
      serverVersion: this.serverVersion,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      process: { pid: process.pid, node: process.version, rssBytes: memory.rss, heapUsedBytes: memory.heapUsed },
      storage: { dataBytes: dataInfo.size || 0, attachmentFiles: attachmentStats.files, attachmentBytes: attachmentStats.bytes },
      records: {
        activeUsers: this.store.data.users.filter((user) => user.status === 'active').length,
        activeSessions: this.store.data.sessions.length,
        changes: this.store.data.changes.length,
        auditEvents: this.store.data.audit.length,
        resources: resourceCounts,
        totalResources: Object.values(resourceCounts).reduce((sum, value) => sum + value, 0),
      },
      backups: {
        enabled: this.config.backupEnabled,
        intervalHours: this.config.backupIntervalHours,
        retentionCount: this.config.backupRetentionCount,
        count: backups.length,
        last: backups[0] || null,
      },
      maintenance: { lastRunAt: this.lastMaintenanceAt, lastResult: this.lastMaintenanceResult },
      warnings: this.config.backupEnabled ? [] : ['Automatické serverové snapshoty jsou vypnuté. Nastavte LESSON_HUB_BACKUP_ENABLED=true.'],
    };
  }

  async maybeAutomaticBackup() {
    if (!this.config.backupEnabled) return null;
    const backups = await this.listBackups();
    const last = backups[0]?.createdAt ? new Date(backups[0].createdAt).getTime() : 0;
    if (last && Date.now() - last < this.config.backupIntervalHours * 3_600_000) return null;
    return this.createBackup({ reason: 'automatic', actorId: 'server-scheduler' });
  }

  recordMaintenance(result) {
    this.lastMaintenanceAt = new Date().toISOString();
    this.lastMaintenanceResult = result;
  }
}

export function startOperationsScheduler({ operations, intervalMs, onError = console.error }) {
  const run = () => operations.maybeAutomaticBackup().catch((error) => onError('Automatická serverová záloha selhala:', error));
  const initial = setTimeout(run, Math.min(10_000, intervalMs));
  initial.unref?.();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return { stop() { clearTimeout(initial); clearInterval(timer); } };
}

import { APP_RELEASE } from '../core/release.js';
import { recordAnonymousOutput } from '../core/telemetry.js';
import { DATABASE_VERSION, SCHEMA_VERSION, STORE_DEFINITIONS, createId } from '../core/schema.js';
import { ENTITY_STORES } from '../core/constants.js';
import { loadSettings, saveSettings } from '../core/settings.js';
import { SERVER_API_CONTRACT } from '../server/dataGateway.js';

export const BACKUP_FORMAT = 'lesson-hub-backup-v1';
export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
const MAX_LOCAL_BACKUPS = 3;
export const RESTORE_SYNC_META_KEY = 'sync:restorePending';
const PREPARED_AUDIT_META_KEY = 'sync:lastPreparedAudit';

const EXCLUDED_EXPORT_STORES = new Set([ENTITY_STORES.backupSnapshots, ENTITY_STORES.auditEvents]);
const EXPORT_STORE_NAMES = STORE_DEFINITIONS
  .map(({ name }) => name)
  .filter((name) => !EXCLUDED_EXPORT_STORES.has(name));

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256Fallback(text) {
  const bytes = new TextEncoder().encode(text);
  const bitLength = bytes.length * 8;
  const totalLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(totalLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(totalLength - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(totalLength - 4, bitLength >>> 0, false);

  const constants = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const hash = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const words = new Uint32Array(64);
  const rotateRight = (value, bits) => (value >>> bits) | (value << (32 - bits));

  for (let offset = 0; offset < totalLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4, false);
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotateRight(words[index - 15], 7) ^ rotateRight(words[index - 15], 18) ^ (words[index - 15] >>> 3);
      const s1 = rotateRight(words[index - 2], 17) ^ rotateRight(words[index - 2], 19) ^ (words[index - 2] >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choice + constants[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0; hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0; hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0; hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0; hash[7] = (hash[7] + h) >>> 0;
  }
  return [...hash].map((value) => value.toString(16).padStart(8, '0')).join('');
}

async function sha256(value) {
  const text = canonicalStringify(value);
  const bytes = new TextEncoder().encode(text);
  if (globalThis.crypto?.subtle) {
    try {
      const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
      return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    } catch {
      // Nezabezpečený lokální kontext může Web Crypto blokovat. Použije se deterministický fallback.
    }
  }
  return sha256Fallback(text);
}

function bytesOf(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function parsePackage(input) {
  if (typeof input === 'string') {
    if (new TextEncoder().encode(input).byteLength > MAX_IMPORT_BYTES) throw new Error('Soubor je větší než povolených 50 MB.');
    try {
      return JSON.parse(input);
    } catch {
      throw new Error('Soubor není platný JSON export Lesson Hubu.');
    }
  }
  if (!input || typeof input !== 'object') throw new Error('Záloha nemá platný formát.');
  return structuredClone(input);
}

function packageWithoutChecksum(backupPackage) {
  const { checksum, ...unsigned } = backupPackage;
  return unsigned;
}

function currentStoreTemplate() {
  return Object.fromEntries(EXPORT_STORE_NAMES.map((storeName) => [storeName, []]));
}

function summaryFromData(data) {
  const counts = Object.fromEntries(EXPORT_STORE_NAMES.map((storeName) => [storeName, Array.isArray(data?.[storeName]) ? data[storeName].length : 0]));
  return {
    counts,
    totalRecords: Object.values(counts).reduce((sum, value) => sum + value, 0),
  };
}

function formatBackupLabel(date = new Date()) {
  return new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export class BackupService {
  constructor(database, repositories) {
    this.database = database;
    this.repositories = repositories;
  }

  async restoreSyncStatus() {
    return this.database.get(ENTITY_STORES.appMeta, RESTORE_SYNC_META_KEY);
  }

  async clearRestoreSyncStatus() {
    await this.database.delete(ENTITY_STORES.appMeta, RESTORE_SYNC_META_KEY);
  }

  async #queueRestoredState(checksum) {
    await this.database.clear(ENTITY_STORES.syncQueue);
    await this.database.clear(ENTITY_STORES.syncConflicts);
    await this.database.delete(ENTITY_STORES.appMeta, PREPARED_AUDIT_META_KEY);

    const checksumPrefix = String(checksum || 'unknown').slice(0, 16);
    let queued = 0;
    for (const resource of SERVER_API_CONTRACT.resources) {
      const repository = this.repositories[resource];
      if (!repository) continue;
      const records = await repository.list();
      for (const record of records) {
        if (!record?.id) continue;
        const id = `restore_${checksumPrefix}_${resource}_${record.id}`;
        await this.repositories.syncQueue.create({
          id,
          schema: SERVER_API_CONTRACT.syncEnvelope.schema,
          auditEventId: null,
          resource,
          entityType: resource,
          entityId: record.id,
          operation: 'upsert',
          payload: record,
          status: 'pending',
          attemptCount: 0,
          lastAttemptAt: null,
          syncedAt: null,
          restoreChecksum: checksum,
        });
        queued += 1;
      }
    }

    const meta = {
      key: RESTORE_SYNC_META_KEY,
      checksum,
      queued,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await this.database.put(ENTITY_STORES.appMeta, meta);
    return meta;
  }

  async exportPackage({ label = '', reason = 'manual' } = {}) {
    const data = currentStoreTemplate();
    for (const storeName of EXPORT_STORE_NAMES) data[storeName] = await this.database.getAll(storeName);

    const unsigned = {
      format: BACKUP_FORMAT,
      appId: APP_RELEASE.appId,
      appVersion: APP_RELEASE.version,
      schemaVersion: SCHEMA_VERSION,
      databaseVersion: DATABASE_VERSION,
      exportedAt: new Date().toISOString(),
      label: String(label || '').trim(),
      reason,
      settings: loadSettings(),
      summary: summaryFromData(data),
      data,
    };

    const backupPackage = { ...unsigned, checksum: await sha256(unsigned) };
    recordAnonymousOutput('backup-export');
    return backupPackage;
  }

  async validatePackage(input) {
    let backupPackage = parsePackage(input);
    if (backupPackage?.schema === 'ghrab-artifact-envelope-v1') {
      if (!globalThis.GHRABArtifact?.unwrapMaybe) throw new Error('Jednotný formát GHRAB nelze v tomto prostředí ověřit.');
      backupPackage = (await globalThis.GHRABArtifact.unwrapMaybe(backupPackage, { allowLegacy: false, expectedAppId: APP_RELEASE.appId, verifyChecksum: true })).payload;
    }
    const errors = [];
    const warnings = [];

    if (backupPackage.format !== BACKUP_FORMAT) errors.push(`Nepodporovaný formát zálohy: ${backupPackage.format || 'neuveden'}.`);
    if (backupPackage.appId !== APP_RELEASE.appId) errors.push('Záloha není určena pro Lesson Hub.');
    if (!backupPackage.data || typeof backupPackage.data !== 'object') errors.push('Záloha neobsahuje datovou část.');
    if (!backupPackage.checksum) errors.push('Záloha neobsahuje kontrolní součet.');
    if (Number(backupPackage.databaseVersion || 0) > DATABASE_VERSION) errors.push('Záloha pochází z novější databázové verze a nelze ji bezpečně načíst.');
    if (backupPackage.schemaVersion !== SCHEMA_VERSION) warnings.push(`Záloha používá schéma ${backupPackage.schemaVersion || 'neuvedeno'}, aplikace používá ${SCHEMA_VERSION}.`);

    const knownStores = new Set(EXPORT_STORE_NAMES);
    const unknownStores = Object.keys(backupPackage.data || {}).filter((storeName) => !knownStores.has(storeName));
    if (unknownStores.length) warnings.push(`Neznámá úložiště budou ignorována: ${unknownStores.join(', ')}.`);

    let checksumValid = false;
    if (backupPackage.checksum) {
      try {
        checksumValid = (await sha256(packageWithoutChecksum(backupPackage))) === backupPackage.checksum;
        if (!checksumValid) errors.push('Kontrolní součet nesouhlasí. Soubor může být poškozený nebo upravený.');
      } catch (error) {
        errors.push(error.message);
      }
    }

    const normalizedData = currentStoreTemplate();
    for (const storeName of EXPORT_STORE_NAMES) {
      const value = backupPackage.data?.[storeName];
      if (value !== undefined && !Array.isArray(value)) errors.push(`Úložiště ${storeName} nemá očekávaný seznam záznamů.`);
      normalizedData[storeName] = Array.isArray(value) ? value : [];
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      checksumValid,
      package: { ...backupPackage, data: normalizedData },
      summary: summaryFromData(normalizedData),
      sizeBytes: bytesOf(backupPackage),
    };
  }

  async importPackage(input, { mode = 'replace', createSafetyBackup = true } = {}) {
    if (!['replace', 'merge'].includes(mode)) throw new Error('Neplatný režim importu.');
    const validation = await this.validatePackage(input);
    if (!validation.valid) throw new Error(validation.errors.join(' '));

    let safetyBackup = null;
    if (createSafetyBackup) {
      safetyBackup = await this.createLocalBackup({
        label: `Bezpečnostní záloha před importem · ${formatBackupLabel()}`,
        reason: 'pre-import',
      });
    }

    const data = mode === 'replace'
      ? validation.package.data
      : Object.fromEntries(Object.entries(validation.package.data).filter(([, records]) => records.length));

    try {
      await this.database.importStores(data, { mode, replaceStoreNames: EXPORT_STORE_NAMES });
      await this.database.put(ENTITY_STORES.appMeta, {
        key: 'schema',
        schemaVersion: SCHEMA_VERSION,
        databaseVersion: DATABASE_VERSION,
        storageKind: this.database.kind,
        updatedAt: new Date().toISOString(),
      });
      const restoreSync = mode === 'replace' ? await this.#queueRestoredState(validation.package.checksum) : null;
      await this.database.put(ENTITY_STORES.appMeta, {
        key: 'lastImport',
        importedAt: new Date().toISOString(),
        sourceAppVersion: validation.package.appVersion,
        sourceSchemaVersion: validation.package.schemaVersion,
        mode,
        checksum: validation.package.checksum,
        restoreSyncQueued: restoreSync?.queued || 0,
      });
      const settingsResult = validation.package.settings ? saveSettings(validation.package.settings) : { ok: true };
      await this.repositories.auditEvents.create({
        entityType: 'database',
        entityId: 'lesson-hub-db',
        action: mode === 'replace' ? 'database-import-replace' : 'database-import-merge',
        timestamp: new Date().toISOString(),
        metadata: { totalRecords: validation.summary.totalRecords, checksum: validation.package.checksum },
      });
      return {
        ...validation,
        mode,
        safetyBackup,
        restoreSyncQueued: mode === 'replace' ? (await this.restoreSyncStatus())?.queued || 0 : 0,
        warnings: settingsResult.ok ? [] : ['Data byla importována, ale nastavení vzhledu se nepodařilo uložit.'],
      };
    } catch (error) {
      throw new Error(`Import se nepodařilo dokončit: ${error.message}`);
    }
  }

  async createLocalBackup({ label = '', reason = 'manual' } = {}) {
    const estimate = await this.storageEstimate();
    if (estimate.supported && estimate.percent >= 80) throw new Error('Lokální úložiště je zaplněno z více než 80 %. Nejprve stáhněte export a uvolněte místo.');
    const backupPackage = await this.exportPackage({ label, reason });
    const record = await this.repositories.backupSnapshots.create({
      label: String(label || '').trim() || `Ruční záloha · ${formatBackupLabel()}`,
      reason,
      checksum: backupPackage.checksum,
      appVersion: backupPackage.appVersion,
      schemaVersion: backupPackage.schemaVersion,
      totalRecords: backupPackage.summary.totalRecords,
      sizeBytes: bytesOf(backupPackage),
      package: backupPackage,
    });
    await this.#pruneLocalBackups();
    return record;
  }

  async listLocalBackups() {
    return (await this.repositories.backupSnapshots.list()).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async deleteLocalBackup(id) {
    await this.repositories.backupSnapshots.remove(id);
  }

  async restoreLocalBackup(id) {
    const snapshot = await this.repositories.backupSnapshots.get(id);
    if (!snapshot?.package) throw new Error('Bod obnovy nebyl nalezen nebo je poškozený.');
    return this.importPackage(snapshot.package, { mode: 'replace', createSafetyBackup: true });
  }

  async integrityReport() {
    const [years, subjects, identities, groups, lessons, tasks, reminders, materials, materialLinks, tags, entityTags,
      students, messages, deliveries, attachments, attachmentLinks, periods, plans, substitutionItems] = await Promise.all([
      this.repositories.schoolYears.list(), this.repositories.subjects.list(), this.repositories.groupIdentities.list(),
      this.repositories.groupInstances.list(), this.repositories.lessons.list(), this.repositories.tasks.list(),
      this.repositories.reminders.list(), this.repositories.materials.list(), this.repositories.materialLinks.list(),
      this.repositories.tags.list(), this.repositories.entityTags.list(), this.repositories.students.list(),
      this.repositories.messages.list(), this.repositories.messageDeliveries.list(), this.repositories.attachments.list(),
      this.repositories.attachmentLinks.list(), this.repositories.substitutionPeriods.list(), this.repositories.substitutionPlans.list(),
      this.repositories.substitutionItems.list(),
    ]);

    const sets = {
      years: new Set(years.map(({ id }) => id)),
      subjects: new Set(subjects.map(({ id }) => id)),
      identities: new Set(identities.map(({ id }) => id)),
      groups: new Set(groups.map(({ id }) => id)),
      lessons: new Set(lessons.map(({ id }) => id)),
      materials: new Set(materials.map(({ id }) => id)),
      tags: new Set(tags.map(({ id }) => id)),
      tasks: new Set(tasks.map(({ id }) => id)),
      reminders: new Set(reminders.map(({ id }) => id)),
      students: new Set(students.map(({ id }) => id)), messages: new Set(messages.map(({ id }) => id)),
      attachments: new Set(attachments.map(({ id }) => id)), periods: new Set(periods.map(({ id }) => id)),
      plans: new Set(plans.map(({ id }) => id)),
    };
    const issues = [];
    const issue = (type, id, detail) => issues.push({ type, id, detail });

    for (const group of groups) {
      if (!sets.years.has(group.schoolYearId)) issue('group-year', group.id, 'Skupina odkazuje na neexistující školní rok.');
      if (!sets.subjects.has(group.subjectId)) issue('group-subject', group.id, 'Skupina odkazuje na neexistující předmět.');
      if (!sets.identities.has(group.groupIdentityId)) issue('group-identity', group.id, 'Skupina nemá platnou trvalou identitu.');
      if (group.previousGroupInstanceId && !sets.groups.has(group.previousGroupInstanceId)) issue('group-history', group.id, 'Předchozí podoba skupiny nebyla nalezena.');
    }
    for (const lesson of lessons) {
      if (!sets.groups.has(lesson.groupInstanceId)) issue('lesson-group', lesson.id, 'Hodina odkazuje na neexistující skupinu.');
      if (!sets.years.has(lesson.schoolYearId)) issue('lesson-year', lesson.id, 'Hodina odkazuje na neexistující školní rok.');
    }
    for (const item of [...tasks, ...reminders]) {
      if (item.groupInstanceId && !sets.groups.has(item.groupInstanceId)) issue('work-group', item.id, 'Povinnost odkazuje na neexistující skupinu.');
      if (item.lessonId && !sets.lessons.has(item.lessonId)) issue('work-lesson', item.id, 'Povinnost odkazuje na neexistující hodinu.');
    }
    for (const link of materialLinks) {
      if (!sets.materials.has(link.materialId)) issue('material-link', link.id, 'Vazba odkazuje na neexistující materiál.');
      if (link.entityType === 'group' && !sets.groups.has(link.entityId)) issue('material-group', link.id, 'Materiál odkazuje na neexistující skupinu.');
      if (link.entityType === 'lesson' && !sets.lessons.has(link.entityId)) issue('material-lesson', link.id, 'Materiál odkazuje na neexistující hodinu.');
    }
    for (const link of entityTags) {
      if (!sets.tags.has(link.tagId)) issue('tag-link', link.id, 'Vazba odkazuje na neexistující štítek.');
      const targetSet = { lesson: sets.lessons, task: sets.tasks, reminder: sets.reminders, material: sets.materials }[link.entityType];
      if (targetSet && !targetSet.has(link.entityId)) issue('tag-target', link.id, 'Štítek odkazuje na neexistující záznam.');
    }
    for (const student of students) if (student.groupInstanceId && !sets.groups.has(student.groupInstanceId)) issue('student-group', student.id, 'Student odkazuje na neexistující skupinu.');
    for (const message of messages) {
      if (message.groupInstanceId && !sets.groups.has(message.groupInstanceId)) issue('message-group', message.id, 'Zpráva odkazuje na neexistující skupinu.');
      for (const recipient of message.recipients || []) if (recipient.studentId && !sets.students.has(recipient.studentId)) issue('message-student', message.id, 'Zpráva odkazuje na neexistujícího studenta.');
    }
    for (const delivery of deliveries) if (!sets.messages.has(delivery.messageId)) issue('delivery-message', delivery.id, 'Doručenka odkazuje na neexistující zprávu.');
    for (const link of attachmentLinks) {
      if (!sets.attachments.has(link.attachmentId)) issue('attachment-link', link.id, 'Vazba odkazuje na neexistující přílohu.');
    }
    for (const plan of plans) {
      if (!sets.periods.has(plan.periodId)) issue('substitution-plan-period', plan.id, 'Zastupovací plán odkazuje na neexistující období.');
      if (plan.groupInstanceId && !sets.groups.has(plan.groupInstanceId)) issue('substitution-plan-group', plan.id, 'Zastupovací plán odkazuje na neexistující skupinu.');
    }
    for (const item of substitutionItems) {
      if (!sets.periods.has(item.periodId)) issue('substitution-item-period', item.id, 'Položka zastupování odkazuje na neexistující období.');
      if (!sets.plans.has(item.planId)) issue('substitution-item-plan', item.id, 'Položka zastupování odkazuje na neexistující plán.');
    }

    return {
      valid: issues.length === 0,
      issues,
      checkedAt: new Date().toISOString(),
      summary: {
        schoolYears: years.length,
        subjects: subjects.length,
        groups: groups.length,
        lessons: lessons.length,
        tasks: tasks.length,
        reminders: reminders.length,
        materials: materials.length, students: students.length, messages: messages.length,
        attachments: attachments.length, substitutionPeriods: periods.length, substitutionPlans: plans.length,
      },
    };
  }

  async storageEstimate() {
    if (!globalThis.navigator?.storage?.estimate) return { supported: false, usage: 0, quota: 0, percent: 0 };
    const { usage = 0, quota = 0 } = await globalThis.navigator.storage.estimate();
    return { supported: true, usage, quota, percent: quota ? (usage / quota) * 100 : 0 };
  }

  async createDownload(backupPackage, filename = '') {
    if (typeof document === 'undefined') throw new Error('Stažení souboru je dostupné pouze v prohlížeči.');
    const date = new Date(backupPackage.exportedAt || Date.now()).toISOString().slice(0, 10);
    const safeName = filename || `lesson-hub-zaloha-${date}.ghrab.json`;
    if (globalThis.GHRABArtifact?.download) {
      await globalThis.GHRABArtifact.download({ appId: APP_RELEASE.appId, appVersion: APP_RELEASE.version, artifactType: 'lesson-hub-backup', sensitivity: 'restricted', contentManifest: [{ kind: 'database-backup', schema: BACKUP_FORMAT, records: backupPackage.summary?.totalRecords || 0 }], payload: backupPackage, filename: safeName });
      return safeName;
    }
    const blob = new Blob([JSON.stringify(backupPackage, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = safeName.replace(/\.ghrab(?=\.json$)/, '');
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return anchor.download;
  }

  async #pruneLocalBackups() {
    const snapshots = await this.listLocalBackups();
    for (const snapshot of snapshots.slice(MAX_LOCAL_BACKUPS)) await this.repositories.backupSnapshots.remove(snapshot.id);
  }
}

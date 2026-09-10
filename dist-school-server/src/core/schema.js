import { ENTITY_STORES } from './constants.js';

export const DATABASE_NAME = 'lesson-hub-db';
export const DATABASE_VERSION = 10;
export const SCHEMA_VERSION = '10.0.0';

export const STORE_DEFINITIONS = Object.freeze([
  { name: ENTITY_STORES.appMeta, keyPath: 'key' },
  { name: ENTITY_STORES.schoolYears, keyPath: 'id', indexes: [['isCurrent', 'isCurrent'], ['status', 'status'], ['label', 'label']] },
  { name: ENTITY_STORES.subjects, keyPath: 'id', indexes: [['name', 'name'], ['status', 'status']] },
  { name: ENTITY_STORES.groupIdentities, keyPath: 'id', indexes: [['status', 'status']] },
  {
    name: ENTITY_STORES.groupInstances,
    keyPath: 'id',
    indexes: [
      ['schoolYearId', 'schoolYearId'],
      ['groupIdentityId', 'groupIdentityId'],
      ['subjectId', 'subjectId'],
      ['status', 'status'],
      ['displayName', 'displayName'],
    ],
  },
  {
    name: ENTITY_STORES.lessons,
    keyPath: 'id',
    indexes: [
      ['groupInstanceId', 'groupInstanceId'],
      ['schoolYearId', 'schoolYearId'],
      ['date', 'date'],
      ['status', 'status'],
    ],
  },
  { name: ENTITY_STORES.quickNotes, keyPath: 'id', indexes: [['lessonId', 'lessonId'], ['groupInstanceId', 'groupInstanceId']] },
  { name: ENTITY_STORES.tasks, keyPath: 'id', indexes: [['status', 'status'], ['groupInstanceId', 'groupInstanceId'], ['lessonId', 'lessonId'], ['dueDate', 'dueDate'], ['priority', 'priority']] },
  { name: ENTITY_STORES.reminders, keyPath: 'id', indexes: [['status', 'status'], ['groupInstanceId', 'groupInstanceId'], ['lessonId', 'lessonId'], ['triggerDate', 'triggerDate'], ['priority', 'priority']] },
  { name: ENTITY_STORES.materials, keyPath: 'id', indexes: [['title', 'title'], ['materialType', 'materialType'], ['sourceType', 'sourceType'], ['status', 'status'], ['normalizedKey', 'normalizedKey']] },
  { name: ENTITY_STORES.materialLinks, keyPath: 'id', indexes: [['materialId', 'materialId'], ['entityId', 'entityId'], ['entityType', 'entityType'], ['purpose', 'purpose']] },
  { name: ENTITY_STORES.tags, keyPath: 'id', indexes: [['name', 'name'], ['category', 'category'], ['status', 'status']] },
  { name: ENTITY_STORES.entityTags, keyPath: 'id', indexes: [['tagId', 'tagId'], ['entityId', 'entityId'], ['entityType', 'entityType']] },
  { name: ENTITY_STORES.students, keyPath: 'id', indexes: [['groupIdentityId', 'groupIdentityId'], ['normalizedEmail', 'normalizedEmail'], ['status', 'status']] },
  { name: ENTITY_STORES.messageTemplates, keyPath: 'id', indexes: [['status', 'status'], ['title', 'title'], ['type', 'type']] },
  { name: ENTITY_STORES.messages, keyPath: 'id', indexes: [['status', 'status'], ['groupInstanceId', 'groupInstanceId'], ['scheduledAt', 'scheduledAt'], ['createdAt', 'createdAt']] },
  { name: ENTITY_STORES.messageDeliveries, keyPath: 'id', indexes: [['messageId', 'messageId'], ['status', 'status'], ['updatedAt', 'updatedAt']] },
  { name: ENTITY_STORES.attachments, keyPath: 'id', indexes: [['status', 'status'], ['serverId', 'serverId'], ['createdAt', 'createdAt']] },
  { name: ENTITY_STORES.attachmentLinks, keyPath: 'id', indexes: [['attachmentId', 'attachmentId'], ['entityId', 'entityId'], ['entityType', 'entityType']] },
  { name: ENTITY_STORES.lessonTemplates, keyPath: 'id', indexes: [['status', 'status'], ['subjectId', 'subjectId'], ['title', 'title'], ['favorite', 'favorite']] },
  { name: ENTITY_STORES.teachingCycles, keyPath: 'id', indexes: [['status', 'status'], ['name', 'name']] },
  { name: ENTITY_STORES.syncQueue, keyPath: 'id', indexes: [['status', 'status'], ['entityType', 'entityType'], ['resource', 'resource'], ['createdAt', 'createdAt']] },
  { name: ENTITY_STORES.syncConflicts, keyPath: 'id', indexes: [['status', 'status'], ['resource', 'resource'], ['entityId', 'entityId'], ['detectedAt', 'detectedAt']] },
  { name: ENTITY_STORES.auditEvents, keyPath: 'id', indexes: [['timestamp', 'timestamp']] },
  { name: ENTITY_STORES.backupSnapshots, keyPath: 'id', indexes: [['createdAt', 'createdAt'], ['reason', 'reason']] },
  { name: ENTITY_STORES.substitutionPeriods, keyPath: 'id', indexes: [['status', 'status'], ['startDate', 'startDate'], ['ownerId', 'ownerId']] },
  { name: ENTITY_STORES.substitutionPlans, keyPath: 'id', indexes: [['periodId', 'periodId'], ['groupInstanceId', 'groupInstanceId'], ['status', 'status']] },
  { name: ENTITY_STORES.substitutionItems, keyPath: 'id', indexes: [['periodId', 'periodId'], ['planId', 'planId'], ['status', 'status'], ['realizedAt', 'realizedAt']] },
]);

export function createId(prefix = 'entity') {
  if (globalThis.crypto?.randomUUID) return `${prefix}_${globalThis.crypto.randomUUID()}`;
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createTimestamps() {
  const now = new Date().toISOString();
  return { createdAt: now, updatedAt: now };
}

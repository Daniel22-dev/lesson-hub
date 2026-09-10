import { ENTITY_STORES } from '../core/constants.js';
import { BaseRepository } from './BaseRepository.js';

const PREFIXES = Object.freeze({
  [ENTITY_STORES.schoolYears]: 'year',
  [ENTITY_STORES.subjects]: 'subject',
  [ENTITY_STORES.groupIdentities]: 'groupIdentity',
  [ENTITY_STORES.groupInstances]: 'group',
  [ENTITY_STORES.lessons]: 'lesson',
  [ENTITY_STORES.quickNotes]: 'note',
  [ENTITY_STORES.tasks]: 'task',
  [ENTITY_STORES.reminders]: 'reminder',
  [ENTITY_STORES.materials]: 'material',
  [ENTITY_STORES.materialLinks]: 'materialLink',
  [ENTITY_STORES.tags]: 'tag',
  [ENTITY_STORES.entityTags]: 'entityTag',
  [ENTITY_STORES.students]: 'student',
  [ENTITY_STORES.messageTemplates]: 'messageTemplate',
  [ENTITY_STORES.messages]: 'message',
  [ENTITY_STORES.messageDeliveries]: 'delivery',
  [ENTITY_STORES.attachments]: 'attachment',
  [ENTITY_STORES.attachmentLinks]: 'attachmentLink',
  [ENTITY_STORES.lessonTemplates]: 'template',
  [ENTITY_STORES.teachingCycles]: 'cycle',
  [ENTITY_STORES.syncQueue]: 'sync',
  [ENTITY_STORES.syncConflicts]: 'syncConflict',
  [ENTITY_STORES.auditEvents]: 'audit',
  [ENTITY_STORES.backupSnapshots]: 'backup',
  [ENTITY_STORES.substitutionPeriods]: 'subPeriod',
  [ENTITY_STORES.substitutionPlans]: 'subPlan',
  [ENTITY_STORES.substitutionItems]: 'subItem',
});

export function createRepositories(database) {
  return Object.fromEntries(
    Object.values(ENTITY_STORES)
      .filter((storeName) => storeName !== ENTITY_STORES.appMeta)
      .map((storeName) => [storeName, new BaseRepository(database, storeName, PREFIXES[storeName] ?? 'entity')]),
  );
}

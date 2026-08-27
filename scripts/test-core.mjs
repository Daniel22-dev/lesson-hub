import assert from 'node:assert/strict';
import { createDatabase } from '../src/core/database.js';
import { createRepositories } from '../src/repositories/repositoryFactory.js';
import { AcademicService } from '../src/services/academicService.js';
import { LessonService } from '../src/services/lessonService.js';
import { WorkService } from '../src/services/workService.js';
import { MaterialService } from '../src/services/materialService.js';
import { SearchService } from '../src/services/searchService.js';
import { BackupService } from '../src/services/backupService.js';
import { TemplateCycleService } from '../src/services/templateCycleService.js';
import { SyncService } from '../src/services/syncService.js';
import { CommunicationService } from '../src/services/communicationService.js';
import { LocalRepositoryGateway, SERVER_API_CONTRACT } from '../src/server/dataGateway.js';
import { SCHEMA_VERSION } from '../src/core/schema.js';
import { ENTITY_STORES } from '../src/core/constants.js';

const database = await createDatabase();
const repositories = createRepositories(database);
const academics = new AcademicService(repositories);
const lessons = new LessonService(repositories);
const work = new WorkService(repositories);
const materials = new MaterialService(repositories);
const search = new SearchService(repositories, materials);
const templateCycles = new TemplateCycleService(repositories, lessons);
const sync = new SyncService(repositories);
const localGateway = new LocalRepositoryGateway(repositories);
const communication = new CommunicationService(repositories);
assert.equal(database.kind, 'memory', 'Node test má použít paměťovou databázi.');
assert.equal((await database.get(ENTITY_STORES.appMeta, 'schema')).schemaVersion, SCHEMA_VERSION);

const yearA = await academics.createSchoolYear({
  label: '2025/2026',
  startDate: '2025-09-01',
  endDate: '2026-08-31',
  isCurrent: true,
});
await assert.rejects(() => academics.createSchoolYear({ label: '2025/2026' }), /již existuje/);

const english = await academics.createSubject({ name: 'Anglický jazyk', shortName: 'AJ', colorToken: 'blue' });
await assert.rejects(() => academics.createSubject({ name: 'Anglický jazyk' }), /již existuje/);

const groupA = await academics.createGroup({
  schoolYearId: yearA.id,
  subjectId: english.id,
  displayName: '2.4 AJ',
  grade: '2. ročník',
  note: 'Pilotní skupina',
});
const detailA = await academics.getGroupDetail(groupA.id);
assert.equal(detailA.history.length, 1);
assert.equal(detailA.group.groupIdentityId, detailA.identity.id);
assert.equal(detailA.subject.name, 'Anglický jazyk');

await academics.setGroupStatus(groupA.id, 'hidden');
assert.equal((await repositories.groupInstances.get(groupA.id)).status, 'hidden');
await academics.setGroupStatus(groupA.id, 'active');
assert.equal((await repositories.groupInstances.get(groupA.id)).status, 'active');

const yearB = await academics.createSchoolYear({
  label: '2026/2027',
  startDate: '2026-09-01',
  endDate: '2027-08-31',
  isCurrent: true,
});
const years = await academics.listSchoolYears();
assert.equal(years.filter((year) => year.isCurrent).length, 1, 'Smí existovat jen jeden aktuální školní rok.');
assert.equal(years.find((year) => year.isCurrent).id, yearB.id);
await assert.rejects(() => academics.archiveSchoolYear(yearB.id), /Aktuální školní rok nelze archivovat/);
await assert.rejects(() => academics.archiveSubject(english.id), /používá aktivní nebo skrytá skupina/);

const promotion = await academics.promoteGroups({
  sourceYearId: yearA.id,
  targetYearId: yearB.id,
  rows: [{ id: groupA.id, action: 'promote', displayName: '3.4 AJ', grade: '3. ročník' }],
});
assert.deepEqual(promotion, { promoted: 1, archived: 0, skipped: 0 });
const targetGroups = await academics.listGroups({ schoolYearId: yearB.id, status: 'active' });
assert.equal(targetGroups.length, 1);
const groupB = targetGroups[0];
assert.equal(groupB.groupIdentityId, groupA.groupIdentityId, 'Postup musí zachovat trvalou identitu.');
assert.equal(groupB.previousGroupInstanceId, groupA.id);
assert.equal((await repositories.groupInstances.get(groupA.id)).status, 'archived');
assert.equal((await academics.getGroupDetail(groupB.id)).history.length, 2);

const planned = await lessons.createLesson({
  groupInstanceId: groupB.id,
  date: '2026-09-03',
  startTime: '08:00',
  title: 'Unit 1 · Introduction',
  topic: 'Introductions',
  objectives: 'Student se představí.',
  plannedOutline: 'Warm-up a krátký rozhovor.',
  status: 'planned',
});
assert.equal(planned.status, 'planned');
assert.equal(planned.sequenceNumber, 1);
await lessons.startLesson(planned.id);
assert.equal((await repositories.lessons.get(planned.id)).status, 'in_progress');
await lessons.updateLesson(planned.id, {
  actualProgress: 'Warm-up a rozhovor ve dvojicích.',
  endedAtText: 'Učebnice strana 8.',
  homework: 'Cvičení 4.',
}, { audit: false });
await lessons.completeLesson(planned.id, { patch: { nextLessonNote: 'Navázat poslechem.' } });
const completed = await repositories.lessons.get(planned.id);
assert.equal(completed.status, 'completed');
assert.equal(completed.endedAtText, 'Učebnice strana 8.');
assert.ok(completed.completedAt);

const future = await lessons.createLesson({
  groupInstanceId: groupB.id,
  date: '2026-09-10',
  title: 'Unit 1 · Listening',
  status: 'draft',
});
assert.equal(future.sequenceNumber, 2);
const continuity = await lessons.groupContinuity(groupB.id);
assert.equal(continuity.lastLesson.id, planned.id);
assert.equal(continuity.nextLesson.id, future.id);
assert.equal(continuity.completedCount, 1);
assert.equal(continuity.plannedCount, 1);
const dashboard = await lessons.dashboard({ schoolYearId: yearB.id, date: '2026-09-03' });
assert.equal(dashboard.today.length, 1);
assert.ok(dashboard.upcoming.some((lesson) => lesson.id === future.id));
const quickNote = await lessons.addQuickNote({ lessonId: planned.id, groupInstanceId: groupB.id, text: 'Zopakovat výslovnost.' });
assert.equal(quickNote.type, 'general');

await lessons.updateLesson(planned.id, {
  successRating: 'good',
  reflectionWorked: 'Studenti dobře reagovali na práci ve dvojicích.',
  reflectionImprove: 'Příště zkrátit úvodní instrukce.',
  reuseDecision: 'reuse',
  activityType: 'pair_work',
  skillType: 'speaking',
  level: 'B1',
});
const reflected = await repositories.lessons.get(planned.id);
assert.equal(reflected.successRating, 'good');
assert.equal(reflected.skillType, 'speaking');

const lessonTemplate = await templateCycles.createTemplateFromLesson(planned.id, {
  title: 'Povedená konverzační hodina',
  description: 'Opakovatelná struktura pro jazykovou skupinu.',
  favorite: true,
});
assert.equal(lessonTemplate.sourceLessonId, planned.id);
assert.equal((await templateCycles.getTemplate(lessonTemplate.id)).favorite, true);
const lessonFromTemplate = await templateCycles.createLessonFromTemplate(lessonTemplate.id, {
  groupInstanceId: groupB.id,
  date: '2026-09-17',
  startTime: '08:00',
});
assert.equal(lessonFromTemplate.sourceTemplateId, lessonTemplate.id);
assert.equal((await templateCycles.getTemplate(lessonTemplate.id)).useCount, 1);
const duplicatedLesson = await templateCycles.duplicateLesson(planned.id, {
  groupInstanceId: groupB.id,
  date: '2026-09-24',
  title: 'Kopie povedené hodiny',
});
assert.equal(duplicatedLesson.status, 'planned');
assert.equal(duplicatedLesson.actualProgress, '');
const bulkLessons = await templateCycles.bulkPlanFromTemplate(lessonTemplate.id, {
  groupIds: [groupB.id],
  date: '2026-10-01',
});
assert.equal(bulkLessons.length, 1);

const teachingCycle = await templateCycles.createCycle({
  name: 'Jazykové dovednosti',
  description: 'Týdenní střídání hlavních dovedností.',
  stepDurationWeeks: 1,
  favorite: true,
  steps: [
    { label: 'Mluvení', skillType: 'speaking', colorToken: 'teal' },
    { label: 'Poslech', skillType: 'listening', colorToken: 'blue' },
    { label: 'Čtení', skillType: 'reading', colorToken: 'violet' },
  ],
});
await templateCycles.assignCycleToGroups(teachingCycle.id, {
  groupIds: [groupB.id],
  anchorDate: '2026-09-01',
  stepDurationWeeks: 1,
});
const cycleState = await templateCycles.groupCycleState(groupB.id, '2026-09-08');
assert.equal(cycleState.step.label, 'Poslech');
assert.equal(cycleState.step.index, 1);
assert.equal((await templateCycles.summary()).assignedGroups, 1);

const gatewayTemplate = await localGateway.get('lessonTemplates', lessonTemplate.id);
assert.equal(gatewayTemplate.id, lessonTemplate.id);
assert.equal(SERVER_API_CONTRACT.version, 'lesson-hub-api-v1');
const preparedQueue = await sync.prepareFromAudit({ limit: 20 });
assert.ok(preparedQueue.length > 0, 'Auditní události musí jít převést do server-ready fronty.');
await sync.markSynced(preparedQueue[0].id);
assert.equal((await repositories.syncQueue.get(preparedQueue[0].id)).status, 'synced');
assert.equal((await sync.summary()).total, preparedQueue.length);
assert.equal(await sync.clearSynced(), 0);
assert.equal((await repositories.syncQueue.get(preparedQueue[0].id)).status, 'synced');
const nextPreparedQueue = await sync.prepareFromAudit({ limit: 20 });
assert.ok(!nextPreparedQueue.some((item) => item.auditEventId === preparedQueue[0].auditEventId), 'Vyčištění synchronizované fronty nesmí znovu vytvořit starou auditní změnu.');

const task = await work.createTask({
  title: 'Zkontrolovat domácí úkol',
  type: 'homework_check',
  priority: 'high',
  groupInstanceId: groupB.id,
  lessonId: planned.id,
  nextLessonTrigger: true,
});
assert.equal(task.status, 'open');
assert.equal((await work.listTasks({ groupInstanceId: groupB.id })).length, 1);
await work.carryTask(task.id);
assert.equal((await repositories.tasks.get(task.id)).carriedCount, 1);
await work.postponeTask(task.id, '2026-09-09');
assert.equal((await repositories.tasks.get(task.id)).status, 'postponed');
await work.completeTask(task.id);
assert.equal((await repositories.tasks.get(task.id)).status, 'completed');

const reminder = await work.createReminder({
  title: 'Vrátit pracovní listy',
  triggerType: 'date',
  triggerDate: '2026-09-04',
  priority: 'normal',
  groupInstanceId: groupB.id,
  lessonId: planned.id,
});
assert.equal(reminder.status, 'active');
await work.snoozeReminder(reminder.id, '2026-09-05');
assert.equal((await repositories.reminders.get(reminder.id)).status, 'snoozed');
await work.carryReminder(reminder.id);
assert.equal((await repositories.reminders.get(reminder.id)).triggerType, 'next_lesson');
await work.completeReminder(reminder.id);
assert.equal((await repositories.reminders.get(reminder.id)).status, 'completed');

const tagA = await work.createTag({ name: 'Použít znovu', category: 'quality', colorToken: 'teal' });
const tagB = await work.createTag({ name: 'Mluvení', category: 'skill', colorToken: 'blue' });
await work.setEntityTags('lesson', planned.id, [tagA.id, tagB.id]);
assert.equal((await work.tagsForEntity('lesson', planned.id)).length, 2);
const workDashboard = await work.dashboard({ schoolYearId: yearB.id, date: '2026-09-03' });
assert.equal(workDashboard.openTaskCount, 0);
assert.equal(workDashboard.activeReminderCount, 0);
await assert.rejects(() => lessons.removeLesson(planned.id), /navazující záznamy/);
await assert.rejects(() => academics.removeGroup(groupB.id), /nelze bezpečně smazat/);

const disposable = await academics.createGroup({
  schoolYearId: yearB.id,
  subjectId: english.id,
  displayName: 'Dočasná skupina',
  grade: '1. ročník',
});
await academics.removeGroup(disposable.id);
assert.equal(await repositories.groupInstances.get(disposable.id), undefined);

const snapshot = await academics.snapshot();
assert.equal(snapshot.currentYear.id, yearB.id);
assert.equal(snapshot.activeGroupCount, 1);
assert.ok((await repositories.auditEvents.list()).length >= 8, 'Významné akademické operace mají auditní stopu.');

const values = new Map();
const safeStorageFixture = {
  getItem: (key) => values.has(String(key)) ? values.get(String(key)) : null,
  setItem: (key, value) => values.set(String(key), String(value)),
  removeItem: (key) => values.delete(String(key)),
};
globalThis.localStorage = safeStorageFixture;
globalThis.location = { search: '?studioHandoff=1' };
const telemetryOutputs = [];
globalThis.GHRABTelemetry = { recordOutput: (payload) => { telemetryOutputs.push(payload); return true; } };
const backups = new BackupService(database, repositories);

const material = {
  schema: 'ghrab-material-v1',
  id: 'qa-material-1',
  title: 'QA materiál pro Lesson Hub',
  subject: 'Anglický jazyk',
  language: 'en',
  level: 'B1',
  content: { sourceText: 'Anonymous educational content.' },
};
safeStorageFixture.setItem('ghrab.handoff.v1', JSON.stringify({
  schema: 'ghrab-handoff-v1',
  target: 'lesson-hub',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  material,
}));

const { consumeStudioHandoff } = await import('../src/core/studioBridge.js');
const imported = await consumeStudioHandoff(repositories);
assert.equal(imported.stored.sourceMaterialId, material.id);
assert.equal(await repositories.materials.count(), 1);
assert.equal(safeStorageFixture.getItem('ghrab.handoff.v1'), null, 'Úspěšný handoff musí být odstraněn.');
assert.equal(telemetryOutputs.at(-1).outputKind, 'material-import');
assert.equal(safeStorageFixture.getItem('ghrab.pilot.events.v2'), null, 'Lesson Hub nesmí zapisovat vlastní obsahovou telemetrii mimo centrální API.');

safeStorageFixture.setItem('ghrab.handoff.v1', JSON.stringify({
  schema: 'ghrab-handoff-v1',
  target: 'generator',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  material,
}));
assert.equal(await consumeStudioHandoff(repositories), null, 'Cizí target nesmí být importován.');
assert.equal(await repositories.materials.count(), 1);

const createdMaterial = await materials.createMaterial({
  title: 'Poslech o cestování',
  materialType: 'audio',
  sourceType: 'url',
  url: 'https://example.com/travel-listening',
  description: 'Poslechová aktivita pro úroveň B1.',
  teacherNote: 'Použít znovu ve třetím ročníku.',
  studentFacing: true,
  visibility: 'students',
}, { groupIds: [groupB.id], lessonIds: [planned.id], tagIds: [tagA.id, tagB.id] });
assert.equal(createdMaterial.reused, false);
assert.equal(createdMaterial.material.links.length, 2);
assert.equal(createdMaterial.material.tags.length, 2);
const duplicateMaterial = await materials.createMaterial({
  title: 'Jiný název stejného odkazu',
  materialType: 'audio',
  sourceType: 'url',
  url: 'https://example.com/travel-listening',
});
assert.equal(duplicateMaterial.reused, true, 'Stejný odkaz se nesmí zbytečně duplikovat.');
assert.equal((await materials.listMaterials({ groupId: groupB.id })).length, 1);
const searchResult = await search.search({ query: 'cestovani', type: 'all', schoolYearId: yearB.id });
assert.ok(searchResult.results.some((item) => item.type === 'material' && item.id === createdMaterial.material.id));
const filteredLessons = await search.search({ query: 'studenti dobre', type: 'lesson', successRating: 'good', skillType: 'speaking' });
assert.ok(filteredLessons.results.some((item) => item.id === planned.id));

const integrity = await backups.integrityReport();
assert.equal(integrity.valid, true, 'Datové vazby musí být před exportem konzistentní.');
const exportedBackup = await backups.exportPackage({ label: 'Core test export', reason: 'test' });
const validatedBackup = await backups.validatePackage(exportedBackup);
assert.equal(validatedBackup.valid, true);
assert.equal(validatedBackup.checksumValid, true);
assert.ok(validatedBackup.summary.totalRecords > 0);
const corruptedBackup = structuredClone(exportedBackup);
corruptedBackup.checksum = '0'.repeat(64);
assert.equal((await backups.validatePackage(corruptedBackup)).valid, false, 'Poškozený kontrolní součet musí import zablokovat.');
const localSnapshot = await backups.createLocalBackup({ label: 'Core test bod obnovy', reason: 'test' });
const storedSnapshot = await repositories.backupSnapshots.get(localSnapshot.id);
assert.equal((await backups.validatePackage(storedSnapshot.package)).valid, true);
await backups.deleteLocalBackup(localSnapshot.id);
assert.equal(await repositories.backupSnapshots.get(localSnapshot.id), undefined);
const extraSubject = await academics.createSubject({ name: 'Dočasný předmět před obnovou', shortName: 'TMP', colorToken: 'slate' });
assert.ok(await repositories.subjects.get(extraSubject.id));
await backups.importPackage(exportedBackup, { mode: 'replace', createSafetyBackup: false });
assert.equal(await repositories.subjects.get(extraSubject.id), undefined, 'Úplná obnova musí odstranit záznamy, které v záloze nejsou.');
assert.ok(await repositories.groupInstances.get(groupB.id), 'Obnova musí zachovat skupinu obsaženou v exportu.');
assert.ok(await repositories.materials.get(createdMaterial.material.id), 'Obnova musí zachovat materiál obsažený v exportu.');
await materials.archiveMaterial(createdMaterial.material.id);
assert.equal((await materials.getMaterial(createdMaterial.material.id)).status, 'archived');
await materials.restoreMaterial(createdMaterial.material.id);
await materials.setMaterialLinks(createdMaterial.material.id, { groupIds: [], lessonIds: [] });
await materials.removeMaterial(createdMaterial.material.id);
assert.equal(await repositories.materials.count(), 1, 'Po odstranění testovacího materiálu musí zůstat pouze Studio Bridge import.');



const importedStudents = await communication.importStudents({
  groupInstanceId: groupB.id,
  rawEmails: ['tobias.baran', 'example.test'].join('@') + ',' + ['sofie.faldynova', 'example.test'].join('@') + ';' + ['tobias.baran', 'example.test'].join('@'),
});
assert.equal(importedStudents.created.length, 2);
assert.equal(importedStudents.updated.length, 0);
assert.equal((await communication.listStudents({ groupInstanceId: groupB.id })).length, 2);
const student = (await communication.listStudents({ groupInstanceId: groupB.id }))[0];
await communication.updateStudent(student.id, { displayName: 'Upravený student', email: student.email, notes: 'Pouze provozní poznámka.' });
assert.equal((await repositories.students.get(student.id)).displayName, 'Upravený student');

const messageTemplate = await communication.createTemplate({
  title: 'Připomínka testu', type: 'test', subject: 'Test {{date}}', body: 'Dobrý den {{studentName}}, připomínám test.', signature: 'Daniel Baláž',
});
assert.equal(messageTemplate.status, 'active');
const scheduledMessage = await communication.createMessage({
  groupInstanceId: groupB.id,
  studentIds: (await communication.listStudents({ groupInstanceId: groupB.id })).map((item) => item.id),
  templateId: messageTemplate.id,
  type: 'test', subject: 'Připomínka testu', body: 'Připomínám zítřejší test.', status: 'scheduled',
  scheduledAt: '2020-01-01T10:00:00.000Z', sensitive: false, requireApproval: false,
});
assert.equal(scheduledMessage.recipients.length, 2);
const preparedMessages = await communication.processDueLocal(new Date('2026-01-01T10:00:00.000Z'));
assert.equal(preparedMessages.length, 1);
assert.equal((await repositories.messages.get(scheduledMessage.id)).status, 'ready');
await communication.markSent(scheduledMessage.id);
assert.equal((await repositories.messages.get(scheduledMessage.id)).status, 'sent');

const sensitiveMessage = await communication.createMessage({
  groupInstanceId: groupB.id, studentIds: [student.id], type: 'missing_work', subject: 'Doplnění práce', body: 'Je potřeba doplnit práci.',
  status: 'scheduled', scheduledAt: '2020-01-01T10:00:00.000Z', sensitive: true,
});
assert.equal(sensitiveMessage.status, 'approval_required');
await communication.approveMessage(sensitiveMessage.id);
assert.equal((await repositories.messages.get(sensitiveMessage.id)).status, 'ready');

const rememberedAttachment = await communication.rememberServerAttachment({
  id: 'attachment_server_test', fileName: 'pracovni-list.pdf', mimeType: 'application/pdf', size: 1200, checksum: 'abc', purpose: 'student', visibility: 'private', createdAt: new Date().toISOString(),
}, [{ entityType: 'lesson', entityId: planned.id, purpose: 'student' }]);
assert.equal(rememberedAttachment.serverId, 'attachment_server_test');
assert.equal((await repositories.attachmentLinks.list()).length, 1);
assert.equal((await communication.snapshot()).activeStudents, 2);

await database.close();
console.log('Core test prošel: databáze, akademické jádro, hodiny, šablony, cykly, server-ready fronta, studenti, komunikace, přílohy, materiály, vyhledávání, export, import, integrita a Studio Bridge.');

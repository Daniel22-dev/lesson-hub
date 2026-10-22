import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/core/database.js';
import { createRepositories } from '../src/repositories/repositoryFactory.js';
import { AcademicService } from '../src/services/academicService.js';
import { LessonService } from '../src/services/lessonService.js';
import { BackupService } from '../src/services/backupService.js';
import { CanonicalGroupLinkService } from '../src/services/canonicalGroupLinkService.js';

// Node-only stub for the existing appearance settings persistence; no browser storage is touched.
const fakeSettings = new Map();
globalThis.localStorage = {
  getItem: key => fakeSettings.get(key) ?? null,
  setItem: (key, value) => { fakeSettings.set(key, value); },
  removeItem: key => { fakeSettings.delete(key); },
};

/* Real Lesson Hub services and MemoryDatabase (no mocked persistence, no PII). */
const meta = (patch={}) => ({schema:'ghrab-teaching-group-v1',groupId:'grp_0123456789ab',revision:1,
  displayName:'3A4 - AJ',schoolYear:'2026/27',subject:'AJ',grade:'3',status:'active',
  updatedAt:'2026-10-22T10:00:00.000Z',...patch});
const clone = value => structuredClone(value);
async function fixture() {
  const database = await createDatabase();
  assert.equal(database.kind,'memory');
  const repositories = createRepositories(database);
  const academic = new AcademicService(repositories);
  const lessonService = new LessonService(repositories);
  const linkService = new CanonicalGroupLinkService(repositories,academic);
  const backupService = new BackupService(database,repositories);
  const year = await academic.createSchoolYear({label:'2026/2027',startDate:'2026-09-01',endDate:'2027-08-31',isCurrent:true});
  const subject = await academic.createSubject({name:'Anglický jazyk',shortName:'AJ'});
  return {database,repositories,academic,lessonService,linkService,backupService,year,subject};
}

const makeLesson = (f,id,title='Past Perfect') => f.lessonService.createLesson({groupInstanceId:id,
  date:'2026-10-22',title,topic:'Past Perfect',status:'completed',
  actualProgress:'Druhy typ cviceni',endedAtText:'Strana 42',nextLessonNote:'Opakovat casovani'});

test('real database + AcademicService + LessonService: link, rename, archive, unlink never mutate lesson',async()=>{
  const f=await fixture();
  const group=await f.academic.createGroup({schoolYearId:f.year.id,subjectId:f.subject.id,displayName:'3A4 AJ'});
  const lesson=await makeLesson(f,group.id);
  const note=await f.lessonService.addQuickNote({lessonId:lesson.id,groupInstanceId:group.id,text:'Studentum zkontrolovat pracovni sesit'});
  const before=clone(await f.repositories.lessons.get(lesson.id));
  const beforeNote=clone(await f.repositories.quickNotes.get(note.id));
  const preview=await f.linkService.previewExisting(group.id,meta());
  const linked=await f.linkService.linkExisting(group.id,meta(),preview.expectedUpdatedAt,preview.expectedLocalSnapshot);
  assert.equal(linked.canonicalGroupId,meta().groupId);
  assert.equal(linked.groupIdentityId,group.groupIdentityId);
  assert.equal(linked.displayName,group.displayName);
  assert.deepEqual(await f.repositories.lessons.get(lesson.id),before);
  assert.deepEqual(await f.repositories.quickNotes.get(note.id),beforeNote);
  const revised=meta({revision:2,displayName:'Prejmenovana centralni',updatedAt:'2026-10-22T11:00:00.000Z'});
  const revPreview=await f.linkService.previewExisting(group.id,revised);
  const refreshed=await f.linkService.linkExisting(group.id,revised,revPreview.expectedUpdatedAt,revPreview.expectedLocalSnapshot);
  assert.equal(refreshed.displayName,'3A4 AJ');
  assert.equal(refreshed.canonicalRevision,2);
  const archived=meta({revision:3,status:'archived',updatedAt:'2026-10-22T12:00:00.000Z'});
  const archPreview=await f.linkService.previewExisting(group.id,archived);
  const archivedRef=await f.linkService.linkExisting(group.id,archived,archPreview.expectedUpdatedAt,archPreview.expectedLocalSnapshot);
  assert.equal(archivedRef.status,'active');
  assert.equal(archivedRef.canonicalSync.status,'archived');
  const unlinked=await f.linkService.unlink(group.id,archivedRef.updatedAt,JSON.stringify(archivedRef));
  assert.equal(unlinked.canonicalGroupId,null);
  assert.equal(unlinked.groupIdentityId,group.groupIdentityId);
  assert.deepEqual(await f.repositories.lessons.get(lesson.id),before);
  assert.deepEqual(await f.repositories.quickNotes.get(note.id),beforeNote);
  assert.equal((await f.lessonService.groupContinuity(group.id)).completedCount,1);
});

test('real rollover retains groupIdentity, previous instance link, and old lesson, but never canonical ID',async()=>{
  const f=await fixture();
  const group=await f.academic.createGroup({schoolYearId:f.year.id,subjectId:f.subject.id,
    displayName:'3A4 AJ',canonicalLink:meta()});
  const lesson=await makeLesson(f,group.id);
  const target=await f.academic.createSchoolYear({label:'2027/2028',startDate:'2027-09-01',endDate:'2028-08-31'});
  const result=await f.academic.promoteGroups({sourceYearId:f.year.id,targetYearId:target.id,
    rows:[{id:group.id,action:'promote',displayName:'4A4 AJ',grade:'4'}]});
  assert.equal(result.promoted,1);
  const groups=await f.repositories.groupInstances.list();
  const successor=groups.find(g=>g.previousGroupInstanceId===group.id);
  assert.ok(successor);
  assert.equal(successor.canonicalGroupId,null);
  assert.equal(successor.canonicalRevision,null);
  assert.equal(successor.groupIdentityId,group.groupIdentityId);
  assert.equal(successor.schoolYearId,target.id);
  assert.equal((await f.repositories.groupInstances.get(group.id)).status,'archived');
  assert.equal((await f.repositories.lessons.get(lesson.id)).groupInstanceId,group.id);
  assert.equal((await f.academic.getGroupDetail(successor.id)).history.length,2);
  assert.equal((await f.lessonService.groupContinuity(group.id)).completedCount,1);
});

test('real backup/restore retains links, local history, notes and local-only successor',async()=>{
  const f=await fixture();
  const group=await f.academic.createGroup({schoolYearId:f.year.id,subjectId:f.subject.id,
    displayName:'3A4 AJ',canonicalLink:meta()});
  const lesson=await makeLesson(f,group.id,'Hodina se zalohem');
  const note=await f.lessonService.addQuickNote({lessonId:lesson.id,groupInstanceId:group.id,text:'Bez skutecnych studentskych dat'});
  const target=await f.academic.createSchoolYear({label:'2027/2028',startDate:'2027-09-01',endDate:'2028-08-31'});
  await f.academic.promoteGroups({sourceYearId:f.year.id,targetYearId:target.id,
    rows:[{id:group.id,action:'promote',displayName:'4A4 AJ',grade:'4'}]});
  const backup=await f.backupService.exportPackage({label:'Stage04-Synthetic',reason:'manual'});
  assert.equal(backup.format,'lesson-hub-backup-v1');
  const restored=await fixture();
  const result=await restored.backupService.importPackage(backup,{mode:'replace',createSafetyBackup:false});
  assert.equal(result.valid,true);
  const originalGroups=await f.repositories.groupInstances.list();
  const restoredGroups=await restored.repositories.groupInstances.list();
  assert.deepEqual(restoredGroups,originalGroups);
  assert.deepEqual(await restored.repositories.lessons.get(lesson.id),await f.repositories.lessons.get(lesson.id));
  assert.deepEqual(await restored.repositories.quickNotes.get(note.id),await f.repositories.quickNotes.get(note.id));
  assert.equal((await restored.academic.getGroupDetail(group.id)).history.length,2);
  assert.equal((await restored.lessonService.groupContinuity(group.id)).completedCount,1);
});

test('real Repository write rejects duplicate canonical ID and a stale preview',async()=>{
  const f=await fixture();
  const one=await f.academic.createGroup({schoolYearId:f.year.id,subjectId:f.subject.id,displayName:'3A4 AJ'});
  const two=await f.academic.createGroup({schoolYearId:f.year.id,subjectId:f.subject.id,displayName:'4A4 AJ'});
  const first=await f.linkService.previewExisting(one.id,meta());
  const second=await f.linkService.previewExisting(two.id,meta());
  const results=await Promise.allSettled([
    f.linkService.linkExisting(one.id,meta(),first.expectedUpdatedAt,first.expectedLocalSnapshot),
    f.linkService.linkExisting(two.id,meta(),second.expectedUpdatedAt,second.expectedLocalSnapshot),
  ]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(results.filter(x=>x.status==='rejected').length,1);
  assert.match(String(results.find(x=>x.status==='rejected')?.reason),/CENTRAL_LINK_ALREADY_USED/);
  const groups=await f.repositories.groupInstances.list();
  assert.equal(groups.filter(x=>x.canonicalGroupId===meta().groupId).length,1);
  const linked=groups.find(x=>x.canonicalGroupId);
  const preview=await f.linkService.previewExisting(linked.id,meta());
  await f.repositories.groupInstances.update(linked.id,{note:'changed within same timestamp tick'});
  await assert.rejects(f.linkService.linkExisting(linked.id,meta(),preview.expectedUpdatedAt,preview.expectedLocalSnapshot),/CENTRAL_LOCAL_STALE_PREVIEW/);
});

test('real backup rejects duplicate canonical IDs even with a valid backup checksum',async()=>{
  const f=await fixture();
  const original=await f.academic.createGroup({schoolYearId:f.year.id,subjectId:f.subject.id,
    displayName:'3A4 AJ',canonicalLink:meta()});
  // Direct import is intentionally used to model the legacy/untrusted bulk-restore bypass.
  await f.database.importStores({groupInstances:[{...original,id:'malicious_duplicate',displayName:'Duplicita'}]});
  const poisoned=await f.backupService.exportPackage({reason:'manual'});
  const v=await f.backupService.validatePackage(poisoned);
  assert.equal(v.checksumValid,true);
  assert.equal(v.valid,false);
  assert.match(v.errors.join(' '),/CENTRAL_STORED_DUPLICATE_LINK/);
  const dest=await fixture();
  const sentinel=await dest.academic.createGroup({schoolYearId:dest.year.id,subjectId:dest.subject.id,
    displayName:'Puvodni mistni skupina'});
  await assert.rejects(dest.backupService.importPackage(poisoned,{mode:'replace',createSafetyBackup:false}),
    /CENTRAL_STORED_DUPLICATE_LINK/);
  assert.equal((await dest.repositories.groupInstances.get(sentinel.id)).displayName,'Puvodni mistni skupina');
  const integrity=await f.backupService.integrityReport();
  assert.equal(integrity.valid,false);
  assert.equal(integrity.issues.some(x=>x.type==='group-central-link'),true);
});

test('real backup accepts pre-integration groups with no canonical fields',async()=>{
  const f=await fixture();
  const group=await f.academic.createGroup({schoolYearId:f.year.id,subjectId:f.subject.id,
    displayName:'3A4 AJ'});
  await f.repositories.groupInstances.update(group.id,{canonicalGroupId:undefined,canonicalRevision:undefined,canonicalSync:undefined});
  const saved=await f.backupService.exportPackage({reason:'manual'});
  const valid=await f.backupService.validatePackage(saved);
  assert.equal(valid.valid,true);
  const dest=await fixture();
  await dest.backupService.importPackage(saved,{mode:'replace',createSafetyBackup:false});
  assert.equal((await dest.repositories.groupInstances.get(group.id)).displayName,'3A4 AJ');
});


test('merge import rejects collision between an individually valid backup and current database',async()=>{
  const source=await fixture();
  await source.academic.createGroup({schoolYearId:source.year.id,subjectId:source.subject.id,
    displayName:'Source',canonicalLink:meta()});
  const backup=await source.backupService.exportPackage({label:'Valid source',reason:'manual'});
  assert.equal((await source.backupService.validatePackage(backup)).valid,true);
  const target=await fixture();
  const original=await target.academic.createGroup({schoolYearId:target.year.id,subjectId:target.subject.id,
    displayName:'Target',canonicalLink:meta()});
  const before=await target.repositories.groupInstances.list();
  await assert.rejects(target.backupService.importPackage(backup,{mode:'merge',createSafetyBackup:false}),
    /CENTRAL_STORED_DUPLICATE_LINK/);
  assert.deepEqual(await target.repositories.groupInstances.list(),before);
  assert.equal((await target.repositories.groupInstances.get(original.id)).canonicalGroupId,meta().groupId);
});

test('real atomic repository rejects malformed and orphaned canonical bindings',async()=>{
  const f=await fixture();
  const group=await f.academic.createGroup({schoolYearId:f.year.id,subjectId:f.subject.id,
    displayName:'3A4 AJ'});
  await assert.rejects(f.repositories.groupInstances.update(group.id,{canonicalGroupId:meta().groupId,
    canonicalRevision:null,canonicalSync:null}),/CENTRAL_STORED_LINK_INVALID/);
  await assert.rejects(f.repositories.groupInstances.update(group.id,{canonicalGroupId:null,
    canonicalRevision:2,canonicalSync:null}),/CENTRAL_STORED_ORPHANED_LINK/);
  assert.equal((await f.repositories.groupInstances.get(group.id)).canonicalGroupId,null);
  const correct=await f.repositories.groupInstances.update(group.id,{
    canonicalGroupId:meta().groupId,canonicalRevision:1,
    canonicalSync:{schema:'lesson-hub-canonical-link-v1',consumerAppId:'lesson-hub',
      displayName:'3A4 - AJ',schoolYear:'2026/27',status:'active'}});
  assert.equal(correct.canonicalGroupId,meta().groupId);
});

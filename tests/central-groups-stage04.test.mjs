import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CANONICAL_GROUP_SCHEMA, validateCanonicalMetadata, validateCanonicalMetadataList,
  normalizeAcademicYear, assertMatchingYear, canonicalLinkFields, localOnlyFields,
  planCanonicalLink, planCanonicalCreate, assertUniqueCanonicalGroup, readCanonicalMetadataOnly,
} from '../src/services/canonicalGroupModel.js';
import { CanonicalGroupLinkService } from '../src/services/canonicalGroupLinkService.js';

const CENTRAL_ID = 'grp_0123456789ab';
const OTHER_ID = 'grp_cdef01234567';
const meta = (patch = {}) => ({schema: CANONICAL_GROUP_SCHEMA, groupId:CENTRAL_ID, revision:1,
  displayName:'3A4 – AJ', schoolYear:'2026/27', subject:'Angličtina', grade:'3', status:'active',
  updatedAt:'2026-10-22T08:00:00.000Z', ...patch});
const year = {id:'year_2026',label:'2026/2027',status:'active'};
const secondYear={id:'year_2027',label:'2027/28',status:'active'};
const subject = {id:'sub_AJ',name:'Anglický jazyk',status:'active'};
const local = (patch={}) => ({id:'group_local_A', groupIdentityId:'identity_permanent_A',
  schoolYearId:year.id, subjectId:subject.id,displayName:'3A4 – Angličtina',status:'active',
  canonicalGroupId:null,canonicalRevision:null,canonicalSync:null,
  createdAt:'2026-09-01T00:00:00.000Z',updatedAt:'2026-10-22T07:00:00.000Z', ...patch});
const clone = x => x === undefined ? undefined : structuredClone(x);
class Repository {
  constructor(entries=[]) { this.db=new Map(entries.map(x=>[x.id,clone(x)])); this.operations=[]; }
  async get(id){return clone(this.db.get(id));}
  async list(){return [...this.db.values()].map(clone);}
  async update(id,patch){const old=await this.get(id);if(!old)throw Error('missing');const updated={...old,...clone(patch),updatedAt:new Date().toISOString()};this.db.set(id,updated);this.operations.push({type:'update',id});return clone(updated);}
  async create(obj){const id=obj.id||`local_${this.db.size+1}`;const row={...clone(obj),id,updatedAt:new Date().toISOString()};this.db.set(id,row);this.operations.push({type:'create',id});return clone(row);}
}
function fixture({groups=[local()],lessons=[{id:'lesson_1',groupInstanceId:'group_local_A',title:'Past perfect',status:'completed'}]}={}){
  const groupInstances=new Repository(groups),schoolYears=new Repository([year,secondYear]),subjects=new Repository([subject]);
  const lessonStore=new Repository(lessons), groupIdentities=new Repository([{id:'identity_permanent_A',status:'active'}]);
  const audits=[];
  const repos={groupInstances,schoolYears,subjects,lessons:lessonStore,groupIdentities};
  const academic = {audit:async (...args)=>{audits.push(args);},createGroup:async(input)=>{
    // Minimal local academicService contract stub: real creation is guarded by stage04 patch.
    const group=await groupInstances.create({...input,id:'local_created',groupIdentityId:'identity_new',
      ...canonicalLinkFields(input.canonicalLink),previousGroupInstanceId:null});
    await groupIdentities.create({id:'identity_new',status:'active'});return group;
  }};
  return {repos,academic,audits,service:new CanonicalGroupLinkService(repos,academic)};
}

test('canonical contract uses only group metadata and stable UUID-like identifier',()=>{
  const m=validateCanonicalMetadata(meta());
  assert.equal(m.groupId,CENTRAL_ID); assert.equal(m.revision,1);assert.equal(m.subject,'Angličtina');
  assert.deepEqual(Object.keys(m).sort(),['schema','groupId','revision','displayName','schoolYear','subject','grade','status','updatedAt'].sort());
});
test('member roster, emails, unknown fields and HTML-like names fail-closed',()=>{
  assert.throws(()=>validateCanonicalMetadata(meta({members:[{memberId:'mem_0123456789ab',name:'Student'}]})),/CENTRAL_META_FIELDS_INVALID/);
  assert.throws(()=>validateCanonicalMetadata(meta({schoolEmail:'student@example.school'})),/CENTRAL_META_FIELDS_INVALID/);
  assert.throws(()=>validateCanonicalMetadata(meta({displayName:'<script>alert(1)</script>'})),/CENTRAL_META_INVALID/);
});
test('list caps at 200 and duplicate canonical IDs rejected',()=>{
  assert.throws(()=>validateCanonicalMetadataList([meta(),meta()]),/CENTRAL_GROUP_DUPLICATE/);
  assert.throws(()=>validateCanonicalMetadataList(new Array(201).fill(meta())),/CENTRAL_METADATA_LIST_INVALID/);
});
test('two common school year formats normalize to same academic year',()=>{
  assert.equal(normalizeAcademicYear('2026/27'),'2026/2027');
  assert.equal(normalizeAcademicYear('2026/2027'),'2026/2027');
  assert.equal(normalizeAcademicYear('2026/29'),null);
  assert.equal(assertMatchingYear(year,meta()),'2026/2027');
});
test('a mismatched school year is not automatically linked',()=>{
  assert.throws(()=>assertMatchingYear(secondYear,meta()),/CENTRAL_YEAR_MISMATCH/);
  assert.throws(()=>planCanonicalLink({group:local({schoolYearId:secondYear.id}),year:secondYear,metadata:meta(),allGroups:[]}),/CENTRAL_YEAR_MISMATCH/);
});
test('create from central group is explicit and stores only canonical metadata',async()=>{
  const f=fixture({groups:[],lessons:[]});
  const input={schoolYearId:year.id,subjectId:subject.id,displayName:'Výuka 3A4',grade:'3'};
  const plan=await f.service.previewCreate(input,meta());
  assert.equal(plan.mode,'create');
  const created=await f.service.createFromCentral(input,meta());
  assert.equal(created.canonicalGroupId,CENTRAL_ID);
  assert.equal(created.canonicalRevision,1);
  assert.equal(created.displayName,'Výuka 3A4');
  assert.equal(created.canonicalSync?.displayName,'3A4 – AJ');
  assert.equal(created.groupIdentityId,'identity_new');
  assert.equal(Object.hasOwn(created,'members'),false);
});
test('existing local group linked without changing its original identity, lessons, name or subjects',async()=>{
  const f=fixture();const original=await f.repos.groupInstances.get('group_local_A');
  const lessons=await f.repos.lessons.list();
  const plan=await f.service.previewExisting('group_local_A',meta());
  assert.equal(plan.mode,'link');
  const linked=await f.service.linkExisting('group_local_A',meta(),plan.expectedUpdatedAt,plan.expectedLocalSnapshot);
  assert.equal(linked.canonicalGroupId,CENTRAL_ID);
  assert.equal(linked.groupIdentityId,original.groupIdentityId);
  assert.equal(linked.displayName,original.displayName);
  assert.equal(linked.schoolYearId,original.schoolYearId);
  assert.deepEqual(await f.repos.lessons.list(),lessons);
  assert.deepEqual(f.audits.map(a=>a[0]),['group-central-linked']);
});
test('central rename increments revision without renaming local group, lesson history persists',async()=>{
  const f=fixture();let plan=await f.service.previewExisting('group_local_A',meta());
  await f.service.linkExisting('group_local_A',meta(),plan.expectedUpdatedAt,plan.expectedLocalSnapshot);
  const renamed=meta({revision:2,displayName:'3A4 – maturitní AJ',updatedAt:'2026-10-22T09:00:00Z'});
  plan=await f.service.previewExisting('group_local_A',renamed);
  assert.equal(plan.mode,'refresh');
  const r=await f.service.linkExisting('group_local_A',renamed,plan.expectedUpdatedAt,plan.expectedLocalSnapshot);
  assert.equal(r.canonicalGroupId,CENTRAL_ID);assert.equal(r.displayName,'3A4 – Angličtina');
  assert.equal(r.canonicalSync.displayName,'3A4 – maturitní AJ');
  assert.equal((await f.repos.lessons.list()).length,1);
});
test('archived central group updates metadata, never archives local group/history',async()=>{
  const f=fixture();let p=await f.service.previewExisting('group_local_A',meta());await f.service.linkExisting('group_local_A',meta(),p.expectedUpdatedAt,p.expectedLocalSnapshot);
  const archived=meta({revision:2,status:'archived',updatedAt:'2026-10-22T09:00:00Z'});
  p=await f.service.previewExisting('group_local_A',archived);
  assert.equal(p.warnings.some(w=>w.includes('archivovaná')),true);
  const r=await f.service.linkExisting('group_local_A',archived,p.expectedUpdatedAt,p.expectedLocalSnapshot);
  assert.equal(r.status,'active');assert.equal(r.canonicalSync.status,'archived');
  assert.equal((await f.repos.lessons.list()).length,1);
  assert.throws(()=>planCanonicalLink({group:local(),year,metadata:archived,allGroups:[]}),/CENTRAL_ARCHIVED_CANNOT_LINK/);
});
test('switching canonical group needs explicit unlink; collisions across years reject',()=>{
  const linked=local({...canonicalLinkFields(meta())});
  assert.throws(()=>planCanonicalLink({group:linked,year,metadata:meta({groupId:OTHER_ID}),allGroups:[]}),/CENTRAL_LINK_SWITCH_REQUIRES_UNLINK/);
  assert.throws(()=>assertUniqueCanonicalGroup([linked],CENTRAL_ID,'other_local'),/CENTRAL_LINK_ALREADY_USED/);
  assert.throws(()=>planCanonicalCreate({year,subject,metadata:meta(),allGroups:[linked],displayName:'Nová'}),/CENTRAL_LINK_ALREADY_USED/);
});
test('rollback and same-revision metadata conflicts reject',()=>{
  const linked=local({...canonicalLinkFields(meta({revision:3}))});
  assert.throws(()=>planCanonicalLink({group:linked,year,metadata:meta({revision:2}),allGroups:[linked]}),/CENTRAL_REVISION_ROLLBACK/);
  assert.throws(()=>planCanonicalLink({group:linked,year,metadata:meta({revision:3,displayName:'Změna bez revize'}),allGroups:[linked]}),/CENTRAL_SAME_REVISION_CONFLICT/);
});
test('stale local preview cannot modify linked group',async()=>{
  const f=fixture();const p=await f.service.previewExisting('group_local_A',meta());
  await f.repos.groupInstances.update('group_local_A',{note:'nová interní poznámka'});
  await assert.rejects(f.service.linkExisting('group_local_A',meta(),p.expectedUpdatedAt),/CENTRAL_LOCAL_STALE_PREVIEW/);
  assert.equal((await f.repos.groupInstances.get('group_local_A')).canonicalGroupId,null);
});
test('unlink clears only metadata, never historical identity or lesson records',async()=>{
  const f=fixture();let p=await f.service.previewExisting('group_local_A',meta());
  const linked=await f.service.linkExisting('group_local_A',meta(),p.expectedUpdatedAt,p.expectedLocalSnapshot);
  const beforeLessons=await f.repos.lessons.list();
  const unlinked=await f.service.unlink('group_local_A',linked.updatedAt,JSON.stringify(linked));
  assert.equal(unlinked.canonicalGroupId,null);assert.equal(unlinked.canonicalRevision,null);
  assert.equal(unlinked.canonicalSync,null);assert.equal(unlinked.groupIdentityId,'identity_permanent_A');
  assert.deepEqual(await f.repos.lessons.list(),beforeLessons);
});
test('new school year successor is local-only, continuity identity belongs to previous instance',()=>{
  const source=local({...canonicalLinkFields(meta())});
  const successor={...source,id:'group_local_successor',schoolYearId:secondYear.id,
    groupIdentityId:source.groupIdentityId,previousGroupInstanceId:source.id,...localOnlyFields()};
  assert.equal(successor.canonicalGroupId,null);
  assert.equal(source.canonicalGroupId,CENTRAL_ID);
  assert.equal(successor.groupIdentityId,source.groupIdentityId);
  assert.equal(successor.previousGroupInstanceId,source.id);
});
test('offline central client never affects locally persisted group or lessons',async()=>{
  const f=fixture();const before=await f.repos.groupInstances.list();const lessons=await f.repos.lessons.list();
  await assert.rejects(Promise.reject(new Error('CENTRAL_SERVICE_UNAVAILABLE')),/CENTRAL_SERVICE_UNAVAILABLE/);
  assert.deepEqual(await f.repos.groupInstances.list(),before);
  assert.deepEqual(await f.repos.lessons.list(),lessons);
});
test('privacy and integrity boundary: no direct student roster or raw storage in new modules',()=>{
  const client=readFileSync(new URL('../src/integration/centralGroupsClient.js',import.meta.url),'utf8');
  const model=readFileSync(new URL('../src/services/canonicalGroupModel.js',import.meta.url),'utf8');
  const ui=readFileSync(new URL('../src/ui/centralGroupDialogs.js',import.meta.url),'utf8');
  assert.match(model,/listGroupMetadata\(CONSUMER_ID/);
  assert.doesNotMatch(client,/\.getRosterProjection\s*\(/);
  assert.doesNotMatch(client,/\.getGroup\s*\(/);
  assert.doesNotMatch(client,/\.listGroups\s*\(/);
  assert.doesNotMatch(client,/localStorage\.|sessionStorage\./);
  assert.doesNotMatch(model,/memberId|schoolEmail|lessonText|results/);
  assert.doesNotMatch(ui,/getRosterProjection\s*\(/);
});

test('metadata consumer contract never calls student roster methods',()=>{
  let rosterCalls=0, rawCalls=0, metadataCalls=0;
  const fake={schema:'ghrab-groups-service-v1',contractVersion:1,
    listGroupMetadata(consumer, options) {
      metadataCalls++;
      assert.equal(consumer,'lesson-hub');assert.deepEqual(options,{status:'all'});
      return [meta()];
    },
    getRosterProjection(){rosterCalls++;throw Error('must not call student roster');},
    getGroup(){rawCalls++;throw Error('must not call raw group');},
    listGroups(){rawCalls++;throw Error('must not call raw groups');}
  };
  const list=readCanonicalMetadataOnly(fake);
  assert.equal(list.length,1);assert.equal(metadataCalls,1);
  assert.equal(rosterCalls,0);assert.equal(rawCalls,0);
});
test('incompatible Studio group-service contract is rejected before reading',()=>{
  assert.throws(()=>readCanonicalMetadataOnly({schema:'ghrab-groups-service-v1',contractVersion:2,listGroupMetadata(){return[]}}),
    /CENTRAL_SERVICE_CONTRACT_UNSUPPORTED/);
});

test('year rollover 2099/00 is represented as 2099/2100, not 2099/2000',()=>{
  assert.equal(normalizeAcademicYear('2099/00'),'2099/2100');
  assert.equal(normalizeAcademicYear('1999/00'),'1999/2000');
  assert.equal(normalizeAcademicYear('2099/2100'),'2099/2100');
  assert.equal(normalizeAcademicYear('2099/99'),null);
});
test('creating from AI Studio fails closed when local academic year is archived',()=>{
  const archivedYear={...year,status:'archived'};
  assert.throws(()=>planCanonicalCreate({year:archivedYear,subject,metadata:meta(),allGroups:[],displayName:'3A4 AJ'}),/CENTRAL_LOCAL_SELECTION_INVALID/);
});
test('creating from AI Studio fails closed for archived or malformed local subject',()=>{
  assert.throws(()=>planCanonicalCreate({year,subject:{...subject,status:'archived'},metadata:meta(),allGroups:[],displayName:'3A4 AJ'}),/CENTRAL_LOCAL_SELECTION_INVALID/);
  assert.throws(()=>planCanonicalCreate({year,subject:{id:subject.id,name:subject.name},metadata:meta(),allGroups:[],displayName:'3A4 AJ'}),/CENTRAL_LOCAL_SELECTION_INVALID/);
});
test('old Lesson Hub group records with no canonical fields can be linked without other data loss',async()=>{
  const legacy=local();delete legacy.canonicalGroupId;delete legacy.canonicalRevision;delete legacy.canonicalSync;
  const f=fixture({groups:[legacy]});
  const snapshot=await f.repos.groupInstances.get(legacy.id);
  const plan=await f.service.previewExisting(legacy.id,meta());
  const updated=await f.service.linkExisting(legacy.id,meta(),plan.expectedUpdatedAt,plan.expectedLocalSnapshot);
  assert.equal(updated.canonicalGroupId,CENTRAL_ID);
  assert.equal(updated.groupIdentityId,snapshot.groupIdentityId);
  assert.equal(updated.displayName,snapshot.displayName);
  assert.equal(updated.schoolYearId,snapshot.schoolYearId);
  assert.equal((await f.repos.lessons.list()).length,1);
});
test('same metadata revision is idempotent, creates no extra audit or record mutation',async()=>{
  const f=fixture();const before=await f.service.previewExisting('group_local_A',meta());
  const linked=await f.service.linkExisting('group_local_A',meta(),before.expectedUpdatedAt,before.expectedLocalSnapshot);
  const plan=await f.service.previewExisting('group_local_A',meta());
  assert.equal(plan.changed,false);
  const replayed=await f.service.linkExisting('group_local_A',meta(),plan.expectedUpdatedAt,plan.expectedLocalSnapshot);
  assert.deepEqual(replayed,linked);
  assert.equal(f.audits.length,1);
});
test('explicit unlink refuses an outdated local snapshot',async()=>{
  const f=fixture();const p=await f.service.previewExisting('group_local_A',meta());
  const linked=await f.service.linkExisting('group_local_A',meta(),p.expectedUpdatedAt,p.expectedLocalSnapshot);
  await f.repos.groupInstances.update(linked.id,{note:'new note between preview and unlink'});
  await assert.rejects(f.service.unlink(linked.id,linked.updatedAt),/CENTRAL_LOCAL_STALE_PREVIEW/);
  assert.equal((await f.repos.groupInstances.get(linked.id)).canonicalGroupId,CENTRAL_ID);
});
test('metadata-only service rejects extra group fields that could leak students',()=>{
  const leak=meta({members:[{name:'Anna',schoolEmail:'test@example.school'}]});
  let rosterCalls=0;
  const service={schema:'ghrab-groups-service-v1',contractVersion:1,
    listGroupMetadata(){return[leak]},getRosterProjection(){rosterCalls++}};
  assert.throws(()=>readCanonicalMetadataOnly(service),/CENTRAL_META_FIELDS_INVALID/);
  assert.equal(rosterCalls,0);
});
test('malicious-looking source metadata is rejected before storage or UI display',()=>{
  for(const update of [{subject:'<script>alert(1)</script>'},{grade:'3\n4'},
                       {status:'disabled'},{updatedAt:'garbage'},{revision:0}]) {
    assert.throws(()=>validateCanonicalMetadata(meta(update)),/CENTRAL_META_INVALID/);
  }
});
test('normal unlink fields are intentionally null, never delete historical group properties',()=>{
  const old=local({ ...canonicalLinkFields(meta()),someLessonMetadata:{foo:'bar'} });
  const next={...old,...localOnlyFields()};
  assert.equal(next.canonicalGroupId,null);
  assert.equal(next.canonicalRevision,null);
  assert.equal(next.canonicalSync,null);
  assert.deepEqual(next.someLessonMetadata,{foo:'bar'});
  assert.equal(next.groupIdentityId,old.groupIdentityId);
});
test('UI requires human acceptance, fresh remote metadata and local stale check',()=>{
  const ui=readFileSync(new URL('../src/ui/centralGroupDialogs.js',import.meta.url),'utf8');
  assert.match(ui,/form\.elements\.accept\.checked/);
  assert.match(ui,/listCentralGroupMetadata\(\)/);
  assert.match(ui,/JSON\.stringify\(actual\)\s*!==\s*JSON\.stringify\(preview\.metadata\)/);
  assert.match(ui,/preview\.plan\.expectedUpdatedAt/);
  assert.match(ui,/confirmAction\(/);
  assert.doesNotMatch(ui,/getRosterProjection\s*\(/);
});

// Execute the real centralGroupsClient.js (with only the dynamic module loader
// stubbed) so the same-origin, access and metadata-only paths are exercised.
function centralClientHarness({access='granted',studioUrl='/AI-Studio-GHRAB/',loader}={}) {
  const original=readFileSync(new URL('../src/integration/centralGroupsClient.js',import.meta.url),'utf8');
  const dynamic='const module = await import(script.href);';
  assert.equal(original.split(dynamic).length-1,1);
  const runnable=original.replace(/^import .*;\s*$/gm,'').replace(dynamic,'const module = await __loader(script.href);')
    .replace(/^export /gm,'');
  const factory=new Function('APP_CONFIG','readCanonicalMetadataOnly','document','location','__loader',
    runnable+'\nreturn {listCentralGroupMetadata,resetCentralGroupClientForTests};');
  const host={href:'https://example.github.io/lesson-hub/index.html',origin:'https://example.github.io'};
  return factory({aiStudioUrl:studioUrl},readCanonicalMetadataOnly,{documentElement:{dataset:{ghrabAccess:access}}},host,
    loader||(()=>{throw Error('Loader should not be reached')}));
}
test('runtime central client rejects user without granted Studio access before importing',async()=>{
  let loads=0;
  const h=centralClientHarness({access:'checking',loader:async()=>{loads++;return{}}});
  await assert.rejects(h.listCentralGroupMetadata(),/CENTRAL_ACCESS_DENIED/);
  assert.equal(loads,0);
});
test('runtime central client rejects foreign Studio origins before any dynamic import',async()=>{
  let loads=0;
  const h=centralClientHarness({studioUrl:'https://untrusted.example/AI-Studio-GHRAB/',loader:async()=>{loads++;return{}}});
  await assert.rejects(h.listCentralGroupMetadata(),/CENTRAL_ORIGIN_DENIED/);
  assert.equal(loads,0);
});
test('runtime central client uses only approved same-origin Studio metadata contract',async()=>{
  let rosterCalls=0,metadataCalls=0,imports=0;
  const h=centralClientHarness({loader:async(url)=>{
    imports++;
    assert.equal(url,'https://example.github.io/AI-Studio-GHRAB/groups/group-service.js');
    return {createGroupsService(){return {schema:'ghrab-groups-service-v1',contractVersion:1,
      listGroupMetadata(consumer,opts){metadataCalls++;assert.equal(consumer,'lesson-hub');assert.deepEqual(opts,{status:'all'});return[meta()]},
      getRosterProjection(){rosterCalls++;throw Error('Forbidden')}
    }}};
  }});
  const list=await h.listCentralGroupMetadata();
  assert.equal(list.length,1);
  assert.equal(list[0].groupId,CENTRAL_ID);
  assert.equal(imports,1);assert.equal(metadataCalls,1);assert.equal(rosterCalls,0);
  await h.listCentralGroupMetadata();assert.equal(imports,1);assert.equal(rosterCalls,0);
});
test('runtime central client never stores metadata when source contract is invalid',async()=>{
  const h=centralClientHarness({loader:async()=>({createGroupsService(){return {
    schema:'ghrab-groups-service-v2',contractVersion:2,listGroupMetadata(){return[meta()]}}}})});
  await assert.rejects(h.listCentralGroupMetadata(),/CENTRAL_SERVICE_CONTRACT_UNSUPPORTED/);
});

test('central chooser returns to standard local editor without losing the local-only option',()=>{
  const ui=readFileSync(new URL('../src/ui/centralGroupDialogs.js',import.meta.url),'utf8');
  assert.match(ui,/returnToLocal/);
  assert.match(ui,/data-canonical-close/);
  assert.match(ui,/Nechat pouze lokální skupinu/);
  assert.match(ui,/if \(typeof returnToLocal === 'function'\) returnToLocal\(\)/);
});
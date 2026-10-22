import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupInstanceAtomic, updateGroupInstanceAtomic } from '../src/services/canonicalGroupTransaction.js';

function memoryDb(entries = []) {
  return {kind:'memory',stores:new Map([['groupInstances',new Map(entries.map(e=>[e.id,structuredClone(e)]))]])};
}
const linked = (id)=>({canonicalGroupId:id,canonicalRevision:1,canonicalSync:{
  schema:'lesson-hub-canonical-link-v1',consumerAppId:'lesson-hub',
  displayName:'3A4 AJ',schoolYear:'2026/27',status:'active'}});
const unlinked = () => ({canonicalGroupId:null,canonicalRevision:null,canonicalSync:null});
const g = (id,canonical=null)=>({id,displayName:id,...(canonical?linked(canonical):unlinked()),
  groupIdentityId:'identity',schoolYearId:'year',note:'',updatedAt:'fixed'});
const id='grp_0000000000ab';

test('memory CAS: concurrent preview with same updatedAt cannot both commit',async()=>{
  const db=memoryDb([g('a')]);const snap=JSON.stringify(db.stores.get('groupInstances').get('a'));
  const jobs=await Promise.allSettled([
    updateGroupInstanceAtomic(db,'a',linked(id),{expectedSnapshot:snap}),
    updateGroupInstanceAtomic(db,'a',linked(id),{expectedSnapshot:snap})
  ]);
  assert.equal(jobs.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(jobs.filter(x=>x.status==='rejected').length,1);
  assert.equal(jobs.find(x=>x.status==='rejected').reason.code,'CENTRAL_LOCAL_STALE_PREVIEW');
});
test('memory creates enforce canonical-ID uniqueness across group instances and years',async()=>{
  const db=memoryDb([g('old',id)]);
  await assert.rejects(createGroupInstanceAtomic(db,g('new',id)),/CENTRAL_LINK_ALREADY_USED/);
  assert.equal(db.stores.get('groupInstances').size,1);
});
test('memory updates enforce canonical-ID uniqueness even without a preview',async()=>{
  const db=memoryDb([g('old',id),g('new')]);
  await assert.rejects(updateGroupInstanceAtomic(db,'new',linked(id)),/CENTRAL_LINK_ALREADY_USED/);
  assert.equal(db.stores.get('groupInstances').get('new').canonicalGroupId,null);
});
test('regular group edits preserve concurrent canonical metadata',async()=>{
  const db=memoryDb([g('one')]);
  await updateGroupInstanceAtomic(db,'one',linked(id));
  await updateGroupInstanceAtomic(db,'one',{displayName:'Renamed lesson group'});
  assert.equal(db.stores.get('groupInstances').get('one').canonicalGroupId,id);
});
test('unlink is an optimistic CAS and cannot destroy a later update',async()=>{
  const db=memoryDb([g('one',id)]);
  const stale=JSON.stringify(db.stores.get('groupInstances').get('one'));
  await updateGroupInstanceAtomic(db,'one',{note:'already changed'});
  await assert.rejects(updateGroupInstanceAtomic(db,'one',unlinked(),{expectedSnapshot:stale}),/CENTRAL_LOCAL_STALE_PREVIEW/);
  assert.equal(db.stores.get('groupInstances').get('one').canonicalGroupId,id);
});
test('create with duplicate local ID fails without overwrite',async()=>{
  const db=memoryDb([g('one')]);
  await assert.rejects(createGroupInstanceAtomic(db,g('one',id)),/CENTRAL_LOCAL_ID_COLLISION/);
  assert.equal(db.stores.get('groupInstances').get('one').canonicalGroupId,null);
});
test('foreign/unrecognized group storage fails closed',async()=>{
  await assert.rejects(createGroupInstanceAtomic({kind:'unknown'},g('one',id)),/CENTRAL_STORAGE_UNAVAILABLE/);
});
test('group status and pedagogical fields are not altered by metadata link',async()=>{
  const db=memoryDb([{...g('one'),lessonIds:['lesson1'],status:'archived'}]);
  await updateGroupInstanceAtomic(db,'one',linked(id));
  const record=db.stores.get('groupInstances').get('one');
  assert.deepEqual(record.lessonIds,['lesson1']);assert.equal(record.status,'archived');
});

test('invalid partial central IDs are refused, requiring revision and sync metadata',async()=>{
  const db=memoryDb([g('one')]);
  await assert.rejects(updateGroupInstanceAtomic(db,'one',{canonicalGroupId:id}),/CENTRAL_STORED_LINK_INVALID/);
  assert.equal(db.stores.get('groupInstances').get('one').canonicalGroupId,null);
});
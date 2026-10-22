/* Simulated IndexedDB readwrite transaction scheduler, not a real browser UAT.
 * It exercises the actual async transaction branch under two-tab contention.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createGroupInstanceAtomic, updateGroupInstanceAtomic} from '../src/services/canonicalGroupTransaction.js';
const clone = (x) => structuredClone(x);
const linked = (id)=>({canonicalGroupId:id,canonicalRevision:1,canonicalSync:{
  schema:'lesson-hub-canonical-link-v1',consumerAppId:'lesson-hub',
  displayName:'3A4 AJ',schoolYear:'2026/27',status:'active'}});
const unlinked = () => ({canonicalGroupId:null,canonicalRevision:null,canonicalSync:null});
const make = (id,canonicalGroupId=null)=>({id,...(canonicalGroupId?linked(canonicalGroupId):unlinked()),
  groupIdentityId:'history',displayName:id,updatedAt:'before'});
function sharedIndexedDb(rows) {
  const entries = new Map(rows.map(x=>[x.id,clone(x)]));
  let last = Promise.resolve();
  function makeConnection() {
    return {kind:'indexeddb',db:{transaction(storeName,mode){
      assert.equal(storeName,'groupInstances');assert.equal(mode,'readwrite');
      let aborted=false, staged=[], request, closeJob;
      const done=new Promise(resolve=>{closeJob=resolve});
      const tx={oncomplete:null,onabort:null,onerror:null,error:null,
        objectStore(name){assert.equal(name,'groupInstances');return {
          getAll(){
            request={onsuccess:null,onerror:null,result:null};
            const run=last.then(()=>{
              queueMicrotask(()=>{
                if(aborted)return;
                request.result=[...entries.values()].map(clone);
                request.onsuccess?.();
                queueMicrotask(()=>{
                  if(!aborted){for(const [kind,data] of staged){
                    if(kind==='add'&&entries.has(data.id)){tx.error=Error('ConstraintError');aborted=true;break;}
                    entries.set(data.id,clone(data));
                  }}
                  if(aborted)tx.onabort?.();else tx.oncomplete?.();
                  closeJob();
                });
              });
            });
            last=run.then(()=>done);
            return request;
          },
          add(record){staged.push(['add',clone(record)])},
          put(record){staged.push(['put',clone(record)])},
        };
        },
        abort(){aborted=true;tx.error=Error('AbortError')},
      };
      return tx;
    }}};
  }
  return {open:makeConnection,all:()=>[...entries.values()].map(clone)};
}
const canonical='grp_0000000000ab';
test('simulated IndexedDB: two tabs cannot create duplicate canonical IDs',async()=>{
 const idb=sharedIndexedDb([]); const a=idb.open(),b=idb.open();
 const results=await Promise.allSettled([
   createGroupInstanceAtomic(a,make('left',canonical)),
   createGroupInstanceAtomic(b,make('right',canonical)),
 ]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(results.filter(x=>x.status==='rejected').length,1);
 assert.equal(results.find(x=>x.status==='rejected').reason.code,'CENTRAL_LINK_ALREADY_USED');
 assert.equal(idb.all().length,1);
});
test('simulated IndexedDB: two tabs cannot approve the same stale snapshot',async()=>{
 const idb=sharedIndexedDb([make('one')]); const a=idb.open(),b=idb.open();
 const snapshot=JSON.stringify(idb.all()[0]);
 const results=await Promise.allSettled([
   updateGroupInstanceAtomic(a,'one',linked(canonical),{expectedSnapshot:snapshot}),
   updateGroupInstanceAtomic(b,'one',linked(canonical),{expectedSnapshot:snapshot}),
 ]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(results.find(x=>x.status==='rejected').reason.code,'CENTRAL_LOCAL_STALE_PREVIEW');
 assert.equal(idb.all()[0].canonicalGroupId,canonical);
});
test('simulated IndexedDB: regular local edit cannot erase prior link',async()=>{
 const idb=sharedIndexedDb([make('one')]);const a=idb.open(),b=idb.open();
 const results=await Promise.allSettled([
   updateGroupInstanceAtomic(a,'one',linked(canonical)),
   updateGroupInstanceAtomic(b,'one',{displayName:'Local rename'})
 ]);
 assert.equal(results.filter(x=>x.status==='rejected').length,0);
 assert.equal(idb.all()[0].canonicalGroupId,canonical);
 assert.equal(idb.all()[0].displayName,'Local rename');
});
test('simulated IndexedDB: stale CAS fails after concurrent note edit',async()=>{
 const idb=sharedIndexedDb([make('one')]);const a=idb.open(),b=idb.open();
 const old=JSON.stringify(idb.all()[0]);
 await updateGroupInstanceAtomic(b,'one',{note:'modified in second tab'});
 await assert.rejects(updateGroupInstanceAtomic(a,'one',linked(canonical),{expectedSnapshot:old}),/CENTRAL_LOCAL_STALE_PREVIEW/);
 assert.equal(idb.all()[0].canonicalGroupId,null);
});
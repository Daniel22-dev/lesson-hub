/* Stage 04: atomic group instance mutations without a destructive DB schema migration.
 * All groupInstance create/update writes are serialized in the IndexedDB readwrite
 * transaction, including canonicalGroupId uniqueness and optimistic preview CAS.
 * Memory fallback uses the same guards synchronously.
 */
import { assertPersistenceAllowed } from '../core/persistenceGuard.js';
import { ENTITY_STORES } from '../core/constants.js';
import { assertCanonicalLinksConsistent } from './canonicalGroupModel.js';

const GROUP_STORE = ENTITY_STORES.groupInstances;
const clone = (value) => value === undefined ? undefined : structuredClone(value);
function failure(code) { const error = new Error(code); error.code = code; return error; }
function checkDuplicate(records, id, canonicalGroupId) {
  if (canonicalGroupId == null || canonicalGroupId === '') return;
  if (typeof canonicalGroupId !== 'string' || !/^grp_[a-z0-9-]{12,}$/i.test(canonicalGroupId)) {
    throw failure('CENTRAL_LINK_ID_INVALID');
  }
  if (records.some((g) => g.id !== id && g.canonicalGroupId === canonicalGroupId)) {
    throw failure('CENTRAL_LINK_ALREADY_USED');
  }
}
function nextRecord(records, id, patch, { expectedSnapshot = null, preserveUpdatedAt = false } = {}) {
  const current = records.find((item) => item.id === id);
  if (!current) throw failure('CENTRAL_LOCAL_GROUP_NOT_FOUND');
  if (expectedSnapshot != null && JSON.stringify(current) !== expectedSnapshot) {
    throw failure('CENTRAL_LOCAL_STALE_PREVIEW');
  }
  const next = {
    ...current, ...clone(patch), id,
    updatedAt: preserveUpdatedAt && patch?.updatedAt ? patch.updatedAt : new Date().toISOString(),
  };
  assertCanonicalLinksConsistent([next]);
  checkDuplicate(records, id, next.canonicalGroupId);
  return next;
}
function newRecord(records, value) {
  if (!value || typeof value.id !== 'string' || !value.id.trim()) throw failure('CENTRAL_LOCAL_GROUP_INVALID');
  if (records.some((item) => item.id === value.id)) throw failure('CENTRAL_LOCAL_ID_COLLISION');
  assertCanonicalLinksConsistent([value]);
  checkDuplicate(records, value.id, value.canonicalGroupId);
  return clone(value);
}

function writeMemory(database, mode, payload) {
  const store = database.stores?.get(GROUP_STORE);
  if (!(store instanceof Map)) throw failure('CENTRAL_STORAGE_UNAVAILABLE');
  const records = [...store.values()];
  const value = mode === 'create'
    ? newRecord(records, payload.value)
    : nextRecord(records, payload.id, payload.patch, payload.options);
  store.set(value.id, clone(value));
  return clone(value);
}

function writeIndexedDb(database, mode, payload) {
  if (!database.db || typeof database.db.transaction !== 'function') {
    throw failure('CENTRAL_STORAGE_UNAVAILABLE');
  }
  return new Promise((resolve, reject) => {
    let tx, store;
    try {
      tx = database.db.transaction(GROUP_STORE, 'readwrite');
      store = tx.objectStore(GROUP_STORE);
    } catch (error) { reject(error); return; }
    let result, cause;
    tx.oncomplete = () => resolve(clone(result));
    tx.onabort = () => reject(cause || tx.error || failure('CENTRAL_TRANSACTION_ABORTED'));
    tx.onerror = () => { /* onabort is the terminal error handler */ };
    // The read and write are held inside the SAME exclusive transaction.
    // A second tab cannot interleave a conflicting canonical-ID operation.
    const request = store.getAll();
    request.onsuccess = () => {
      try {
        const records = request.result;
        result = mode === 'create'
          ? newRecord(records, payload.value)
          : nextRecord(records, payload.id, payload.patch, payload.options);
        if (mode === 'create') store.add(result);
        else store.put(result);
      } catch (error) {
        cause = error;
        try { tx.abort(); } catch { reject(cause); }
      }
    };
    request.onerror = () => { cause = request.error || failure('CENTRAL_READ_FAILED'); };
  });
}

function atomicGroupWrite(database, mode, payload) {
  assertPersistenceAllowed('atomický zápis skupiny');
  if (database?.kind === 'memory') return writeMemory(database, mode, payload);
  if (database?.kind === 'indexeddb') return writeIndexedDb(database, mode, payload);
  throw failure('CENTRAL_STORAGE_UNAVAILABLE');
}

export async function createGroupInstanceAtomic(database, value) {
  return atomicGroupWrite(database, 'create', { value });
}

export async function updateGroupInstanceAtomic(database, id, patch, options = {}) {
  return atomicGroupWrite(database, 'update', { id, patch, options });
}
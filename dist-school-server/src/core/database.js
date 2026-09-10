import { DATABASE_NAME, DATABASE_VERSION, SCHEMA_VERSION, STORE_DEFINITIONS } from './schema.js';
import { ENTITY_STORES } from './constants.js';
import { migrations } from './migrations.js';
import { assertPersistenceAllowed } from './persistenceGuard.js';

export class DatabaseBlockedError extends Error {
  constructor(message = 'Aktualizace databáze je blokována jinou kartou.') {
    super(message);
    this.name = 'DatabaseBlockedError';
    this.code = 'database_blocked';
  }
}

const validStoreNames = new Set(STORE_DEFINITIONS.map(({ name }) => name));

class MemoryDatabase {
  constructor({ fallbackReason = '' } = {}) {
    this.kind = 'memory';
    this.fallbackReason = fallbackReason;
    this.stores = new Map(STORE_DEFINITIONS.map(({ name }) => [name, new Map()]));
  }

  async open() {
    await this.put(ENTITY_STORES.appMeta, {
      key: 'schema', schemaVersion: SCHEMA_VERSION, databaseVersion: DATABASE_VERSION,
      storageKind: this.kind, fallbackReason: this.fallbackReason, updatedAt: new Date().toISOString(),
    });
    return this;
  }

  async get(storeName, key) { return structuredClone(this.#store(storeName).get(key)); }
  async getAll(storeName) { return [...this.#store(storeName).values()].map((item) => structuredClone(item)); }
  async put(storeName, value) {
    assertPersistenceAllowed(`zápis do ${storeName}`);
    const definition = STORE_DEFINITIONS.find((store) => store.name === storeName);
    const key = value[definition?.keyPath ?? 'id'];
    if (key === undefined) throw new Error(`Záznam pro ${storeName} nemá klíč.`);
    this.#store(storeName).set(key, structuredClone(value));
    return key;
  }
  async delete(storeName, key) { assertPersistenceAllowed(`mazání z ${storeName}`); this.#store(storeName).delete(key); }
  async clear(storeName) { assertPersistenceAllowed(`čištění ${storeName}`); this.#store(storeName).clear(); }
  async count(storeName) { return this.#store(storeName).size; }

  async importStores(dataByStore, { mode = 'merge', replaceStoreNames = [] } = {}) {
    assertPersistenceAllowed('import dat');
    const snapshots = new Map([...this.stores.entries()].map(([name, store]) => [name, new Map([...store.entries()].map(([key, value]) => [key, structuredClone(value)]))]));
    const entries = Object.entries(dataByStore).filter(([storeName]) => validStoreNames.has(storeName));
    try {
      if (mode === 'replace') {
        const names = replaceStoreNames.length ? replaceStoreNames.filter((name) => validStoreNames.has(name)) : entries.map(([name]) => name);
        for (const name of names) this.#store(name).clear();
      }
      for (const [storeName, records] of entries) {
        const store = this.#store(storeName);
        for (const record of records ?? []) {
          const definition = STORE_DEFINITIONS.find((item) => item.name === storeName);
          const key = record?.[definition?.keyPath ?? 'id'];
          if (key === undefined) throw new Error(`Importovaný záznam pro ${storeName} nemá klíč.`);
          store.set(key, structuredClone(record));
        }
      }
    } catch (error) {
      this.stores = snapshots;
      throw error;
    }
  }

  async purgeForSuiteEnd() {
    for (const store of this.stores.values()) store.clear();
  }

  async close() {}
  #store(storeName) {
    const store = this.stores.get(storeName);
    if (!store) throw new Error(`Neznámé úložiště: ${storeName}`);
    return store;
  }
}

class IndexedDbDatabase {
  constructor() { this.kind = 'indexeddb'; this.db = null; }

  async open() {
    this.db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      let settled = false;
      request.onupgradeneeded = (event) => {
        const database = request.result;
        const transaction = request.transaction;
        for (const definition of STORE_DEFINITIONS) {
          let store;
          if (!database.objectStoreNames.contains(definition.name)) store = database.createObjectStore(definition.name, { keyPath: definition.keyPath });
          else store = transaction.objectStore(definition.name);
          for (const [indexName, keyPath, options = { unique: false }] of definition.indexes ?? []) {
            if (!store.indexNames.contains(indexName)) store.createIndex(indexName, keyPath, options);
          }
        }
        for (const migration of migrations) if (migration.version > event.oldVersion && migration.version <= event.newVersion) migration.apply({ database, transaction });
      };
      request.onsuccess = () => { if (!settled) { settled = true; resolve(request.result); } else request.result.close(); };
      request.onerror = () => { if (!settled) { settled = true; reject(request.error ?? new Error('IndexedDB se nepodařilo otevřít.')); } };
      request.onblocked = () => { if (!settled) { settled = true; reject(new DatabaseBlockedError()); } };
    });
    this.db.onversionchange = () => {
      this.db?.close();
      this.db = null;
      globalThis.dispatchEvent?.(new CustomEvent('lesson-hub-database-versionchange'));
    };
    await this.put(ENTITY_STORES.appMeta, {
      key: 'schema', schemaVersion: SCHEMA_VERSION, databaseVersion: DATABASE_VERSION,
      storageKind: this.kind, updatedAt: new Date().toISOString(),
    });
    return this;
  }

  async get(storeName, key) { return this.#request(storeName, 'readonly', (store) => store.get(key)); }
  async getAll(storeName) { return this.#request(storeName, 'readonly', (store) => store.getAll()); }
  async put(storeName, value) { assertPersistenceAllowed(`zápis do ${storeName}`); return this.#request(storeName, 'readwrite', (store) => store.put(value)); }
  async delete(storeName, key) { assertPersistenceAllowed(`mazání z ${storeName}`); return this.#request(storeName, 'readwrite', (store) => store.delete(key)); }
  async clear(storeName) { assertPersistenceAllowed(`čištění ${storeName}`); return this.#request(storeName, 'readwrite', (store) => store.clear()); }
  async count(storeName) { return this.#request(storeName, 'readonly', (store) => store.count()); }

  async importStores(dataByStore, { mode = 'merge', replaceStoreNames = [] } = {}) {
    assertPersistenceAllowed('import dat');
    if (!this.db) throw new Error('Databáze není otevřená.');
    const entries = Object.entries(dataByStore).filter(([storeName]) => validStoreNames.has(storeName));
    const names = mode === 'replace'
      ? [...new Set((replaceStoreNames.length ? replaceStoreNames : entries.map(([name]) => name)).filter((name) => validStoreNames.has(name)))]
      : [...new Set(entries.map(([name]) => name))];
    if (!names.length) return;
    const recordsByStore = new Map(entries);
    await new Promise((resolve, reject) => {
      const transaction = this.db.transaction(names, 'readwrite');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Hromadný import dat selhal.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Hromadný import dat byl zrušen.'));
      for (const storeName of names) {
        const store = transaction.objectStore(storeName);
        const putRecords = () => { for (const record of recordsByStore.get(storeName) ?? []) store.put(structuredClone(record)); };
        if (mode === 'replace') {
          const clearRequest = store.clear();
          clearRequest.onsuccess = putRecords;
          clearRequest.onerror = () => transaction.abort();
        } else putRecords();
      }
    });
  }

  async purgeForSuiteEnd() { this.db?.close(); this.db = null; }
  async close() { this.db?.close(); this.db = null; }
  #request(storeName, mode, createRequest) {
    if (!this.db) throw new Error('Databáze není otevřená.');
    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db.transaction(storeName, mode);
        const request = createRequest(transaction.objectStore(storeName));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error(`Operace nad ${storeName} selhala.`));
        transaction.onabort = () => reject(transaction.error ?? new Error(`Transakce ${storeName} byla zrušena.`));
      } catch (error) { reject(error); }
    });
  }
}

export async function createDatabase() {
  if (typeof indexedDB === 'undefined') return new MemoryDatabase({ fallbackReason: 'indexeddb_unsupported' }).open();
  const database = new IndexedDbDatabase();
  try { return await database.open(); }
  catch (error) {
    if (error?.code === 'database_blocked') throw error;
    console.warn('IndexedDB není dostupná, používám dočasnou paměťovou databázi.', error);
    return new MemoryDatabase({ fallbackReason: error?.message || 'indexeddb_open_failed' }).open();
  }
}

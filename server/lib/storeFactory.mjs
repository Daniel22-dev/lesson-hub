import { JsonStore } from './store.mjs';

export const STORE_ADAPTER_CONTRACT = 'lesson-hub-store-adapter-v1';

export function assertStoreAdapter(store) {
  const missing = ['open', 'save', 'resource', 'nextCursor', 'pruneSessions', 'freeze', 'unfreeze']
    .filter((name) => typeof store?.[name] !== 'function');
  if (!store || typeof store !== 'object' || !store.data || missing.length) {
    throw new Error(`Úložiště neplní ${STORE_ADAPTER_CONTRACT}: ${missing.join(', ') || 'chybí data'}`);
  }
  return store;
}

export function createStore(config = {}) {
  const driver = String(config.storageDriver || 'json').trim().toLowerCase();
  if (driver === 'json') return assertStoreAdapter(new JsonStore(config.dataFile));
  const error = new Error(`Nepodporovaný LESSON_HUB_STORAGE_DRIVER=${driver}. P3 připravuje kontrakt; produkční databázový adaptér musí být dodán a migrován podle docs/DATABASE-MIGRATION.md.`);
  error.code = 'unsupported_storage_driver';
  throw error;
}

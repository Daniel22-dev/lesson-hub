import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { JsonStore } from './store.mjs';
import { normalizeOpenedStore } from './storeNormalization.mjs';

export const PERSISTENCE_CONTRACT = 'lesson-hub-persistence-v1';

export class JsonPersistenceAdapter {
  constructor(filePath) {
    this.contract = PERSISTENCE_CONTRACT;
    this.kind = 'json-atomic';
    this.store = new JsonStore(filePath);
  }
  async open() {
    await this.store.open();
    const normalization = normalizeOpenedStore(this.store);
    if (normalization.changed > 0) await this.store.save();
    return this;
  }
  snapshot() { return this.store.snapshot(); }
  stats() { return this.store.stats(); }
  transact(mutator, options) { return this.store.transact(mutator, options); }
  save() { return this.store.save(); }
}

export function createPersistenceAdapter({ driver = 'json', filePath } = {}) {
  if (driver !== 'json') {
    const error = new Error(`Persistence driver ${driver} is not installed. Export a migration bundle before switching drivers.`);
    error.code = 'persistence_driver_unavailable';
    throw error;
  }
  if (!filePath) throw new Error('filePath is required for the JSON persistence adapter.');
  return new JsonPersistenceAdapter(filePath);
}

function stableRows(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, row]) => ({ key, value: row }));
}

export async function exportMigrationBundle(data, outputDir) {
  const snapshot = structuredClone(data);
  await mkdir(outputDir, { recursive: true });
  const collections = {
    users: stableRows(snapshot.users),
    sessions: stableRows(snapshot.sessions),
    resources: Object.entries(snapshot.resources || {}).sort(([a], [b]) => a.localeCompare(b)).flatMap(([resourceType, rows]) => stableRows(rows).map((row) => ({ resourceType, ...row }))),
    attachments: stableRows(snapshot.attachments),
    privacyPolicies: stableRows(snapshot.privacyPolicies),
    changes: stableRows(snapshot.changes),
    audit: stableRows(snapshot.audit),
  };
  const artifacts = {};
  for (const [name, rows] of Object.entries(collections)) {
    const payload = rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '');
    const fileName = `${name}.ndjson`;
    await writeFile(path.join(outputDir, fileName), payload, 'utf8');
    artifacts[fileName] = {
      rows: rows.length,
      bytes: Buffer.byteLength(payload),
      sha256: createHash('sha256').update(payload).digest('hex'),
    };
  }
  const manifest = {
    schema: 'lesson-hub-migration-bundle-v1',
    persistenceContract: PERSISTENCE_CONTRACT,
    sourceSchema: snapshot.schema,
    exportedAt: new Date().toISOString(),
    artifacts,
  };
  await writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const verify = JSON.parse(await readFile(path.join(outputDir, 'manifest.json'), 'utf8'));
  if (verify.schema !== manifest.schema) throw new Error('Migration bundle verification failed.');
  return manifest;
}

import { mkdir, open, readFile, rename } from 'node:fs/promises';
import path from 'node:path';

const SERVER_SCHEMA = 'lesson-hub-server-store-v3';
const LEGACY_SCHEMAS = new Set(['lesson-hub-server-store-v1', 'lesson-hub-server-store-v2']);

async function syncDirectory(directory) {
  const handle = await open(directory, 'r');
  try {
    await handle.sync();
  } catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'EISDIR'].includes(error?.code)) throw error;
  } finally {
    await handle.close();
  }
}

function emptyStore() {
  return {
    schema: SERVER_SCHEMA,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    users: [],
    sessions: [],
    resources: {},
    attachments: {},
    privacyPolicies: {},
    changes: [],
    audit: [],
    nextCursor: 1,
    oldestCursor: 1,
  };
}

export class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = emptyStore();
    this.writeQueue = Promise.resolve();
    this.mutationQueue = Promise.resolve();
    this.frozen = false;
    this.consecutiveWriteFailures = 0;
    this.onWriteFailure = null;
  }

  async open() {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8'));
      if (parsed.schema !== SERVER_SCHEMA && !LEGACY_SCHEMAS.has(parsed.schema)) throw new Error('Datový soubor serveru má neznámé schéma.');
      this.data = {
        ...emptyStore(),
        ...parsed,
        schema: SERVER_SCHEMA,
        resources: parsed.resources || {},
        attachments: parsed.attachments || {},
        privacyPolicies: parsed.privacyPolicies || {},
        oldestCursor: Number(parsed.oldestCursor || parsed.changes?.[0]?.cursor || 1),
      };
      if (parsed.schema !== SERVER_SCHEMA) await this.save();
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await this.save();
    }
    this.pruneSessions();
    return this;
  }

  resource(name) {
    if (!this.data.resources[name]) this.data.resources[name] = {};
    return this.data.resources[name];
  }

  nextCursor() {
    const cursor = this.data.nextCursor;
    this.data.nextCursor += 1;
    return cursor;
  }

  pruneSessions(now = Date.now()) {
    this.data.sessions = this.data.sessions.filter((session) => new Date(session.expiresAt).getTime() > now);
  }


  snapshot() {
    return structuredClone(this.data);
  }

  stats() {
    const resources = Object.values(this.data.resources || {}).reduce((sum, bucket) => sum + Object.keys(bucket || {}).length, 0);
    return Object.freeze({
      schema: this.data.schema,
      users: this.data.users.length,
      sessions: this.data.sessions.length,
      resources,
      attachments: Object.keys(this.data.attachments || {}).length,
      changes: this.data.changes.length,
      audit: this.data.audit.length,
    });
  }

  async transact(mutator, { persist = true } = {}) {
    if (typeof mutator !== 'function') throw new TypeError('JsonStore.transact requires a mutator function.');
    const run = this.mutationQueue.catch(() => {}).then(async () => {
      if (this.frozen) {
        const error = new Error('Datove uloziste je docasne uzamceno kvuli obnove.');
        error.status = 503;
        error.code = 'store_frozen';
        throw error;
      }
      const before = structuredClone(this.data);
      try {
        const result = await mutator(this.data, this);
        if (persist) await this.save();
        return result;
      } catch (error) {
        this.data = before;
        throw error;
      }
    });
    this.mutationQueue = run.catch(() => {});
    return run;
  }

  freeze() { this.frozen = true; }
  unfreeze() { this.frozen = false; }

  async save() {
    if (this.frozen) {
      const error = new Error('Datové úložiště je dočasně uzamčeno kvůli obnově.');
      error.status = 503;
      error.code = 'store_frozen';
      throw error;
    }
    this.data.updatedAt = new Date().toISOString();
    const payload = `${JSON.stringify(this.data, null, 2)}\n`;
    const temporary = `${this.filePath}.tmp`;
    const run = this.writeQueue.catch(() => {}).then(async () => {
      const handle = await open(temporary, 'w', 0o600);
      try {
        await handle.writeFile(payload);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, this.filePath);
      await syncDirectory(path.dirname(this.filePath));
    });
    this.writeQueue = run.catch(() => {});
    try {
      await run;
      this.consecutiveWriteFailures = 0;
    } catch (error) {
      this.consecutiveWriteFailures += 1;
      this.onWriteFailure?.(error, this.consecutiveWriteFailures);
      throw error;
    }
  }
}

import { createId, createTimestamps } from '../core/schema.js';

export class BaseRepository {
  constructor(database, storeName, idPrefix) {
    this.database = database;
    this.storeName = storeName;
    this.idPrefix = idPrefix;
    this.auditWrites = 0;
  }

  async list() {
    return this.database.getAll(this.storeName);
  }

  async get(id) {
    return this.database.get(this.storeName, id);
  }

  async create(input) {
    const entity = {
      id: input.id ?? createId(this.idPrefix),
      ...createTimestamps(),
      ...input,
    };
    await this.database.put(this.storeName, entity);
    if (this.storeName === 'auditEvents') await this.#pruneAuditEvents();
    return entity;
  }

  async update(id, patch, { preserveUpdatedAt = false } = {}) {
    const current = await this.get(id);
    if (!current) throw new Error(`Záznam ${id} nebyl nalezen.`);

    const updated = {
      ...current,
      ...patch,
      id,
      updatedAt: preserveUpdatedAt && patch?.updatedAt ? patch.updatedAt : new Date().toISOString(),
    };
    await this.database.put(this.storeName, updated);
    return updated;
  }

  async remove(id) {
    await this.database.delete(this.storeName, id);
  }

  async count() {
    return this.database.count(this.storeName);
  }

  async #pruneAuditEvents() {
    this.auditWrites += 1;
    if (this.auditWrites % 100 !== 0) return;
    if (await this.database.count(this.storeName) < 5500) return;

    const items = await this.database.getAll(this.storeName);
    const cutoff = Date.now() - 180 * 86_400_000;
    const ordered = items.sort((a, b) => String(b.timestamp || b.createdAt).localeCompare(String(a.timestamp || a.createdAt)));
    const remove = ordered.filter((item, index) => index >= 5000 || new Date(item.timestamp || item.createdAt || 0).getTime() < cutoff);
    for (const item of remove) await this.database.delete(this.storeName, item.id);
  }
}

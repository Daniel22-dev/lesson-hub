import { recordAnonymousOutput } from '../core/telemetry.js';

const normalizeText = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');
const lower = (value) => normalizeText(value).toLocaleLowerCase('cs-CZ').normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export const MATERIAL_TYPES = Object.freeze({
  link: { label: 'Webový odkaz', icon: 'link' },
  worksheet: { label: 'Pracovní list', icon: 'materials' },
  solution: { label: 'Řešení / klíč', icon: 'check' },
  test: { label: 'Test / zadání', icon: 'edit' },
  presentation: { label: 'Prezentace', icon: 'overview' },
  document: { label: 'Dokument', icon: 'book' },
  image: { label: 'Obrázek / fotografie', icon: 'materials' },
  audio: { label: 'Zvuk / poslech', icon: 'play' },
  video: { label: 'Video', icon: 'play' },
  app: { label: 'Aplikace / hra', icon: 'overview' },
  note: { label: 'Poznámka učitele', icon: 'edit' },
  other: { label: 'Jiný materiál', icon: 'materials' },
});

export const SOURCE_TYPES = Object.freeze({
  url: 'Odkaz',
  reference: 'Odkaz na soubor',
  note: 'Textový záznam',
  studio: 'Převzato z AI Studia',
});

export const MATERIAL_VISIBILITY = Object.freeze({
  private: 'Pouze já',
  students: 'Pro studenty',
  substitution: 'Pro zastupování',
});

function required(value, label) {
  const normalized = normalizeText(value);
  if (!normalized) throw new Error(`${label} je povinný.`);
  return normalized;
}

function validUrl(value) {
  const normalized = normalizeText(value);
  if (!normalized) return '';
  try {
    const parsed = new URL(normalized, globalThis.location?.href || 'https://lesson-hub.local/');
    if (!['http:', 'https:', 'file:'].includes(parsed.protocol)) throw new Error();
    return parsed.href;
  } catch {
    throw new Error('Odkaz nemá platný formát. Použijte adresu začínající http:// nebo https://.');
  }
}

function keyFor({ title, url, materialType, sourceType }) {
  if (url) return `url:${lower(url).replace(/\/$/, '')}`;
  return `meta:${lower(materialType)}:${lower(sourceType)}:${lower(title)}`;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export class MaterialService {
  constructor(repositories) {
    this.repositories = repositories;
  }

  async audit(action, entityType, entityId, metadata = {}) {
    return this.repositories.auditEvents.create({ action, entityType, entityId, timestamp: new Date().toISOString(), actorId: 'local-user', metadata });
  }

  async relationMaps() {
    const [groups, years, subjects, lessons, links, tags, entityTags] = await Promise.all([
      this.repositories.groupInstances.list(),
      this.repositories.schoolYears.list(),
      this.repositories.subjects.list(),
      this.repositories.lessons.list(),
      this.repositories.materialLinks.list(),
      this.repositories.tags.list(),
      this.repositories.entityTags.list(),
    ]);
    return {
      groups: new Map(groups.map((item) => [item.id, item])),
      years: new Map(years.map((item) => [item.id, item])),
      subjects: new Map(subjects.map((item) => [item.id, item])),
      lessons: new Map(lessons.map((item) => [item.id, item])),
      links,
      tags: new Map(tags.map((item) => [item.id, item])),
      entityTags,
    };
  }

  enrich(material, maps) {
    const materialLinks = maps.links.filter((link) => link.materialId === material.id);
    const resolvedLinks = materialLinks.map((link) => {
      if (link.entityType === 'group') {
        const group = maps.groups.get(link.entityId);
        return { ...link, entity: group, label: group?.displayName || 'Neznámá skupina', href: group ? `#/groups/${group.id}` : '' };
      }
      if (link.entityType === 'lesson') {
        const lesson = maps.lessons.get(link.entityId);
        const group = lesson ? maps.groups.get(lesson.groupInstanceId) : null;
        return { ...link, entity: lesson, group, label: lesson ? `${lesson.title} · ${group?.displayName || ''}` : 'Neznámá hodina', href: lesson ? `#/plan/${lesson.id}` : '' };
      }
      return { ...link, entity: null, label: link.entityType, href: '' };
    });
    const tagIds = new Set(maps.entityTags.filter((link) => link.entityType === 'material' && link.entityId === material.id).map((link) => link.tagId));
    const materialTags = [...tagIds].map((id) => maps.tags.get(id)).filter((tag) => tag && tag.status !== 'archived');
    return { ...material, links: resolvedLinks, tags: materialTags, linkCount: resolvedLinks.length };
  }

  async listMaterials({ query = '', type = '', status = 'active', linkedTo = '', groupId = '', lessonId = '', favoritesOnly = false } = {}) {
    const maps = await this.relationMaps();
    const needle = lower(query);
    return (await this.repositories.materials.list())
      .map((material) => this.enrich(material, maps))
      .filter((material) => !status || material.status === status)
      .filter((material) => !type || material.materialType === type)
      .filter((material) => !linkedTo || (linkedTo === 'linked' ? material.linkCount > 0 : material.linkCount === 0))
      .filter((material) => !groupId || material.links.some((link) => link.entityType === 'group' && link.entityId === groupId) || material.links.some((link) => link.entityType === 'lesson' && link.group?.id === groupId))
      .filter((material) => !lessonId || material.links.some((link) => link.entityType === 'lesson' && link.entityId === lessonId))
      .filter((material) => !favoritesOnly || material.favorite)
      .filter((material) => !needle || [material.title, material.description, material.teacherNote, material.url, material.fileName, ...material.tags.map((tag) => tag.name), ...material.links.map((link) => link.label)].some((value) => lower(value).includes(needle)))
      .sort((a, b) => Number(b.favorite) - Number(a.favorite) || (b.lastUsedAt || b.updatedAt || '').localeCompare(a.lastUsedAt || a.updatedAt || '') || a.title.localeCompare(b.title, 'cs'));
  }

  async getMaterial(id) {
    const material = await this.repositories.materials.get(id);
    if (!material) throw new Error('Materiál nebyl nalezen.');
    return this.enrich(material, await this.relationMaps());
  }

  async findDuplicate(input, excludeId = '') {
    const url = input.url ? validUrl(input.url) : '';
    const normalizedKey = keyFor({ ...input, url });
    return (await this.repositories.materials.list()).find((item) => item.id !== excludeId && item.status !== 'archived' && item.normalizedKey === normalizedKey) || null;
  }

  async createMaterial(input, { groupIds = [], lessonIds = [], tagIds = [] } = {}) {
    const title = required(input.title, 'Název materiálu');
    const materialType = MATERIAL_TYPES[input.materialType] ? input.materialType : 'link';
    const sourceType = SOURCE_TYPES[input.sourceType] ? input.sourceType : (input.url ? 'url' : 'note');
    const url = validUrl(input.url);
    if (['url', 'reference', 'studio'].includes(sourceType) && !url && sourceType !== 'studio') throw new Error('Pro tento typ zdroje vložte odkaz.');
    const normalizedKey = keyFor({ title, url, materialType, sourceType });
    const duplicate = await this.findDuplicate({ title, url, materialType, sourceType });
    if (duplicate) {
      const detail = await this.getMaterial(duplicate.id);
      const existingGroupIds = detail.links.filter((link) => link.entityType === 'group').map((link) => link.entityId);
      const existingLessonIds = detail.links.filter((link) => link.entityType === 'lesson').map((link) => link.entityId);
      await this.setMaterialLinks(duplicate.id, { groupIds: unique([...existingGroupIds, ...groupIds]), lessonIds: unique([...existingLessonIds, ...lessonIds]) });
      await this.setMaterialTags(duplicate.id, unique([...detail.tags.map((tag) => tag.id), ...tagIds]));
      await this.audit('material-reused', 'material', duplicate.id, { addedGroupLinks: groupIds.length, addedLessonLinks: lessonIds.length });
      return { material: await this.getMaterial(duplicate.id), reused: true };
    }
    const material = await this.repositories.materials.create({
      title,
      description: normalizeText(input.description),
      materialType,
      sourceType,
      url,
      fileName: normalizeText(input.fileName),
      mimeType: normalizeText(input.mimeType),
      size: Number(input.size) || null,
      checksum: normalizeText(input.checksum),
      teacherNote: normalizeText(input.teacherNote),
      studentFacing: Boolean(input.studentFacing),
      visibility: MATERIAL_VISIBILITY[input.visibility] ? input.visibility : 'private',
      status: 'active',
      favorite: Boolean(input.favorite),
      normalizedKey,
    });
    await this.setMaterialLinks(material.id, { groupIds, lessonIds });
    await this.setMaterialTags(material.id, tagIds);
    await this.audit('material-created', 'material', material.id, { materialType, sourceType, linkCount: unique([...groupIds, ...lessonIds]).length });
    recordAnonymousOutput('material-record');
    return { material: await this.getMaterial(material.id), reused: false };
  }

  async updateMaterial(id, input, { groupIds = null, lessonIds = null, tagIds = null } = {}) {
    const current = await this.repositories.materials.get(id);
    if (!current) throw new Error('Materiál nebyl nalezen.');
    const title = input.title !== undefined ? required(input.title, 'Název materiálu') : current.title;
    const materialType = input.materialType !== undefined && MATERIAL_TYPES[input.materialType] ? input.materialType : current.materialType;
    const sourceType = input.sourceType !== undefined && SOURCE_TYPES[input.sourceType] ? input.sourceType : current.sourceType;
    const url = input.url !== undefined ? validUrl(input.url) : current.url;
    const normalizedKey = keyFor({ title, url, materialType, sourceType });
    const duplicate = await this.findDuplicate({ title, url, materialType, sourceType }, id);
    if (duplicate) throw new Error(`Stejný materiál již existuje jako „${duplicate.title}“.`);
    await this.repositories.materials.update(id, {
      title,
      description: input.description !== undefined ? normalizeText(input.description) : current.description,
      materialType,
      sourceType,
      url,
      fileName: input.fileName !== undefined ? normalizeText(input.fileName) : current.fileName,
      teacherNote: input.teacherNote !== undefined ? normalizeText(input.teacherNote) : current.teacherNote,
      studentFacing: input.studentFacing !== undefined ? Boolean(input.studentFacing) : current.studentFacing,
      visibility: input.visibility !== undefined && MATERIAL_VISIBILITY[input.visibility] ? input.visibility : current.visibility,
      favorite: input.favorite !== undefined ? Boolean(input.favorite) : Boolean(current.favorite),
      normalizedKey,
    });
    if (groupIds !== null || lessonIds !== null) await this.setMaterialLinks(id, { groupIds: groupIds ?? [], lessonIds: lessonIds ?? [] });
    if (tagIds !== null) await this.setMaterialTags(id, tagIds);
    await this.audit('material-updated', 'material', id, { materialType, sourceType });
    return this.getMaterial(id);
  }

  async setMaterialLinks(materialId, { groupIds = [], lessonIds = [] } = {}) {
    if (!(await this.repositories.materials.get(materialId))) throw new Error('Materiál nebyl nalezen.');
    const desired = new Map();
    for (const groupId of unique(groupIds)) {
      if (await this.repositories.groupInstances.get(groupId)) desired.set(`group:${groupId}`, { entityType: 'group', entityId: groupId });
    }
    for (const lessonId of unique(lessonIds)) {
      if (await this.repositories.lessons.get(lessonId)) desired.set(`lesson:${lessonId}`, { entityType: 'lesson', entityId: lessonId });
    }
    const existing = (await this.repositories.materialLinks.list()).filter((link) => link.materialId === materialId);
    for (const link of existing) {
      if (!desired.has(`${link.entityType}:${link.entityId}`)) await this.repositories.materialLinks.remove(link.id);
    }
    const existingKeys = new Set(existing.map((link) => `${link.entityType}:${link.entityId}`));
    for (const [key, target] of desired) {
      if (!existingKeys.has(key)) await this.repositories.materialLinks.create({ materialId, ...target, purpose: 'teaching', visibility: 'private' });
    }
    await this.audit('material-links-updated', 'material', materialId, { count: desired.size });
  }

  async setMaterialTags(materialId, tagIds = []) {
    const selected = new Set(unique(tagIds));
    const existing = (await this.repositories.entityTags.list()).filter((link) => link.entityType === 'material' && link.entityId === materialId);
    for (const link of existing) if (!selected.has(link.tagId)) await this.repositories.entityTags.remove(link.id);
    const existingIds = new Set(existing.map((link) => link.tagId));
    for (const tagId of selected) {
      if (await this.repositories.tags.get(tagId) && !existingIds.has(tagId)) await this.repositories.entityTags.create({ tagId, entityType: 'material', entityId: materialId });
    }
  }


  async setFavorite(id, favorite) {
    if (!(await this.repositories.materials.get(id))) throw new Error('Materiál nebyl nalezen.');
    const updated = await this.repositories.materials.update(id, { favorite: Boolean(favorite) });
    await this.audit(favorite ? 'material-favorited' : 'material-unfavorited', 'material', id);
    return updated;
  }

  async bulkUpdate(ids = [], action) {
    const uniqueIds = unique(ids);
    if (!uniqueIds.length) throw new Error('Vyberte alespoň jeden materiál.');
    let changed = 0;
    for (const id of uniqueIds) {
      const material = await this.repositories.materials.get(id);
      if (!material) continue;
      if (action === 'archive' && material.status !== 'archived') await this.repositories.materials.update(id, { status: 'archived' });
      else if (action === 'restore' && material.status !== 'active') await this.repositories.materials.update(id, { status: 'active' });
      else if (action === 'favorite') await this.repositories.materials.update(id, { favorite: true });
      else if (action === 'unfavorite') await this.repositories.materials.update(id, { favorite: false });
      else continue;
      changed += 1;
      await this.audit(`material-bulk-${action}`, 'material', id);
    }
    return changed;
  }

  async archiveMaterial(id) {
    if (!(await this.repositories.materials.get(id))) throw new Error('Materiál nebyl nalezen.');
    await this.repositories.materials.update(id, { status: 'archived' });
    await this.audit('material-archived', 'material', id);
  }

  async restoreMaterial(id) {
    if (!(await this.repositories.materials.get(id))) throw new Error('Materiál nebyl nalezen.');
    await this.repositories.materials.update(id, { status: 'active' });
    await this.audit('material-restored', 'material', id);
  }

  async removeMaterial(id) {
    const material = await this.repositories.materials.get(id);
    if (!material) throw new Error('Materiál nebyl nalezen.');
    const links = (await this.repositories.materialLinks.list()).filter((link) => link.materialId === id);
    if (links.length) throw new Error('Materiál je propojený s výukou. Nejprve jej archivujte nebo odstraňte vazby.');
    for (const tagLink of (await this.repositories.entityTags.list()).filter((link) => link.entityType === 'material' && link.entityId === id)) await this.repositories.entityTags.remove(tagLink.id);
    await this.repositories.materials.remove(id);
    await this.audit('material-deleted', 'material', id);
  }

  async summary() {
    const all = await this.listMaterials({ status: '' });
    return {
      total: all.filter((item) => item.status === 'active').length,
      linked: all.filter((item) => item.status === 'active' && item.linkCount).length,
      unlinked: all.filter((item) => item.status === 'active' && !item.linkCount).length,
      archived: all.filter((item) => item.status === 'archived').length,
      studentFacing: all.filter((item) => item.status === 'active' && item.studentFacing).length,
      favorites: all.filter((item) => item.status === 'active' && item.favorite).length,
    };
  }
}

import { normalizeText } from '../core/html.js';
import { createId } from '../core/schema.js';
import { ACTIVITY_TYPES, SKILL_TYPES, SUCCESS_RATINGS } from './lessonService.js';

const COLOR_TOKENS = new Set(['teal', 'blue', 'violet', 'amber', 'rose', 'slate']);
const ACTIVE_LESSON_STATUSES = new Set(['draft', 'planned', 'in_progress', 'completed', 'unfinished', 'substituted']);

function required(value, label) {
  const normalized = normalizeText(value);
  if (!normalized) throw new Error(`${label} je povinné.`);
  return normalized;
}

function normalizeDate(value, label = 'Datum') {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${label} je povinné.`);
  return text;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function compareUpdated(a, b) {
  return String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''));
}

function normalizeSteps(steps = []) {
  const normalized = asArray(steps)
    .map((step, index) => ({
      id: step.id || createId('cycleStep'),
      label: normalizeText(step.label),
      skillType: SKILL_TYPES[step.skillType] ? step.skillType : 'other',
      colorToken: COLOR_TOKENS.has(step.colorToken) ? step.colorToken : ['teal', 'blue', 'violet', 'amber', 'rose'][index % 5],
    }))
    .filter((step) => step.label);
  if (!normalized.length) throw new Error('Cyklus musí obsahovat alespoň jeden krok.');
  return normalized;
}

function lessonTemplatePayload(input, sourceLesson = null) {
  return {
    title: required(input.title ?? sourceLesson?.title, 'Název šablony'),
    description: normalizeText(input.description),
    subjectId: input.subjectId || sourceLesson?.subjectId || null,
    topic: normalizeText(input.topic ?? sourceLesson?.topic),
    objectives: normalizeText(input.objectives ?? sourceLesson?.objectives),
    plannedOutline: normalizeText(input.plannedOutline ?? sourceLesson?.plannedOutline),
    plannedDuration: Math.max(5, Number(input.plannedDuration ?? sourceLesson?.plannedDuration) || 45),
    activityType: ACTIVITY_TYPES[input.activityType ?? sourceLesson?.activityType] ? (input.activityType ?? sourceLesson?.activityType) : '',
    skillType: SKILL_TYPES[input.skillType ?? sourceLesson?.skillType] ? (input.skillType ?? sourceLesson?.skillType) : '',
    level: normalizeText(input.level ?? sourceLesson?.level),
    homework: normalizeText(input.homework ?? sourceLesson?.homework),
    nextLessonNote: normalizeText(input.nextLessonNote ?? sourceLesson?.nextLessonNote),
    favorite: Boolean(input.favorite ?? false),
    status: input.status === 'archived' ? 'archived' : 'active',
    sourceLessonId: sourceLesson?.id || input.sourceLessonId || null,
    useCount: Number(input.useCount) || 0,
    lastUsedAt: input.lastUsedAt || null,
  };
}

export class TemplateCycleService {
  constructor(repositories, lessonService) {
    this.repositories = repositories;
    this.lessonService = lessonService;
  }

  async audit(action, entityType, entityId, metadata = {}) {
    return this.repositories.auditEvents.create({
      entityType,
      entityId,
      action,
      timestamp: new Date().toISOString(),
      metadata,
    });
  }

  async listTemplates({ query = '', status = 'active', subjectId = '', favoritesOnly = false } = {}) {
    const [templates, subjects] = await Promise.all([
      this.repositories.lessonTemplates.list(),
      this.repositories.subjects.list(),
    ]);
    const subjectMap = new Map(subjects.map((subject) => [subject.id, subject]));
    const needle = normalizeText(query).toLocaleLowerCase('cs');
    return templates
      .filter((template) => !status || template.status === status)
      .filter((template) => !subjectId || template.subjectId === subjectId)
      .filter((template) => !favoritesOnly || template.favorite)
      .map((template) => ({ ...template, subject: subjectMap.get(template.subjectId) ?? null }))
      .filter((template) => !needle || [template.title, template.description, template.topic, template.objectives, template.plannedOutline, template.subject?.name].some((value) => String(value || '').toLocaleLowerCase('cs').includes(needle)))
      .sort((a, b) => Number(b.favorite) - Number(a.favorite) || compareUpdated(a, b) || a.title.localeCompare(b.title, 'cs'));
  }

  async getTemplate(id) {
    const template = await this.repositories.lessonTemplates.get(id);
    if (!template) return null;
    const subject = template.subjectId ? await this.repositories.subjects.get(template.subjectId) : null;
    return { ...template, subject };
  }

  async createTemplate(input) {
    const payload = lessonTemplatePayload(input);
    const duplicate = (await this.repositories.lessonTemplates.list()).find((item) => item.status !== 'archived' && item.title.toLocaleLowerCase('cs') === payload.title.toLocaleLowerCase('cs') && (item.subjectId || '') === (payload.subjectId || ''));
    if (duplicate) throw new Error('Aktivní šablona se stejným názvem a předmětem již existuje.');
    const created = await this.repositories.lessonTemplates.create(payload);
    await this.audit('template-created', 'lessonTemplate', created.id, { title: created.title });
    return created;
  }

  async createTemplateFromLesson(lessonId, input = {}) {
    const detail = await this.lessonService.getLesson(lessonId);
    if (!detail?.lesson) throw new Error('Zdrojová hodina nebyla nalezena.');
    const lesson = { ...detail.lesson, subjectId: detail.group?.subjectId || null };
    const created = await this.repositories.lessonTemplates.create(lessonTemplatePayload({ ...input, title: input.title || lesson.title, favorite: input.favorite ?? ['excellent', 'good'].includes(lesson.successRating) }, lesson));
    await this.audit('template-created-from-lesson', 'lessonTemplate', created.id, { sourceLessonId: lessonId, title: created.title });
    return created;
  }

  async updateTemplate(id, input) {
    const current = await this.repositories.lessonTemplates.get(id);
    if (!current) throw new Error('Šablona nebyla nalezena.');
    const updated = await this.repositories.lessonTemplates.update(id, lessonTemplatePayload({ ...current, ...input }));
    await this.audit('template-updated', 'lessonTemplate', id, { title: updated.title });
    return updated;
  }

  async setTemplateFavorite(id, favorite) {
    const current = await this.repositories.lessonTemplates.get(id);
    if (!current) throw new Error('Šablona nebyla nalezena.');
    const updated = await this.repositories.lessonTemplates.update(id, { favorite: Boolean(favorite) });
    await this.audit(favorite ? 'template-favorited' : 'template-unfavorited', 'lessonTemplate', id);
    return updated;
  }

  async archiveTemplate(id) {
    const updated = await this.repositories.lessonTemplates.update(id, { status: 'archived' });
    await this.audit('template-archived', 'lessonTemplate', id);
    return updated;
  }

  async restoreTemplate(id) {
    const updated = await this.repositories.lessonTemplates.update(id, { status: 'active' });
    await this.audit('template-restored', 'lessonTemplate', id);
    return updated;
  }

  async removeTemplate(id) {
    const current = await this.repositories.lessonTemplates.get(id);
    if (!current) throw new Error('Šablona nebyla nalezena.');
    if (Number(current.useCount) > 0) throw new Error('Použitou šablonu nelze odstranit. Archivujte ji.');
    await this.repositories.lessonTemplates.remove(id);
    await this.audit('template-deleted', 'lessonTemplate', id);
  }

  async createLessonFromTemplate(templateId, { groupInstanceId, date, startTime = '', title = '', status = 'planned' } = {}) {
    const template = await this.repositories.lessonTemplates.get(templateId);
    if (!template || template.status === 'archived') throw new Error('Vyberte aktivní šablonu.');
    const lesson = await this.lessonService.createLesson({
      groupInstanceId,
      date: normalizeDate(date, 'Datum hodiny'),
      startTime,
      status,
      title: normalizeText(title) || template.title,
      topic: template.topic,
      objectives: template.objectives,
      plannedOutline: template.plannedOutline,
      plannedDuration: template.plannedDuration,
      activityType: template.activityType,
      skillType: template.skillType,
      level: template.level,
      homework: template.homework,
      nextLessonNote: template.nextLessonNote,
      sourceTemplateId: template.id,
    });
    await this.repositories.lessonTemplates.update(template.id, { useCount: Number(template.useCount || 0) + 1, lastUsedAt: new Date().toISOString() });
    await this.audit('template-used', 'lessonTemplate', template.id, { lessonId: lesson.id, groupInstanceId });
    return lesson;
  }

  async duplicateLesson(lessonId, { groupInstanceId, date, startTime = '', title = '' } = {}) {
    const detail = await this.lessonService.getLesson(lessonId);
    if (!detail?.lesson) throw new Error('Zdrojová hodina nebyla nalezena.');
    const source = detail.lesson;
    const lesson = await this.lessonService.createLesson({
      groupInstanceId: groupInstanceId || source.groupInstanceId,
      date: normalizeDate(date || source.date),
      startTime,
      status: 'planned',
      title: normalizeText(title) || source.title,
      topic: source.topic,
      objectives: source.objectives,
      plannedOutline: source.plannedOutline,
      plannedDuration: source.plannedDuration,
      activityType: source.activityType,
      skillType: source.skillType,
      level: source.level,
      homework: source.homework,
      nextLessonNote: source.nextLessonNote,
      sourceTemplateId: source.sourceTemplateId || null,
    });
    await this.audit('lesson-duplicated', 'lesson', lesson.id, { sourceLessonId: lessonId, groupInstanceId: lesson.groupInstanceId });
    return lesson;
  }

  async bulkPlanFromTemplate(templateId, { groupIds = [], date, startTime = '', title = '' } = {}) {
    const uniqueGroups = [...new Set(asArray(groupIds).filter(Boolean))];
    if (!uniqueGroups.length) throw new Error('Vyberte alespoň jednu cílovou skupinu.');
    const created = [];
    for (const groupInstanceId of uniqueGroups) {
      created.push(await this.createLessonFromTemplate(templateId, { groupInstanceId, date, startTime, title }));
    }
    await this.audit('template-bulk-used', 'lessonTemplate', templateId, { count: created.length, date });
    return created;
  }

  async successfulLessons({ limit = 12 } = {}) {
    const lessons = await this.lessonService.listLessons({ statuses: ['completed', 'unfinished', 'substituted'], sort: 'desc' });
    return lessons
      .filter((lesson) => ['excellent', 'good'].includes(lesson.successRating) || ['favorite', 'reuse', 'excellent_material'].includes(lesson.reuseDecision))
      .sort((a, b) => {
        const aRating = SUCCESS_RATINGS[a.successRating] ? (a.successRating === 'excellent' ? 3 : 2) : 0;
        const bRating = SUCCESS_RATINGS[b.successRating] ? (b.successRating === 'excellent' ? 3 : 2) : 0;
        return bRating - aRating || String(b.date).localeCompare(String(a.date));
      })
      .slice(0, limit);
  }

  async listCycles({ status = 'active' } = {}) {
    const cycles = await this.repositories.teachingCycles.list();
    return cycles.filter((cycle) => !status || cycle.status === status).sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name, 'cs'));
  }

  async getCycle(id) {
    return this.repositories.teachingCycles.get(id);
  }

  async createCycle(input) {
    const name = required(input.name, 'Název cyklu');
    const duplicate = (await this.repositories.teachingCycles.list()).find((item) => item.status !== 'archived' && item.name.toLocaleLowerCase('cs') === name.toLocaleLowerCase('cs'));
    if (duplicate) throw new Error('Aktivní cyklus se stejným názvem již existuje.');
    const created = await this.repositories.teachingCycles.create({
      name,
      description: normalizeText(input.description),
      stepDurationWeeks: Math.max(1, Number(input.stepDurationWeeks) || 1),
      steps: normalizeSteps(input.steps),
      status: 'active',
      favorite: Boolean(input.favorite),
    });
    await this.audit('cycle-created', 'teachingCycle', created.id, { name });
    return created;
  }

  async updateCycle(id, input) {
    const current = await this.repositories.teachingCycles.get(id);
    if (!current) throw new Error('Výukový cyklus nebyl nalezen.');
    const updated = await this.repositories.teachingCycles.update(id, {
      name: required(input.name ?? current.name, 'Název cyklu'),
      description: normalizeText(input.description ?? current.description),
      stepDurationWeeks: Math.max(1, Number(input.stepDurationWeeks ?? current.stepDurationWeeks) || 1),
      steps: normalizeSteps(input.steps ?? current.steps),
      favorite: Boolean(input.favorite ?? current.favorite),
      status: input.status === 'archived' ? 'archived' : current.status || 'active',
    });
    await this.audit('cycle-updated', 'teachingCycle', id, { name: updated.name });
    return updated;
  }

  async archiveCycle(id) {
    const groups = (await this.repositories.groupInstances.list()).filter((group) => group.cycleId === id && group.status !== 'archived');
    if (groups.length) throw new Error('Cyklus je přiřazen aktivním skupinám. Nejprve jej z těchto skupin odeberte.');
    const updated = await this.repositories.teachingCycles.update(id, { status: 'archived' });
    await this.audit('cycle-archived', 'teachingCycle', id);
    return updated;
  }

  async assignCycleToGroups(cycleId, { groupIds = [], anchorDate, stepDurationWeeks = null } = {}) {
    const cycle = await this.repositories.teachingCycles.get(cycleId);
    if (!cycle || cycle.status === 'archived') throw new Error('Vyberte aktivní cyklus.');
    const date = normalizeDate(anchorDate, 'Počáteční datum cyklu');
    const uniqueGroups = [...new Set(asArray(groupIds).filter(Boolean))];
    if (!uniqueGroups.length) throw new Error('Vyberte alespoň jednu skupinu.');
    const updated = [];
    for (const groupId of uniqueGroups) {
      const group = await this.repositories.groupInstances.get(groupId);
      if (!group) continue;
      updated.push(await this.repositories.groupInstances.update(groupId, {
        cycleId,
        cycleAnchorDate: date,
        cycleStepDurationWeeks: Math.max(1, Number(stepDurationWeeks) || Number(cycle.stepDurationWeeks) || 1),
      }));
    }
    await this.audit('cycle-assigned', 'teachingCycle', cycleId, { groupIds: updated.map((group) => group.id), anchorDate: date });
    return updated;
  }

  async clearCycleFromGroup(groupId) {
    const group = await this.repositories.groupInstances.get(groupId);
    if (!group) throw new Error('Skupina nebyla nalezena.');
    const updated = await this.repositories.groupInstances.update(groupId, { cycleId: null, cycleAnchorDate: '', cycleStepDurationWeeks: null });
    await this.audit('cycle-unassigned', 'groupInstance', groupId);
    return updated;
  }

  currentCycleStep(group, cycle, date = new Date().toISOString().slice(0, 10)) {
    if (!group?.cycleId || !cycle?.steps?.length || !group.cycleAnchorDate) return null;
    const anchor = new Date(`${group.cycleAnchorDate}T12:00:00`);
    const target = new Date(`${date}T12:00:00`);
    if (Number.isNaN(anchor.getTime()) || Number.isNaN(target.getTime())) return null;
    const durationDays = Math.max(7, (Number(group.cycleStepDurationWeeks) || Number(cycle.stepDurationWeeks) || 1) * 7);
    const elapsedDays = Math.max(0, Math.floor((target - anchor) / 86400000));
    const absoluteIndex = Math.floor(elapsedDays / durationDays);
    const index = absoluteIndex % cycle.steps.length;
    const step = cycle.steps[index];
    const cycleRound = Math.floor(absoluteIndex / cycle.steps.length) + 1;
    const start = new Date(anchor.getTime() + absoluteIndex * durationDays * 86400000);
    const end = new Date(start.getTime() + durationDays * 86400000 - 86400000);
    return { ...step, index, cycleRound, startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10), durationDays };
  }

  async groupCycleState(groupId, date = new Date().toISOString().slice(0, 10)) {
    const group = await this.repositories.groupInstances.get(groupId);
    if (!group?.cycleId) return null;
    const cycle = await this.repositories.teachingCycles.get(group.cycleId);
    if (!cycle || cycle.status === 'archived') return null;
    return { group, cycle, step: this.currentCycleStep(group, cycle, date) };
  }

  async cycleAssignments(date = new Date().toISOString().slice(0, 10)) {
    const [groups, cycles, subjects, years] = await Promise.all([
      this.repositories.groupInstances.list(),
      this.repositories.teachingCycles.list(),
      this.repositories.subjects.list(),
      this.repositories.schoolYears.list(),
    ]);
    const cycleMap = new Map(cycles.map((cycle) => [cycle.id, cycle]));
    const subjectMap = new Map(subjects.map((subject) => [subject.id, subject]));
    const yearMap = new Map(years.map((year) => [year.id, year]));
    return groups.filter((group) => group.cycleId).map((group) => {
      const cycle = cycleMap.get(group.cycleId);
      return { group: { ...group, subject: subjectMap.get(group.subjectId) ?? null, year: yearMap.get(group.schoolYearId) ?? null }, cycle, step: cycle ? this.currentCycleStep(group, cycle, date) : null };
    }).filter((item) => item.cycle).sort((a, b) => a.group.displayName.localeCompare(b.group.displayName, 'cs'));
  }

  async summary() {
    const [templates, cycles, assignments, successful] = await Promise.all([
      this.listTemplates({ status: '' }),
      this.listCycles({ status: '' }),
      this.cycleAssignments(),
      this.successfulLessons({ limit: 50 }),
    ]);
    return {
      activeTemplates: templates.filter((item) => item.status === 'active').length,
      favoriteTemplates: templates.filter((item) => item.status === 'active' && item.favorite).length,
      archivedTemplates: templates.filter((item) => item.status === 'archived').length,
      activeCycles: cycles.filter((item) => item.status === 'active').length,
      assignedGroups: assignments.length,
      reusableLessons: successful.length,
    };
  }

  lessonTemplatePrefill(template) {
    if (!template) return null;
    return {
      title: template.title,
      topic: template.topic,
      objectives: template.objectives,
      plannedOutline: template.plannedOutline,
      plannedDuration: template.plannedDuration,
      activityType: template.activityType,
      skillType: template.skillType,
      level: template.level,
      homework: template.homework,
      nextLessonNote: template.nextLessonNote,
      sourceTemplateId: template.id,
    };
  }

  isLessonReusable(lesson) {
    return Boolean(lesson && ACTIVE_LESSON_STATUSES.has(lesson.status) && (['excellent', 'good'].includes(lesson.successRating) || ['favorite', 'reuse', 'excellent_material'].includes(lesson.reuseDecision)));
  }
}

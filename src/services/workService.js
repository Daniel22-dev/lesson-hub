import { normalizeText } from '../core/html.js';

export const TASK_STATUSES = Object.freeze({
  open: { label: 'Otevřený', variant: 'warning' },
  postponed: { label: 'Odložený', variant: 'info' },
  completed: { label: 'Splněný', variant: 'success' },
  cancelled: { label: 'Zrušený', variant: 'neutral' },
});

export const REMINDER_STATUSES = Object.freeze({
  active: { label: 'Aktivní', variant: 'warning' },
  snoozed: { label: 'Odložená', variant: 'info' },
  carried: { label: 'Přenesena', variant: 'info' },
  completed: { label: 'Splněná', variant: 'success' },
  cancelled: { label: 'Zrušená', variant: 'neutral' },
});

export const PRIORITIES = Object.freeze({
  low: { label: 'Nízká', variant: 'neutral', order: 1 },
  normal: { label: 'Běžná', variant: 'info', order: 2 },
  high: { label: 'Vysoká', variant: 'warning', order: 3 },
  urgent: { label: 'Naléhavá', variant: 'danger', order: 4 },
});

export const TASK_TYPES = Object.freeze({
  next_lesson: 'Příští hodina',
  homework_check: 'Kontrola domácího úkolu',
  return_materials: 'Vrátit materiály',
  make_up_test: 'Náhradní test',
  prepare_materials: 'Připravit materiály',
  teaching_follow_up: 'Navázat ve výuce',
  other: 'Jiné',
});

export const REMINDER_TRIGGERS = Object.freeze({
  no_date: 'Bez data',
  next_lesson: 'Při příští hodině',
  date: 'Konkrétní datum',
});

export const TAG_CATEGORIES = Object.freeze({
  activity: 'Typ aktivity',
  skill: 'Dovednost',
  quality: 'Hodnocení a opakované použití',
  level: 'Úroveň',
  custom: 'Vlastní',
});

const VALID_TASK_STATUSES = new Set(Object.keys(TASK_STATUSES));
const VALID_REMINDER_STATUSES = new Set(Object.keys(REMINDER_STATUSES));
const VALID_PRIORITIES = new Set(Object.keys(PRIORITIES));
const VALID_TASK_TYPES = new Set(Object.keys(TASK_TYPES));
const VALID_TRIGGERS = new Set(Object.keys(REMINDER_TRIGGERS));
const VALID_TAG_CATEGORIES = new Set(Object.keys(TAG_CATEGORIES));

function required(value, label) {
  const normalized = normalizeText(value);
  if (!normalized) throw new Error(`${label} je povinný.`);
  return normalized;
}

function optionalDate(value, label = 'Datum') {
  const text = String(value || '').trim();
  if (!text) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${label} nemá platný formát.`);
  return text;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function compareDue(a, b) {
  const priority = (PRIORITIES[b.priority]?.order || 0) - (PRIORITIES[a.priority]?.order || 0);
  if (priority) return priority;
  const aDate = a.dueDate || a.triggerDate || '9999-12-31';
  const bDate = b.dueDate || b.triggerDate || '9999-12-31';
  return aDate.localeCompare(bDate) || String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
}

function lower(value) {
  return normalizeText(value).toLocaleLowerCase('cs');
}

export class WorkService {
  constructor(repositories) {
    this.repositories = repositories;
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

  async relationMaps() {
    const [groups, subjects, lessons] = await Promise.all([
      this.repositories.groupInstances.list(),
      this.repositories.subjects.list(),
      this.repositories.lessons.list(),
    ]);
    return {
      groups: new Map(groups.map((item) => [item.id, item])),
      subjects: new Map(subjects.map((item) => [item.id, item])),
      lessons: new Map(lessons.map((item) => [item.id, item])),
    };
  }

  enrich(item, maps) {
    const lesson = item.lessonId ? maps.lessons.get(item.lessonId) ?? null : null;
    const groupId = item.groupInstanceId || lesson?.groupInstanceId || '';
    const group = groupId ? maps.groups.get(groupId) ?? null : null;
    return {
      ...item,
      lesson,
      group,
      subject: group ? maps.subjects.get(group.subjectId) ?? null : null,
    };
  }

  async listTasks({ groupInstanceId = '', lessonId = '', statuses = [], query = '', includeClosed = false } = {}) {
    const [items, maps] = await Promise.all([this.repositories.tasks.list(), this.relationMaps()]);
    const statusSet = new Set(Array.isArray(statuses) ? statuses.filter(Boolean) : [statuses].filter(Boolean));
    const needle = lower(query);
    return items
      .filter((item) => !groupInstanceId || item.groupInstanceId === groupInstanceId)
      .filter((item) => !lessonId || item.lessonId === lessonId)
      .filter((item) => includeClosed || !['completed', 'cancelled'].includes(item.status))
      .filter((item) => !statusSet.size || statusSet.has(item.status))
      .map((item) => this.enrich(item, maps))
      .filter((item) => !needle || [item.title, item.description, item.group?.displayName, item.lesson?.title].some((value) => lower(value).includes(needle)))
      .sort(compareDue);
  }

  async getTask(id) {
    const item = await this.repositories.tasks.get(id);
    if (!item) return null;
    return this.enrich(item, await this.relationMaps());
  }

  async createTask(input) {
    let groupInstanceId = String(input.groupInstanceId || '').trim();
    const lessonId = String(input.lessonId || '').trim();
    if (lessonId) {
      const lesson = await this.repositories.lessons.get(lessonId);
      if (!lesson) throw new Error('Navázaná hodina nebyla nalezena.');
      groupInstanceId ||= lesson.groupInstanceId;
    }
    if (groupInstanceId && !(await this.repositories.groupInstances.get(groupInstanceId))) throw new Error('Vybraná skupina nebyla nalezena.');
    const status = VALID_TASK_STATUSES.has(input.status) ? input.status : 'open';
    const priority = VALID_PRIORITIES.has(input.priority) ? input.priority : 'normal';
    const type = VALID_TASK_TYPES.has(input.type) ? input.type : 'other';
    const created = await this.repositories.tasks.create({
      title: required(input.title, 'Název úkolu'),
      description: normalizeText(input.description),
      type,
      priority,
      status,
      groupInstanceId: groupInstanceId || null,
      lessonId: lessonId || null,
      studentId: String(input.studentId || '').trim() || null,
      dueDate: optionalDate(input.dueDate, 'Termín'),
      nextLessonTrigger: input.nextLessonTrigger === true || input.nextLessonTrigger === 'on',
      recurrence: normalizeText(input.recurrence),
      postponedUntil: optionalDate(input.postponedUntil, 'Datum odložení'),
      completedAt: status === 'completed' ? new Date().toISOString() : null,
      carriedCount: Number(input.carriedCount) || 0,
    });
    await this.audit('task-created', 'task', created.id, { groupInstanceId, lessonId, type, priority });
    return created;
  }

  async updateTask(id, input) {
    const current = await this.repositories.tasks.get(id);
    if (!current) throw new Error('Úkol nebyl nalezen.');
    const status = input.status !== undefined && VALID_TASK_STATUSES.has(input.status) ? input.status : current.status;
    const priority = input.priority !== undefined && VALID_PRIORITIES.has(input.priority) ? input.priority : current.priority;
    const type = input.type !== undefined && VALID_TASK_TYPES.has(input.type) ? input.type : current.type;
    const updated = await this.repositories.tasks.update(id, {
      title: input.title !== undefined ? required(input.title, 'Název úkolu') : current.title,
      description: input.description !== undefined ? normalizeText(input.description) : current.description,
      type,
      priority,
      status,
      groupInstanceId: input.groupInstanceId !== undefined ? (String(input.groupInstanceId || '').trim() || null) : current.groupInstanceId,
      lessonId: input.lessonId !== undefined ? (String(input.lessonId || '').trim() || null) : current.lessonId,
      studentId: input.studentId !== undefined ? (String(input.studentId || '').trim() || null) : current.studentId,
      dueDate: input.dueDate !== undefined ? optionalDate(input.dueDate, 'Termín') : current.dueDate,
      nextLessonTrigger: input.nextLessonTrigger !== undefined ? (input.nextLessonTrigger === true || input.nextLessonTrigger === 'on') : current.nextLessonTrigger,
      recurrence: input.recurrence !== undefined ? normalizeText(input.recurrence) : current.recurrence,
      postponedUntil: input.postponedUntil !== undefined ? optionalDate(input.postponedUntil, 'Datum odložení') : current.postponedUntil,
      completedAt: status === 'completed' ? (current.completedAt || new Date().toISOString()) : null,
      carriedCount: input.carriedCount !== undefined ? Number(input.carriedCount) || 0 : current.carriedCount,
    });
    await this.audit('task-updated', 'task', id, { status, priority });
    return updated;
  }

  async completeTask(id) {
    const updated = await this.updateTask(id, { status: 'completed', postponedUntil: '' });
    await this.audit('task-completed', 'task', id);
    return updated;
  }

  async postponeTask(id, until = '') {
    const date = optionalDate(until, 'Datum odložení');
    const updated = await this.updateTask(id, { status: 'postponed', postponedUntil: date });
    await this.audit('task-postponed', 'task', id, { until: date });
    return updated;
  }

  async carryTask(id) {
    const current = await this.repositories.tasks.get(id);
    if (!current) throw new Error('Úkol nebyl nalezen.');
    const updated = await this.updateTask(id, {
      status: 'open',
      dueDate: '',
      postponedUntil: '',
      nextLessonTrigger: true,
      carriedCount: (Number(current.carriedCount) || 0) + 1,
    });
    await this.audit('task-carried-to-next-lesson', 'task', id, { carriedCount: updated.carriedCount });
    return updated;
  }

  async cancelTask(id) {
    const updated = await this.updateTask(id, { status: 'cancelled' });
    await this.audit('task-cancelled', 'task', id);
    return updated;
  }

  async listReminders({ groupInstanceId = '', lessonId = '', statuses = [], query = '', includeClosed = false } = {}) {
    const [items, maps] = await Promise.all([this.repositories.reminders.list(), this.relationMaps()]);
    const statusSet = new Set(Array.isArray(statuses) ? statuses.filter(Boolean) : [statuses].filter(Boolean));
    const needle = lower(query);
    return items
      .filter((item) => !groupInstanceId || item.groupInstanceId === groupInstanceId)
      .filter((item) => !lessonId || item.lessonId === lessonId)
      .filter((item) => includeClosed || !['completed', 'cancelled'].includes(item.status))
      .filter((item) => !statusSet.size || statusSet.has(item.status))
      .map((item) => this.enrich(item, maps))
      .filter((item) => !needle || [item.title, item.note, item.group?.displayName, item.lesson?.title].some((value) => lower(value).includes(needle)))
      .sort(compareDue);
  }

  async getReminder(id) {
    const item = await this.repositories.reminders.get(id);
    if (!item) return null;
    return this.enrich(item, await this.relationMaps());
  }

  async createReminder(input) {
    let groupInstanceId = String(input.groupInstanceId || '').trim();
    const lessonId = String(input.lessonId || '').trim();
    if (lessonId) {
      const lesson = await this.repositories.lessons.get(lessonId);
      if (!lesson) throw new Error('Navázaná hodina nebyla nalezena.');
      groupInstanceId ||= lesson.groupInstanceId;
    }
    if (groupInstanceId && !(await this.repositories.groupInstances.get(groupInstanceId))) throw new Error('Vybraná skupina nebyla nalezena.');
    const triggerType = VALID_TRIGGERS.has(input.triggerType) ? input.triggerType : 'no_date';
    const triggerDate = triggerType === 'date' ? optionalDate(input.triggerDate, 'Datum připomínky') : '';
    if (triggerType === 'date' && !triggerDate) throw new Error('Pro připomínku s datem vyberte konkrétní datum.');
    const priority = VALID_PRIORITIES.has(input.priority) ? input.priority : 'normal';
    const status = VALID_REMINDER_STATUSES.has(input.status) ? input.status : 'active';
    const created = await this.repositories.reminders.create({
      title: required(input.title, 'Text připomínky'),
      note: normalizeText(input.note),
      triggerType,
      triggerDate,
      groupInstanceId: groupInstanceId || null,
      lessonId: lessonId || null,
      studentId: String(input.studentId || '').trim() || null,
      priority,
      status,
      recurrence: normalizeText(input.recurrence),
      snoozedUntil: optionalDate(input.snoozedUntil, 'Datum odložení'),
      completedAt: status === 'completed' ? new Date().toISOString() : null,
      carriedCount: Number(input.carriedCount) || 0,
    });
    await this.audit('reminder-created', 'reminder', created.id, { groupInstanceId, lessonId, triggerType, priority });
    return created;
  }

  async updateReminder(id, input) {
    const current = await this.repositories.reminders.get(id);
    if (!current) throw new Error('Připomínka nebyla nalezena.');
    const triggerType = input.triggerType !== undefined && VALID_TRIGGERS.has(input.triggerType) ? input.triggerType : current.triggerType;
    const triggerDate = input.triggerDate !== undefined
      ? (triggerType === 'date' ? optionalDate(input.triggerDate, 'Datum připomínky') : '')
      : current.triggerDate;
    if (triggerType === 'date' && !triggerDate) throw new Error('Pro připomínku s datem vyberte konkrétní datum.');
    const status = input.status !== undefined && VALID_REMINDER_STATUSES.has(input.status) ? input.status : current.status;
    const priority = input.priority !== undefined && VALID_PRIORITIES.has(input.priority) ? input.priority : current.priority;
    const updated = await this.repositories.reminders.update(id, {
      title: input.title !== undefined ? required(input.title, 'Text připomínky') : current.title,
      note: input.note !== undefined ? normalizeText(input.note) : current.note,
      triggerType,
      triggerDate,
      groupInstanceId: input.groupInstanceId !== undefined ? (String(input.groupInstanceId || '').trim() || null) : current.groupInstanceId,
      lessonId: input.lessonId !== undefined ? (String(input.lessonId || '').trim() || null) : current.lessonId,
      studentId: input.studentId !== undefined ? (String(input.studentId || '').trim() || null) : current.studentId,
      priority,
      status,
      recurrence: input.recurrence !== undefined ? normalizeText(input.recurrence) : current.recurrence,
      snoozedUntil: input.snoozedUntil !== undefined ? optionalDate(input.snoozedUntil, 'Datum odložení') : current.snoozedUntil,
      completedAt: status === 'completed' ? (current.completedAt || new Date().toISOString()) : null,
      carriedCount: input.carriedCount !== undefined ? Number(input.carriedCount) || 0 : current.carriedCount,
    });
    await this.audit('reminder-updated', 'reminder', id, { status, triggerType, priority });
    return updated;
  }

  async completeReminder(id) {
    const updated = await this.updateReminder(id, { status: 'completed', snoozedUntil: '' });
    await this.audit('reminder-completed', 'reminder', id);
    return updated;
  }

  async snoozeReminder(id, until) {
    const date = optionalDate(until, 'Datum odložení');
    if (!date) throw new Error('Vyberte datum, do kdy se má připomínka odložit.');
    const updated = await this.updateReminder(id, { status: 'snoozed', snoozedUntil: date });
    await this.audit('reminder-snoozed', 'reminder', id, { until: date });
    return updated;
  }

  async carryReminder(id) {
    const current = await this.repositories.reminders.get(id);
    if (!current) throw new Error('Připomínka nebyla nalezena.');
    const updated = await this.updateReminder(id, {
      status: 'carried',
      triggerType: 'next_lesson',
      triggerDate: '',
      snoozedUntil: '',
      carriedCount: (Number(current.carriedCount) || 0) + 1,
    });
    await this.audit('reminder-carried-to-next-lesson', 'reminder', id, { carriedCount: updated.carriedCount });
    return updated;
  }

  async cancelReminder(id) {
    const updated = await this.updateReminder(id, { status: 'cancelled' });
    await this.audit('reminder-cancelled', 'reminder', id);
    return updated;
  }

  async listTags({ category = '', includeArchived = false } = {}) {
    return (await this.repositories.tags.list())
      .filter((tag) => includeArchived || tag.status !== 'archived')
      .filter((tag) => !category || tag.category === category)
      .sort((a, b) => a.category.localeCompare(b.category, 'cs') || a.name.localeCompare(b.name, 'cs'));
  }

  async createTag(input) {
    const name = required(input.name, 'Název štítku');
    const category = VALID_TAG_CATEGORIES.has(input.category) ? input.category : 'custom';
    const existing = (await this.repositories.tags.list()).find((tag) => lower(tag.name) === lower(name) && tag.status !== 'archived');
    if (existing) return existing;
    const created = await this.repositories.tags.create({
      name,
      category,
      colorToken: String(input.colorToken || 'teal').trim() || 'teal',
      status: 'active',
    });
    await this.audit('tag-created', 'tag', created.id, { category });
    return created;
  }

  async archiveTag(id) {
    const current = await this.repositories.tags.get(id);
    if (!current) throw new Error('Štítek nebyl nalezen.');
    const updated = await this.repositories.tags.update(id, { status: 'archived' });
    await this.audit('tag-archived', 'tag', id);
    return updated;
  }

  async tagsForEntity(entityType, entityId) {
    const [links, tags] = await Promise.all([this.repositories.entityTags.list(), this.repositories.tags.list()]);
    const ids = new Set(links.filter((link) => link.entityType === entityType && link.entityId === entityId).map((link) => link.tagId));
    return tags.filter((tag) => ids.has(tag.id) && tag.status !== 'archived');
  }

  async setEntityTags(entityType, entityId, tagIds = []) {
    const selected = new Set(tagIds.filter(Boolean));
    const links = (await this.repositories.entityTags.list()).filter((link) => link.entityType === entityType && link.entityId === entityId);
    for (const link of links) {
      if (!selected.has(link.tagId)) await this.repositories.entityTags.remove(link.id);
    }
    const existing = new Set(links.map((link) => link.tagId));
    for (const tagId of selected) {
      if (!(await this.repositories.tags.get(tagId))) continue;
      if (!existing.has(tagId)) await this.repositories.entityTags.create({ tagId, entityType, entityId });
    }
    await this.audit('entity-tags-updated', entityType, entityId, { count: selected.size });
    return this.tagsForEntity(entityType, entityId);
  }

  async createTagsFromText(text, category = 'custom') {
    const names = [...new Set(String(text || '').split(',').map((item) => normalizeText(item)).filter(Boolean))];
    const tags = [];
    for (const name of names) tags.push(await this.createTag({ name, category }));
    return tags;
  }

  async groupSummary(groupInstanceId) {
    const [tasks, reminders] = await Promise.all([
      this.listTasks({ groupInstanceId, includeClosed: false }),
      this.listReminders({ groupInstanceId, includeClosed: false }),
    ]);
    return {
      tasks,
      reminders,
      openTaskCount: tasks.filter((item) => item.status === 'open').length,
      overdueTaskCount: tasks.filter((item) => item.dueDate && item.dueDate < todayIso()).length,
      activeReminderCount: reminders.filter((item) => ['active', 'carried'].includes(item.status)).length,
    };
  }

  async dashboard({ date = todayIso(), schoolYearId = '' } = {}) {
    const [tasks, reminders] = await Promise.all([
      this.listTasks({ includeClosed: false }),
      this.listReminders({ includeClosed: false }),
    ]);
    const inYear = (item) => !schoolYearId || item.group?.schoolYearId === schoolYearId;
    const visibleTasks = tasks.filter(inYear);
    const visibleReminders = reminders.filter(inYear);
    const dueTasks = visibleTasks.filter((item) => item.status !== 'postponed' || !item.postponedUntil || item.postponedUntil <= date);
    const dueReminders = visibleReminders.filter((item) => {
      if (item.status === 'snoozed' && item.snoozedUntil > date) return false;
      if (item.triggerType === 'date') return item.triggerDate <= date;
      return ['next_lesson', 'no_date'].includes(item.triggerType);
    });
    return {
      tasks: dueTasks.slice(0, 8),
      reminders: dueReminders.slice(0, 8),
      openTaskCount: visibleTasks.filter((item) => ['open', 'postponed'].includes(item.status)).length,
      overdueTaskCount: visibleTasks.filter((item) => item.dueDate && item.dueDate < date && item.status !== 'completed').length,
      activeReminderCount: visibleReminders.filter((item) => !['completed', 'cancelled'].includes(item.status)).length,
      urgentCount: [...visibleTasks, ...visibleReminders].filter((item) => item.priority === 'urgent').length,
    };
  }
}

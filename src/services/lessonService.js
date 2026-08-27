import { normalizeText } from '../core/html.js';
import { recordAnonymousOutput } from '../core/telemetry.js';

export const LESSON_STATUSES = Object.freeze({
  draft: { label: 'Koncept', variant: 'neutral' },
  planned: { label: 'Naplánovaná', variant: 'info' },
  in_progress: { label: 'Probíhá', variant: 'warning' },
  completed: { label: 'Uskutečněná', variant: 'success' },
  unfinished: { label: 'Nedokončená', variant: 'warning' },
  cancelled: { label: 'Zrušená', variant: 'neutral' },
  substituted: { label: 'Suplovaná', variant: 'info' },
});


export const SUCCESS_RATINGS = Object.freeze({
  excellent: { label: 'Velmi povedená', variant: 'success' },
  good: { label: 'Povedená', variant: 'success' },
  partial: { label: 'Částečně povedená', variant: 'warning' },
  problematic: { label: 'Problematická', variant: 'danger' },
  failed: { label: 'Nepovedená', variant: 'danger' },
});

export const REUSE_DECISIONS = Object.freeze({
  favorite: 'Oblíbená aktivita',
  reuse: 'Použít znovu',
  adjust: 'Nutno upravit',
  unsuitable: 'Nevhodné pro tuto skupinu',
  excellent_material: 'Výborný materiál',
  too_difficult: 'Příliš obtížné',
  time_consuming: 'Časově náročné',
});

export const SKILL_TYPES = Object.freeze({
  listening: 'Poslech',
  speaking: 'Mluvení',
  reading: 'Čtení',
  writing: 'Psaní',
  grammar: 'Gramatika',
  vocabulary: 'Slovní zásoba',
  mixed: 'Kombinované',
  other: 'Jiné',
});

export const ACTIVITY_TYPES = Object.freeze({
  explanation: 'Výklad',
  practice: 'Procvičování',
  discussion: 'Diskuse',
  pair_work: 'Práce ve dvojicích',
  group_work: 'Skupinová práce',
  listening: 'Poslechová aktivita',
  reading: 'Práce s textem',
  writing: 'Písemná aktivita',
  test: 'Test nebo ověřování',
  project: 'Projekt',
  game: 'Hra',
  other: 'Jiné',
});

const VALID_STATUSES = new Set(Object.keys(LESSON_STATUSES));
const COMPLETED_STATUSES = new Set(['completed', 'unfinished', 'substituted']);
const UPCOMING_STATUSES = new Set(['draft', 'planned', 'in_progress']);

function required(value, label) {
  const normalized = normalizeText(value);
  if (!normalized) throw new Error(`${label} je povinné.`);
  return normalized;
}

function normalizeDate(value, label = 'Datum hodiny') {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${label} je povinné.`);
  return text;
}

function normalizeStatus(value, fallback = 'planned') {
  return VALID_STATUSES.has(value) ? value : fallback;
}

function compareLessonsAsc(a, b) {
  return `${a.date || ''}T${a.startTime || '00:00'}`.localeCompare(`${b.date || ''}T${b.startTime || '00:00'}`);
}

function compareLessonsDesc(a, b) {
  return compareLessonsAsc(b, a);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function lessonTitle(input, fallbackDate = todayIso()) {
  return normalizeText(input.title || input.topic) || `Hodina ${new Date(`${fallbackDate}T12:00:00`).toLocaleDateString('cs-CZ')}`;
}

export class LessonService {
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

  async listLessons({
    groupInstanceId = '',
    schoolYearId = '',
    statuses = [],
    dateFrom = '',
    dateTo = '',
    query = '',
    sort = 'asc',
  } = {}) {
    const [lessons, groups, subjects, years] = await Promise.all([
      this.repositories.lessons.list(),
      this.repositories.groupInstances.list(),
      this.repositories.subjects.list(),
      this.repositories.schoolYears.list(),
    ]);
    const groupMap = new Map(groups.map((item) => [item.id, item]));
    const subjectMap = new Map(subjects.map((item) => [item.id, item]));
    const yearMap = new Map(years.map((item) => [item.id, item]));
    const statusSet = new Set(Array.isArray(statuses) ? statuses.filter(Boolean) : [statuses].filter(Boolean));
    const needle = normalizeText(query).toLocaleLowerCase('cs');

    return lessons
      .filter((lesson) => !groupInstanceId || lesson.groupInstanceId === groupInstanceId)
      .filter((lesson) => !schoolYearId || lesson.schoolYearId === schoolYearId)
      .filter((lesson) => !statusSet.size || statusSet.has(lesson.status))
      .filter((lesson) => !dateFrom || lesson.date >= dateFrom)
      .filter((lesson) => !dateTo || lesson.date <= dateTo)
      .map((lesson) => {
        const group = groupMap.get(lesson.groupInstanceId) ?? null;
        return {
          ...lesson,
          group,
          subject: group ? subjectMap.get(group.subjectId) ?? null : null,
          year: yearMap.get(lesson.schoolYearId) ?? null,
        };
      })
      .filter((lesson) => !needle || [
        lesson.title,
        lesson.topic,
        lesson.objectives,
        lesson.plannedOutline,
        lesson.actualProgress,
        lesson.endedAtText,
        lesson.homework,
        lesson.group?.displayName,
        lesson.subject?.name,
      ].some((value) => String(value || '').toLocaleLowerCase('cs').includes(needle)))
      .sort(sort === 'desc' ? compareLessonsDesc : compareLessonsAsc);
  }

  async getLesson(id) {
    const lesson = await this.repositories.lessons.get(id);
    if (!lesson) return null;
    const [group, notes] = await Promise.all([
      this.repositories.groupInstances.get(lesson.groupInstanceId),
      this.repositories.quickNotes.list(),
    ]);
    if (!group) return { lesson, group: null, subject: null, year: null, notes: [] };
    const [subject, year] = await Promise.all([
      this.repositories.subjects.get(group.subjectId),
      this.repositories.schoolYears.get(lesson.schoolYearId),
    ]);
    return {
      lesson,
      group,
      subject,
      year,
      notes: notes.filter((item) => item.lessonId === id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    };
  }

  async nextSequenceNumber(groupInstanceId) {
    const lessons = await this.listLessons({ groupInstanceId });
    return lessons.reduce((maximum, lesson) => Math.max(maximum, Number(lesson.sequenceNumber) || 0), 0) + 1;
  }

  async createLesson(input) {
    const group = await this.repositories.groupInstances.get(input.groupInstanceId);
    if (!group) throw new Error('Vyberte platnou skupinu.');
    if (group.status === 'archived') throw new Error('Do archivované skupiny nelze přidat novou hodinu.');
    const date = normalizeDate(input.date);
    const status = normalizeStatus(input.status, 'planned');
    const created = await this.repositories.lessons.create({
      groupInstanceId: group.id,
      schoolYearId: group.schoolYearId,
      date,
      startTime: String(input.startTime || '').trim(),
      sequenceNumber: Number(input.sequenceNumber) || await this.nextSequenceNumber(group.id),
      status,
      title: lessonTitle(input, date),
      topic: normalizeText(input.topic),
      objectives: normalizeText(input.objectives),
      plannedOutline: normalizeText(input.plannedOutline),
      actualProgress: normalizeText(input.actualProgress),
      completedText: normalizeText(input.completedText),
      unfinishedText: normalizeText(input.unfinishedText),
      endedAtText: normalizeText(input.endedAtText),
      homework: normalizeText(input.homework),
      nextLessonNote: normalizeText(input.nextLessonNote),
      reflection: normalizeText(input.reflection),
      reflectionWorked: normalizeText(input.reflectionWorked),
      reflectionImprove: normalizeText(input.reflectionImprove),
      successRating: SUCCESS_RATINGS[input.successRating] ? input.successRating : '',
      reuseDecision: REUSE_DECISIONS[input.reuseDecision] ? input.reuseDecision : '',
      activityType: ACTIVITY_TYPES[input.activityType] ? input.activityType : '',
      skillType: SKILL_TYPES[input.skillType] ? input.skillType : '',
      level: normalizeText(input.level),
      plannedDuration: Number(input.plannedDuration) || 45,
      actualDuration: Number(input.actualDuration) || null,
      completedAt: COMPLETED_STATUSES.has(status) ? new Date().toISOString() : null,
      sourceTemplateId: input.sourceTemplateId || null,
      substitutionSourceId: input.substitutionSourceId || null,
    });
    await this.audit('lesson-created', 'lesson', created.id, { groupInstanceId: group.id, status, date });
    recordAnonymousOutput(COMPLETED_STATUSES.has(status) ? 'lesson-record' : 'lesson-plan');
    return created;
  }

  async updateLesson(id, input, { audit = true } = {}) {
    const current = await this.repositories.lessons.get(id);
    if (!current) throw new Error('Hodina nebyla nalezena.');
    const groupId = input.groupInstanceId ?? current.groupInstanceId;
    const group = await this.repositories.groupInstances.get(groupId);
    if (!group) throw new Error('Vyberte platnou skupinu.');
    const date = input.date !== undefined ? normalizeDate(input.date) : current.date;
    const status = normalizeStatus(input.status ?? current.status, current.status);
    const updated = await this.repositories.lessons.update(id, {
      groupInstanceId: group.id,
      schoolYearId: group.schoolYearId,
      date,
      startTime: input.startTime !== undefined ? String(input.startTime || '').trim() : current.startTime,
      sequenceNumber: input.sequenceNumber !== undefined ? Number(input.sequenceNumber) || current.sequenceNumber : current.sequenceNumber,
      status,
      title: input.title !== undefined || input.topic !== undefined ? lessonTitle({ title: input.title ?? current.title, topic: input.topic ?? current.topic }, date) : current.title,
      topic: input.topic !== undefined ? normalizeText(input.topic) : current.topic,
      objectives: input.objectives !== undefined ? normalizeText(input.objectives) : current.objectives,
      plannedOutline: input.plannedOutline !== undefined ? normalizeText(input.plannedOutline) : current.plannedOutline,
      actualProgress: input.actualProgress !== undefined ? normalizeText(input.actualProgress) : current.actualProgress,
      completedText: input.completedText !== undefined ? normalizeText(input.completedText) : current.completedText,
      unfinishedText: input.unfinishedText !== undefined ? normalizeText(input.unfinishedText) : current.unfinishedText,
      endedAtText: input.endedAtText !== undefined ? normalizeText(input.endedAtText) : current.endedAtText,
      homework: input.homework !== undefined ? normalizeText(input.homework) : current.homework,
      nextLessonNote: input.nextLessonNote !== undefined ? normalizeText(input.nextLessonNote) : current.nextLessonNote,
      reflection: input.reflection !== undefined ? normalizeText(input.reflection) : current.reflection,
      reflectionWorked: input.reflectionWorked !== undefined ? normalizeText(input.reflectionWorked) : current.reflectionWorked,
      reflectionImprove: input.reflectionImprove !== undefined ? normalizeText(input.reflectionImprove) : current.reflectionImprove,
      successRating: input.successRating !== undefined ? (SUCCESS_RATINGS[input.successRating] ? input.successRating : '') : current.successRating,
      reuseDecision: input.reuseDecision !== undefined ? (REUSE_DECISIONS[input.reuseDecision] ? input.reuseDecision : '') : current.reuseDecision,
      activityType: input.activityType !== undefined ? (ACTIVITY_TYPES[input.activityType] ? input.activityType : '') : current.activityType,
      skillType: input.skillType !== undefined ? (SKILL_TYPES[input.skillType] ? input.skillType : '') : current.skillType,
      level: input.level !== undefined ? normalizeText(input.level) : current.level,
      plannedDuration: input.plannedDuration !== undefined ? Number(input.plannedDuration) || 45 : current.plannedDuration,
      actualDuration: input.actualDuration !== undefined ? Number(input.actualDuration) || null : current.actualDuration,
      completedAt: COMPLETED_STATUSES.has(status) ? (current.completedAt || new Date().toISOString()) : null,
    });
    if (audit) await this.audit('lesson-updated', 'lesson', id, { status, date, groupInstanceId: group.id });
    if (!COMPLETED_STATUSES.has(current.status) && COMPLETED_STATUSES.has(status)) recordAnonymousOutput('lesson-record');
    return updated;
  }

  async startLesson(id) {
    const lesson = await this.repositories.lessons.get(id);
    if (!lesson) throw new Error('Hodina nebyla nalezena.');
    if (['completed', 'cancelled', 'substituted'].includes(lesson.status)) throw new Error('Tuto hodinu již nelze spustit.');
    const updated = await this.updateLesson(id, { status: 'in_progress' }, { audit: false });
    await this.audit('lesson-started', 'lesson', id, { date: lesson.date });
    return updated;
  }

  async completeLesson(id, { unfinished = false, patch = {} } = {}) {
    const lesson = await this.repositories.lessons.get(id);
    if (!lesson) throw new Error('Hodina nebyla nalezena.');
    const nextStatus = unfinished ? 'unfinished' : 'completed';
    const updated = await this.updateLesson(id, { ...patch, status: nextStatus }, { audit: false });
    await this.audit(unfinished ? 'lesson-marked-unfinished' : 'lesson-completed', 'lesson', id, { date: lesson.date });
    return updated;
  }

  async cancelLesson(id) {
    const lesson = await this.repositories.lessons.get(id);
    if (!lesson) throw new Error('Hodina nebyla nalezena.');
    const updated = await this.updateLesson(id, { status: 'cancelled' }, { audit: false });
    await this.audit('lesson-cancelled', 'lesson', id, { date: lesson.date });
    return updated;
  }

  async removeLesson(id) {
    const lesson = await this.repositories.lessons.get(id);
    if (!lesson) throw new Error('Hodina nebyla nalezena.');
    const [notes, tasks, reminders, links] = await Promise.all([
      this.repositories.quickNotes.list(),
      this.repositories.tasks.list(),
      this.repositories.reminders.list(),
      this.repositories.materialLinks.list(),
    ]);
    const hasDependencies = notes.some((item) => item.lessonId === id)
      || tasks.some((item) => item.lessonId === id)
      || reminders.some((item) => item.lessonId === id)
      || links.some((item) => item.entityType === 'lesson' && item.entityId === id);
    if (hasDependencies) throw new Error('Hodinu nelze smazat, protože obsahuje navazující záznamy. Použijte stav Zrušená.');
    await this.repositories.lessons.remove(id);
    await this.audit('lesson-deleted', 'lesson', id, { date: lesson.date });
  }

  async createQuickLesson(groupInstanceId, date = todayIso()) {
    const created = await this.createLesson({
      groupInstanceId,
      date,
      status: 'in_progress',
      title: `Rychlý záznam · ${new Date(`${date}T12:00:00`).toLocaleDateString('cs-CZ')}`,
    });
    await this.audit('lesson-quick-started', 'lesson', created.id, { groupInstanceId, date });
    return created;
  }

  async addQuickNote({ lessonId, groupInstanceId, type = 'general', text }) {
    const normalized = required(text, 'Text poznámky');
    const note = await this.repositories.quickNotes.create({
      lessonId: lessonId || null,
      groupInstanceId: groupInstanceId || null,
      type,
      text: normalized,
      resolvedAt: null,
    });
    await this.audit('quick-note-created', 'quickNote', note.id, { lessonId, groupInstanceId, type });
    return note;
  }

  async groupContinuity(groupInstanceId) {
    const lessons = await this.listLessons({ groupInstanceId, sort: 'desc' });
    const completed = lessons.filter((lesson) => COMPLETED_STATUSES.has(lesson.status));
    const upcoming = lessons.filter((lesson) => UPCOMING_STATUSES.has(lesson.status) && lesson.date >= todayIso()).sort(compareLessonsAsc);
    return {
      lessons,
      lastLesson: completed[0] ?? null,
      nextLesson: upcoming[0] ?? null,
      inProgress: lessons.find((lesson) => lesson.status === 'in_progress') ?? null,
      completedCount: completed.length,
      plannedCount: lessons.filter((lesson) => ['draft', 'planned', 'in_progress'].includes(lesson.status)).length,
      unfinishedCount: lessons.filter((lesson) => lesson.status === 'unfinished').length,
    };
  }

  async dashboard({ schoolYearId = '', date = todayIso() } = {}) {
    const lessons = await this.listLessons({ schoolYearId, sort: 'asc' });
    const today = lessons.filter((lesson) => lesson.date === date && lesson.status !== 'cancelled');
    const attention = lessons
      .filter((lesson) => lesson.status === 'in_progress' || lesson.status === 'unfinished' || (lesson.status === 'draft' && lesson.date <= date))
      .sort(compareLessonsAsc);
    const upcoming = lessons
      .filter((lesson) => lesson.date >= date && ['draft', 'planned'].includes(lesson.status))
      .sort(compareLessonsAsc)
      .slice(0, 8);
    const recent = lessons.filter((lesson) => COMPLETED_STATUSES.has(lesson.status)).sort(compareLessonsDesc).slice(0, 8);
    return { today, attention, upcoming, recent };
  }
}

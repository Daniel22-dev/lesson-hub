const normalize = (value) => String(value ?? '').trim().toLocaleLowerCase('cs-CZ').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const contains = (value, needle) => normalize(value).includes(needle);

function dateInRange(date, from, to) {
  if (!date) return !from && !to;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

function scoreValues(values, needle) {
  if (!needle) return 1;
  let score = 0;
  for (const value of values.filter(Boolean)) {
    const normalized = normalize(value);
    if (normalized === needle) score += 8;
    else if (normalized.startsWith(needle)) score += 5;
    else if (normalized.includes(needle)) score += 2;
  }
  return score;
}

export const SEARCH_TYPES = Object.freeze({
  lesson: 'Hodiny',
  material: 'Materiály',
  task: 'Úkoly',
  reminder: 'Připomínky',
  group: 'Skupiny',
});

export class SearchService {
  constructor(repositories, materialService) {
    this.repositories = repositories;
    this.materialService = materialService;
  }

  async search(filters = {}) {
    const needle = normalize(filters.query);
    const [groups, years, subjects, lessons, tasks, reminders, tags, entityTags, materials] = await Promise.all([
      this.repositories.groupInstances.list(),
      this.repositories.schoolYears.list(),
      this.repositories.subjects.list(),
      this.repositories.lessons.list(),
      this.repositories.tasks.list(),
      this.repositories.reminders.list(),
      this.repositories.tags.list(),
      this.repositories.entityTags.list(),
      this.materialService.listMaterials({ status: filters.includeArchived ? '' : 'active' }),
    ]);
    const groupMap = new Map(groups.map((group) => [group.id, group]));
    const yearMap = new Map(years.map((year) => [year.id, year]));
    const subjectMap = new Map(subjects.map((subject) => [subject.id, subject]));
    const tagMap = new Map(tags.map((tag) => [tag.id, tag]));
    const tagsFor = (entityType, entityId) => entityTags.filter((link) => link.entityType === entityType && link.entityId === entityId).map((link) => tagMap.get(link.tagId)).filter(Boolean);
    const groupContext = (groupId) => {
      const group = groupMap.get(groupId);
      return { group, year: group ? yearMap.get(group.schoolYearId) : null, subject: group ? subjectMap.get(group.subjectId) : null };
    };
    const passesGroupFilters = ({ group, year, subject }) => {
      if (filters.schoolYearId && year?.id !== filters.schoolYearId) return false;
      if (filters.groupId && group?.id !== filters.groupId) return false;
      if (filters.subjectId && subject?.id !== filters.subjectId) return false;
      return true;
    };
    const requestedType = !filters.type || filters.type === 'all' ? '' : filters.type;
    const typeAllowed = () => true;
    const results = [];

    if (typeAllowed('lesson')) for (const lesson of lessons) {
      const context = groupContext(lesson.groupInstanceId);
      const lessonTags = tagsFor('lesson', lesson.id);
      if (!passesGroupFilters(context)) continue;
      if (!dateInRange(lesson.date, filters.dateFrom, filters.dateTo)) continue;
      if (filters.status && lesson.status !== filters.status) continue;
      if (filters.successRating && lesson.successRating !== filters.successRating) continue;
      if (filters.activityType && lesson.activityType !== filters.activityType) continue;
      if (filters.skillType && lesson.skillType !== filters.skillType) continue;
      const values = [lesson.title, lesson.topic, lesson.objectives, lesson.plannedOutline, lesson.actualProgress, lesson.completedText, lesson.unfinishedText, lesson.endedAtText, lesson.homework, lesson.nextLessonNote, lesson.reflection, lesson.reflectionWorked, lesson.reflectionImprove, context.group?.displayName, context.subject?.name, ...lessonTags.map((tag) => tag.name)];
      const score = scoreValues(values, needle);
      if (needle && !score) continue;
      results.push({ type: 'lesson', id: lesson.id, score, date: lesson.date, title: lesson.title, subtitle: `${context.group?.displayName || 'Neznámá skupina'} · ${context.subject?.name || ''}`, excerpt: lesson.topic || lesson.actualProgress || lesson.plannedOutline || 'Bez dalšího popisu.', href: `#/plan/${lesson.id}`, status: lesson.status, group: context.group, year: context.year, subject: context.subject, tags: lessonTags });
    }

    if (typeAllowed('material')) for (const material of materials) {
      if (filters.materialType && material.materialType !== filters.materialType) continue;
      const relatedGroups = material.links.map((link) => link.entityType === 'group' ? link.entity : link.group).filter(Boolean);
      if (filters.groupId && !relatedGroups.some((group) => group.id === filters.groupId)) continue;
      if (filters.schoolYearId && !relatedGroups.some((group) => group.schoolYearId === filters.schoolYearId)) continue;
      if (filters.subjectId && !relatedGroups.some((group) => group.subjectId === filters.subjectId)) continue;
      const values = [material.title, material.description, material.teacherNote, material.url, material.fileName, ...material.tags.map((tag) => tag.name), ...material.links.map((link) => link.label)];
      const score = scoreValues(values, needle);
      if (needle && !score) continue;
      results.push({ type: 'material', id: material.id, score, date: (material.updatedAt || '').slice(0, 10), title: material.title, subtitle: material.links.length ? material.links.map((link) => link.label).slice(0, 2).join(' · ') : 'Nepřiřazený materiál', excerpt: material.description || material.teacherNote || material.url || 'Bez dalšího popisu.', href: `#/materials/${material.id}`, status: material.materialType, tags: material.tags });
    }

    if (typeAllowed('task')) for (const task of tasks) {
      const context = groupContext(task.groupInstanceId);
      if (!passesGroupFilters(context)) continue;
      if (filters.status && task.status !== filters.status) continue;
      if (!dateInRange(task.dueDate, filters.dateFrom, filters.dateTo)) continue;
      const score = scoreValues([task.title, task.description, task.type, context.group?.displayName, context.subject?.name], needle);
      if (needle && !score) continue;
      results.push({ type: 'task', id: task.id, score, date: task.dueDate || (task.createdAt || '').slice(0, 10), title: task.title, subtitle: `${context.group?.displayName || 'Bez skupiny'} · úkol`, excerpt: task.description || 'Bez poznámky.', href: `#/work?tab=tasks&q=${encodeURIComponent(task.title)}`, status: task.status, group: context.group, year: context.year, subject: context.subject, tags: [] });
    }

    if (typeAllowed('reminder')) for (const reminder of reminders) {
      const context = groupContext(reminder.groupInstanceId);
      if (!passesGroupFilters(context)) continue;
      if (filters.status && reminder.status !== filters.status) continue;
      if (!dateInRange(reminder.triggerDate, filters.dateFrom, filters.dateTo)) continue;
      const score = scoreValues([reminder.title, reminder.note, reminder.triggerType, context.group?.displayName, context.subject?.name], needle);
      if (needle && !score) continue;
      results.push({ type: 'reminder', id: reminder.id, score, date: reminder.triggerDate || (reminder.createdAt || '').slice(0, 10), title: reminder.title, subtitle: `${context.group?.displayName || 'Bez skupiny'} · připomínka`, excerpt: reminder.note || 'Bez poznámky.', href: `#/work?tab=reminders&q=${encodeURIComponent(reminder.title)}`, status: reminder.status, group: context.group, year: context.year, subject: context.subject, tags: [] });
    }

    if (typeAllowed('group')) for (const group of groups) {
      const context = groupContext(group.id);
      if (!passesGroupFilters(context)) continue;
      if (filters.status && group.status !== filters.status) continue;
      const score = scoreValues([group.displayName, group.grade, group.note, context.subject?.name, context.year?.label], needle);
      if (needle && !score) continue;
      results.push({ type: 'group', id: group.id, score, date: (group.updatedAt || '').slice(0, 10), title: group.displayName, subtitle: `${context.subject?.name || 'Bez předmětu'} · ${context.year?.label || ''}`, excerpt: group.note || group.grade || 'Bez poznámky.', href: `#/groups/${group.id}`, status: group.status, group, year: context.year, subject: context.subject, tags: [] });
    }

    results.sort((a, b) => b.score - a.score || (b.date || '').localeCompare(a.date || '') || a.title.localeCompare(b.title, 'cs'));
    const counts = Object.fromEntries(Object.keys(SEARCH_TYPES).map((type) => [type, results.filter((item) => item.type === type).length]));
    const visibleResults = requestedType ? results.filter((item) => item.type === requestedType) : results;
    return { results: visibleResults, counts, total: visibleResults.length, overallTotal: results.length };
  }
}

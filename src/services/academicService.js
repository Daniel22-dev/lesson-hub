import { normalizeText } from '../core/html.js';

const GROUP_STATUSES = new Set(['active', 'hidden', 'archived']);
const YEAR_STATUSES = new Set(['active', 'archived']);
const SUBJECT_STATUSES = new Set(['active', 'archived']);
const COLOR_TOKENS = new Set(['teal', 'blue', 'violet', 'amber', 'rose', 'slate']);

function required(value, label) {
  const normalized = normalizeText(value);
  if (!normalized) throw new Error(`${label} je povinné.`);
  return normalized;
}

function status(value, allowed, fallback) {
  return allowed.has(value) ? value : fallback;
}

function compareYears(a, b) {
  return String(b.startDate || b.label).localeCompare(String(a.startDate || a.label), 'cs');
}

function compareNames(a, b) {
  return String(a.displayName || a.name || '').localeCompare(String(b.displayName || b.name || ''), 'cs', { numeric: true });
}

export class AcademicService {
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

  async snapshot() {
    const [years, subjects, groupInstances] = await Promise.all([
      this.listSchoolYears(),
      this.listSubjects({ includeArchived: true }),
      this.repositories.groupInstances.list(),
    ]);
    const currentYear = years.find((year) => year.isCurrent) ?? years.find((year) => year.status === 'active') ?? null;
    return {
      years,
      subjects,
      currentYear,
      activeGroupCount: groupInstances.filter((group) => group.status === 'active' && (!currentYear || group.schoolYearId === currentYear.id)).length,
      hiddenGroupCount: groupInstances.filter((group) => group.status === 'hidden' && (!currentYear || group.schoolYearId === currentYear.id)).length,
      archivedGroupCount: groupInstances.filter((group) => group.status === 'archived').length,
    };
  }

  async listSchoolYears() {
    return (await this.repositories.schoolYears.list()).sort(compareYears);
  }

  async createSchoolYear(input) {
    const label = required(input.label, 'Označení školního roku');
    const years = await this.listSchoolYears();
    if (years.some((year) => year.label.toLocaleLowerCase('cs') === label.toLocaleLowerCase('cs'))) {
      throw new Error(`Školní rok ${label} již existuje.`);
    }
    const isCurrent = Boolean(input.isCurrent || !years.some((year) => year.isCurrent));
    if (isCurrent) await this.#unsetCurrentYears();
    const created = await this.repositories.schoolYears.create({
      label,
      startDate: input.startDate || '',
      endDate: input.endDate || '',
      status: isCurrent ? 'active' : status(input.status, YEAR_STATUSES, 'active'),
      isCurrent,
    });
    await this.audit('school-year-created', 'schoolYear', created.id, { label });
    return created;
  }

  async updateSchoolYear(id, input) {
    const current = await this.repositories.schoolYears.get(id);
    if (!current) throw new Error('Školní rok nebyl nalezen.');
    const label = required(input.label ?? current.label, 'Označení školního roku');
    const years = await this.listSchoolYears();
    if (years.some((year) => year.id !== id && year.label.toLocaleLowerCase('cs') === label.toLocaleLowerCase('cs'))) {
      throw new Error(`Školní rok ${label} již existuje.`);
    }
    const isCurrent = input.isCurrent ?? current.isCurrent;
    if (isCurrent) await this.#unsetCurrentYears(id);
    const updated = await this.repositories.schoolYears.update(id, {
      label,
      startDate: input.startDate ?? current.startDate,
      endDate: input.endDate ?? current.endDate,
      status: isCurrent ? 'active' : status(input.status ?? current.status, YEAR_STATUSES, 'active'),
      isCurrent: Boolean(isCurrent),
    });
    await this.audit('school-year-updated', 'schoolYear', id, { label });
    return updated;
  }

  async setCurrentSchoolYear(id) {
    const year = await this.repositories.schoolYears.get(id);
    if (!year) throw new Error('Školní rok nebyl nalezen.');
    await this.#unsetCurrentYears(id);
    const updated = await this.repositories.schoolYears.update(id, { isCurrent: true, status: 'active' });
    await this.audit('school-year-current', 'schoolYear', id, { label: year.label });
    return updated;
  }

  async archiveSchoolYear(id) {
    const year = await this.repositories.schoolYears.get(id);
    if (!year) throw new Error('Školní rok nebyl nalezen.');
    if (year.isCurrent) throw new Error('Aktuální školní rok nelze archivovat. Nejprve nastavte jiný jako aktuální.');
    const updated = await this.repositories.schoolYears.update(id, { status: 'archived', isCurrent: false });
    await this.audit('school-year-archived', 'schoolYear', id, { label: year.label });
    return updated;
  }

  async #unsetCurrentYears(exceptId = '') {
    const years = await this.repositories.schoolYears.list();
    await Promise.all(years.filter((year) => year.isCurrent && year.id !== exceptId).map((year) => this.repositories.schoolYears.update(year.id, { isCurrent: false })));
  }

  async listSubjects({ includeArchived = false } = {}) {
    const subjects = await this.repositories.subjects.list();
    return subjects.filter((subject) => includeArchived || subject.status !== 'archived').sort((a, b) => String(a.name).localeCompare(String(b.name), 'cs'));
  }

  async createSubject(input) {
    const name = required(input.name, 'Název předmětu');
    const subjects = await this.listSubjects({ includeArchived: true });
    if (subjects.some((subject) => subject.name.toLocaleLowerCase('cs') === name.toLocaleLowerCase('cs'))) {
      throw new Error(`Předmět ${name} již existuje.`);
    }
    const created = await this.repositories.subjects.create({
      name,
      shortName: normalizeText(input.shortName) || name.slice(0, 4).toUpperCase(),
      colorToken: COLOR_TOKENS.has(input.colorToken) ? input.colorToken : 'teal',
      icon: input.icon || 'book',
      status: status(input.status, SUBJECT_STATUSES, 'active'),
    });
    await this.audit('subject-created', 'subject', created.id, { name });
    return created;
  }

  async updateSubject(id, input) {
    const current = await this.repositories.subjects.get(id);
    if (!current) throw new Error('Předmět nebyl nalezen.');
    const name = required(input.name ?? current.name, 'Název předmětu');
    const subjects = await this.listSubjects({ includeArchived: true });
    if (subjects.some((subject) => subject.id !== id && subject.name.toLocaleLowerCase('cs') === name.toLocaleLowerCase('cs'))) {
      throw new Error(`Předmět ${name} již existuje.`);
    }
    const updated = await this.repositories.subjects.update(id, {
      name,
      shortName: normalizeText(input.shortName ?? current.shortName) || name.slice(0, 4).toUpperCase(),
      colorToken: COLOR_TOKENS.has(input.colorToken) ? input.colorToken : current.colorToken,
      status: status(input.status ?? current.status, SUBJECT_STATUSES, 'active'),
    });
    await this.audit('subject-updated', 'subject', id, { name });
    return updated;
  }

  async archiveSubject(id) {
    const subject = await this.repositories.subjects.get(id);
    if (!subject) throw new Error('Předmět nebyl nalezen.');
    const groups = await this.repositories.groupInstances.list();
    if (groups.some((group) => group.subjectId === id && group.status !== 'archived')) {
      throw new Error('Předmět používá aktivní nebo skrytá skupina. Nejprve skupiny archivujte nebo jim změňte předmět.');
    }
    const updated = await this.repositories.subjects.update(id, { status: 'archived' });
    await this.audit('subject-archived', 'subject', id, { name: subject.name });
    return updated;
  }

  async listGroups({ schoolYearId = '', status: groupStatus = 'active', query = '', includeAllStatuses = false } = {}) {
    const [instances, years, subjects] = await Promise.all([
      this.repositories.groupInstances.list(),
      this.listSchoolYears(),
      this.listSubjects({ includeArchived: true }),
    ]);
    const yearMap = new Map(years.map((item) => [item.id, item]));
    const subjectMap = new Map(subjects.map((item) => [item.id, item]));
    const needle = normalizeText(query).toLocaleLowerCase('cs');
    return instances
      .filter((group) => !schoolYearId || group.schoolYearId === schoolYearId)
      .filter((group) => includeAllStatuses || !groupStatus || group.status === groupStatus)
      .map((group) => ({ ...group, year: yearMap.get(group.schoolYearId) ?? null, subject: subjectMap.get(group.subjectId) ?? null }))
      .filter((group) => !needle || [group.displayName, group.grade, group.subject?.name, group.year?.label].some((value) => String(value || '').toLocaleLowerCase('cs').includes(needle)))
      .sort(compareNames);
  }

  async createGroup(input) {
    const displayName = required(input.displayName, 'Označení skupiny');
    const year = await this.repositories.schoolYears.get(input.schoolYearId);
    if (!year) throw new Error('Vyberte platný školní rok.');
    const subject = await this.repositories.subjects.get(input.subjectId);
    if (!subject || subject.status === 'archived') throw new Error('Vyberte aktivní předmět.');
    const groups = await this.listGroups({ schoolYearId: year.id, includeAllStatuses: true });
    if (groups.some((group) => group.displayName.toLocaleLowerCase('cs') === displayName.toLocaleLowerCase('cs') && group.subjectId === subject.id)) {
      throw new Error('Skupina se stejným označením a předmětem v tomto školním roce již existuje.');
    }

    const identity = await this.repositories.groupIdentities.create({
      originDate: input.originDate || new Date().toISOString().slice(0, 10),
      notes: normalizeText(input.identityNotes),
      status: 'active',
    });
    try {
      const group = await this.repositories.groupInstances.create({
        groupIdentityId: identity.id,
        schoolYearId: year.id,
        subjectId: subject.id,
        displayName,
        grade: normalizeText(input.grade),
        colorToken: COLOR_TOKENS.has(input.colorToken) ? input.colorToken : subject.colorToken || 'teal',
        status: 'active',
        previousGroupInstanceId: null,
        note: normalizeText(input.note),
        cycleId: input.cycleId || null,
        cycleAnchorDate: input.cycleAnchorDate || '',
        cycleStepDurationWeeks: Number(input.cycleStepDurationWeeks) || null,
      });
      await this.audit('group-created', 'groupInstance', group.id, { displayName, schoolYearId: year.id, subjectId: subject.id });
      return group;
    } catch (error) {
      await this.repositories.groupIdentities.remove(identity.id);
      throw error;
    }
  }

  async updateGroup(id, input) {
    const current = await this.repositories.groupInstances.get(id);
    if (!current) throw new Error('Skupina nebyla nalezena.');
    const displayName = required(input.displayName ?? current.displayName, 'Označení skupiny');
    const subject = await this.repositories.subjects.get(input.subjectId ?? current.subjectId);
    if (!subject) throw new Error('Předmět nebyl nalezen.');
    const updated = await this.repositories.groupInstances.update(id, {
      displayName,
      grade: normalizeText(input.grade ?? current.grade),
      subjectId: subject.id,
      colorToken: COLOR_TOKENS.has(input.colorToken) ? input.colorToken : current.colorToken,
      note: normalizeText(input.note ?? current.note),
      cycleId: input.cycleId !== undefined ? input.cycleId || null : current.cycleId || null,
      cycleAnchorDate: input.cycleAnchorDate !== undefined ? String(input.cycleAnchorDate || '') : current.cycleAnchorDate || '',
      cycleStepDurationWeeks: input.cycleStepDurationWeeks !== undefined ? Number(input.cycleStepDurationWeeks) || null : current.cycleStepDurationWeeks || null,
    });
    await this.audit('group-updated', 'groupInstance', id, { displayName });
    return updated;
  }

  async setGroupStatus(id, nextStatus) {
    if (!GROUP_STATUSES.has(nextStatus)) throw new Error('Neplatný stav skupiny.');
    const group = await this.repositories.groupInstances.get(id);
    if (!group) throw new Error('Skupina nebyla nalezena.');
    const updated = await this.repositories.groupInstances.update(id, { status: nextStatus });
    await this.audit(`group-${nextStatus}`, 'groupInstance', id, { displayName: group.displayName });
    return updated;
  }

  async getGroupDetail(id) {
    const group = await this.repositories.groupInstances.get(id);
    if (!group) return null;
    const [identity, year, subject, allInstances, lessons, tasks, reminders, materialLinks, years] = await Promise.all([
      this.repositories.groupIdentities.get(group.groupIdentityId),
      this.repositories.schoolYears.get(group.schoolYearId),
      this.repositories.subjects.get(group.subjectId),
      this.repositories.groupInstances.list(),
      this.repositories.lessons.list(),
      this.repositories.tasks.list(),
      this.repositories.reminders.list(),
      this.repositories.materialLinks.list(),
      this.listSchoolYears(),
    ]);
    const yearMap = new Map(years.map((item) => [item.id, item]));
    const history = allInstances
      .filter((instance) => instance.groupIdentityId === group.groupIdentityId)
      .map((instance) => ({ ...instance, year: yearMap.get(instance.schoolYearId) ?? null }))
      .sort((a, b) => compareYears(a.year || {}, b.year || {}));
    return {
      group,
      identity,
      year,
      subject,
      history,
      counts: {
        lessons: lessons.filter((item) => item.groupInstanceId === id).length,
        tasks: tasks.filter((item) => item.groupInstanceId === id && item.status !== 'completed').length,
        reminders: reminders.filter((item) => item.groupInstanceId === id && item.status !== 'completed').length,
        materials: materialLinks.filter((item) => item.entityType === 'groupInstance' && item.entityId === id).length,
      },
    };
  }

  async removeGroup(id) {
    const detail = await this.getGroupDetail(id);
    if (!detail) throw new Error('Skupina nebyla nalezena.');
    const [notes, tasks, reminders, materialLinks] = await Promise.all([
      this.repositories.quickNotes.list(),
      this.repositories.tasks.list(),
      this.repositories.reminders.list(),
      this.repositories.materialLinks.list(),
    ]);
    const hasDependencies = detail.counts.lessons > 0
      || notes.some((item) => item.groupInstanceId === id)
      || tasks.some((item) => item.groupInstanceId === id)
      || reminders.some((item) => item.groupInstanceId === id)
      || materialLinks.some((item) => item.entityType === 'groupInstance' && item.entityId === id);
    if (hasDependencies || detail.history.length > 1) {
      throw new Error('Skupinu nelze bezpečně smazat, protože obsahuje historii nebo navazující záznamy. Použijte archivaci.');
    }
    await this.repositories.groupInstances.remove(id);
    await this.repositories.groupIdentities.remove(detail.group.groupIdentityId);
    await this.audit('group-deleted', 'groupInstance', id, { displayName: detail.group.displayName });
  }

  async promoteGroups({ sourceYearId, targetYearId, rows }) {
    if (!sourceYearId || !targetYearId || sourceYearId === targetYearId) throw new Error('Vyberte dva různé školní roky.');
    const [sourceYear, targetYear] = await Promise.all([
      this.repositories.schoolYears.get(sourceYearId),
      this.repositories.schoolYears.get(targetYearId),
    ]);
    if (!sourceYear || !targetYear) throw new Error('Vybraný školní rok nebyl nalezen.');
    const existingTarget = await this.listGroups({ schoolYearId: targetYearId, includeAllStatuses: true });
    const result = { promoted: 0, archived: 0, skipped: 0 };

    for (const row of rows) {
      const source = await this.repositories.groupInstances.get(row.id);
      if (!source || source.schoolYearId !== sourceYearId) continue;
      if (row.action === 'skip') {
        result.skipped += 1;
        continue;
      }
      if (row.action === 'archive') {
        await this.setGroupStatus(source.id, 'archived');
        result.archived += 1;
        continue;
      }
      if (existingTarget.some((target) => target.groupIdentityId === source.groupIdentityId)) {
        throw new Error(`Skupina ${source.displayName} už má záznam v cílovém školním roce.`);
      }
      const displayName = required(row.displayName, `Nové označení skupiny ${source.displayName}`);
      const created = await this.repositories.groupInstances.create({
        groupIdentityId: source.groupIdentityId,
        schoolYearId: targetYearId,
        subjectId: source.subjectId,
        displayName,
        grade: normalizeText(row.grade),
        colorToken: source.colorToken,
        status: 'active',
        previousGroupInstanceId: source.id,
        note: source.note || '',
        cycleId: source.cycleId || null,
        cycleAnchorDate: source.cycleAnchorDate || '',
        cycleStepDurationWeeks: source.cycleStepDurationWeeks || null,
      });
      await this.repositories.groupInstances.update(source.id, { status: 'archived' });
      await this.audit('group-promoted', 'groupInstance', created.id, {
        sourceGroupInstanceId: source.id,
        sourceYearId,
        targetYearId,
        from: source.displayName,
        to: displayName,
      });
      existingTarget.push(created);
      result.promoted += 1;
    }
    return result;
  }

  async quickSetup(input) {
    const year = await this.createSchoolYear({
      label: input.yearLabel,
      startDate: input.startDate,
      endDate: input.endDate,
      isCurrent: true,
    });
    const subject = await this.createSubject({
      name: input.subjectName,
      shortName: input.subjectShortName,
      colorToken: input.colorToken,
    });
    const group = await this.createGroup({
      schoolYearId: year.id,
      subjectId: subject.id,
      displayName: input.groupName,
      grade: input.grade,
      colorToken: input.colorToken,
    });
    return { year, subject, group };
  }
}

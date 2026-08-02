import { randomUUID } from 'node:crypto';

function uid(prefix) { return `${prefix}_${randomUUID()}`; }
function text(value, fallback = '') { return String(value ?? fallback).trim(); }
function iso(value, label, optional = false) {
  if (!value && optional) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw Object.assign(new Error(`${label} nemá platné datum.`), { status: 400, code: 'date_invalid' });
  return date.toISOString();
}
function required(value, label) {
  const result = text(value);
  if (!result) throw Object.assign(new Error(`${label} je povinné.`), { status: 400, code: 'field_required' });
  return result;
}
function now() { return new Date().toISOString(); }

export function canViewPeriod(user, period) {
  if (!user || !period) return false;
  if (user.role === 'owner' || user.role === 'admin' || period.ownerId === user.id) return true;
  if (period.status !== 'active') return false;
  return period.accessMode === 'all_substitutes' || (period.allowedUserIds || []).includes(user.id);
}

export function canEditPeriod(user, period) {
  return Boolean(user && period && (user.role === 'owner' || user.role === 'admin' || period.ownerId === user.id));
}

export function publicPeriod(period) {
  const { privateNotes, ...safe } = period;
  return safe;
}
export function publicPlan(plan) {
  const { privateNotes, ...safe } = plan;
  return safe;
}
export function publicItem(item) {
  const { privateNotes, ...safe } = item;
  return safe;
}

export function listSubstitutionBundles(store, user, { activeOnly = false } = {}) {
  const periods = Object.values(store.resource('substitutionPeriods'))
    .filter((period) => canViewPeriod(user, period))
    .filter((period) => !activeOnly || period.status === 'active')
    .sort((a, b) => String(b.startDate || b.createdAt).localeCompare(String(a.startDate || a.createdAt)));
  const plans = Object.values(store.resource('substitutionPlans'));
  const items = Object.values(store.resource('substitutionItems'));
  return periods.map((period) => ({
    ...publicPeriod(period),
    plans: plans.filter((plan) => plan.periodId === period.id).map((plan) => ({
      ...publicPlan(plan),
      items: items.filter((item) => item.planId === plan.id).sort((a, b) => Number(a.order || 0) - Number(b.order || 0)).map(publicItem),
    })),
  }));
}

export function createPeriod(store, user, input) {
  const timestamp = now();
  const record = {
    id: uid('subPeriod'), ownerId: user.id, teacherDisplayName: user.displayName,
    title: required(input.title, 'Název zastupování'), startDate: iso(input.startDate, 'Datum začátku'), endDate: iso(input.endDate, 'Datum konce'),
    status: input.status === 'active' ? 'active' : 'draft',
    accessMode: input.accessMode === 'selected' ? 'selected' : 'all_substitutes',
    allowedUserIds: Array.isArray(input.allowedUserIds) ? [...new Set(input.allowedUserIds.map(String))] : [],
    summary: text(input.summary), privateNotes: text(input.privateNotes),
    createdAt: timestamp, updatedAt: timestamp, activatedAt: input.status === 'active' ? timestamp : null, closedAt: null,
  };
  if (new Date(record.endDate) < new Date(record.startDate)) throw Object.assign(new Error('Konec zastupování nemůže být před začátkem.'), { status: 400, code: 'period_range_invalid' });
  store.resource('substitutionPeriods')[record.id] = record;
  return record;
}

export function updatePeriod(period, input) {
  if (input.title != null) period.title = required(input.title, 'Název zastupování');
  if (input.startDate != null) period.startDate = iso(input.startDate, 'Datum začátku');
  if (input.endDate != null) period.endDate = iso(input.endDate, 'Datum konce');
  if (input.summary != null) period.summary = text(input.summary);
  if (input.privateNotes != null) period.privateNotes = text(input.privateNotes);
  if (input.accessMode != null) period.accessMode = input.accessMode === 'selected' ? 'selected' : 'all_substitutes';
  if (input.allowedUserIds != null) period.allowedUserIds = Array.isArray(input.allowedUserIds) ? [...new Set(input.allowedUserIds.map(String))] : [];
  if (input.status != null) {
    const status = ['draft', 'active', 'closed'].includes(input.status) ? input.status : period.status;
    if (status === 'active' && period.status !== 'active') period.activatedAt = now();
    if (status === 'closed' && period.status !== 'closed') period.closedAt = now();
    period.status = status;
  }
  if (new Date(period.endDate) < new Date(period.startDate)) throw Object.assign(new Error('Konec zastupování nemůže být před začátkem.'), { status: 400, code: 'period_range_invalid' });
  period.updatedAt = now();
  return period;
}

export function createPlan(store, user, period, input) {
  const timestamp = now();
  const record = {
    id: uid('subPlan'), periodId: period.id, ownerId: period.ownerId,
    groupInstanceId: text(input.groupInstanceId), groupName: required(input.groupName, 'Skupina'), subjectName: text(input.subjectName),
    planType: input.planType === 'horizon' ? 'horizon' : 'lessons',
    title: required(input.title || input.groupName, 'Název plánu'), instructions: text(input.instructions), studentInstructions: text(input.studentInstructions),
    privateNotes: text(input.privateNotes), ordering: ['fixed', 'recommended', 'free', 'substitute', 'students'].includes(input.ordering) ? input.ordering : 'recommended',
    status: ['ready', 'partial', 'missing'].includes(input.status) ? input.status : 'ready', visibility: 'substitution',
    createdAt: timestamp, updatedAt: timestamp,
  };
  store.resource('substitutionPlans')[record.id] = record;
  return record;
}

export function updatePlan(plan, input) {
  for (const field of ['groupInstanceId', 'groupName', 'subjectName', 'title', 'instructions', 'studentInstructions', 'privateNotes']) if (input[field] != null) plan[field] = text(input[field]);
  if (input.planType != null) plan.planType = input.planType === 'horizon' ? 'horizon' : 'lessons';
  if (input.ordering != null) plan.ordering = ['fixed', 'recommended', 'free', 'substitute', 'students'].includes(input.ordering) ? input.ordering : plan.ordering;
  if (input.status != null) plan.status = ['ready', 'partial', 'missing'].includes(input.status) ? input.status : plan.status;
  plan.updatedAt = now();
  return plan;
}

export function createItem(store, plan, input) {
  const timestamp = now();
  const record = {
    id: uid('subItem'), planId: plan.id, periodId: plan.periodId, ownerId: plan.ownerId,
    order: Number.isFinite(Number(input.order)) ? Number(input.order) : Object.values(store.resource('substitutionItems')).filter((item) => item.planId === plan.id).length + 1,
    date: input.date ? iso(input.date, 'Datum položky', true) : '', title: required(input.title, 'Název úkolu'), topic: text(input.topic), objective: text(input.objective),
    instructions: text(input.instructions), expectedOutput: text(input.expectedOutput), teacherNote: text(input.teacherNote), studentNote: text(input.studentNote), privateNotes: text(input.privateNotes),
    attachmentIds: Array.isArray(input.attachmentIds) ? [...new Set(input.attachmentIds.map(String))] : [],
    status: 'pending', substituteNote: '', realizedAt: null, updatedBy: null, importedAt: null,
    createdAt: timestamp, updatedAt: timestamp,
  };
  store.resource('substitutionItems')[record.id] = record;
  return record;
}

export function updateItemByOwner(item, input) {
  for (const field of ['title', 'topic', 'objective', 'instructions', 'expectedOutput', 'teacherNote', 'studentNote', 'privateNotes']) if (input[field] != null) item[field] = text(input[field]);
  if (input.date != null) item.date = input.date ? iso(input.date, 'Datum položky', true) : '';
  if (input.order != null && Number.isFinite(Number(input.order))) item.order = Number(input.order);
  if (input.attachmentIds != null) item.attachmentIds = Array.isArray(input.attachmentIds) ? [...new Set(input.attachmentIds.map(String))] : [];
  item.updatedAt = now();
  return item;
}

export function updateItemProgress(item, user, input) {
  const allowed = ['completed', 'partial', 'not_completed', 'moved', 'adjusted', 'impossible', 'pending'];
  item.status = allowed.includes(input.status) ? input.status : item.status;
  if (input.substituteNote != null) item.substituteNote = text(input.substituteNote);
  if (input.realizedAt != null) item.realizedAt = input.realizedAt ? iso(input.realizedAt, 'Datum realizace', true) : null;
  else if (item.status !== 'pending' && !item.realizedAt) item.realizedAt = now();
  else if (item.status === 'pending' && input.status != null) item.realizedAt = null;
  item.updatedBy = user.id;
  item.updatedByName = user.displayName;
  item.updatedAt = now();
  return item;
}

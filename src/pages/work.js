import { appState } from '../core/appState.js';
import { escapeAttribute, escapeHtml } from '../core/html.js';
import { icon } from '../ui/icons.js';
import { confirmAction } from '../ui/modal.js';
import { navigate } from '../ui/router.js';
import { showToast } from '../ui/toast.js';
import {
  openDateDialog,
  openReminderDialog,
  openTagDialog,
  openTaskDialog,
} from '../ui/workDialogs.js';
import {
  PRIORITIES,
  REMINDER_STATUSES,
  REMINDER_TRIGGERS,
  TAG_CATEGORIES,
  TASK_STATUSES,
  TASK_TYPES,
} from '../services/workService.js';
import { emptyState, sectionHeader, statusPill } from './shared.js';

const TABS = Object.freeze({
  tasks: 'Otevřené úkoly',
  reminders: 'Připomínky',
  tags: 'Štítky',
});

function formatDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' }).format(new Date(`${value}T12:00:00`));
}

function priorityPill(priority) {
  const meta = PRIORITIES[priority] ?? PRIORITIES.normal;
  return statusPill(meta.label, meta.variant, priority === 'urgent' ? 'warning' : 'plan');
}

function taskStatusPill(status) {
  const meta = TASK_STATUSES[status] ?? TASK_STATUSES.open;
  return statusPill(meta.label, meta.variant, status === 'completed' ? 'check' : 'plan');
}

function reminderStatusPill(status) {
  const meta = REMINDER_STATUSES[status] ?? REMINDER_STATUSES.active;
  return statusPill(meta.label, meta.variant, status === 'completed' ? 'check' : 'warning');
}

function contextLine(item) {
  const bits = [];
  if (item.group) bits.push(item.group.displayName);
  if (item.subject) bits.push(item.subject.shortName || item.subject.name);
  if (item.lesson) bits.push(item.lesson.title);
  return bits.join(' · ') || 'Osobní povinnost bez vazby na skupinu';
}

function taskCard(task) {
  const overdue = task.dueDate && task.dueDate < new Date().toISOString().slice(0, 10) && !['completed', 'cancelled'].includes(task.status);
  const schedule = task.nextLessonTrigger
    ? 'Při příští hodině'
    : task.dueDate
      ? `${overdue ? 'Po termínu · ' : 'Termín · '}${formatDate(task.dueDate)}`
      : 'Bez termínu';
  return `
    <article class="work-card ${overdue ? 'is-overdue' : ''}" data-task-card="${task.id}">
      <div class="work-card__marker">${icon(task.status === 'completed' ? 'check' : 'plan', 20)}</div>
      <div class="work-card__main">
        <div class="work-card__eyebrow">${escapeHtml(contextLine(task))}</div>
        <h2>${escapeHtml(task.title)}</h2>
        <p>${escapeHtml(task.description || TASK_TYPES[task.type] || 'Bez doplňující poznámky.')}</p>
        <div class="work-card__meta"><span>${icon('calendar', 15)} ${escapeHtml(schedule)}</span><span>${escapeHtml(TASK_TYPES[task.type] || 'Jiné')}</span>${task.carriedCount ? `<span>Přeneseno ${task.carriedCount}×</span>` : ''}</div>
      </div>
      <div class="work-card__side">${priorityPill(task.priority)}${taskStatusPill(task.status)}</div>
      <div class="work-card__actions">
        ${!['completed', 'cancelled'].includes(task.status) ? `<button class="button button--primary button--small" type="button" data-task-action="complete" data-id="${task.id}">${icon('check', 15)} Splnit</button><button class="button button--secondary button--small" type="button" data-task-action="carry" data-id="${task.id}">Přenést</button><button class="button button--ghost button--small" type="button" data-task-action="postpone" data-id="${task.id}">Odložit</button>` : ''}
        <button class="button button--ghost button--small" type="button" data-task-action="edit" data-id="${task.id}">${icon('edit', 15)} Upravit</button>
        ${!['completed', 'cancelled'].includes(task.status) ? `<button class="icon-button icon-button--small" type="button" data-task-action="cancel" data-id="${task.id}" aria-label="Zrušit úkol" title="Zrušit úkol">${icon('close', 16)}</button>` : ''}
      </div>
    </article>`;
}

function reminderCard(reminder) {
  const trigger = reminder.triggerType === 'date'
    ? formatDate(reminder.triggerDate)
    : REMINDER_TRIGGERS[reminder.triggerType] || 'Bez data';
  return `
    <article class="work-card work-card--reminder" data-reminder-card="${reminder.id}">
      <div class="work-card__marker">${icon('warning', 20)}</div>
      <div class="work-card__main">
        <div class="work-card__eyebrow">${escapeHtml(contextLine(reminder))}</div>
        <h2>${escapeHtml(reminder.title)}</h2>
        <p>${escapeHtml(reminder.note || 'Bez doplňující poznámky.')}</p>
        <div class="work-card__meta"><span>${icon('calendar', 15)} ${escapeHtml(trigger)}</span>${reminder.snoozedUntil ? `<span>Odloženo do ${formatDate(reminder.snoozedUntil)}</span>` : ''}${reminder.carriedCount ? `<span>Přeneseno ${reminder.carriedCount}×</span>` : ''}</div>
      </div>
      <div class="work-card__side">${priorityPill(reminder.priority)}${reminderStatusPill(reminder.status)}</div>
      <div class="work-card__actions">
        ${!['completed', 'cancelled'].includes(reminder.status) ? `<button class="button button--primary button--small" type="button" data-reminder-action="complete" data-id="${reminder.id}">${icon('check', 15)} Splnit</button><button class="button button--secondary button--small" type="button" data-reminder-action="carry" data-id="${reminder.id}">Na další hodinu</button><button class="button button--ghost button--small" type="button" data-reminder-action="snooze" data-id="${reminder.id}">Odložit</button>` : ''}
        <button class="button button--ghost button--small" type="button" data-reminder-action="edit" data-id="${reminder.id}">${icon('edit', 15)} Upravit</button>
        ${!['completed', 'cancelled'].includes(reminder.status) ? `<button class="icon-button icon-button--small" type="button" data-reminder-action="cancel" data-id="${reminder.id}" aria-label="Zrušit připomínku" title="Zrušit připomínku">${icon('close', 16)}</button>` : ''}
      </div>
    </article>`;
}

function tagCard(tag, count) {
  return `<article class="tag-manager-card tag-manager-card--${escapeAttribute(tag.colorToken || 'teal')}"><span class="tag-manager-card__dot"></span><div><strong>${escapeHtml(tag.name)}</strong><small>${escapeHtml(TAG_CATEGORIES[tag.category] || 'Vlastní')} · použito ${count}×</small></div><button class="icon-button icon-button--small" type="button" data-tag-action="archive" data-id="${tag.id}" aria-label="Archivovat štítek" title="Archivovat štítek">${icon('archive', 16)}</button></article>`;
}

async function workPageModel(context) {
  const tab = TABS[context.query.get('tab')] ? context.query.get('tab') : 'tasks';
  const groupId = context.query.get('group') || '';
  const query = context.query.get('q') || '';
  const includeClosed = context.query.get('history') === '1';
  const currentYear = appState.academic.currentYear;
  const groups = currentYear
    ? await appState.academicService.listGroups({ schoolYearId: currentYear.id, includeAllStatuses: true, status: '' })
    : await appState.academicService.listGroups({ includeAllStatuses: true, status: '' });
  const summary = await appState.workService.dashboard({ schoolYearId: currentYear?.id || '' });
  const tasks = tab === 'tasks' ? await appState.workService.listTasks({ groupInstanceId: groupId, query, includeClosed }) : [];
  const reminders = tab === 'reminders' ? await appState.workService.listReminders({ groupInstanceId: groupId, query, includeClosed }) : [];
  let tags = [];
  let tagCounts = new Map();
  if (tab === 'tags') {
    [tags] = await Promise.all([appState.workService.listTags()]);
    const links = await appState.repositories.entityTags.list();
    tagCounts = new Map(tags.map((tag) => [tag.id, links.filter((link) => link.tagId === tag.id).length]));
  }
  return { tab, groupId, query, includeClosed, groups, summary, tasks, reminders, tags, tagCounts };
}

export async function workPage(context) {
  const model = await workPageModel(context);
  const { tab, groupId, query, includeClosed, groups, summary, tasks, reminders, tags, tagCounts } = model;
  const contentByTab = {
    tasks: tasks.length
      ? `<div class="work-list">${tasks.map(taskCard).join('')}</div>`
      : emptyState({ iconName: 'check', title: 'Žádné otevřené úkoly', text: includeClosed ? 'V tomto výběru nejsou ani uzavřené úkoly.' : 'Vše je vyřešeno. Nový úkol můžete navázat na skupinu nebo konkrétní hodinu.', action: '<button class="button button--primary" type="button" data-open-task>Přidat úkol</button>' }),
    reminders: reminders.length
      ? `<div class="work-list">${reminders.map(reminderCard).join('')}</div>`
      : emptyState({ iconName: 'warning', title: 'Žádné aktivní připomínky', text: includeClosed ? 'V tomto výběru nejsou ani uzavřené připomínky.' : 'Připomínka se může zobrazit bez data, v konkrétní den nebo při příští hodině.', action: '<button class="button button--primary" type="button" data-open-reminder>Přidat připomínku</button>' }),
    tags: tags.length
      ? `<div class="tag-manager-grid">${tags.map((tag) => tagCard(tag, tagCounts.get(tag.id) || 0)).join('')}</div>`
      : emptyState({ iconName: 'materials', title: 'Zatím bez vlastních štítků', text: 'Štítky pomáhají dohledat dovednosti, typy aktivit a povedené hodiny.', action: '<button class="button button--primary" type="button" data-open-tag>Vytvořit štítek</button>' }),
  };
  return {
    title: 'Povinnosti a připomínky',
    description: 'Co je potřeba dokončit, zkontrolovat nebo připomenout při další hodině.',
    actions: `<button class="button button--secondary" type="button" data-open-reminder>${icon('warning', 17)} Připomínka</button><button class="button button--primary" type="button" data-open-task>${icon('plus', 17)} Nový úkol</button>`,
    content: `
      <section class="dashboard-grid dashboard-grid--four work-summary">
        <article class="summary-card"><div class="summary-card__icon">${icon('plan', 21)}</div><div><span>Otevřené úkoly</span><strong>${summary.openTaskCount}</strong><small>Aktivní a odložené</small></div></article>
        <article class="summary-card ${summary.overdueTaskCount ? 'summary-card--warning' : ''}"><div class="summary-card__icon">${icon('warning', 21)}</div><div><span>Po termínu</span><strong>${summary.overdueTaskCount}</strong><small>Vyžaduje pozornost</small></div></article>
        <article class="summary-card"><div class="summary-card__icon">${icon('calendar', 21)}</div><div><span>Připomínky</span><strong>${summary.activeReminderCount}</strong><small>Aktivní a přenesené</small></div></article>
        <article class="summary-card ${summary.urgentCount ? 'summary-card--danger' : ''}"><div class="summary-card__icon">${icon('shield', 21)}</div><div><span>Naléhavé</span><strong>${summary.urgentCount}</strong><small>Nejvyšší priorita</small></div></article>
      </section>
      <section class="group-toolbar work-toolbar">
        <div class="segmented-control" aria-label="Typ pracovních záznamů">${Object.entries(TABS).map(([key, label]) => `<button type="button" class="${tab === key ? 'is-active' : ''}" data-work-tab="${key}">${escapeHtml(label)}</button>`).join('')}</div>
        ${tab !== 'tags' ? `<label class="compact-field"><span>Skupina</span><select id="work-group-filter"><option value="">Všechny skupiny</option>${groups.map((group) => `<option value="${group.id}" ${group.id === groupId ? 'selected' : ''}>${escapeHtml(group.displayName)}</option>`).join('')}</select></label><form id="work-search-form" class="search-field search-field--compact">${icon('search', 18)}<input name="q" value="${escapeAttribute(query)}" placeholder="Hledat v povinnostech"><button class="search-submit" type="submit" aria-label="Hledat">${icon('chevron', 17)}</button></form><label class="history-toggle"><input type="checkbox" id="work-history-toggle" ${includeClosed ? 'checked' : ''}><span>Zobrazit uzavřené</span></label>` : '<button class="button button--secondary button--small" type="button" data-open-tag>Nový štítek</button>'}
      </section>
      <section class="content-card content-card--transparent">${sectionHeader(TABS[tab], tab === 'tasks' ? `${tasks.length} záznamů` : tab === 'reminders' ? `${reminders.length} záznamů` : `${tags.length} aktivních štítků`)}${contentByTab[tab]}</section>`,
  };
}

async function runTaskAction(action, id) {
  const task = await appState.workService.getTask(id);
  if (!task) throw new Error('Úkol nebyl nalezen.');
  if (action === 'edit') return openTaskDialog({ task });
  if (action === 'complete') { await appState.workService.completeTask(id); showToast('Úkol byl splněn.', 'success'); }
  if (action === 'carry') { await appState.workService.carryTask(id); showToast('Úkol byl přenesen na příští hodinu.', 'success'); }
  if (action === 'postpone') return openDateDialog({ title: 'Odložit úkol', description: 'Úkol zůstane otevřený, ale do zvoleného data nebude považován za aktuální.', confirmLabel: 'Odložit úkol', onConfirm: async (date) => { await appState.workService.postponeTask(id, date); showToast('Úkol byl odložen.', 'success'); } });
  if (action === 'cancel') return confirmAction({ title: 'Zrušit úkol?', message: 'Záznam zůstane v historii jako zrušený.', confirmLabel: 'Zrušit úkol', danger: true, onConfirm: async () => { await appState.workService.cancelTask(id); showToast('Úkol byl zrušen.', 'success'); window.dispatchEvent(new HashChangeEvent('hashchange')); } });
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  return null;
}

async function runReminderAction(action, id) {
  const reminder = await appState.workService.getReminder(id);
  if (!reminder) throw new Error('Připomínka nebyla nalezena.');
  if (action === 'edit') return openReminderDialog({ reminder });
  if (action === 'complete') { await appState.workService.completeReminder(id); showToast('Připomínka byla splněna.', 'success'); }
  if (action === 'carry') { await appState.workService.carryReminder(id); showToast('Připomínka byla přenesena na další hodinu.', 'success'); }
  if (action === 'snooze') return openDateDialog({ title: 'Odložit připomínku', description: 'Do zvoleného dne se připomínka nebude zobrazovat mezi aktuálními.', confirmLabel: 'Odložit připomínku', onConfirm: async (date) => { await appState.workService.snoozeReminder(id, date); showToast('Připomínka byla odložena.', 'success'); } });
  if (action === 'cancel') return confirmAction({ title: 'Zrušit připomínku?', message: 'Záznam zůstane dohledatelný v historii.', confirmLabel: 'Zrušit připomínku', danger: true, onConfirm: async () => { await appState.workService.cancelReminder(id); showToast('Připomínka byla zrušena.', 'success'); window.dispatchEvent(new HashChangeEvent('hashchange')); } });
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  return null;
}

export function bindWorkPage(context) {
  const query = Object.fromEntries(context.query);
  document.querySelectorAll('[data-open-task]').forEach((button) => button.addEventListener('click', () => void openTaskDialog({ groupId: query.group || '' })));
  document.querySelectorAll('[data-open-reminder]').forEach((button) => button.addEventListener('click', () => void openReminderDialog({ groupId: query.group || '' })));
  document.querySelectorAll('[data-open-tag]').forEach((button) => button.addEventListener('click', openTagDialog));
  document.querySelectorAll('[data-work-tab]').forEach((button) => button.addEventListener('click', () => navigate('work', [], { ...query, tab: button.dataset.workTab, q: '', history: '' })));
  document.querySelector('#work-group-filter')?.addEventListener('change', (event) => navigate('work', [], { ...query, group: event.target.value }));
  document.querySelector('#work-history-toggle')?.addEventListener('change', (event) => navigate('work', [], { ...query, history: event.target.checked ? '1' : '' }));
  document.querySelector('#work-search-form')?.addEventListener('submit', (event) => { event.preventDefault(); const data = new FormData(event.currentTarget); navigate('work', [], { ...query, q: String(data.get('q') || '').trim() }); });
  document.querySelectorAll('[data-task-action]').forEach((button) => button.addEventListener('click', async () => { try { await runTaskAction(button.dataset.taskAction, button.dataset.id); } catch (error) { showToast(error.message, 'error'); } }));
  document.querySelectorAll('[data-reminder-action]').forEach((button) => button.addEventListener('click', async () => { try { await runReminderAction(button.dataset.reminderAction, button.dataset.id); } catch (error) { showToast(error.message, 'error'); } }));
  document.querySelectorAll('[data-tag-action="archive"]').forEach((button) => button.addEventListener('click', () => confirmAction({ title: 'Archivovat štítek?', message: 'Přiřazení u starších hodin zůstane zachováno, štítek ale nebude nabízen pro nové záznamy.', confirmLabel: 'Archivovat', onConfirm: async () => { await appState.workService.archiveTag(button.dataset.id); showToast('Štítek byl archivován.', 'success'); window.dispatchEvent(new HashChangeEvent('hashchange')); } })));
}

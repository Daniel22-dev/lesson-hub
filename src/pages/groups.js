import { appState } from '../core/appState.js';
import { escapeAttribute, escapeHtml } from '../core/html.js';
import { icon } from '../ui/icons.js';
import { confirmAction } from '../ui/modal.js';
import { navigate } from '../ui/router.js';
import { showToast } from '../ui/toast.js';
import { openGroupDialog, openQuickSetupDialog } from '../ui/academicDialogs.js';
import { openLessonDialog, openQuickLessonDialog } from '../ui/lessonDialogs.js';
import { openReminderDialog, openTaskDialog } from '../ui/workDialogs.js';
import { openMaterialDialog } from '../ui/materialDialogs.js';
import { LESSON_STATUSES } from '../services/lessonService.js';
import { emptyState, sectionHeader, statusPill } from './shared.js';

const STATUS_META = Object.freeze({
  active: ['Aktivní', 'success', 'check'],
  hidden: ['Skryté', 'warning', 'eyeOff'],
  archived: ['Archiv', 'neutral', 'archive'],
});

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' }).format(new Date(`${value}T12:00:00`));
}

function statusMarkup(status) {
  const [label, variant, iconName] = STATUS_META[status] ?? STATUS_META.active;
  return statusPill(label, variant, iconName);
}

function lessonStatusMarkup(status) {
  const meta = LESSON_STATUSES[status] ?? LESSON_STATUSES.draft;
  return statusPill(meta.label, meta.variant, status === 'completed' ? 'check' : status === 'unfinished' ? 'warning' : 'plan');
}

async function groupCard(group) {
  const [continuity, cycleState] = await Promise.all([appState.lessonService.groupContinuity(group.id), appState.templateCycleService.groupCycleState(group.id)]);
  return `
    <article class="group-card group-card--${escapeAttribute(group.colorToken || 'teal')}" data-group-card="${group.id}">
      <div class="group-card__top">
        <div class="group-card__identity"><span class="group-card__subject">${escapeHtml(group.subject?.shortName || group.subject?.name || 'Bez předmětu')}</span><div><h2>${escapeHtml(group.displayName)}</h2><p>${escapeHtml(group.subject?.name || 'Předmět nebyl nalezen')} · ${escapeHtml(group.grade || 'ročník neuveden')}</p></div></div>
        ${statusMarkup(group.status)}
      </div>
      <div class="group-card__continuity">
        <div><span>Poslední hodina</span><strong>${continuity.lastLesson ? `${formatDate(continuity.lastLesson.date)} · ${escapeHtml(continuity.lastLesson.title)}` : 'Zatím bez záznamu'}</strong></div>
        <div><span>Skončili jsme</span><strong>${escapeHtml(continuity.lastLesson?.endedAtText || continuity.lastLesson?.actualProgress || '—')}</strong></div>
        <div><span>Nejbližší plán</span><strong>${continuity.nextLesson ? `${formatDate(continuity.nextLesson.date)} · ${escapeHtml(continuity.nextLesson.title)}` : 'Není připraven'}</strong></div>
      </div>
      ${cycleState?.step ? `<div class="group-cycle-strip group-cycle-strip--${escapeAttribute(cycleState.step.colorToken || 'teal')}"><span>${icon('restore', 16)}</span><div><strong>${escapeHtml(cycleState.step.label)}</strong><small>${escapeHtml(cycleState.cycle.name)} · ${formatDate(cycleState.step.startDate)}–${formatDate(cycleState.step.endDate)}</small></div></div>` : ''}
      ${group.note ? `<p class="group-card__note">${escapeHtml(group.note)}</p>` : ''}
      <div class="group-card__footer">
        <span>${icon('calendar', 16)} ${escapeHtml(group.year?.label || 'Neznámý rok')}</span>
        <div class="group-card__actions">
          ${group.status === 'active' ? `<button class="icon-button icon-button--small" type="button" data-open-quick-lesson data-group-id="${group.id}" aria-label="Rychlý zápis" title="Rychlý zápis">${icon('edit', 17)}</button>` : ''}
          <button class="icon-button icon-button--small" type="button" data-group-action="edit" data-group-id="${group.id}" aria-label="Upravit skupinu" title="Upravit">${icon('settings', 17)}</button>
          ${group.status === 'active' ? `<button class="icon-button icon-button--small" type="button" data-group-action="hide" data-group-id="${group.id}" aria-label="Skrýt skupinu" title="Skrýt">${icon('eyeOff', 17)}</button>` : ''}
          ${group.status === 'hidden' ? `<button class="icon-button icon-button--small" type="button" data-group-action="activate" data-group-id="${group.id}" aria-label="Znovu aktivovat" title="Znovu aktivovat">${icon('eye', 17)}</button>` : ''}
          ${group.status !== 'archived' ? `<button class="icon-button icon-button--small" type="button" data-group-action="archive" data-group-id="${group.id}" aria-label="Archivovat skupinu" title="Archivovat">${icon('archive', 17)}</button>` : ''}
          <a class="button button--secondary button--small" href="#/groups/${group.id}">Otevřít skupinu ${icon('chevron', 16)}</a>
        </div>
      </div>
    </article>`;
}

function onboardingContent() {
  return `<section class="onboarding-panel"><div class="onboarding-panel__visual">${icon('groups', 42)}</div><div class="onboarding-panel__content"><span class="topbar__eyebrow">První spuštění</span><h2>Vytvořte pracovní prostor pro svou výuku</h2><p>Lesson Hub potřebuje znát aktuální školní rok, předmět a první skupinu. Průvodce je vytvoří jedním krokem a později je můžete libovolně upravit.</p><div class="onboarding-steps"><span><b>1</b> Školní rok</span><span><b>2</b> Předmět</span><span><b>3</b> Skupina</span></div><button class="button button--primary" type="button" data-open-quick-setup>${icon('plus', 18)} Spustit rychlé nastavení</button></div></section>`;
}

async function groupsListPage(context) {
  const years = appState.academic.years;
  if (!years.length) return { title: 'Skupiny', description: 'Aktuální skupiny, jejich stav a dlouhodobá historie.', actions: `<button class="button button--primary" type="button" data-open-quick-setup>${icon('plus', 18)} Připravit první skupinu</button>`, content: onboardingContent() };

  const selectedYearId = context.query.get('year') || appState.academic.currentYear?.id || years[0].id;
  const selectedStatus = ['active', 'hidden', 'archived'].includes(context.query.get('status')) ? context.query.get('status') : 'active';
  const query = context.query.get('q') || '';
  const groups = await appState.academicService.listGroups({ schoolYearId: selectedYearId, status: selectedStatus, query });
  const cards = await Promise.all(groups.map(groupCard));
  const year = years.find((item) => item.id === selectedYearId);
  const subjectsReady = appState.academic.subjects.some((subject) => subject.status === 'active');
  const statusCounts = {};
  for (const groupStatus of Object.keys(STATUS_META)) statusCounts[groupStatus] = (await appState.academicService.listGroups({ schoolYearId: selectedYearId, status: groupStatus })).length;
  const emptyText = query ? `Pro hledání „${query}“ nebyla v této části nalezena žádná skupina.` : selectedStatus === 'active' ? 'V tomto školním roce zatím nejsou aktivní skupiny.' : selectedStatus === 'hidden' ? 'Žádná skupina není dočasně skrytá.' : 'Archiv tohoto školního roku je prázdný.';

  return {
    title: 'Skupiny',
    description: 'Aktuální skupiny, jejich stav a dlouhodobá historie.',
    actions: `<button class="button button--primary" type="button" data-open-group ${subjectsReady ? '' : 'disabled'}>${icon('plus', 18)} Přidat skupinu</button>`,
    content: `
      <section class="group-toolbar"><div class="group-toolbar__filters"><label class="compact-field"><span>Školní rok</span><select id="group-year-filter">${years.map((item) => `<option value="${item.id}" ${item.id === selectedYearId ? 'selected' : ''}>${escapeHtml(item.label)}${item.isCurrent ? ' · aktuální' : ''}</option>`).join('')}</select></label><div class="segmented-control" aria-label="Stav skupin">${Object.entries(STATUS_META).map(([value, [label]]) => `<button type="button" class="${value === selectedStatus ? 'is-active' : ''}" data-status-filter="${value}">${escapeHtml(label)} <b>${statusCounts[value]}</b></button>`).join('')}</div></div><form id="group-search-form" class="search-field search-field--compact">${icon('search', 18)}<input name="q" value="${escapeAttribute(query)}" placeholder="Hledat skupinu nebo předmět" aria-label="Hledat skupinu"><button class="search-submit" type="submit" aria-label="Spustit hledání">${icon('chevron', 17)}</button></form><a class="button button--ghost" href="#/academic">${icon('settings', 17)} Školní roky a předměty</a></section>
      ${!subjectsReady ? `<aside class="notice notice--warning">${icon('warning', 20)}<div><strong>Chybí aktivní předmět</strong><p>Než přidáte skupinu, vytvořte alespoň jeden předmět ve správě výuky.</p></div><a class="button button--secondary button--small" href="#/academic">Otevřít správu</a></aside>` : ''}
      <section class="content-card content-card--transparent">${sectionHeader(year ? `${STATUS_META[selectedStatus][0]} skupiny · ${year.label}` : STATUS_META[selectedStatus][0], `${groups.length} ${groups.length === 1 ? 'zobrazená skupina' : 'zobrazených skupin'}`)}${groups.length ? `<div class="group-grid">${cards.join('')}</div>` : emptyState({ iconName: selectedStatus === 'archived' ? 'archive' : 'groups', title: query ? 'Žádná shoda' : 'Zatím bez skupin', text: emptyText, action: selectedStatus === 'active' && !query && subjectsReady ? `<button class="button button--secondary" type="button" data-open-group>Přidat první skupinu</button>` : '' })}</section>`,
  };
}

function historyRow(instance, currentId) {
  return `<div class="history-row ${instance.id === currentId ? 'is-current' : ''}"><span class="history-row__line"></span><div class="history-row__main"><strong>${escapeHtml(instance.year?.label || 'Neznámý rok')}</strong><span>${escapeHtml(instance.displayName)} · ${escapeHtml(instance.grade || 'ročník neuveden')}</span></div>${statusMarkup(instance.status)}${instance.id !== currentId ? `<a class="button button--ghost button--small" href="#/groups/${instance.id}">Otevřít</a>` : '<span class="history-row__current">Otevřený záznam</span>'}</div>`;
}

function timelineItem(lesson) {
  return `<a class="group-timeline-item" href="#/plan/${lesson.id}"><div class="group-timeline-item__date"><strong>${formatDate(lesson.date)}</strong><span>${lesson.startTime || ''}</span></div><div><span>${lessonStatusMarkup(lesson.status)}</span><h3>${escapeHtml(lesson.title)}</h3><p>${escapeHtml(lesson.status === 'completed' || lesson.status === 'unfinished' ? lesson.endedAtText || lesson.actualProgress || 'Bez doplněného průběhu.' : lesson.plannedOutline || lesson.objectives || 'Základní plán.')}</p></div>${icon('chevron', 18)}</a>`;
}

async function groupDetailPage(groupId) {
  const detail = await appState.academicService.getGroupDetail(groupId);
  if (!detail) return { title: 'Skupina nebyla nalezena', description: 'Záznam mohl být odstraněn nebo odkaz již není platný.', content: `<section class="content-card">${emptyState({ iconName: 'warning', title: 'Skupina neexistuje', text: 'Vraťte se na přehled skupin a vyberte platný záznam.', action: '<a class="button button--secondary" href="#/groups">Zpět na skupiny</a>' })}</section>` };
  const { group, subject, year, identity, history, counts } = detail;
  const [continuity, workSummary, materials, cycleState] = await Promise.all([
    appState.lessonService.groupContinuity(group.id),
    appState.workService.groupSummary(group.id),
    appState.materialService.listMaterials({ groupId: group.id }),
    appState.templateCycleService.groupCycleState(group.id),
  ]);
  const recent = continuity.lessons.slice(0, 8);
  return {
    title: group.displayName,
    description: `${subject?.name || 'Bez předmětu'} · ${year?.label || 'Neznámý školní rok'}`,
    actions: `<button class="button button--ghost" type="button" data-open-material data-group-id="${group.id}">${icon('materials', 17)} Materiál</button><button class="button button--ghost" type="button" data-open-reminder data-group-id="${group.id}">${icon('warning', 17)} Připomínka</button><button class="button button--ghost" type="button" data-open-task data-group-id="${group.id}">${icon('check', 17)} Úkol</button><button class="button button--secondary" type="button" data-open-quick-lesson data-group-id="${group.id}">${icon('edit', 17)} Rychlý zápis</button><button class="button button--primary" type="button" data-open-lesson data-group-id="${group.id}">${icon('plus', 17)} Nová hodina</button>`,
    content: `
      <nav class="breadcrumb"><a href="#/groups">Skupiny</a>${icon('chevron', 15)}<span>${escapeHtml(group.displayName)}</span></nav>
      <section class="group-detail-hero group-detail-hero--${escapeAttribute(group.colorToken || 'teal')}"><div class="group-detail-hero__subject"><span>${escapeHtml(subject?.shortName || '—')}</span></div><div class="group-detail-hero__main"><div class="group-detail-hero__meta">${statusMarkup(group.status)}<span>${escapeHtml(year?.label || '')}</span><span>${escapeHtml(group.grade || 'ročník neuveden')}</span></div><h2>${escapeHtml(group.displayName)}</h2><p>${escapeHtml(group.note || 'Zatím bez interní organizační poznámky.')}</p></div><div class="group-detail-hero__actions">${group.status === 'active' ? `<button class="button button--ghost" type="button" data-group-action="hide" data-group-id="${group.id}">${icon('eyeOff', 17)} Skrýt</button>` : ''}${group.status !== 'active' ? `<button class="button button--ghost" type="button" data-group-action="activate" data-group-id="${group.id}">${icon('eye', 17)} Aktivovat</button>` : ''}${group.status !== 'archived' ? `<button class="button button--ghost" type="button" data-group-action="archive" data-group-id="${group.id}">${icon('archive', 17)} Archivovat</button>` : ''}<button class="button button--ghost" type="button" data-group-action="edit" data-group-id="${group.id}">${icon('settings', 17)} Upravit</button></div></section>
      ${cycleState?.step ? `<section class="cycle-current-banner cycle-current-banner--${escapeAttribute(cycleState.step.colorToken || 'teal')}"><span class="cycle-current-banner__icon">${icon('restore', 22)}</span><div><span>Aktuální krok výukového cyklu</span><strong>${escapeHtml(cycleState.step.label)}</strong><small>${escapeHtml(cycleState.cycle.name)} · ${formatDate(cycleState.step.startDate)}–${formatDate(cycleState.step.endDate)} · okruh ${cycleState.step.cycleRound}</small></div><a class="button button--secondary button--small" href="#/templates?tab=cycles">Spravovat cyklus</a></section>` : `<section class="cycle-current-banner cycle-current-banner--empty"><span class="cycle-current-banner__icon">${icon('restore', 22)}</span><div><span>Výukový cyklus</span><strong>Není přiřazen</strong><small>Cyklická organizace je volitelná a lze ji zapnout pouze pro vybrané skupiny.</small></div><a class="button button--ghost button--small" href="#/templates?tab=cycles">Nastavit cyklus</a></section>`}
      <section class="dashboard-grid dashboard-grid--four"><article class="summary-card"><div class="summary-card__icon">${icon('plan', 21)}</div><div><span>Uskutečněné hodiny</span><strong>${continuity.completedCount}</strong><small>${continuity.unfinishedCount} nedokončených</small></div></article><article class="summary-card"><div class="summary-card__icon">${icon('calendar', 21)}</div><div><span>Budoucí plán</span><strong>${continuity.plannedCount}</strong><small>Koncepty a naplánované hodiny</small></div></article><article class="summary-card ${workSummary.overdueTaskCount ? 'summary-card--warning' : ''}"><div class="summary-card__icon">${icon('check', 21)}</div><div><span>Otevřené povinnosti</span><strong>${workSummary.openTaskCount + workSummary.activeReminderCount}</strong><small>${workSummary.overdueTaskCount} úkolů po termínu</small></div></article><article class="summary-card"><div class="summary-card__icon">${icon('arrowUp', 21)}</div><div><span>Školní roky</span><strong>${history.length}</strong><small>Trvalá historie skupiny</small></div></article></section>
      <div class="detail-tabs" role="navigation"><a class="is-active" href="#/groups/${group.id}">Přehled</a><a href="#/plan?group=${group.id}&view=completed">Hodiny</a><a href="#/plan?group=${group.id}&view=upcoming">Plán</a><a href="#/work?group=${group.id}&tab=tasks">Úkoly <b>${workSummary.openTaskCount}</b></a><a href="#/work?group=${group.id}&tab=reminders">Připomínky <b>${workSummary.activeReminderCount}</b></a><a href="#/materials?group=${group.id}">Materiály <b>${materials.length}</b></a><button type="button" data-action="wave-placeholder">Studenti</button><a href="#/academic">Historie</a></div>
      <div class="two-column-grid two-column-grid--detail"><section class="content-card">${sectionHeader('Aktuální stav', 'Nejdůležitější informace pro rychlé navázání na výuku.')}<div class="continuity-panel"><div><span>Poslední hodina</span><strong>${continuity.lastLesson ? `${formatDate(continuity.lastLesson.date)} · ${escapeHtml(continuity.lastLesson.title)}` : 'Zatím nebyla zaznamenána'}</strong><small>${escapeHtml(continuity.lastLesson?.actualProgress || 'Po první hodině se zde objeví skutečný průběh.')}</small></div><div><span>Kde se skončilo</span><strong>${escapeHtml(continuity.lastLesson?.endedAtText || '—')}</strong><small>${escapeHtml(continuity.lastLesson?.nextLessonNote || 'Zatím bez poznámky pro další hodinu.')}</small></div><div><span>Co následuje</span><strong>${continuity.nextLesson ? `${formatDate(continuity.nextLesson.date)} · ${escapeHtml(continuity.nextLesson.title)}` : 'Zatím bez plánu'}</strong><small>${escapeHtml(continuity.nextLesson?.plannedOutline || 'Další hodinu můžete naplánovat jedním krokem.')}</small></div></div></section><section class="content-card">${sectionHeader('Trvalá identita skupiny', 'Změna označení ani postup do dalšího ročníku historii nepřeruší.')}<dl class="definition-list compact-definition-list"><div><dt>Identita</dt><dd>${escapeHtml(identity?.id || 'neuvedena')}</dd></div><div><dt>Vznik záznamu</dt><dd>${identity?.originDate ? new Date(identity.originDate).toLocaleDateString('cs-CZ') : 'neuveden'}</dd></div><div><dt>Předchozí podoba</dt><dd>${group.previousGroupInstanceId ? 'Ano' : 'První evidovaná podoba'}</dd></div></dl></section></div>
      <section class="content-card group-work-panel">${sectionHeader('Povinnosti pro tuto skupinu', `${workSummary.tasks.length} úkolů · ${workSummary.reminders.length} připomínek`, `<a class="button button--secondary button--small" href="#/work?group=${group.id}">Otevřít vše</a>`)}${workSummary.tasks.length || workSummary.reminders.length ? `<div class="linked-work-list">${workSummary.tasks.slice(0, 3).map((task) => `<div><span>${icon('check', 16)}</span><strong>${escapeHtml(task.title)}</strong><small>${escapeHtml(task.nextLessonTrigger ? 'Při příští hodině' : task.dueDate ? `Termín ${formatDate(task.dueDate)}` : 'Bez termínu')}</small></div>`).join('')}${workSummary.reminders.slice(0, 3).map((reminder) => `<div><span>${icon('warning', 16)}</span><strong>${escapeHtml(reminder.title)}</strong><small>${escapeHtml(reminder.triggerType === 'date' ? formatDate(reminder.triggerDate) : 'Při příští hodině')}</small></div>`).join('')}</div>` : '<p class="muted-copy">Tato skupina nemá žádné otevřené úkoly ani připomínky.</p>'}</section>
      <section class="content-card">${sectionHeader('Časová osa hodin', 'Nejnovější uskutečněné i budoucí hodiny této skupiny.', `<a class="button button--secondary button--small" href="#/plan?group=${group.id}&view=all">Zobrazit celou historii</a>`)}${recent.length ? `<div class="group-timeline">${recent.map(timelineItem).join('')}</div>` : emptyState({ iconName: 'plan', title: 'Zatím bez hodin', text: 'Naplánujte první hodinu nebo spusťte rychlý zápis během výuky.', action: `<button class="button button--primary" type="button" data-open-lesson data-group-id="${group.id}">Naplánovat první hodinu</button>` })}</section>
      <section class="content-card">${sectionHeader('Historie skupiny', 'Jednotlivé podoby skupiny napříč školními roky.', `<a class="button button--secondary button--small" href="#/academic">${icon('arrowUp', 16)} Postup skupin</a>`)}<div class="history-list">${history.map((instance) => historyRow(instance, group.id)).join('')}</div></section>
      <section class="danger-zone"><div><strong>Odstranění skupiny</strong><p>Definitivní smazání je povoleno pouze u skupiny bez historie a navazujících dat. Ve všech ostatních případech použijte archivaci.</p></div><button class="button button--danger" type="button" data-group-action="delete" data-group-id="${group.id}">${icon('trash', 17)} Bezpečně odstranit</button></section>`,
  };
}

export async function groupsPage(context) {
  const groupId = context.params[0];
  return groupId ? groupDetailPage(groupId) : groupsListPage(context);
}

async function runGroupAction(action, id) {
  const group = await appState.repositories.groupInstances.get(id);
  if (!group) throw new Error('Skupina nebyla nalezena.');
  if (action === 'edit') return openGroupDialog(group);
  if (action === 'activate') { await appState.academicService.setGroupStatus(id, 'active'); await appState.refreshAcademic(); showToast('Skupina je znovu aktivní.', 'success'); return; }
  if (action === 'hide') { await appState.academicService.setGroupStatus(id, 'hidden'); await appState.refreshAcademic(); showToast('Skupina byla dočasně skryta.', 'success'); return; }
  if (action === 'archive') return confirmAction({ title: `Archivovat ${group.displayName}?`, message: 'Skupina zmizí z aktivního přehledu, ale celá její historie zůstane zachována.', confirmLabel: 'Archivovat skupinu', onConfirm: async () => { await appState.academicService.setGroupStatus(id, 'archived'); await appState.refreshAcademic(); showToast('Skupina byla archivována.', 'success'); navigate('groups', [], { status: 'archived', year: group.schoolYearId }); } });
  if (action === 'delete') return confirmAction({ title: `Definitivně odstranit ${group.displayName}?`, message: 'Tato operace je povolena pouze u prázdné skupiny bez navazující historie. Nelze ji vrátit zpět.', confirmLabel: 'Odstranit skupinu', danger: true, onConfirm: async () => { await appState.academicService.removeGroup(id); await appState.refreshAcademic(); showToast('Prázdná skupina byla odstraněna.', 'success'); navigate('groups'); } });
  return null;
}

export async function bindGroupsPage(context) {
  document.querySelectorAll('[data-open-quick-setup]').forEach((button) => button.addEventListener('click', openQuickSetupDialog));
  document.querySelectorAll('[data-open-group]').forEach((button) => button.addEventListener('click', () => openGroupDialog()));
  document.querySelectorAll('[data-open-lesson]').forEach((button) => button.addEventListener('click', () => void openLessonDialog({ groupId: button.dataset.groupId })));
  document.querySelectorAll('[data-open-quick-lesson]').forEach((button) => button.addEventListener('click', () => void openQuickLessonDialog({ groupId: button.dataset.groupId })));
  document.querySelectorAll('[data-open-task]').forEach((button) => button.addEventListener('click', () => void openTaskDialog({ groupId: button.dataset.groupId })));
  document.querySelectorAll('[data-open-material]').forEach((button) => button.addEventListener('click', () => void openMaterialDialog({ groupId: button.dataset.groupId })));
  document.querySelectorAll('[data-open-reminder]').forEach((button) => button.addEventListener('click', () => void openReminderDialog({ groupId: button.dataset.groupId })));
  document.querySelectorAll('[data-group-action]').forEach((button) => button.addEventListener('click', async () => { try { await runGroupAction(button.dataset.groupAction, button.dataset.groupId); } catch (error) { showToast(error.message, 'error'); } }));
  const currentQuery = Object.fromEntries(context.query);
  document.querySelector('#group-year-filter')?.addEventListener('change', (event) => navigate('groups', [], { ...currentQuery, year: event.target.value }));
  document.querySelectorAll('[data-status-filter]').forEach((button) => button.addEventListener('click', () => navigate('groups', [], { ...currentQuery, status: button.dataset.statusFilter })));
  document.querySelector('#group-search-form')?.addEventListener('submit', (event) => { event.preventDefault(); const data = new FormData(event.currentTarget); navigate('groups', [], { ...currentQuery, q: String(data.get('q') || '').trim() }); });
}

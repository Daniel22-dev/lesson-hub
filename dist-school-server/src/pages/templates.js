import { appState } from '../core/appState.js';
import { APP_EVENTS } from '../core/constants.js';
import { eventBus } from '../core/eventBus.js';
import { escapeAttribute, escapeHtml } from '../core/html.js';
import { ACTIVITY_TYPES, LESSON_STATUSES, SKILL_TYPES, SUCCESS_RATINGS } from '../services/lessonService.js';
import { icon } from '../ui/icons.js';
import { confirmAction } from '../ui/modal.js';
import { navigate } from '../ui/router.js';
import { showToast } from '../ui/toast.js';
import { openAssignCycleDialog, openBulkPlanDialog, openCycleDialog, openTemplateDialog, openTemplateFromLessonDialog, openUseTemplateDialog } from '../ui/templateDialogs.js';
import { emptyState, sectionHeader, statusPill } from './shared.js';

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' }).format(new Date(String(value).includes('T') ? value : `${value}T12:00:00`));
}

function tabLink(tab, label, count = '') {
  return `<button type="button" data-template-tab="${tab}" class="${tab === currentTab() ? 'is-active' : ''}">${label}${count !== '' ? `<b>${count}</b>` : ''}</button>`;
}

function currentTab() {
  return new URLSearchParams(window.location.hash.split('?')[1] || '').get('tab') || 'templates';
}

function templateCard(template) {
  const activity = ACTIVITY_TYPES[template.activityType] || '';
  const skill = SKILL_TYPES[template.skillType] || '';
  return `<article class="template-card ${template.favorite ? 'template-card--favorite' : ''}" data-template-id="${template.id}">
    <div class="template-card__top">
      <div><div class="template-card__pills">${template.favorite ? statusPill('Oblíbená', 'success', 'check') : ''}${template.subject ? statusPill(template.subject.shortName || template.subject.name, 'info', 'book') : statusPill('Univerzální', 'neutral', 'book')}</div><h3>${escapeHtml(template.title)}</h3><p>${escapeHtml(template.description || template.topic || 'Bez doplňujícího popisu.')}</p></div>
      <button class="icon-button" type="button" data-template-action="favorite" data-template-id="${template.id}" title="${template.favorite ? 'Odebrat z oblíbených' : 'Přidat do oblíbených'}">${icon(template.favorite ? 'check' : 'plus', 18)}</button>
    </div>
    <div class="template-card__meta"><span>${icon('plan', 16)} ${template.plannedDuration || 45} min</span>${activity ? `<span>${escapeHtml(activity)}</span>` : ''}${skill ? `<span>${escapeHtml(skill)}</span>` : ''}${template.level ? `<span>${escapeHtml(template.level)}</span>` : ''}</div>
    <div class="template-card__outline">${escapeHtml(template.plannedOutline || 'Plánovaný průběh zatím není vyplněn.')}</div>
    <div class="template-card__footer"><span>Použito ${Number(template.useCount || 0)}×${template.lastUsedAt ? ` · naposledy ${formatDate(template.lastUsedAt)}` : ''}</span><div><button class="button button--ghost button--small" type="button" data-template-action="edit" data-template-id="${template.id}">Upravit</button><button class="button button--secondary button--small" type="button" data-template-action="bulk" data-template-id="${template.id}">Více skupin</button><button class="button button--primary button--small" type="button" data-template-action="use" data-template-id="${template.id}">Použít</button><button class="icon-button icon-button--small" type="button" data-template-action="archive" data-template-id="${template.id}" title="Archivovat">${icon('archive', 17)}</button></div></div>
  </article>`;
}

function archivedTemplateCard(template) {
  return `<article class="template-card template-card--archived"><div><h3>${escapeHtml(template.title)}</h3><p>${escapeHtml(template.description || template.topic || 'Archivovaná šablona')}</p></div><div class="template-card__footer"><span>Archivovaná šablona</span><button class="button button--secondary button--small" type="button" data-template-action="restore" data-template-id="${template.id}">Obnovit</button></div></article>`;
}

function reusableLessonCard(lesson) {
  const rating = SUCCESS_RATINGS[lesson.successRating];
  return `<article class="reusable-lesson-card">
    <div><span>${formatDate(lesson.date)} · ${escapeHtml(lesson.group?.displayName || '')}</span><h3>${escapeHtml(lesson.title)}</h3><p>${escapeHtml(lesson.reflectionWorked || lesson.topic || lesson.actualProgress || 'Bez doplňující reflexe.')}</p></div>
    <div class="reusable-lesson-card__meta">${rating ? statusPill(rating.label, rating.variant, 'check') : ''}${lesson.reuseDecision ? statusPill('Označeno pro opakování', 'info', 'restore') : ''}</div>
    <div class="reusable-lesson-card__actions"><a class="button button--ghost button--small" href="#/plan/${lesson.id}">Detail</a><button class="button button--secondary button--small" type="button" data-save-lesson-template="${lesson.id}">${icon('plus', 16)} Uložit jako šablonu</button></div>
  </article>`;
}

function cycleCard(cycle, assignments) {
  const assigned = assignments.filter((item) => item.cycle.id === cycle.id);
  return `<article class="cycle-card ${cycle.favorite ? 'cycle-card--favorite' : ''}">
    <div class="cycle-card__header"><div><div class="cycle-card__pills">${cycle.favorite ? statusPill('Oblíbený', 'success', 'check') : ''}${statusPill(`${cycle.steps.length} kroků`, 'neutral', 'restore')}</div><h3>${escapeHtml(cycle.name)}</h3><p>${escapeHtml(cycle.description || `Každý krok trvá ${cycle.stepDurationWeeks || 1} týden.`)}</p></div><span class="cycle-card__count">${assigned.length}<small>skupin</small></span></div>
    <ol class="cycle-steps">${cycle.steps.map((step, index) => `<li class="cycle-step cycle-step--${escapeAttribute(step.colorToken || 'teal')}"><span>${index + 1}</span><div><strong>${escapeHtml(step.label)}</strong><small>${escapeHtml(SKILL_TYPES[step.skillType] || 'Jiné')}</small></div></li>`).join('')}</ol>
    ${assigned.length ? `<div class="cycle-assignment-list">${assigned.slice(0, 6).map((item) => `<a href="#/groups/${item.group.id}"><span class="color-swatch color-swatch--${escapeAttribute(item.step?.colorToken || item.group.colorToken || 'teal')}"></span><div><strong>${escapeHtml(item.group.displayName)}</strong><small>${escapeHtml(item.step?.label || 'Bez aktuálního kroku')} · ${item.step ? `${formatDate(item.step.startDate)}–${formatDate(item.step.endDate)}` : 'není možné vypočítat'}</small></div>${icon('chevron', 16)}</a>`).join('')}</div>` : '<p class="cycle-card__empty">Cyklus zatím není přiřazen žádné skupině.</p>'}
    <div class="cycle-card__actions"><button class="button button--ghost button--small" type="button" data-cycle-action="edit" data-cycle-id="${cycle.id}">Upravit</button><button class="button button--primary button--small" type="button" data-cycle-action="assign" data-cycle-id="${cycle.id}">Přiřadit skupinám</button><button class="icon-button icon-button--small" type="button" data-cycle-action="archive" data-cycle-id="${cycle.id}" title="Archivovat">${icon('archive', 17)}</button></div>
  </article>`;
}

async function templatesTab(context, summary) {
  const query = context.query.get('q') || '';
  const favoritesOnly = context.query.get('favorite') === '1';
  const status = context.query.get('status') === 'archived' ? 'archived' : 'active';
  const [templates, successful] = await Promise.all([
    appState.templateCycleService.listTemplates({ query, status, favoritesOnly }),
    appState.templateCycleService.successfulLessons({ limit: 8 }),
  ]);
  return `
    <section class="template-summary"><div><span>Aktivní šablony</span><strong>${summary.activeTemplates}</strong></div><div><span>Oblíbené</span><strong>${summary.favoriteTemplates}</strong></div><div><span>Povedené hodiny</span><strong>${summary.reusableLessons}</strong></div><div><span>Přiřazené cykly</span><strong>${summary.assignedGroups}</strong></div></section>
    <form id="template-filter-form" class="template-toolbar"><label class="search-field search-field--compact">${icon('search', 18)}<input name="q" type="search" value="${escapeAttribute(query)}" placeholder="Hledat šablonu, téma nebo předmět"><button class="search-submit" type="submit" aria-label="Hledat">${icon('chevron', 17)}</button></label><label class="check-card check-card--compact"><input type="checkbox" name="favorite" value="1" ${favoritesOnly ? 'checked' : ''}><span><strong>Jen oblíbené</strong></span></label><div class="segmented-control"><button type="button" data-template-status="active" class="${status === 'active' ? 'is-active' : ''}">Aktivní <b>${summary.activeTemplates}</b></button><button type="button" data-template-status="archived" class="${status === 'archived' ? 'is-active' : ''}">Archiv <b>${summary.archivedTemplates}</b></button></div></form>
    <section class="template-grid">${templates.length ? templates.map(status === 'archived' ? archivedTemplateCard : templateCard).join('') : emptyState({ iconName: 'book', title: status === 'archived' ? 'Archiv šablon je prázdný' : 'Zatím nemáte žádnou šablonu', text: status === 'archived' ? 'Archivované šablony se zobrazí zde.' : 'Vytvořte vlastní předlohu nebo ji uložte z povedené starší hodiny.', action: status === 'active' ? `<button class="button button--primary" type="button" data-open-template>${icon('plus', 18)} Vytvořit první šablonu</button>` : '' })}</section>
    ${status === 'active' ? `<section class="content-card">${sectionHeader('Povedené hodiny k opakování', 'Reflexe a označení „použít znovu“ promění historii v praktickou osobní knihovnu.')}${successful.length ? `<div class="reusable-lesson-grid">${successful.map(reusableLessonCard).join('')}</div>` : emptyState({ iconName: 'restore', title: 'Zatím bez doporučených hodin', text: 'Po uskutečněné hodině doplňte reflexi a označte ji jako povedenou nebo vhodnou k opakování.' })}</section>` : ''}`;
}

async function cyclesTab(summary) {
  const [cycles, assignments] = await Promise.all([
    appState.templateCycleService.listCycles({ status: 'active' }),
    appState.templateCycleService.cycleAssignments(),
  ]);
  const unassigned = (await appState.academicService.listGroups({ schoolYearId: appState.academic.currentYear?.id || '', status: 'active' })).filter((group) => !group.cycleId);
  return `
    <section class="cycle-intro"><div class="cycle-intro__main"><span class="cycle-intro__icon">${icon('restore', 26)}</span><div><h2>Volitelná cyklická organizace</h2><p>Cyklus pouze pomáhá plánovat dovednosti nebo témata v opakovaných blocích. Skupiny bez cyklu fungují beze změny.</p></div></div><div class="cycle-intro__stats"><div><strong>${summary.activeCycles}</strong><span>aktivních cyklů</span></div><div><strong>${summary.assignedGroups}</strong><span>přiřazených skupin</span></div></div></section>
    ${unassigned.length ? `<aside class="notice notice--info">${icon('warning', 20)}<div><strong>${unassigned.length} skupin bez cyklu</strong><p>Je to v pořádku — cyklický systém je dobrovolný. Přiřazení lze provést z konkrétní karty cyklu.</p></div></aside>` : ''}
    <section class="cycle-grid">${cycles.length ? cycles.map((cycle) => cycleCard(cycle, assignments)).join('') : emptyState({ iconName: 'restore', title: 'Zatím nemáte žádný výukový cyklus', text: 'Můžete použít například týden poslechu, mluvení, čtení, psaní a gramatiky.', action: `<button class="button button--primary" type="button" data-open-cycle>${icon('plus', 18)} Vytvořit první cyklus</button>` })}</section>`;
}

async function bulkTab(summary) {
  const syncSummary = await appState.syncService.summary();
  return `
    <div class="two-column-grid">
      <section class="content-card bulk-operation-card">${sectionHeader('Hromadné plánování', 'Jedna šablona vytvoří samostatnou plánovanou hodinu pro každou vybranou skupinu.')}<div class="bulk-operation-card__body"><span>${icon('plan', 34)}</span><div><strong>Naplánovat více skupinám</strong><p>Praktické pro paralelní skupiny, stejné ročníky nebo opakovanou aktivitu.</p></div></div><button class="button button--primary" type="button" data-open-bulk-plan ${summary.activeTemplates ? '' : 'disabled'}>${icon('plus', 17)} Spustit hromadné plánování</button>${summary.activeTemplates ? '' : '<small>Nejprve vytvořte alespoň jednu šablonu.</small>'}</section>
      <section class="content-card server-ready-card">${sectionHeader('Server-ready datové rozhraní', 'Lokální aplikace zůstává funkční bez serveru, ale doménové změny lze připravit pro budoucí synchronizaci.')}<dl><div><dt>API kontrakt</dt><dd>${escapeHtml(syncSummary.contractVersion)}</dd></div><div><dt>Čekající změny</dt><dd>${syncSummary.pending}</dd></div><div><dt>Neúspěšné</dt><dd>${syncSummary.failed}</dd></div><div><dt>Synchronizované</dt><dd>${syncSummary.synced}</dd></div></dl><div class="server-ready-card__actions"><button class="button button--secondary" type="button" data-prepare-sync>${icon('database', 17)} Připravit frontu z auditu</button>${syncSummary.synced ? '<button class="button button--ghost" type="button" data-clear-synced>Vyčistit synchronizované</button>' : ''}</div><p class="privacy-hint">Tato verze nic neodesílá. Fronta pouze ověřuje stabilní formát změn pro budoucí serverovou vrstvu.</p></section>
    </div>
    <section class="content-card">${sectionHeader('Rozšířená lokální verze', 'Co je nyní připraveno před přechodem na server.')}<div class="readiness-grid"><div>${icon('book', 21)}<strong>Šablony</strong><span>${summary.activeTemplates} aktivních předloh</span></div><div>${icon('restore', 21)}<strong>Cykly</strong><span>${summary.assignedGroups} přiřazených skupin</span></div><div>${icon('materials', 21)}<strong>Opakované použití</strong><span>${summary.reusableLessons} povedených hodin</span></div><div>${icon('database', 21)}<strong>Datový kontrakt</strong><span>Repository + API gateway v1</span></div></div></section>`;
}

export async function templatesPage(context) {
  const tab = context.query.get('tab') || 'templates';
  const summary = await appState.templateCycleService.summary();
  const contentByTab = tab === 'cycles' ? await cyclesTab(summary) : tab === 'bulk' ? await bulkTab(summary) : await templatesTab(context, summary);
  return {
    title: 'Šablony a cykly',
    description: 'Opakované použití povedených hodin a volitelná dlouhodobá organizace výuky.',
    actions: tab === 'cycles' ? `<button class="button button--primary" type="button" data-open-cycle>${icon('plus', 18)} Nový cyklus</button>` : tab === 'bulk' ? `<button class="button button--primary" type="button" data-open-bulk-plan>${icon('plan', 18)} Hromadně plánovat</button>` : `<button class="button button--secondary" type="button" data-open-bulk-plan>${icon('plan', 18)} Více skupin</button><button class="button button--primary" type="button" data-open-template>${icon('plus', 18)} Nová šablona</button>`,
    content: `<nav class="workspace-tabs workspace-tabs--prominent">${tabLink('templates', 'Šablony', summary.activeTemplates)}${tabLink('cycles', 'Výukové cykly', summary.activeCycles)}${tabLink('bulk', 'Hromadně a server-ready')}</nav>${contentByTab}`,
  };
}

export function bindTemplatesPage(context) {
  document.querySelectorAll('[data-template-tab]').forEach((button) => button.addEventListener('click', () => navigate('templates', [], { tab: button.dataset.templateTab })));
  document.querySelectorAll('[data-open-template]').forEach((button) => button.addEventListener('click', () => openTemplateDialog()));
  document.querySelectorAll('[data-open-cycle]').forEach((button) => button.addEventListener('click', () => openCycleDialog()));
  document.querySelectorAll('[data-open-bulk-plan]').forEach((button) => button.addEventListener('click', () => void openBulkPlanDialog(button.dataset.templateId || '')));
  document.querySelector('#template-filter-form')?.addEventListener('submit', (event) => { event.preventDefault(); const data = new FormData(event.currentTarget); navigate('templates', [], { tab: 'templates', q: String(data.get('q') || '').trim(), favorite: data.has('favorite') ? '1' : '', status: context.query.get('status') || 'active' }); });
  document.querySelector('#template-filter-form input[name="favorite"]')?.addEventListener('change', () => document.querySelector('#template-filter-form')?.requestSubmit());
  document.querySelectorAll('[data-template-status]').forEach((button) => button.addEventListener('click', () => navigate('templates', [], { tab: 'templates', status: button.dataset.templateStatus, q: context.query.get('q') || '', favorite: context.query.get('favorite') || '' })));
  document.querySelectorAll('[data-template-action]').forEach((button) => button.addEventListener('click', async () => {
    try {
      const template = await appState.templateCycleService.getTemplate(button.dataset.templateId);
      const action = button.dataset.templateAction;
      if (!template) throw new Error('Šablona nebyla nalezena.');
      if (action === 'edit') return openTemplateDialog(template);
      if (action === 'use') return openUseTemplateDialog(template);
      if (action === 'bulk') return openBulkPlanDialog(template.id);
      if (action === 'favorite') { await appState.templateCycleService.setTemplateFavorite(template.id, !template.favorite); showToast(template.favorite ? 'Šablona byla odebrána z oblíbených.' : 'Šablona byla označena jako oblíbená.', 'success'); return eventBus.emit(APP_EVENTS.templateChanged); }
      if (action === 'restore') { await appState.templateCycleService.restoreTemplate(template.id); showToast('Šablona byla obnovena.', 'success'); return eventBus.emit(APP_EVENTS.templateChanged); }
      if (action === 'archive') return confirmAction({ title: 'Archivovat šablonu?', message: 'Starší hodiny vytvořené z této šablony zůstanou beze změny.', confirmLabel: 'Archivovat', onConfirm: async () => { await appState.templateCycleService.archiveTemplate(template.id); showToast('Šablona byla archivována.', 'success'); eventBus.emit(APP_EVENTS.templateChanged); } });
    } catch (error) { showToast(error.message, 'error'); }
  }));
  document.querySelectorAll('[data-save-lesson-template]').forEach((button) => button.addEventListener('click', async () => { const detail = await appState.lessonService.getLesson(button.dataset.saveLessonTemplate); if (detail?.lesson) openTemplateFromLessonDialog(detail.lesson); }));
  document.querySelectorAll('[data-cycle-action]').forEach((button) => button.addEventListener('click', async () => {
    try {
      const cycle = await appState.templateCycleService.getCycle(button.dataset.cycleId);
      if (!cycle) throw new Error('Cyklus nebyl nalezen.');
      if (button.dataset.cycleAction === 'edit') return openCycleDialog(cycle);
      if (button.dataset.cycleAction === 'assign') return openAssignCycleDialog(cycle);
      if (button.dataset.cycleAction === 'archive') return confirmAction({ title: 'Archivovat cyklus?', message: 'Cyklus lze archivovat pouze tehdy, když není přiřazen aktivním skupinám.', confirmLabel: 'Archivovat', onConfirm: async () => { await appState.templateCycleService.archiveCycle(cycle.id); showToast('Cyklus byl archivován.', 'success'); eventBus.emit(APP_EVENTS.cycleChanged); } });
    } catch (error) { showToast(error.message, 'error'); }
  }));
  document.querySelector('[data-prepare-sync]')?.addEventListener('click', async () => { const created = await appState.syncService.prepareFromAudit(); showToast(`Do server-ready fronty bylo přidáno ${created.length} změn.`, 'success'); eventBus.emit(APP_EVENTS.syncChanged); });
  document.querySelector('[data-clear-synced]')?.addEventListener('click', async () => { const count = await appState.syncService.clearSynced(); showToast(`Odstraněno ${count} synchronizovaných položek.`, 'success'); eventBus.emit(APP_EVENTS.syncChanged); });
}

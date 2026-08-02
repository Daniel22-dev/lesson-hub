import { appState } from '../core/appState.js';
import { APP_EVENTS, ROUTES } from '../core/constants.js';
import { eventBus } from '../core/eventBus.js';
import { escapeHtml } from '../core/html.js';
import { SUBSTITUTION_ITEM_STATUSES } from '../services/substitutionService.js';
import { icon } from '../ui/icons.js';
import { confirmAction } from '../ui/modal.js';
import { showToast } from '../ui/toast.js';
import { openSubstitutionItemDialog, openSubstitutionPeriodDialog, openSubstitutionPlanDialog, openSubstitutionProgressDialog } from '../ui/substitutionDialogs.js';
import { emptyState, statusPill } from './shared.js';

function date(value) {
  if (!value) return 'Bez data';
  return new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' }).format(new Date(value));
}
function periodStatus(status) {
  return ({ draft: ['Koncept', 'neutral'], active: ['Aktivní', 'success'], closed: ['Uzavřeno', 'neutral'] })[status] || [status, 'neutral'];
}
function itemStatus(status) {
  const variant = status === 'completed' ? 'success' : ['partial', 'moved', 'adjusted'].includes(status) ? 'warning' : ['not_completed', 'impossible'].includes(status) ? 'danger' : 'neutral';
  return statusPill(SUBSTITUTION_ITEM_STATUSES[status] || status, variant);
}
function progress(bundle) {
  const items = (bundle.plans || []).flatMap((plan) => plan.items || []);
  return { total: items.length, complete: items.filter((item) => item.status === 'completed').length, partial: items.filter((item) => item.status === 'partial').length, open: items.filter((item) => item.status === 'pending').length };
}

function itemCard(item, canEditOwner) {
  return `<article class="substitution-item"><div class="substitution-item__main"><div class="substitution-item__title"><strong>${escapeHtml(item.title)}</strong>${itemStatus(item.status)}</div><p>${escapeHtml(item.topic || item.objective || item.instructions || 'Bez doplňujícího popisu.')}</p>${item.substituteNote ? `<blockquote>${escapeHtml(item.substituteNote)}</blockquote>` : ''}<small>${item.date ? `Plán: ${date(item.date)}` : 'Bez pevného data'}${item.realizedAt ? ` · Realizováno ${date(item.realizedAt)}` : ''}${item.updatedByName ? ` · ${escapeHtml(item.updatedByName)}` : ''}</small></div><div class="button-cluster"><button class="button button--small button--secondary" type="button" data-sub-progress="${item.id}">${icon('check',15)} Zapsat průběh</button>${canEditOwner ? `<button class="button button--small button--ghost" type="button" data-sub-item-edit="${item.id}">${icon('edit',15)} Upravit</button>` : ''}</div></article>`;
}

function planCard(plan, period, canEditOwner) {
  return `<section class="substitution-plan"><header><div><span class="topbar__eyebrow">${plan.planType === 'horizon' ? 'Plán pro období' : 'Plán po hodinách'}</span><h3>${escapeHtml(plan.title)}</h3><p>${escapeHtml(plan.groupName)}${plan.subjectName ? ` · ${escapeHtml(plan.subjectName)}` : ''}</p></div>${canEditOwner ? `<button class="button button--small button--ghost" type="button" data-sub-item-create="${plan.id}">${icon('plus',15)} Přidat úkol</button>` : ''}</header>${plan.instructions ? `<div class="substitution-instructions"><strong>Pokyny pro suplujícího</strong><p>${escapeHtml(plan.instructions)}</p></div>` : ''}${plan.studentInstructions ? `<div class="substitution-instructions substitution-instructions--student"><strong>Pokyny pro studenty</strong><p>${escapeHtml(plan.studentInstructions)}</p></div>` : ''}<div class="substitution-items">${(plan.items || []).map((item) => itemCard(item, canEditOwner)).join('') || '<p class="muted-text">Plán zatím neobsahuje jednotlivé úkoly.</p>'}</div></section>`;
}

function periodCard(period, role, profileId) {
  const canEditOwner = ['owner', 'admin'].includes(role) || period.ownerId === profileId;
  const [label, variant] = periodStatus(period.status);
  const stats = progress(period);
  return `<article class="substitution-period" data-period-id="${period.id}"><header class="substitution-period__header"><div><span class="topbar__eyebrow">${date(period.startDate)}–${date(period.endDate)}</span><h2>${escapeHtml(period.title)}</h2><p>${escapeHtml(period.teacherDisplayName || 'Nepřítomný učitel')}${period.summary ? ` · ${escapeHtml(period.summary)}` : ''}</p></div>${statusPill(label, variant)}</header><div class="substitution-summary-grid"><article><strong>${stats.total}</strong><span>položek</span></article><article><strong>${stats.complete}</strong><span>splněno</span></article><article><strong>${stats.partial}</strong><span>částečně</span></article><article><strong>${stats.open}</strong><span>čeká</span></article></div><div class="substitution-period__actions">${canEditOwner ? `<button class="button button--secondary button--small" type="button" data-sub-plan-create="${period.id}">${icon('plus',15)} Přidat skupinu</button><button class="button button--ghost button--small" type="button" data-sub-period-edit="${period.id}">${icon('edit',15)} Upravit období</button>${period.status !== 'active' ? `<button class="button button--primary button--small" type="button" data-sub-period-status="${period.id}" data-next-status="active">Aktivovat</button>` : `<button class="button button--ghost button--small" type="button" data-sub-period-status="${period.id}" data-next-status="closed">Uzavřít</button>`}${period.status === 'closed' ? `<button class="button button--secondary button--small" type="button" data-sub-import="${period.id}">${icon('restore',15)} Převzít do historie</button>` : ''}` : ''}</div><div class="substitution-plans">${(period.plans || []).map((plan) => planCard(plan, period, canEditOwner)).join('') || '<p class="muted-text">Pro toto období zatím nejsou připraveny žádné skupiny.</p>'}</div></article>`;
}

async function model(tab) {
  const server = appState.serverService;
  if (!server?.isAuthenticated) return { authenticated: false, items: [], role: '', profileId: '' };
  const items = tab === 'active' ? await appState.substitutionService.listActive() : await appState.substitutionService.listMine();
  return { authenticated: true, items, role: server.role, profileId: server.profile?.id || '' };
}

export async function substitutionPage(context) {
  const tab = context.query.get('tab') === 'active' ? 'active' : 'mine';
  const data = await model(tab);
  if (!data.authenticated) {
    return { title: 'Zastupování', description: 'Kontinuita výuky při delší nepřítomnosti učitele.', content: emptyState({ iconName: 'shield', title: 'Zastupování vyžaduje serverovou relaci', text: 'Přihlaste se k Lesson Hub Serveru. Soukromé lokální poznámky zůstanou mimo sdílený zastupovací prostor.', action: `<a class="button button--primary" href="#/${ROUTES.server}">Otevřít serverové centrum</a>` }) };
  }
  const tabs = `<nav class="detail-tabs" aria-label="Režimy zastupování"><a href="#/${ROUTES.substitution}?tab=mine" class="${tab === 'mine' ? 'is-active' : ''}">Moje zastupování</a><a href="#/${ROUTES.substitution}?tab=active" class="${tab === 'active' ? 'is-active' : ''}">Aktivní zastupování</a></nav>`;
  return {
    title: 'Zastupování',
    description: 'Vybrané plány pro suplující učitele bez zpřístupnění soukromého zápisníku.',
    actions: tab === 'mine' && data.role !== 'substitute' ? `<button class="button button--primary" type="button" data-sub-period-create>${icon('plus',16)} Nové zastupování</button>` : '',
    content: `${tabs}<section class="substitution-page">${data.items.map((period) => periodCard(period, data.role, data.profileId)).join('') || emptyState({ iconName: 'calendar', title: tab === 'active' ? 'Žádné aktivní zastupování' : 'Zatím nemáte zastupovací období', text: tab === 'active' ? 'Až některý učitel zveřejní podklady, zobrazí se zde.' : 'Vytvořte období, přidejte skupiny a zveřejněte pouze informace určené kolegům.' })}</section>`,
  };
}

export function bindSubstitutionPage() {
  document.querySelectorAll('[data-sub-period-create]').forEach((button) => button.addEventListener('click', () => openSubstitutionPeriodDialog()));
  document.querySelectorAll('[data-sub-period-edit]').forEach((button) => button.addEventListener('click', async () => { const period = (await appState.substitutionService.listMine()).find((item) => item.id === button.dataset.subPeriodEdit); if (period) openSubstitutionPeriodDialog(period); }));
  document.querySelectorAll('[data-sub-period-status]').forEach((button) => button.addEventListener('click', async () => { await appState.substitutionService.updatePeriod(button.dataset.subPeriodStatus, { status: button.dataset.nextStatus }); eventBus.emit(APP_EVENTS.substitutionChanged, {}); showToast(button.dataset.nextStatus === 'active' ? 'Zastupování bylo zveřejněno.' : 'Zastupování bylo uzavřeno.', 'success'); }));
  document.querySelectorAll('[data-sub-plan-create]').forEach((button) => button.addEventListener('click', async () => { const period = (await appState.substitutionService.listMine()).find((item) => item.id === button.dataset.subPlanCreate); if (period) openSubstitutionPlanDialog(period); }));
  document.querySelectorAll('[data-sub-item-create]').forEach((button) => button.addEventListener('click', async () => { const periods = await appState.substitutionService.listMine(); const plan = periods.flatMap((period) => period.plans || []).find((item) => item.id === button.dataset.subItemCreate); if (plan) openSubstitutionItemDialog(plan); }));
  document.querySelectorAll('[data-sub-item-edit]').forEach((button) => button.addEventListener('click', async () => { const periods = await appState.substitutionService.listMine(); const plan = periods.flatMap((period) => period.plans || []).find((candidate) => candidate.items?.some((item) => item.id === button.dataset.subItemEdit)); const item = plan?.items.find((candidate) => candidate.id === button.dataset.subItemEdit); if (plan && item) openSubstitutionItemDialog(plan, item); }));
  document.querySelectorAll('[data-sub-progress]').forEach((button) => button.addEventListener('click', async () => { const periods = [...await appState.substitutionService.listActive(), ...await appState.substitutionService.listMine()]; const item = periods.flatMap((period) => period.plans || []).flatMap((plan) => plan.items || []).find((candidate) => candidate.id === button.dataset.subProgress); if (item) openSubstitutionProgressDialog(item); }));
  document.querySelectorAll('[data-sub-import]').forEach((button) => button.addEventListener('click', () => confirmAction({ title: 'Převzít zastupování do historie?', message: 'Splněné a částečně splněné položky vytvoří nové záznamy suplovaných hodin. Duplicitní položky se přeskočí.', confirmLabel: 'Převzít', onConfirm: async () => { const result = await appState.substitutionService.importPeriodToHistory(button.dataset.subImport); showToast(`Do historie bylo převzato ${result.imported.length} hodin${result.skipped.length ? `, ${result.skipped.length} plánů přeskočeno` : ''}.`, result.skipped.length ? 'info' : 'success'); eventBus.emit(APP_EVENTS.lessonChanged, {}); eventBus.emit(APP_EVENTS.substitutionChanged, {}); } }))); 
}

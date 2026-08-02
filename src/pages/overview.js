import { appState } from '../core/appState.js';
import { escapeAttribute, escapeHtml } from '../core/html.js';
import { icon } from '../ui/icons.js';
import { openGroupDialog, openQuickSetupDialog } from '../ui/academicDialogs.js';
import { openLessonDialog, openQuickLessonDialog } from '../ui/lessonDialogs.js';
import { openReminderDialog, openTaskDialog } from '../ui/workDialogs.js';
import { openMaterialDialog } from '../ui/materialDialogs.js';
import { LESSON_STATUSES } from '../services/lessonService.js';
import { sectionHeader, statusPill } from './shared.js';

function formatToday() {
  return new Intl.DateTimeFormat('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
}

function formatDate(value) {
  return new Intl.DateTimeFormat('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric' }).format(new Date(`${value}T12:00:00`));
}

function lessonPill(status) {
  const meta = LESSON_STATUSES[status] ?? LESSON_STATUSES.draft;
  return statusPill(meta.label, meta.variant, status === 'completed' ? 'check' : status === 'unfinished' ? 'warning' : 'plan');
}

function todayLesson(lesson) {
  return `<article class="today-lesson today-lesson--${lesson.status}">
    <div class="today-lesson__time"><strong>${escapeHtml(lesson.startTime || '—')}</strong><span>#${lesson.sequenceNumber || '—'}</span></div>
    <div class="today-lesson__main"><span>${escapeHtml(lesson.group?.displayName || 'Neznámá skupina')} · ${escapeHtml(lesson.subject?.shortName || lesson.subject?.name || '')}</span><h3>${escapeHtml(lesson.title)}</h3><p>${escapeHtml(lesson.status === 'completed' ? lesson.endedAtText || lesson.actualProgress || 'Hodina je dokončena.' : lesson.plannedOutline || lesson.objectives || 'Základní příprava je vytvořena.')}</p></div>
    <div class="today-lesson__actions">${lessonPill(lesson.status)}<a class="button button--secondary button--small" href="#/plan/${lesson.id}">Otevřít</a></div>
  </article>`;
}

function attentionItem(lesson) {
  const title = lesson.status === 'unfinished' ? 'Nedokončená hodina' : lesson.status === 'in_progress' ? 'Rozpracovaná hodina' : 'Koncept vyžaduje doplnění';
  return `<a class="attention-item" href="#/plan/${lesson.id}"><span class="attention-item__icon">${icon(lesson.status === 'unfinished' ? 'warning' : 'edit', 18)}</span><div><strong>${escapeHtml(title)} · ${escapeHtml(lesson.group?.displayName || '')}</strong><small>${escapeHtml(formatDate(lesson.date))} · ${escapeHtml(lesson.title)}</small></div>${icon('chevron', 17)}</a>`;
}

function upcomingItem(lesson) {
  return `<a class="upcoming-item" href="#/plan/${lesson.id}"><div><span>${escapeHtml(formatDate(lesson.date))}${lesson.startTime ? ` · ${escapeHtml(lesson.startTime)}` : ''}</span><strong>${escapeHtml(lesson.title)}</strong><small>${escapeHtml(lesson.group?.displayName || '')} · ${escapeHtml(lesson.subject?.shortName || lesson.subject?.name || '')}</small></div>${lessonPill(lesson.status)}</a>`;
}

function workItem(item, type) {
  const isTask = type === 'task';
  const context = [item.group?.displayName, item.subject?.shortName || item.subject?.name].filter(Boolean).join(' · ') || 'Osobní záznam';
  const timing = isTask
    ? item.nextLessonTrigger ? 'Při příští hodině' : item.dueDate ? `Termín ${formatDate(item.dueDate)}` : 'Bez termínu'
    : item.triggerType === 'date' ? formatDate(item.triggerDate) : 'Při příští hodině';
  return `<a class="attention-item attention-item--work" href="#/work?tab=${isTask ? 'tasks' : 'reminders'}${item.group?.id ? `&group=${item.group.id}` : ''}"><span class="attention-item__icon">${icon(isTask ? 'check' : 'warning', 18)}</span><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(context)} · ${escapeHtml(timing)}</small></div>${icon('chevron', 17)}</a>`;
}

async function compactGroup(group) {
  const continuity = await appState.lessonService.groupContinuity(group.id);
  return `
    <a class="dashboard-group" href="#/groups/${group.id}">
      <span class="subject-monogram subject-monogram--${group.colorToken}">${escapeHtml(group.subject?.shortName || '—')}</span>
      <span><strong>${escapeHtml(group.displayName)}</strong><small>${continuity.lastLesson ? `Naposledy: ${escapeHtml(continuity.lastLesson.title)}` : `${escapeHtml(group.subject?.name || 'Bez předmětu')} · zatím bez hodiny`}</small></span>
      <span class="dashboard-group__state">${continuity.nextLesson ? `${escapeHtml(formatDate(continuity.nextLesson.date))} · ${escapeHtml(continuity.nextLesson.title)}` : 'Bez dalšího plánu'} ${icon('chevron', 17)}</span>
    </a>`;
}

export async function overviewPage() {
  const currentYear = appState.academic.currentYear;
  const groups = currentYear ? await appState.academicService.listGroups({ schoolYearId: currentYear.id, status: 'active' }) : [];
  const [dashboard, workDashboard, materialSummary, templateSummary, cycleAssignments] = currentYear ? await Promise.all([
    appState.lessonService.dashboard({ schoolYearId: currentYear.id }),
    appState.workService.dashboard({ schoolYearId: currentYear.id }),
    appState.materialService.summary(),
    appState.templateCycleService.summary(),
    appState.templateCycleService.cycleAssignments(),
  ]) : [{ today: [], attention: [], upcoming: [], recent: [] }, { tasks: [], reminders: [], openTaskCount: 0, overdueTaskCount: 0, activeReminderCount: 0, urgentCount: 0 }, { total: 0, linked: 0, unlinked: 0, archived: 0, studentFacing: 0, favorites: 0 }, { activeTemplates: 0, activeCycles: 0, assignedGroups: 0, reusableLessons: 0 }, []];
  const groupMarkup = await Promise.all(groups.slice(0, 6).map(compactGroup));
  const isEmpty = !currentYear;
  const content = `
    <section class="hero-panel hero-panel--lesson">
      <div>
        <span class="hero-panel__label">${escapeHtml(formatToday())}</span>
        <h2>${isEmpty ? 'Připravte Lesson Hub na svou výuku' : dashboard.today.length ? `Dnes vás čeká ${dashboard.today.length} ${dashboard.today.length === 1 ? 'hodina' : dashboard.today.length <= 4 ? 'hodiny' : 'hodin'}` : `Váš pracovní prostor pro ${escapeHtml(currentYear.label)}`}</h2>
        <p>${isEmpty ? 'Vytvořte školní rok, předmět a první skupinu. Lesson Hub pak začne uchovávat jejich dlouhodobou kontinuitu.' : dashboard.today.length ? 'Otevřete připravenou hodinu nebo začněte rychlým zápisem přímo během výuky.' : 'Dnes nemáte naplánovanou žádnou hodinu. Můžete připravit další výuku nebo doplnit starší záznamy.'}</p>
        ${isEmpty ? `<button class="button button--primary hero-panel__action" type="button" data-open-quick-setup>${icon('plus', 18)} Spustit rychlé nastavení</button>` : `<div class="hero-panel__actions"><button class="button button--primary" type="button" data-open-quick-lesson>${icon('edit', 18)} Rychlý zápis</button><button class="button button--secondary" type="button" data-open-lesson>${icon('plus', 18)} Naplánovat hodinu</button></div>`}
      </div>
      <div class="hero-panel__metric"><span>Stav dne</span><strong>${dashboard.attention.length + workDashboard.overdueTaskCount ? `${dashboard.attention.length + workDashboard.overdueTaskCount} k řešení` : 'V pořádku'}</strong>${statusPill('Vlna 7', 'success', 'check')}</div>
    </section>

    <section class="dashboard-grid">
      <article class="summary-card summary-card--accent"><div class="summary-card__icon">${icon('plan', 22)}</div><div><span>Dnešní hodiny</span><strong>${dashboard.today.length}</strong><small>${dashboard.today.filter((lesson) => lesson.status === 'completed').length} dokončeno</small></div></article>
      <article class="summary-card"><div class="summary-card__icon">${icon('warning', 22)}</div><div><span>Vyžaduje pozornost</span><strong>${dashboard.attention.length}</strong><small>Nedokončené a rozpracované záznamy</small></div></article>
      <article class="summary-card ${workDashboard.overdueTaskCount ? 'summary-card--warning' : ''}"><div class="summary-card__icon">${icon('check', 22)}</div><div><span>Povinnosti</span><strong>${workDashboard.openTaskCount + workDashboard.activeReminderCount}</strong><small>${workDashboard.overdueTaskCount} úkolů po termínu</small></div></article>
      <article class="summary-card"><div class="summary-card__icon">${icon('groups', 22)}</div><div><span>Aktivní skupiny</span><strong>${groups.length}</strong><small>${currentYear ? escapeHtml(currentYear.label) : 'Školní rok není nastaven'}</small></div></article>
      <a class="summary-card summary-card--link" href="#/materials"><div class="summary-card__icon">${icon('materials', 22)}</div><div><span>Materiály</span><strong>${materialSummary.total}</strong><small>${materialSummary.favorites} oblíbených</small></div></a>
      <a class="summary-card summary-card--link" href="#/templates"><div class="summary-card__icon">${icon('restore', 22)}</div><div><span>Šablony a cykly</span><strong>${templateSummary.activeTemplates}</strong><small>${templateSummary.assignedGroups} skupin s cyklem</small></div></a>
    </section>

    ${dashboard.today.length ? `<section class="content-card">${sectionHeader('Dnešní výuka', 'Připravené, probíhající a dokončené hodiny dneška.', '<a class="button button--ghost button--small" href="#/plan">Celý plán</a>')}<div class="today-lesson-list">${dashboard.today.map(todayLesson).join('')}</div></section>` : ''}

    <div class="two-column-grid">
      <section class="content-card">${sectionHeader('Vyžaduje pozornost', 'Záznamy, které potřebují dokončit nebo uzavřít.')}${dashboard.attention.length ? `<div class="attention-list">${dashboard.attention.slice(0, 6).map(attentionItem).join('')}</div>` : `<div class="calm-empty">${icon('check', 24)}<div><strong>Vše je v pořádku</strong><span>Nemáte rozpracovanou ani nedokončenou hodinu.</span></div></div>`}</section>
      <section class="content-card">${sectionHeader('Následuje', 'Nejbližší plánované hodiny.')}${dashboard.upcoming.length ? `<div class="upcoming-list">${dashboard.upcoming.slice(0, 6).map(upcomingItem).join('')}</div>` : `<div class="calm-empty calm-empty--neutral">${icon('plan', 24)}<div><strong>Zatím bez dalšího plánu</strong><span>Naplánujte první budoucí hodinu.</span></div></div>`}</section>
    </div>

    <section class="content-card">
      ${sectionHeader('Povinnosti a připomínky', 'Aktuální úkoly, termíny a věci navázané na příští hodinu.', '<a class="button button--ghost button--small" href="#/work">Otevřít centrum povinností</a>')}
      ${workDashboard.tasks.length || workDashboard.reminders.length ? `<div class="attention-list work-dashboard-list">${workDashboard.tasks.slice(0, 4).map((item) => workItem(item, 'task')).join('')}${workDashboard.reminders.slice(0, 4).map((item) => workItem(item, 'reminder')).join('')}</div>` : `<div class="calm-empty">${icon('check', 24)}<div><strong>Žádné aktuální povinnosti</strong><span>Nový úkol nebo připomínku můžete přidat přímo z dashboardu.</span></div><div class="calm-empty__actions"><button class="button button--secondary button--small" type="button" data-open-reminder>Připomínka</button><button class="button button--primary button--small" type="button" data-open-task>Nový úkol</button></div></div>`}
    </section>

    ${cycleAssignments.length ? `<section class="content-card">${sectionHeader('Aktuální výukové cykly', 'Volitelná orientace v tom, na kterou dovednost nebo téma právě připadá řada.', '<a class="button button--ghost button--small" href="#/templates?tab=cycles">Spravovat cykly</a>')}<div class="dashboard-cycle-list">${cycleAssignments.filter((item) => item.group.schoolYearId === currentYear.id).slice(0, 8).map((item) => `<a href="#/groups/${item.group.id}" class="dashboard-cycle-item dashboard-cycle-item--${escapeAttribute(item.step?.colorToken || item.group.colorToken || 'teal')}"><span>${icon('restore', 18)}</span><div><strong>${escapeHtml(item.group.displayName)}</strong><small>${escapeHtml(item.cycle.name)}</small></div><b>${escapeHtml(item.step?.label || 'Bez kroku')}</b></a>`).join('')}</div></section>` : ''}

    <section class="content-card">
      ${sectionHeader('Aktivní skupiny', currentYear ? `Rychlý vstup do pracovních prostorů školního roku ${currentYear.label}.` : 'Nejprve vytvořte základní strukturu výuky.', currentYear ? '<a class="button button--ghost button--small" href="#/groups">Zobrazit všechny skupiny</a>' : '')}
      ${groups.length ? `<div class="dashboard-group-list">${groupMarkup.join('')}</div>${groups.length > 6 ? `<a class="dashboard-more-link" href="#/groups">Dalších ${groups.length - 6} skupin</a>` : ''}` : `<div class="calm-empty calm-empty--neutral">${icon('groups', 24)}<div><strong>${currentYear ? 'V aktuálním roce zatím nejsou skupiny' : 'Začněte rychlým nastavením'}</strong><span>${currentYear ? 'Přidejte první skupinu nebo ji převeďte z minulého roku.' : 'Průvodce vytvoří rok, předmět i první skupinu.'}</span></div><button class="button button--secondary button--small" type="button" ${currentYear ? 'data-open-group' : 'data-open-quick-setup'}>${currentYear ? 'Přidat skupinu' : 'Spustit průvodce'}</button></div>`}
    </section>

    <aside class="notice notice--info">${icon('warning', 20)}<div><strong>Lokální verze</strong><p>Hodiny i rozpracované rychlé zápisy se ukládají do lokální databáze tohoto prohlížeče. Editor navíc průběžně ukládá rozepsaný koncept.</p></div></aside>`;

  return {
    title: 'Přehled',
    description: 'Co potřebujete vědět právě teď.',
    actions: currentYear ? `<button class="button button--ghost" type="button" data-open-material>${icon('materials', 17)} Materiál</button><button class="button button--ghost" type="button" data-open-reminder>${icon('warning', 17)} Připomínka</button><button class="button button--ghost" type="button" data-open-task>${icon('check', 17)} Úkol</button><button class="button button--secondary" type="button" data-open-quick-lesson>${icon('edit', 17)} Rychlý zápis</button>` : '',
    content,
  };
}

export function bindOverviewPage() {
  document.querySelectorAll('[data-open-quick-setup]').forEach((button) => button.addEventListener('click', openQuickSetupDialog));
  document.querySelectorAll('[data-open-group]').forEach((button) => button.addEventListener('click', () => openGroupDialog()));
  document.querySelectorAll('[data-open-lesson]').forEach((button) => button.addEventListener('click', () => void openLessonDialog()));
  document.querySelectorAll('[data-open-quick-lesson]').forEach((button) => button.addEventListener('click', () => void openQuickLessonDialog()));
  document.querySelectorAll('[data-open-material]').forEach((button) => button.addEventListener('click', () => void openMaterialDialog()));
  document.querySelectorAll('[data-open-task]').forEach((button) => button.addEventListener('click', () => void openTaskDialog()));
  document.querySelectorAll('[data-open-reminder]').forEach((button) => button.addEventListener('click', () => void openReminderDialog()));
}

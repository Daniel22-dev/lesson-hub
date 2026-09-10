import { appState } from '../core/appState.js';
import { escapeAttribute, escapeHtml } from '../core/html.js';
import { icon } from '../ui/icons.js';
import { openLessonDialog, openQuickLessonDialog } from '../ui/lessonDialogs.js';
import { openReflectionDialog, openReminderDialog, openTaskDialog } from '../ui/workDialogs.js';
import { openMaterialDialog } from '../ui/materialDialogs.js';
import { openDuplicateLessonDialog, openTemplateFromLessonDialog } from '../ui/templateDialogs.js';
import { confirmAction } from '../ui/modal.js';
import { navigate } from '../ui/router.js';
import { showToast } from '../ui/toast.js';
import { LESSON_STATUSES, REUSE_DECISIONS, SUCCESS_RATINGS, ACTIVITY_TYPES, SKILL_TYPES } from '../services/lessonService.js';
import { emptyState, sectionHeader, statusPill } from './shared.js';

const VIEW_META = Object.freeze({
  upcoming: ['Následující', ['draft', 'planned', 'in_progress']],
  all: ['Všechny hodiny', []],
  drafts: ['Koncepty', ['draft']],
  completed: ['Uskutečněné', ['completed', 'unfinished', 'substituted']],
});

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function isoOffset(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatDate(value, long = false) {
  if (!value) return 'Datum neuvedeno';
  return new Intl.DateTimeFormat('cs-CZ', long
    ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
    : { weekday: 'short', day: 'numeric', month: 'numeric' }).format(new Date(`${value}T12:00:00`));
}

function formatTime(value) {
  return value ? value : 'čas neurčen';
}

function lessonStatus(status) {
  const meta = LESSON_STATUSES[status] ?? LESSON_STATUSES.draft;
  const iconName = status === 'completed' ? 'check' : status === 'unfinished' ? 'warning' : status === 'cancelled' ? 'close' : 'plan';
  return statusPill(meta.label, meta.variant, iconName);
}

function lessonCard(lesson) {
  const continuity = lesson.status === 'completed' || lesson.status === 'unfinished'
    ? lesson.endedAtText || lesson.actualProgress || 'Průběh zatím nebyl doplněn.'
    : lesson.plannedOutline || lesson.objectives || 'Příprava zatím obsahuje pouze základní údaje.';
  return `
    <article class="lesson-card lesson-card--${escapeAttribute(lesson.status)}" data-lesson-card="${lesson.id}">
      <div class="lesson-card__date"><strong>${escapeHtml(formatDate(lesson.date))}</strong><span>${escapeHtml(formatTime(lesson.startTime))}</span></div>
      <div class="lesson-card__main">
        <div class="lesson-card__eyebrow"><span class="subject-dot subject-dot--${escapeAttribute(lesson.group?.colorToken || 'teal')}"></span>${escapeHtml(lesson.group?.displayName || 'Neznámá skupina')} · ${escapeHtml(lesson.subject?.shortName || lesson.subject?.name || 'bez předmětu')}</div>
        <h2>${escapeHtml(lesson.title)}</h2>
        <p>${escapeHtml(continuity)}</p>
        <div class="lesson-card__meta">${lesson.topic ? `<span>${icon('book', 15)} ${escapeHtml(lesson.topic)}</span>` : ''}${lesson.homework ? `<span>${icon('edit', 15)} Domácí úkol</span>` : ''}${lesson.sequenceNumber ? `<span>#${lesson.sequenceNumber}</span>` : ''}</div>
      </div>
      <div class="lesson-card__side">${lessonStatus(lesson.status)}<a class="button button--secondary button--small" href="#/plan/${lesson.id}">Otevřít ${icon('chevron', 15)}</a></div>
    </article>`;
}

function dayStrip(lessons) {
  const lessonCounts = new Map();
  for (const lesson of lessons) lessonCounts.set(lesson.date, (lessonCounts.get(lesson.date) || 0) + 1);
  return `<div class="week-strip">${Array.from({ length: 7 }, (_, index) => {
    const iso = isoOffset(index);
    const date = new Date(`${iso}T12:00:00`);
    return `<a class="week-day ${index === 0 ? 'is-today' : ''}" href="#/plan?view=all&from=${iso}&to=${iso}"><span>${new Intl.DateTimeFormat('cs-CZ', { weekday: 'short' }).format(date)}</span><strong>${date.getDate()}</strong><small>${lessonCounts.get(iso) || 0} h</small></a>`;
  }).join('')}</div>`;
}

async function planListPage(context) {
  const currentYear = appState.academic.currentYear;
  const view = VIEW_META[context.query.get('view')] ? context.query.get('view') : 'upcoming';
  const groupId = context.query.get('group') || '';
  const query = context.query.get('q') || '';
  const from = context.query.get('from') || (view === 'upcoming' ? todayIso() : '');
  const to = context.query.get('to') || '';
  const groups = currentYear ? await appState.academicService.listGroups({ schoolYearId: currentYear.id, includeAllStatuses: true, status: '' }) : [];
  const lessons = await appState.lessonService.listLessons({
    schoolYearId: currentYear?.id || '',
    groupInstanceId: groupId,
    statuses: VIEW_META[view][1],
    dateFrom: from,
    dateTo: to,
    query,
    sort: view === 'completed' || view === 'all' ? 'desc' : 'asc',
  });
  const allNear = await appState.lessonService.listLessons({ schoolYearId: currentYear?.id || '', dateFrom: todayIso(), dateTo: isoOffset(6) });

  return {
    title: 'Plán a hodiny',
    description: 'Budoucí přípravy, probíhající hodiny a uskutečněná výuka na jednom místě.',
    actions: `<button class="button button--secondary" type="button" data-open-quick-lesson>${icon('edit', 17)} Rychlý zápis</button><button class="button button--primary" type="button" data-open-lesson>${icon('plus', 18)} Naplánovat hodinu</button>`,
    content: `
      <section class="plan-hero">
        <div><span class="topbar__eyebrow">Nejbližších sedm dní</span><h2>Výuka v rytmu týdne</h2><p>Datum otevřete jedním kliknutím. Po skončení plánovanou hodinu převedete do skutečné historie bez přepisování.</p></div>
        ${dayStrip(allNear)}
      </section>
      <section class="group-toolbar plan-toolbar">
        <div class="segmented-control" aria-label="Režim plánu">${Object.entries(VIEW_META).map(([value, [label]]) => `<button type="button" class="${view === value ? 'is-active' : ''}" data-plan-view="${value}">${escapeHtml(label)}</button>`).join('')}</div>
        <label class="compact-field"><span>Skupina</span><select id="plan-group-filter"><option value="">Všechny skupiny</option>${groups.map((group) => `<option value="${group.id}" ${group.id === groupId ? 'selected' : ''}>${escapeHtml(group.displayName)}</option>`).join('')}</select></label>
        <form id="plan-search-form" class="search-field search-field--compact">${icon('search', 18)}<input name="q" value="${escapeAttribute(query)}" placeholder="Hledat téma nebo průběh"><button class="search-submit" type="submit" aria-label="Hledat">${icon('chevron', 17)}</button></form>
      </section>
      <section class="content-card content-card--transparent">
        ${sectionHeader(VIEW_META[view][0], `${lessons.length} ${lessons.length === 1 ? 'hodina' : lessons.length >= 2 && lessons.length <= 4 ? 'hodiny' : 'hodin'}`, from || to ? '<a class="button button--ghost button--small" href="#/plan?view=all">Zrušit datumový filtr</a>' : '')}
        ${lessons.length ? `<div class="lesson-list">${lessons.map(lessonCard).join('')}</div>` : emptyState({
          iconName: 'plan',
          title: view === 'upcoming' ? 'Zatím není nic naplánováno' : 'V tomto výběru nejsou hodiny',
          text: currentYear ? 'Vytvořte první přípravu nebo použijte rychlý zápis přímo během výuky.' : 'Nejprve nastavte aktuální školní rok a skupinu.',
          action: currentYear ? '<button class="button button--primary" type="button" data-open-lesson>Naplánovat první hodinu</button>' : '<a class="button button--secondary" href="#/groups">Připravit skupiny</a>',
        })}
      </section>`,
  };
}

function detailField(label, value, fallback = 'Neuvedeno') {
  return `<div class="lesson-detail-field"><span>${escapeHtml(label)}</span><p>${escapeHtml(value || fallback)}</p></div>`;
}

function reflectionStatus(lesson) {
  const meta = SUCCESS_RATINGS[lesson.successRating];
  return meta ? statusPill(meta.label, meta.variant, lesson.successRating === 'excellent' || lesson.successRating === 'good' ? 'check' : 'warning') : statusPill('Bez hodnocení', 'neutral', 'edit');
}

function tagMarkup(tags) {
  return tags.length
    ? `<div class="entity-tag-list">${tags.map((tag) => `<span class="entity-tag entity-tag--${escapeAttribute(tag.colorToken || 'teal')}">${escapeHtml(tag.name)}</span>`).join('')}</div>`
    : '<p class="muted-copy">Zatím bez vlastních štítků.</p>';
}

async function lessonDetailPage(id) {
  const detail = await appState.lessonService.getLesson(id);
  if (!detail) {
    return {
      title: 'Hodina nebyla nalezena',
      description: 'Záznam mohl být odstraněn nebo odkaz již není platný.',
      content: `<section class="content-card">${emptyState({ iconName: 'warning', title: 'Hodina neexistuje', text: 'Vraťte se do plánu a vyberte platný záznam.', action: '<a class="button button--secondary" href="#/plan">Zpět do plánu</a>' })}</section>`,
    };
  }
  const { lesson, group, subject, year, notes } = detail;
  const [tasks, reminders, tags, materials] = await Promise.all([
    appState.workService.listTasks({ lessonId: lesson.id, includeClosed: true }),
    appState.workService.listReminders({ lessonId: lesson.id, includeClosed: true }),
    appState.workService.tagsForEntity('lesson', lesson.id),
    appState.materialService.listMaterials({ lessonId: lesson.id }),
  ]);
  const isClosed = ['completed', 'unfinished', 'cancelled', 'substituted'].includes(lesson.status);
  return {
    title: lesson.title,
    description: `${group?.displayName || 'Neznámá skupina'} · ${formatDate(lesson.date, true)}`,
    actions: `<button class="button button--ghost" type="button" data-lesson-action="duplicate" data-lesson-id="${lesson.id}">${icon('restore', 17)} Duplikovat</button><button class="button button--ghost" type="button" data-lesson-action="template" data-lesson-id="${lesson.id}">${icon('book', 17)} Šablona</button><button class="button button--ghost" type="button" data-open-material data-group-id="${group?.id || ''}" data-lesson-id="${lesson.id}">${icon('materials', 17)} Materiál</button><button class="button button--ghost" type="button" data-open-reminder data-group-id="${group?.id || ''}" data-lesson-id="${lesson.id}">${icon('warning', 17)} Připomínka</button><button class="button button--ghost" type="button" data-open-task data-group-id="${group?.id || ''}" data-lesson-id="${lesson.id}">${icon('plus', 17)} Úkol</button>${isClosed ? `<button class="button button--secondary" type="button" data-lesson-action="reflect" data-lesson-id="${lesson.id}">${icon('edit', 17)} Reflexe</button>` : `<button class="button button--secondary" type="button" data-lesson-action="edit" data-lesson-id="${lesson.id}">${icon('edit', 17)} Upravit</button>`}${!isClosed ? `<button class="button button--primary" type="button" data-lesson-action="quick" data-lesson-id="${lesson.id}">${icon('check', 17)} ${lesson.status === 'in_progress' ? 'Pokračovat v zápisu' : 'Spustit hodinu'}</button>` : ''}`,
    content: `
      <nav class="breadcrumb"><a href="#/plan">Plán</a>${icon('chevron', 15)}<span>${escapeHtml(lesson.title)}</span></nav>
      <section class="lesson-detail-hero lesson-detail-hero--${escapeAttribute(lesson.status)}">
        <div class="lesson-detail-hero__date"><span>${new Date(`${lesson.date}T12:00:00`).getDate()}</span><small>${new Intl.DateTimeFormat('cs-CZ', { month: 'short' }).format(new Date(`${lesson.date}T12:00:00`))}</small></div>
        <div class="lesson-detail-hero__main"><div>${lessonStatus(lesson.status)}<a href="#/groups/${group?.id}">${escapeHtml(group?.displayName || 'Neznámá skupina')}</a><span>${escapeHtml(subject?.name || '')}</span></div><h2>${escapeHtml(lesson.title)}</h2><p>${escapeHtml(lesson.topic || lesson.objectives || 'Bez doplňujícího tématu.')}</p></div>
        <div class="lesson-detail-hero__meta"><span>${icon('calendar', 17)} ${escapeHtml(formatDate(lesson.date, true))}</span><span>${icon('plan', 17)} ${escapeHtml(formatTime(lesson.startTime))}</span><span>#${lesson.sequenceNumber || '—'}</span></div>
      </section>
      <div class="two-column-grid two-column-grid--detail">
        <section class="content-card">
          ${sectionHeader('Příprava', 'Co mělo v hodině proběhnout.')}
          <div class="lesson-detail-grid">${detailField('Cíle', lesson.objectives)}${detailField('Plánovaný průběh', lesson.plannedOutline)}${detailField('Plánovaná délka', lesson.plannedDuration ? `${lesson.plannedDuration} minut` : '')}</div>
        </section>
        <section class="content-card">
          ${sectionHeader('Skutečný průběh', 'Co se opravdu podařilo realizovat.')}
          <div class="lesson-detail-grid">${detailField('Průběh', lesson.actualProgress)}${detailField('Kde se skončilo', lesson.endedAtText)}${detailField('Co se nestihlo', lesson.unfinishedText)}</div>
        </section>
      </div>
      <section class="continuity-callout">
        <div><span>${icon('edit', 20)}</span><strong>Domácí úkol</strong><p>${escapeHtml(lesson.homework || 'Nebyl zadán.')}</p></div>
        <div><span>${icon('chevron', 20)}</span><strong>Poznámka pro příště</strong><p>${escapeHtml(lesson.nextLessonNote || 'Zatím bez poznámky.')}</p></div>
      </section>
      <section class="content-card reflection-card">
        ${sectionHeader('Reflexe a opakované použití', 'Rychlé hodnocení toho, co fungovalo a co příště změnit.', `<button class="button button--secondary button--small" type="button" data-lesson-action="reflect" data-lesson-id="${lesson.id}">${icon('edit', 16)} ${lesson.successRating || lesson.reflection ? 'Upravit reflexi' : 'Přidat reflexi'}</button>`)}
        <div class="reflection-overview">
          <div class="reflection-overview__rating">${reflectionStatus(lesson)}<strong>${escapeHtml(REUSE_DECISIONS[lesson.reuseDecision] || 'Bez rozhodnutí o dalším použití')}</strong><small>${escapeHtml([ACTIVITY_TYPES[lesson.activityType], SKILL_TYPES[lesson.skillType], lesson.level].filter(Boolean).join(' · ') || 'Typ aktivity, dovednost a úroveň zatím nejsou označeny.')}</small></div>
          <div class="reflection-overview__text">${detailField('Co fungovalo', lesson.reflectionWorked || lesson.reflection, 'Zatím bez reflexe.')}${detailField('Co příště změnit', lesson.reflectionImprove, 'Zatím bez poznámky.')}</div>
        </div>
        ${tagMarkup(tags)}
      </section>
      <section class="content-card">
        ${sectionHeader('Použité materiály', `${materials.length} propojených položek`, `<button class="button button--secondary button--small" type="button" data-open-material data-group-id="${group?.id || ''}" data-lesson-id="${lesson.id}">${icon('plus', 16)} Přidat materiál</button>`)}
        ${materials.length ? `<div class="lesson-material-list">${materials.map((material) => `<a href="#/materials/${material.id}"><span>${icon('materials', 17)}</span><div><strong>${escapeHtml(material.title)}</strong><small>${escapeHtml(material.description || material.url || 'Bez popisu')}</small></div>${icon('chevron', 16)}</a>`).join('')}</div>` : '<p class="muted-copy">K této hodině zatím není připojený žádný materiál.</p>'}
      </section>
      <section class="content-card">
        ${sectionHeader('Navázané povinnosti', `${tasks.length} úkolů · ${reminders.length} připomínek`, `<a class="button button--secondary button--small" href="#/work?group=${group?.id || ''}">Otevřít povinnosti</a>`)}
        ${tasks.length || reminders.length ? `<div class="linked-work-list">${tasks.slice(0, 3).map((task) => `<div><span>${icon(task.status === 'completed' ? 'check' : 'plan', 16)}</span><strong>${escapeHtml(task.title)}</strong><small>${escapeHtml(task.status === 'completed' ? 'Splněno' : task.nextLessonTrigger ? 'Při příští hodině' : task.dueDate ? formatDate(task.dueDate) : 'Bez termínu')}</small></div>`).join('')}${reminders.slice(0, 3).map((reminder) => `<div><span>${icon('warning', 16)}</span><strong>${escapeHtml(reminder.title)}</strong><small>${escapeHtml(reminder.triggerType === 'date' ? formatDate(reminder.triggerDate) : 'Při příští hodině')}</small></div>`).join('')}</div>` : '<p class="muted-copy">K této hodině zatím nejsou navázané úkoly ani připomínky.</p>'}
      </section>
      ${notes.length ? `<section class="content-card">${sectionHeader('Rychlé poznámky', 'Poznámky zachycené přímo během hodiny.')}<div class="quick-note-list">${notes.map((note) => `<div><span>${escapeHtml(new Date(note.createdAt).toLocaleString('cs-CZ'))}</span><p>${escapeHtml(note.text)}</p></div>`).join('')}</div></section>` : ''}
      <section class="lesson-actions-panel">
        <div><strong>Stav záznamu</strong><p>Plánovanou hodinu lze jedním krokem spustit a po skončení uložit jako uskutečněnou nebo nedokončenou.</p></div>
        <div>${lesson.status === 'cancelled' ? '' : `<button class="button button--ghost" type="button" data-lesson-action="cancel" data-lesson-id="${lesson.id}">Označit jako zrušenou</button>`}<button class="button button--danger" type="button" data-lesson-action="delete" data-lesson-id="${lesson.id}">${icon('trash', 16)} Odstranit prázdný záznam</button></div>
      </section>`,
  };
}

export async function planPage(context) {
  return context.params[0] ? lessonDetailPage(context.params[0]) : planListPage(context);
}

async function runLessonAction(action, lessonId) {
  const detail = await appState.lessonService.getLesson(lessonId);
  if (!detail) throw new Error('Hodina nebyla nalezena.');
  if (action === 'edit') return openLessonDialog({ lesson: detail.lesson });
  if (action === 'quick') return openQuickLessonDialog({ lessonId });
  if (action === 'reflect') return openReflectionDialog(detail.lesson);
  if (action === 'duplicate') return openDuplicateLessonDialog(detail.lesson);
  if (action === 'template') return openTemplateFromLessonDialog(detail.lesson);
  if (action === 'cancel') {
    return confirmAction({
      title: 'Označit hodinu jako zrušenou?',
      message: 'Záznam zůstane zachován v historii, ale nebude se počítat mezi uskutečněné hodiny.',
      confirmLabel: 'Označit jako zrušenou',
      onConfirm: async () => {
        await appState.lessonService.cancelLesson(lessonId);
        showToast('Hodina byla označena jako zrušená.', 'success');
        navigate('plan', [lessonId]);
      },
    });
  }
  if (action === 'delete') {
    return confirmAction({
      title: 'Definitivně odstranit hodinu?',
      message: 'Odstranění je možné pouze u záznamu bez navazujících poznámek, úkolů, připomínek a materiálů.',
      confirmLabel: 'Odstranit hodinu',
      danger: true,
      onConfirm: async () => {
        await appState.lessonService.removeLesson(lessonId);
        showToast('Hodina byla odstraněna.', 'success');
        navigate('plan');
      },
    });
  }
  return null;
}

export function bindPlanPage(context) {
  document.querySelectorAll('[data-open-lesson]').forEach((button) => button.addEventListener('click', () => void openLessonDialog({ groupId: context.query.get('group') || '' })));
  document.querySelectorAll('[data-open-quick-lesson]').forEach((button) => button.addEventListener('click', () => void openQuickLessonDialog({ groupId: context.query.get('group') || '' })));
  document.querySelectorAll('[data-open-task]').forEach((button) => button.addEventListener('click', () => void openTaskDialog({ groupId: button.dataset.groupId, lessonId: button.dataset.lessonId })));
  document.querySelectorAll('[data-open-material]').forEach((button) => button.addEventListener('click', () => void openMaterialDialog({ groupId: button.dataset.groupId, lessonId: button.dataset.lessonId })));
  document.querySelectorAll('[data-open-reminder]').forEach((button) => button.addEventListener('click', () => void openReminderDialog({ groupId: button.dataset.groupId, lessonId: button.dataset.lessonId })));
  document.querySelectorAll('[data-plan-view]').forEach((button) => button.addEventListener('click', () => navigate('plan', [], { ...Object.fromEntries(context.query), view: button.dataset.planView, from: '', to: '' })));
  document.querySelector('#plan-group-filter')?.addEventListener('change', (event) => navigate('plan', [], { ...Object.fromEntries(context.query), group: event.target.value }));
  document.querySelector('#plan-search-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    navigate('plan', [], { ...Object.fromEntries(context.query), q: String(data.get('q') || '').trim() });
  });
  document.querySelectorAll('[data-lesson-action]').forEach((button) => button.addEventListener('click', async () => {
    try { await runLessonAction(button.dataset.lessonAction, button.dataset.lessonId); }
    catch (error) { showToast(error.message, 'error'); }
  }));
}

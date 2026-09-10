import { appState } from '../core/appState.js';
import { escapeAttribute, escapeHtml } from '../core/html.js';
import { ACTIVITY_TYPES, LESSON_STATUSES, SKILL_TYPES, SUCCESS_RATINGS } from '../services/lessonService.js';
import { MATERIAL_TYPES } from '../services/materialService.js';
import { SEARCH_TYPES } from '../services/searchService.js';
import { icon } from '../ui/icons.js';
import { navigate } from '../ui/router.js';
import { emptyState, statusPill } from './shared.js';

const RESULT_META = Object.freeze({
  lesson: { label: 'Hodina', icon: 'plan', variant: 'info' },
  material: { label: 'Materiál', icon: 'materials', variant: 'success' },
  task: { label: 'Úkol', icon: 'check', variant: 'warning' },
  reminder: { label: 'Připomínka', icon: 'warning', variant: 'warning' },
  group: { label: 'Skupina', icon: 'groups', variant: 'neutral' },
});

function formatDate(value) {
  if (!value) return '';
  try { return new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' }).format(new Date(`${value}T12:00:00`)); } catch { return value; }
}
function options(items, selected, emptyLabel) {
  return `<option value="">${emptyLabel}</option>${Object.entries(items).map(([key, item]) => `<option value="${key}" ${selected === key ? 'selected' : ''}>${escapeHtml(typeof item === 'string' ? item : item.label)}</option>`).join('')}`;
}
function resultCard(result, needle = '') {
  const meta = RESULT_META[result.type] || RESULT_META.group;
  return `<a class="search-result search-result--${result.type}" href="${escapeAttribute(result.href)}">
    <span class="search-result__icon">${icon(meta.icon, 21)}</span>
    <div class="search-result__main"><div class="search-result__meta">${statusPill(meta.label, meta.variant, meta.icon)}${result.date ? `<span>${formatDate(result.date)}</span>` : ''}${result.status ? `<span>${escapeHtml(result.status)}</span>` : ''}</div><h2>${escapeHtml(result.title)}</h2><strong>${escapeHtml(result.subtitle || '')}</strong><p>${escapeHtml(result.excerpt || '')}</p>${result.tags?.length ? `<div class="entity-tag-list">${result.tags.map((tag) => `<span class="entity-tag entity-tag--${escapeAttribute(tag.colorToken || 'teal')}">${escapeHtml(tag.name)}</span>`).join('')}</div>` : ''}</div>
    <span class="search-result__chevron">${icon('chevron', 18)}</span>
  </a>`;
}

function activeFilterCount(query) {
  return [...query.entries()].filter(([key, value]) => value && !['q', 'type'].includes(key)).length;
}

export async function searchPage(context) {
  const query = context.query;
  const filters = {
    query: query.get('q') || '',
    type: query.get('type') || 'all',
    schoolYearId: query.get('year') || '',
    groupId: query.get('group') || '',
    subjectId: query.get('subject') || '',
    dateFrom: query.get('from') || '',
    dateTo: query.get('to') || '',
    status: query.get('status') || '',
    successRating: query.get('success') || '',
    activityType: query.get('activity') || '',
    skillType: query.get('skill') || '',
    materialType: query.get('materialType') || '',
  };
  const [search, groups] = await Promise.all([
    appState.searchService.search(filters),
    appState.academicService.listGroups({ includeAllStatuses: true, status: '' }),
  ]);
  const years = appState.academic.years;
  const subjects = appState.academic.subjects;
  const hasIntent = Boolean(filters.query || activeFilterCount(query) || filters.type !== 'all');
  const displayed = hasIntent ? search.results : search.results.slice(0, 8);
  const filterCount = activeFilterCount(query);
  return {
    title: 'Hledat',
    description: 'Dohledání hodin, témat, aktivit, materiálů a povinností napříč školními roky.',
    content: `
      <section class="search-hero search-hero--functional">
        <form id="global-search-form" class="global-search-form">
          <label class="search-field search-field--large">${icon('search', 24)}<input name="q" type="search" value="${escapeAttribute(filters.query)}" placeholder="Např. poslech o cestování, past simple, test lekce 4…" autofocus><kbd>Ctrl K</kbd><button type="submit" class="search-submit search-submit--large" aria-label="Hledat">${icon('chevron', 20)}</button></label>
          <div class="filter-row search-type-row"><button class="filter-chip ${filters.type === 'all' ? 'is-active' : ''}" type="button" data-search-type="all">Vše <b>${search.overallTotal}</b></button>${Object.entries(SEARCH_TYPES).map(([type, label]) => `<button class="filter-chip ${filters.type === type ? 'is-active' : ''}" type="button" data-search-type="${type}">${escapeHtml(label)} <b>${search.counts[type] || 0}</b></button>`).join('')}<button class="filter-chip filter-chip--control ${filterCount ? 'is-active' : ''}" type="button" data-toggle-search-filters>${icon('filter', 15)} Filtry ${filterCount ? `<b>${filterCount}</b>` : ''}</button></div>
          <div class="advanced-search-filters ${filterCount ? 'is-open' : ''}" data-search-filters>
            <label class="compact-field"><span>Školní rok</span><select name="year"><option value="">Všechny roky</option>${years.map((year) => `<option value="${year.id}" ${year.id === filters.schoolYearId ? 'selected' : ''}>${escapeHtml(year.label)}</option>`).join('')}</select></label>
            <label class="compact-field"><span>Skupina</span><select name="group"><option value="">Všechny skupiny</option>${groups.map((group) => `<option value="${group.id}" ${group.id === filters.groupId ? 'selected' : ''}>${escapeHtml(group.displayName)}</option>`).join('')}</select></label>
            <label class="compact-field"><span>Předmět</span><select name="subject"><option value="">Všechny předměty</option>${subjects.map((subject) => `<option value="${subject.id}" ${subject.id === filters.subjectId ? 'selected' : ''}>${escapeHtml(subject.name)}</option>`).join('')}</select></label>
            <label class="compact-field"><span>Od data</span><input type="date" name="from" value="${escapeAttribute(filters.dateFrom)}"></label>
            <label class="compact-field"><span>Do data</span><input type="date" name="to" value="${escapeAttribute(filters.dateTo)}"></label>
            <label class="compact-field"><span>Stav hodiny</span><select name="status">${options(LESSON_STATUSES, filters.status, 'Všechny stavy')}</select></label>
            <label class="compact-field"><span>Úspěšnost</span><select name="success">${options(SUCCESS_RATINGS, filters.successRating, 'Jakákoli')}</select></label>
            <label class="compact-field"><span>Typ aktivity</span><select name="activity">${options(ACTIVITY_TYPES, filters.activityType, 'Jakýkoli')}</select></label>
            <label class="compact-field"><span>Dovednost</span><select name="skill">${options(SKILL_TYPES, filters.skillType, 'Jakákoli')}</select></label>
            <label class="compact-field"><span>Typ materiálu</span><select name="materialType">${options(MATERIAL_TYPES, filters.materialType, 'Jakýkoli')}</select></label>
            <div class="advanced-search-filters__actions"><button class="button button--secondary button--small" type="submit">Použít filtry</button><a class="button button--ghost button--small" href="#/search${filters.query ? `?q=${encodeURIComponent(filters.query)}` : ''}">Vymazat filtry</a></div>
          </div>
          <input type="hidden" name="type" value="${escapeAttribute(filters.type)}">
        </form>
      </section>
      <section class="search-results-section">
        <div class="search-results-heading"><div><span class="topbar__eyebrow">${hasIntent ? 'Výsledky vyhledávání' : 'Naposledy upravené záznamy'}</span><h2>${hasIntent ? `${search.total} ${search.total === 1 ? 'výsledek' : search.total > 1 && search.total < 5 ? 'výsledky' : 'výsledků'}` : 'Rychlý přehled napříč aplikací'}</h2></div>${hasIntent && search.total ? `<span class="search-query-summary">${filters.query ? `Dotaz „${escapeHtml(filters.query)}“` : 'Použité filtry'}</span>` : ''}</div>
        ${displayed.length ? `<div class="search-results">${displayed.map((result) => resultCard(result, filters.query)).join('')}</div>` : emptyState({ iconName: 'search', title: hasIntent ? 'Nic jsme nenašli' : 'Zatím není co prohledávat', text: hasIntent ? 'Zkuste obecnější výraz, jiný školní rok nebo zrušte některý filtr.' : 'Jakmile vytvoříte hodiny, materiály nebo povinnosti, objeví se zde.' })}
      </section>`,
  };
}

export function bindSearchPage(context) {
  const form = document.querySelector('#global-search-form');
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(form);
    navigate('search', [], Object.fromEntries([...data.entries()].filter(([, value]) => value && value !== 'all')));
  });
  document.querySelectorAll('[data-search-type]').forEach((button) => button.addEventListener('click', () => {
    const next = Object.fromEntries(context.query.entries());
    if (button.dataset.searchType === 'all') delete next.type; else next.type = button.dataset.searchType;
    navigate('search', [], next);
  }));
  document.querySelector('[data-toggle-search-filters]')?.addEventListener('click', () => document.querySelector('[data-search-filters]')?.classList.toggle('is-open'));
}

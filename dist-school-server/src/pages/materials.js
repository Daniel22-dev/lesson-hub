import { appState } from '../core/appState.js';
import { APP_EVENTS } from '../core/constants.js';
import { eventBus } from '../core/eventBus.js';
import { escapeAttribute, escapeHtml } from '../core/html.js';
import { MATERIAL_TYPES, MATERIAL_VISIBILITY, SOURCE_TYPES } from '../services/materialService.js';
import { icon } from '../ui/icons.js';
import { confirmAction } from '../ui/modal.js';
import { navigate } from '../ui/router.js';
import { showToast } from '../ui/toast.js';
import { openMaterialDialog } from '../ui/materialDialogs.js';
import { emptyState, sectionHeader, statusPill } from './shared.js';

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' }).format(new Date(value));
}

function typeOptions(selected = '') {
  return `<option value="">Všechny typy</option>${Object.entries(MATERIAL_TYPES).map(([key, item]) => `<option value="${key}" ${selected === key ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}`;
}

function materialTags(material) {
  if (!material.tags?.length) return '';
  return `<div class="entity-tag-list">${material.tags.map((tag) => `<span class="entity-tag entity-tag--${escapeAttribute(tag.colorToken || 'teal')}">${escapeHtml(tag.name)}</span>`).join('')}</div>`;
}

function linkMarkup(link) {
  const iconName = link.entityType === 'lesson' ? 'plan' : 'groups';
  return `<a class="material-relation" href="${escapeAttribute(link.href || '#/materials')}">${icon(iconName, 15)}<span>${escapeHtml(link.label)}</span></a>`;
}

function materialCard(material) {
  const type = MATERIAL_TYPES[material.materialType] ?? MATERIAL_TYPES.other;
  const source = SOURCE_TYPES[material.sourceType] ?? material.sourceType;
  return `
    <article class="material-card material-card--${escapeAttribute(material.materialType || 'other')} ${material.favorite ? 'material-card--favorite' : ''}" data-material-card="${material.id}">
      <label class="material-card__select"><input type="checkbox" data-material-select value="${material.id}" aria-label="Vybrat materiál ${escapeAttribute(material.title)}"></label>
      <div class="material-card__icon">${material.favorite ? `<span class="material-favorite-mark" title="Oblíbený materiál">★</span>` : ''}${icon(type.icon || 'materials', 23)}</div>
      <div class="material-card__main">
        <div class="material-card__heading"><div><span class="material-card__type">${escapeHtml(type.label)} · ${escapeHtml(source || '')}</span><h2>${escapeHtml(material.title)}</h2></div>${material.studentFacing ? statusPill('Pro studenty', 'info', 'groups') : statusPill(MATERIAL_VISIBILITY[material.visibility] || 'Soukromé', 'neutral', 'shield')}</div>
        <p>${escapeHtml(material.description || material.teacherNote || 'Bez doplňujícího popisu.')}</p>
        ${material.url ? `<a class="material-card__url" href="${escapeAttribute(material.url)}" target="_blank" rel="noopener noreferrer">${icon('link', 15)}<span>${escapeHtml(material.url.replace(/^https?:\/\//, '').slice(0, 90))}</span></a>` : ''}
        ${material.links.length ? `<div class="material-card__relations">${material.links.slice(0, 4).map(linkMarkup).join('')}${material.links.length > 4 ? `<span class="material-relation material-relation--more">+${material.links.length - 4} dalších vazeb</span>` : ''}</div>` : '<p class="material-card__unlinked">Materiál zatím není propojený s výukou.</p>'}
        ${materialTags(material)}
      </div>
      <div class="material-card__side"><span>Upraveno ${formatDate(material.updatedAt)}</span><div class="material-card__actions"><button class="icon-button icon-button--small" type="button" data-material-action="favorite" data-material-id="${material.id}" title="${material.favorite ? 'Odebrat z oblíbených' : 'Přidat do oblíbených'}">${material.favorite ? '★' : '☆'}</button><a class="button button--secondary button--small" href="#/materials/${material.id}">Detail</a><button class="icon-button icon-button--small" type="button" data-material-action="edit" data-material-id="${material.id}" title="Upravit">${icon('edit', 17)}</button>${material.status === 'active' ? `<button class="icon-button icon-button--small" type="button" data-material-action="archive" data-material-id="${material.id}" title="Archivovat">${icon('archive', 17)}</button>` : `<button class="button button--ghost button--small" type="button" data-material-action="restore" data-material-id="${material.id}">Obnovit</button>`}</div></div>
    </article>`;
}

async function materialsListPage(context) {
  const query = context.query.get('q') || '';
  const type = context.query.get('type') || '';
  const status = context.query.get('status') === 'archived' ? 'archived' : 'active';
  const linkedTo = ['linked', 'unlinked'].includes(context.query.get('linked')) ? context.query.get('linked') : '';
  const groupId = context.query.get('group') || '';
  const lessonId = context.query.get('lesson') || '';
  const favoritesOnly = context.query.get('favorite') === '1';
  const [materials, summary, groups] = await Promise.all([
    appState.materialService.listMaterials({ query, type, status, linkedTo, groupId, lessonId, favoritesOnly }),
    appState.materialService.summary(),
    appState.academicService.listGroups({ includeAllStatuses: true, status: '' }),
  ]);
  return {
    title: 'Materiály',
    description: 'Centrální knihovna zdrojů, pracovních listů a odkazů bez zbytečných kopií.',
    actions: `<button class="button button--primary" type="button" data-open-material>${icon('plus', 18)} Přidat materiál</button>`,
    content: `
      <section class="material-summary" aria-label="Souhrn knihovny">
        <div><span>Aktivní materiály</span><strong>${summary.total}</strong></div><div><span>Propojené s výukou</span><strong>${summary.linked}</strong></div><div><span>Bez vazby</span><strong>${summary.unlinked}</strong></div><div><span>Pro studenty</span><strong>${summary.studentFacing}</strong></div><div><span>Oblíbené</span><strong>${summary.favorites}</strong></div>
      </section>
      <form id="material-filter-form" class="material-toolbar">
        <label class="search-field search-field--compact">${icon('search', 18)}<input name="q" type="search" value="${escapeAttribute(query)}" placeholder="Hledat název, odkaz, štítek nebo skupinu"><button class="search-submit" type="submit" aria-label="Hledat">${icon('chevron', 17)}</button></label>
        <label class="compact-field"><span>Typ</span><select name="type">${typeOptions(type)}</select></label>
        <label class="compact-field"><span>Vazba</span><select name="linked"><option value="">Všechny</option><option value="linked" ${linkedTo === 'linked' ? 'selected' : ''}>Propojené</option><option value="unlinked" ${linkedTo === 'unlinked' ? 'selected' : ''}>Bez vazby</option></select></label>
        <label class="compact-field"><span>Skupina</span><select name="group"><option value="">Všechny skupiny</option>${groups.map((group) => `<option value="${group.id}" ${group.id === groupId ? 'selected' : ''}>${escapeHtml(group.displayName)}</option>`).join('')}</select></label>
        <label class="check-card check-card--compact"><input type="checkbox" name="favorite" value="1" ${favoritesOnly ? 'checked' : ''}><span><strong>Jen oblíbené</strong></span></label><input type="hidden" name="status" value="${status}"><div class="segmented-control"><button type="button" data-material-status="active" class="${status === 'active' ? 'is-active' : ''}">Aktivní <b>${summary.total}</b></button><button type="button" data-material-status="archived" class="${status === 'archived' ? 'is-active' : ''}">Archiv <b>${summary.archived}</b></button></div>
      </form>
      <section class="bulk-selection-bar" data-material-bulk hidden><div><strong><span data-material-selected-count>0</span> vybraných</strong><span>Hromadná změna neodstraní vazby na výuku.</span></div><div><button class="button button--ghost button--small" type="button" data-material-bulk-action="favorite">Označit oblíbené</button><button class="button button--ghost button--small" type="button" data-material-bulk-action="unfavorite">Odebrat oblíbené</button><button class="button button--secondary button--small" type="button" data-material-bulk-action="${status === 'archived' ? 'restore' : 'archive'}">${status === 'archived' ? 'Obnovit' : 'Archivovat'}</button></div></section>
      <section class="material-list">
        ${materials.length ? materials.map(materialCard).join('') : emptyState({ iconName: 'materials', title: query || type || linkedTo || groupId ? 'Žádný materiál neodpovídá filtrům' : status === 'archived' ? 'Archiv materiálů je prázdný' : 'Knihovna čeká na první materiál', text: query || type || linkedTo || groupId ? 'Změňte hledaný výraz nebo některý z filtrů.' : 'Uložte odkaz, pracovní list, prezentaci nebo vlastní poznámku a propojte ji s výukou.', action: status === 'active' ? `<button class="button button--primary" type="button" data-open-material>${icon('plus', 18)} Přidat první materiál</button>` : '' })}
      </section>`,
  };
}

async function materialDetailPage(id) {
  const material = await appState.materialService.getMaterial(id);
  const type = MATERIAL_TYPES[material.materialType] ?? MATERIAL_TYPES.other;
  return {
    title: material.title,
    description: `${type.label} · ${SOURCE_TYPES[material.sourceType] || material.sourceType}`,
    actions: `<button class="button button--ghost" type="button" data-material-action="favorite" data-material-id="${material.id}">${material.favorite ? '★ Oblíbený' : '☆ Přidat k oblíbeným'}</button><button class="button button--secondary" type="button" data-material-action="edit" data-material-id="${material.id}">${icon('edit', 17)} Upravit</button>${material.url ? `<a class="button button--primary" href="${escapeAttribute(material.url)}" target="_blank" rel="noopener noreferrer">${icon('link', 17)} Otevřít zdroj</a>` : ''}`,
    content: `
      <a class="back-to-list" href="#/materials">${icon('arrowBack', 17)} Zpět do knihovny</a>
      <section class="material-detail-hero"><div class="material-detail-hero__icon">${icon(type.icon || 'materials', 30)}</div><div><div class="material-detail-hero__pills">${statusPill(type.label, 'info', type.icon || 'materials')}${statusPill(MATERIAL_VISIBILITY[material.visibility] || 'Pouze já', 'neutral', 'shield')}${material.studentFacing ? statusPill('Určeno studentům', 'success', 'groups') : ''}</div><h2>${escapeHtml(material.title)}</h2><p>${escapeHtml(material.description || 'Bez doplňujícího popisu.')}</p></div></section>
      <div class="detail-grid">
        <section class="content-card">${sectionHeader('Zdroj a poznámky')}<dl class="detail-list"><div><dt>Typ zdroje</dt><dd>${escapeHtml(SOURCE_TYPES[material.sourceType] || material.sourceType)}</dd></div><div><dt>Odkaz</dt><dd>${material.url ? `<a href="${escapeAttribute(material.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(material.url)}</a>` : 'Není uveden'}</dd></div><div><dt>Poznámka učitele</dt><dd>${escapeHtml(material.teacherNote || 'Není uvedena')}</dd></div><div><dt>Poslední změna</dt><dd>${formatDate(material.updatedAt)}</dd></div></dl>${materialTags(material)}</section>
        <section class="content-card">${sectionHeader('Použití ve výuce', 'Jeden centrální záznam může být připojen k více hodinám a skupinám.')} ${material.links.length ? `<div class="material-detail-links">${material.links.map(linkMarkup).join('')}</div>` : emptyState({ iconName: 'link', title: 'Materiál zatím není propojený', text: 'Upravte materiál a vyberte skupiny nebo konkrétní hodiny.' })}</section>
      </div>
      <section class="danger-zone"><div><strong>${material.status === 'active' ? 'Archivace materiálu' : 'Obnovení materiálu'}</strong><p>Archivace zachová všechny vazby a starší historii použití.</p></div><button class="button ${material.status === 'active' ? 'button--ghost' : 'button--secondary'}" type="button" data-material-action="${material.status === 'active' ? 'archive' : 'restore'}" data-material-id="${material.id}">${material.status === 'active' ? 'Archivovat' : 'Obnovit'}</button></section>`,
  };
}

export async function materialsPage(context) {
  return context.params[0] ? materialDetailPage(context.params[0]) : materialsListPage(context);
}

function currentFilters() {
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
  return Object.fromEntries(params.entries());
}

export function bindMaterialsPage(context) {
  document.querySelectorAll('[data-open-material]').forEach((button) => button.addEventListener('click', () => void openMaterialDialog({ groupId: context.query.get('group') || '', lessonId: context.query.get('lesson') || '' })));
  document.querySelector('#material-filter-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    navigate('materials', [], Object.fromEntries([...data.entries()].filter(([, value]) => value)));
  });
  document.querySelectorAll('#material-filter-form select, #material-filter-form input[name="favorite"]').forEach((control) => control.addEventListener('change', () => document.querySelector('#material-filter-form')?.requestSubmit()));
  document.querySelectorAll('[data-material-status]').forEach((button) => button.addEventListener('click', () => navigate('materials', [], { ...currentFilters(), status: button.dataset.materialStatus })));

  const selectedMaterials = () => [...document.querySelectorAll('[data-material-select]:checked')].map((input) => input.value);
  const updateBulkBar = () => {
    const ids = selectedMaterials();
    const bar = document.querySelector('[data-material-bulk]');
    if (!bar) return;
    bar.hidden = !ids.length;
    const count = bar.querySelector('[data-material-selected-count]');
    if (count) count.textContent = String(ids.length);
  };
  document.querySelectorAll('[data-material-select]').forEach((input) => input.addEventListener('change', updateBulkBar));
  document.querySelectorAll('[data-material-bulk-action]').forEach((button) => button.addEventListener('click', async () => {
    try {
      const changed = await appState.materialService.bulkUpdate(selectedMaterials(), button.dataset.materialBulkAction);
      showToast(`Hromadně upraveno ${changed} materiálů.`, 'success');
      eventBus.emit(APP_EVENTS.materialChanged);
    } catch (error) { showToast(error.message, 'error'); }
  }));
  document.querySelectorAll('[data-material-action]').forEach((button) => button.addEventListener('click', async () => {
    const id = button.dataset.materialId;
    try {
      if (button.dataset.materialAction === 'edit') return openMaterialDialog({ material: await appState.materialService.getMaterial(id) });
      if (button.dataset.materialAction === 'favorite') { const material = await appState.materialService.getMaterial(id); await appState.materialService.setFavorite(id, !material.favorite); showToast(material.favorite ? 'Materiál byl odebrán z oblíbených.' : 'Materiál byl označen jako oblíbený.', 'success'); return eventBus.emit(APP_EVENTS.materialChanged); }
      if (button.dataset.materialAction === 'archive') return confirmAction({ title: 'Archivovat materiál?', message: 'Materiál zmizí z aktivní knihovny, ale vazby na výuku zůstanou zachované.', confirmLabel: 'Archivovat', onConfirm: async () => { await appState.materialService.archiveMaterial(id); showToast('Materiál byl archivován.', 'success'); eventBus.emit(APP_EVENTS.materialChanged); } });
      if (button.dataset.materialAction === 'restore') { await appState.materialService.restoreMaterial(id); showToast('Materiál byl obnoven.', 'success'); eventBus.emit(APP_EVENTS.materialChanged); }
    } catch (error) { showToast(error.message, 'error'); }
  }));
}

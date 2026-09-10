import { appState } from '../core/appState.js';
import { escapeAttribute, escapeHtml } from '../core/html.js';
import { MATERIAL_TYPES, MATERIAL_VISIBILITY, SOURCE_TYPES } from '../services/materialService.js';
import { APP_EVENTS } from '../core/constants.js';
import { eventBus } from '../core/eventBus.js';
import { openModal } from './modal.js';
import { showToast } from './toast.js';

function value(data, key) { return String(data.get(key) || '').trim(); }
function options(items, selected = '') {
  return Object.entries(items).map(([key, item]) => `<option value="${escapeAttribute(key)}" ${selected === key ? 'selected' : ''}>${escapeHtml(typeof item === 'string' ? item : item.label)}</option>`).join('');
}
function showError(form, error) {
  const region = form.querySelector('[data-form-error]');
  if (region) { region.hidden = false; region.textContent = error.message || 'Operaci se nepodařilo dokončit.'; }
}
function selectedSet(values) { return new Set((values || []).filter(Boolean)); }

export async function openMaterialDialog({ material = null, groupId = '', lessonId = '' } = {}) {
  const [groups, lessons, tags] = await Promise.all([
    appState.academicService.listGroups({ includeAllStatuses: true, status: '' }),
    appState.lessonService.listLessons({ sort: 'desc' }),
    appState.workService.listTags(),
  ]);
  const currentLinks = material?.links || [];
  const groupIds = selectedSet([...currentLinks.filter((link) => link.entityType === 'group').map((link) => link.entityId), groupId]);
  const lessonIds = selectedSet([...currentLinks.filter((link) => link.entityType === 'lesson').map((link) => link.entityId), lessonId]);
  const tagIds = selectedSet(material?.tags?.map((tag) => tag.id));
  const sourceType = material?.sourceType || 'url';

  return openModal({
    id: 'material-editor-modal',
    eyebrow: material ? 'Úprava materiálu' : 'Nový materiál',
    title: material ? material.title : 'Co chcete uložit do knihovny?',
    wide: true,
    body: `
      <form id="material-form" class="form-stack">
        <div class="form-grid">
          <label class="form-field form-field--wide"><span>Název materiálu</span><input name="title" required value="${escapeAttribute(material?.title || '')}" placeholder="Poslech o cestování"></label>
          <label class="form-field"><span>Typ materiálu</span><select name="materialType">${options(MATERIAL_TYPES, material?.materialType || 'link')}</select></label>
          <label class="form-field"><span>Zdroj</span><select name="sourceType" data-material-source>${options(SOURCE_TYPES, sourceType)}</select></label>
          <label class="form-field form-field--wide" data-material-url><span>Odkaz</span><input type="url" name="url" value="${escapeAttribute(material?.url || '')}" placeholder="https://…"></label>
          <label class="form-field"><span>Viditelnost</span><select name="visibility">${options(MATERIAL_VISIBILITY, material?.visibility || 'private')}</select></label>
          <label class="check-row"><input type="checkbox" name="studentFacing" ${material?.studentFacing ? 'checked' : ''}><span><strong>Materiál určený studentům</strong><small>Jde o obsah, který může být později sdílen.</small></span></label>
          <label class="check-row"><input type="checkbox" name="favorite" ${material?.favorite ? 'checked' : ''}><span><strong>Oblíbený materiál</strong><small>Bude se zobrazovat před ostatními položkami.</small></span></label>
        </div>
        <label class="form-field"><span>Popis</span><textarea name="description" rows="3" placeholder="Co materiál obsahuje a k čemu se hodí…">${escapeHtml(material?.description || '')}</textarea></label>
        <label class="form-field"><span>Poznámka pro učitele</span><textarea name="teacherNote" rows="3" placeholder="Co upravit, vytisknout nebo připravit…">${escapeHtml(material?.teacherNote || '')}</textarea></label>
        <div class="material-link-editor">
          <fieldset class="tag-selector"><legend>Propojit se skupinami</legend>${groups.length ? `<div class="selector-scroll">${groups.map((group) => `<label class="check-row check-row--compact"><input type="checkbox" name="groupIds" value="${group.id}" ${groupIds.has(group.id) ? 'checked' : ''}><span><strong>${escapeHtml(group.displayName)}</strong><small>${escapeHtml(group.subject?.name || '')} · ${escapeHtml(group.year?.label || '')}</small></span></label>`).join('')}</div>` : '<p>Nejdříve vytvořte skupinu.</p>'}</fieldset>
          <fieldset class="tag-selector"><legend>Propojit s hodinami</legend>${lessons.length ? `<div class="selector-scroll">${lessons.slice(0, 60).map((lesson) => `<label class="check-row check-row--compact"><input type="checkbox" name="lessonIds" value="${lesson.id}" ${lessonIds.has(lesson.id) ? 'checked' : ''}><span><strong>${escapeHtml(lesson.title)}</strong><small>${escapeHtml(lesson.group?.displayName || '')} · ${escapeHtml(lesson.date || '')}</small></span></label>`).join('')}</div>` : '<p>Zatím nejsou vytvořené hodiny.</p>'}</fieldset>
        </div>
        <fieldset class="tag-selector"><legend>Štítky</legend>${tags.length ? `<div class="tag-selector__options">${tags.map((tag) => `<label class="tag-check tag-check--${escapeAttribute(tag.colorToken || 'teal')}"><input type="checkbox" name="tagIds" value="${tag.id}" ${tagIds.has(tag.id) ? 'checked' : ''}><span>${escapeHtml(tag.name)}</span></label>`).join('')}</div>` : '<p>Zatím nemáte vytvořené štítky.</p>'}<label class="form-field"><span>Nové štítky oddělené čárkou</span><input name="newTags" placeholder="poslech, cestování, B1"></label></fieldset>
        <p class="form-error" data-form-error hidden></p>
      </form>`,
    actions: `<button class="button button--ghost" type="button" data-close-modal>Zrušit</button><button class="button button--primary" type="submit" form="material-form">${material ? 'Uložit změny' : 'Přidat do knihovny'}</button>`,
    onOpen(backdrop, close) {
      const form = backdrop.querySelector('#material-form');
      const source = form.querySelector('[data-material-source]');
      const urlField = form.querySelector('[data-material-url]');
      const syncSource = () => { urlField.hidden = source.value === 'note'; form.elements.url.required = ['url', 'reference'].includes(source.value); };
      source.addEventListener('change', syncSource); syncSource();
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submit = backdrop.querySelector('button[form="material-form"]');
        submit.disabled = true;
        try {
          const data = new FormData(form);
          const input = Object.fromEntries(data);
          input.studentFacing = data.has('studentFacing');
          input.favorite = data.has('favorite');
          const createdTags = await appState.workService.createTagsFromText(value(data, 'newTags'));
          const payload = { groupIds: data.getAll('groupIds').map(String), lessonIds: data.getAll('lessonIds').map(String), tagIds: [...data.getAll('tagIds').map(String), ...createdTags.map((tag) => tag.id)] };
          if (material) {
            await appState.materialService.updateMaterial(material.id, input, payload);
            showToast('Materiál byl upraven.', 'success');
          } else {
            const result = await appState.materialService.createMaterial(input, payload);
            showToast(result.reused ? 'Stejný materiál už v knihovně existoval. Použil se původní záznam.' : 'Materiál byl přidán do knihovny.', result.reused ? 'info' : 'success');
          }
          close();
          eventBus.emit(APP_EVENTS.materialChanged);
        } catch (error) { showError(form, error); } finally { submit.disabled = false; }
      });
    },
  });
}

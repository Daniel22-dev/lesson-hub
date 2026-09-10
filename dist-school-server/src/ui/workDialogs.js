import { appState } from '../core/appState.js';
import { escapeAttribute, escapeHtml } from '../core/html.js';
import {
  PRIORITIES,
  REMINDER_TRIGGERS,
  TAG_CATEGORIES,
  TASK_TYPES,
} from '../services/workService.js';
import {
  ACTIVITY_TYPES,
  REUSE_DECISIONS,
  SKILL_TYPES,
  SUCCESS_RATINGS,
} from '../services/lessonService.js';
import { openModal } from './modal.js';
import { showToast } from './toast.js';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function value(data, key) {
  return String(data.get(key) || '').trim();
}

function optionList(items, selected = '', empty = '') {
  return `${empty ? `<option value="">${escapeHtml(empty)}</option>` : ''}${Object.entries(items).map(([key, item]) => {
    const label = typeof item === 'string' ? item : item.label;
    return `<option value="${escapeAttribute(key)}" ${selected === key ? 'selected' : ''}>${escapeHtml(label)}</option>`;
  }).join('')}`;
}

async function groupOptions(selectedId = '') {
  const groups = await appState.academicService.listGroups({ includeAllStatuses: true, status: '' });
  return `<option value="">Bez vazby na skupinu</option>${groups.map((group) => `<option value="${group.id}" ${group.id === selectedId ? 'selected' : ''}>${escapeHtml(group.displayName)} · ${escapeHtml(group.subject?.shortName || group.subject?.name || '')}</option>`).join('')}`;
}

function showError(form, error) {
  const region = form.querySelector('[data-form-error]');
  if (!region) return;
  region.hidden = false;
  region.textContent = error.message || 'Operaci se nepodařilo dokončit.';
}

function refreshRoute() {
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export async function openTaskDialog({ task = null, groupId = '', lessonId = '' } = {}) {
  const selectedGroup = task?.groupInstanceId || groupId || '';
  const groups = await groupOptions(selectedGroup);
  return openModal({
    id: 'task-editor-modal',
    eyebrow: task ? 'Úprava otevřeného úkolu' : 'Nový otevřený úkol',
    title: task ? task.title : 'Co je potřeba udělat?',
    wide: true,
    body: `
      <form id="task-form" class="form-stack">
        <div class="form-grid">
          <label class="form-field form-field--wide"><span>Název úkolu</span><input name="title" required value="${escapeAttribute(task?.title || '')}" placeholder="Příště zkontrolovat domácí úkol"></label>
          <label class="form-field"><span>Skupina</span><select name="groupInstanceId">${groups}</select></label>
          <label class="form-field"><span>Typ</span><select name="type">${optionList(TASK_TYPES, task?.type || 'next_lesson')}</select></label>
          <label class="form-field"><span>Priorita</span><select name="priority">${optionList(PRIORITIES, task?.priority || 'normal')}</select></label>
          <label class="form-field"><span>Termín</span><input type="date" name="dueDate" value="${escapeAttribute(task?.dueDate || '')}"></label>
        </div>
        <label class="form-field"><span>Upřesnění</span><textarea name="description" rows="4" placeholder="Volitelná praktická poznámka…">${escapeHtml(task?.description || '')}</textarea></label>
        <label class="check-row"><input type="checkbox" name="nextLessonTrigger" ${task?.nextLessonTrigger || (!task && !task?.dueDate) ? 'checked' : ''}><span><strong>Zobrazit při příští hodině skupiny</strong><small>Úkol se automaticky připomene v kontextu další hodiny.</small></span></label>
        <input type="hidden" name="lessonId" value="${escapeAttribute(task?.lessonId || lessonId)}">
        <p class="form-error" data-form-error hidden></p>
      </form>`,
    actions: `<button class="button button--ghost" type="button" data-close-modal>Zrušit</button><button class="button button--primary" type="submit" form="task-form">${task ? 'Uložit úkol' : 'Přidat úkol'}</button>`,
    onOpen(backdrop, close) {
      const form = backdrop.querySelector('#task-form');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submit = backdrop.querySelector('button[form="task-form"]');
        submit.disabled = true;
        try {
          const data = new FormData(form);
          const input = Object.fromEntries(data);
          input.nextLessonTrigger = data.has('nextLessonTrigger');
          if (task) await appState.workService.updateTask(task.id, input);
          else await appState.workService.createTask(input);
          showToast(task ? 'Úkol byl upraven.' : 'Úkol byl přidán.', 'success');
          close();
          refreshRoute();
        } catch (error) {
          showError(form, error);
        } finally {
          submit.disabled = false;
        }
      });
    },
  });
}

export async function openReminderDialog({ reminder = null, groupId = '', lessonId = '' } = {}) {
  const selectedGroup = reminder?.groupInstanceId || groupId || '';
  const groups = await groupOptions(selectedGroup);
  return openModal({
    id: 'reminder-editor-modal',
    eyebrow: reminder ? 'Úprava připomínky' : 'Nová připomínka',
    title: reminder ? reminder.title : 'Na co nesmím zapomenout?',
    wide: true,
    body: `
      <form id="reminder-form" class="form-stack">
        <div class="form-grid">
          <label class="form-field form-field--wide"><span>Text připomínky</span><input name="title" required value="${escapeAttribute(reminder?.title || '')}" placeholder="Vrátit pracovní listy"></label>
          <label class="form-field"><span>Skupina</span><select name="groupInstanceId">${groups}</select></label>
          <label class="form-field"><span>Kdy zobrazit</span><select name="triggerType" data-reminder-trigger>${optionList(REMINDER_TRIGGERS, reminder?.triggerType || 'next_lesson')}</select></label>
          <label class="form-field" data-trigger-date-field><span>Datum</span><input type="date" name="triggerDate" value="${escapeAttribute(reminder?.triggerDate || todayIso())}"></label>
          <label class="form-field"><span>Priorita</span><select name="priority">${optionList(PRIORITIES, reminder?.priority || 'normal')}</select></label>
        </div>
        <label class="form-field"><span>Poznámka</span><textarea name="note" rows="4" placeholder="Volitelné upřesnění…">${escapeHtml(reminder?.note || '')}</textarea></label>
        <input type="hidden" name="lessonId" value="${escapeAttribute(reminder?.lessonId || lessonId)}">
        <p class="form-error" data-form-error hidden></p>
      </form>`,
    actions: `<button class="button button--ghost" type="button" data-close-modal>Zrušit</button><button class="button button--primary" type="submit" form="reminder-form">${reminder ? 'Uložit připomínku' : 'Přidat připomínku'}</button>`,
    onOpen(backdrop, close) {
      const form = backdrop.querySelector('#reminder-form');
      const trigger = form.querySelector('[data-reminder-trigger]');
      const dateField = form.querySelector('[data-trigger-date-field]');
      const updateVisibility = () => { dateField.hidden = trigger.value !== 'date'; };
      trigger.addEventListener('change', updateVisibility);
      updateVisibility();
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submit = backdrop.querySelector('button[form="reminder-form"]');
        submit.disabled = true;
        try {
          const input = Object.fromEntries(new FormData(form));
          if (reminder) await appState.workService.updateReminder(reminder.id, input);
          else await appState.workService.createReminder(input);
          showToast(reminder ? 'Připomínka byla upravena.' : 'Připomínka byla přidána.', 'success');
          close();
          refreshRoute();
        } catch (error) {
          showError(form, error);
        } finally {
          submit.disabled = false;
        }
      });
    },
  });
}

export function openTagDialog() {
  return openModal({
    id: 'tag-editor-modal',
    eyebrow: 'Osobní kategorizace',
    title: 'Nový štítek',
    body: `
      <form id="tag-form" class="form-stack">
        <label class="form-field"><span>Název štítku</span><input name="name" required placeholder="Použít znovu"></label>
        <div class="form-grid">
          <label class="form-field"><span>Kategorie</span><select name="category">${optionList(TAG_CATEGORIES, 'custom')}</select></label>
          <label class="form-field"><span>Barevný akcent</span><select name="colorToken"><option value="teal">Tyrkysový</option><option value="blue">Modrý</option><option value="violet">Fialový</option><option value="amber">Jantarový</option><option value="rose">Růžový</option><option value="slate">Neutrální</option></select></label>
        </div>
        <p class="form-error" data-form-error hidden></p>
      </form>`,
    actions: `<button class="button button--ghost" type="button" data-close-modal>Zrušit</button><button class="button button--primary" type="submit" form="tag-form">Vytvořit štítek</button>`,
    onOpen(backdrop, close) {
      const form = backdrop.querySelector('#tag-form');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
          await appState.workService.createTag(Object.fromEntries(new FormData(form)));
          showToast('Štítek byl vytvořen.', 'success');
          close();
          refreshRoute();
        } catch (error) {
          showError(form, error);
        }
      });
    },
  });
}

export async function openReflectionDialog(lesson) {
  const [tags, selectedTags] = await Promise.all([
    appState.workService.listTags(),
    appState.workService.tagsForEntity('lesson', lesson.id),
  ]);
  const selectedIds = new Set(selectedTags.map((tag) => tag.id));
  return openModal({
    id: 'reflection-editor-modal',
    eyebrow: 'Reflexe uskutečněné hodiny',
    title: lesson.title,
    wide: true,
    body: `
      <form id="reflection-form" class="form-stack">
        <div class="reflection-rating-grid">${Object.entries(SUCCESS_RATINGS).map(([key, meta]) => `<label class="rating-choice rating-choice--${meta.variant}"><input type="radio" name="successRating" value="${key}" ${lesson.successRating === key ? 'checked' : ''}><span>${escapeHtml(meta.label)}</span></label>`).join('')}</div>
        <div class="form-grid">
          <label class="form-field"><span>Typ aktivity</span><select name="activityType">${optionList(ACTIVITY_TYPES, lesson.activityType || '', 'Nevybráno')}</select></label>
          <label class="form-field"><span>Dovednost</span><select name="skillType">${optionList(SKILL_TYPES, lesson.skillType || '', 'Nevybráno')}</select></label>
          <label class="form-field"><span>Úroveň</span><input name="level" value="${escapeAttribute(lesson.level || '')}" placeholder="např. B1"></label>
          <label class="form-field"><span>Další použití</span><select name="reuseDecision">${optionList(REUSE_DECISIONS, lesson.reuseDecision || '', 'Bez rozhodnutí')}</select></label>
        </div>
        <div class="form-grid">
          <label class="form-field"><span>Co fungovalo</span><textarea name="reflectionWorked" rows="4">${escapeHtml(lesson.reflectionWorked || '')}</textarea></label>
          <label class="form-field"><span>Co příště změnit</span><textarea name="reflectionImprove" rows="4">${escapeHtml(lesson.reflectionImprove || '')}</textarea></label>
        </div>
        <label class="form-field"><span>Celková reflexe</span><textarea name="reflection" rows="4">${escapeHtml(lesson.reflection || '')}</textarea></label>
        <fieldset class="tag-selector"><legend>Štítky</legend>${tags.length ? `<div class="tag-selector__options">${tags.map((tag) => `<label class="tag-check tag-check--${escapeAttribute(tag.colorToken || 'teal')}"><input type="checkbox" name="tagIds" value="${tag.id}" ${selectedIds.has(tag.id) ? 'checked' : ''}><span>${escapeHtml(tag.name)}</span></label>`).join('')}</div>` : '<p>Zatím nemáte vlastní štítky. Můžete je vytvořit níže.</p>'}<label class="form-field"><span>Nové štítky oddělené čárkou</span><input name="newTags" placeholder="oblíbená aktivita, poslech, upravit"></label></fieldset>
        <p class="form-error" data-form-error hidden></p>
      </form>`,
    actions: `<button class="button button--ghost" type="button" data-close-modal>Zrušit</button><button class="button button--primary" type="submit" form="reflection-form">Uložit reflexi</button>`,
    onOpen(backdrop, close) {
      const form = backdrop.querySelector('#reflection-form');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submit = backdrop.querySelector('button[form="reflection-form"]');
        submit.disabled = true;
        try {
          const data = new FormData(form);
          const input = Object.fromEntries(data);
          await appState.lessonService.updateLesson(lesson.id, input);
          const existingIds = data.getAll('tagIds').map(String);
          const created = await appState.workService.createTagsFromText(value(data, 'newTags'));
          await appState.workService.setEntityTags('lesson', lesson.id, [...existingIds, ...created.map((tag) => tag.id)]);
          showToast('Reflexe a štítky byly uloženy.', 'success');
          close();
          refreshRoute();
        } catch (error) {
          showError(form, error);
        } finally {
          submit.disabled = false;
        }
      });
    },
  });
}

export function openDateDialog({ title, description, initialDate = todayIso(), confirmLabel = 'Odložit', onConfirm }) {
  return openModal({
    id: 'date-action-modal',
    eyebrow: 'Změna termínu',
    title,
    body: `<form id="date-action-form" class="form-stack"><p>${escapeHtml(description)}</p><label class="form-field"><span>Nové datum</span><input type="date" name="date" required value="${escapeAttribute(initialDate)}"></label><p class="form-error" data-form-error hidden></p></form>`,
    actions: `<button class="button button--ghost" type="button" data-close-modal>Zrušit</button><button class="button button--primary" type="submit" form="date-action-form">${escapeHtml(confirmLabel)}</button>`,
    onOpen(backdrop, close) {
      const form = backdrop.querySelector('#date-action-form');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
          await onConfirm(value(new FormData(form), 'date'));
          close();
          refreshRoute();
        } catch (error) {
          showError(form, error);
        }
      });
    },
  });
}

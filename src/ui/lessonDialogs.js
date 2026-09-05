import { appState } from '../core/appState.js';
import { clearLessonDraft, lessonDraftKey, readLessonDraft, saveLessonDraft } from '../core/draftStorage.js';
import { escapeAttribute, escapeHtml } from '../core/html.js';
import { LESSON_STATUSES } from '../services/lessonService.js';
import { openModal } from './modal.js';
import { navigate } from './router.js';
import { showToast } from './toast.js';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formDraftKey(lessonId = 'new', groupId = '') {
  return lessonDraftKey(lessonId, groupId);
}

function saveDraft(key, form) {
  const payload = Object.fromEntries(new FormData(form));
  payload.savedAt = new Date().toISOString();
  return saveLessonDraft(key, payload);
}

function statusOptions(selected = 'planned') {
  return Object.entries(LESSON_STATUSES)
    .filter(([value]) => !['in_progress', 'substituted'].includes(value))
    .map(([value, meta]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${meta.label}</option>`)
    .join('');
}

function groupOptions(groups, selectedId = '') {
  return groups.map((group) => `<option value="${group.id}" ${group.id === selectedId ? 'selected' : ''}>${escapeHtml(group.displayName)} · ${escapeHtml(group.subject?.shortName || group.subject?.name || 'bez předmětu')}</option>`).join('');
}

function showFormError(form, error) {
  const region = form.querySelector('[data-form-error]');
  if (!region) return;
  region.hidden = false;
  region.textContent = error.message || 'Operaci se nepodařilo dokončit.';
}

function bindDraftAutosave(form, key, statusElement) {
  let timer = null;
  const persist = () => {
    const result = saveDraft(key, form);
    if (statusElement && result?.ok) statusElement.textContent = `Koncept uložen ${new Date().toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}`;
    else if (statusElement && result?.blocked) statusElement.textContent = 'Relace byla ukončena; koncept se již neukládá.';
  };
  form.addEventListener('input', () => {
    if (statusElement) statusElement.textContent = 'Ukládám koncept…';
    clearTimeout(timer);
    timer = setTimeout(persist, 450);
  });
  return () => clearTimeout(timer);
}

export async function openLessonDialog({ lesson = null, groupId = '', initialStatus = 'planned', initialDate = todayIso() } = {}) {
  const currentYear = appState.academic.currentYear;
  const groups = currentYear
    ? await appState.academicService.listGroups({ schoolYearId: currentYear.id, status: 'active' })
    : await appState.academicService.listGroups({ status: 'active' });
  const [templates, cycleAssignments] = await Promise.all([appState.templateCycleService.listTemplates({ status: 'active' }), appState.templateCycleService.cycleAssignments(initialDate)]);
  if (!groups.length) {
    showToast('Nejprve vytvořte alespoň jednu aktivní skupinu.', 'warning');
    navigate('groups');
    return null;
  }

  const selectedGroupId = lesson?.groupInstanceId || groupId || groups[0].id;
  const key = formDraftKey(lesson?.id || 'new', selectedGroupId);
  const draft = readLessonDraft(key);
  const value = (name, fallback = '') => draft?.[name] ?? lesson?.[name] ?? fallback;
  const recovered = Boolean(draft?.savedAt);

  return openModal({
    id: 'lesson-editor-modal',
    eyebrow: lesson ? 'Úprava hodiny' : 'Nová hodina',
    title: lesson ? lesson.title : 'Naplánovat hodinu',
    wide: true,
    body: `
      <form id="lesson-form" class="form-stack">
        ${recovered ? `<aside class="draft-recovery"><strong>Obnoven rozepsaný koncept</strong><span>Poslední lokální uložení: ${new Date(draft.savedAt).toLocaleString('cs-CZ')}</span></aside>` : ''}
        <div class="form-section">
          <div class="form-section__title"><span>1</span><div><strong>Základ hodiny</strong><small>Pro rychlé naplánování stačí skupina, datum a název.</small></div></div>
          ${!lesson && templates.length ? `<div class="template-picker-row"><label class="form-field"><span>Volitelně načíst šablonu</span><select data-template-picker><option value="">Začít prázdnou hodinou</option>${templates.map((template) => `<option value="${template.id}">${escapeHtml(template.title)}${template.subject ? ` · ${escapeHtml(template.subject.shortName || template.subject.name)}` : ''}</option>`).join('')}</select></label><aside class="cycle-form-hint" data-cycle-hint></aside></div>` : `<aside class="cycle-form-hint" data-cycle-hint></aside>`}
          <input type="hidden" name="sourceTemplateId" value="${escapeAttribute(value('sourceTemplateId'))}">
          <div class="form-grid form-grid--3">
            <label class="form-field form-field--wide"><span>Skupina</span><select name="groupInstanceId" ${lesson ? 'disabled' : ''}>${groupOptions(groups, value('groupInstanceId', selectedGroupId))}</select></label>
            <label class="form-field"><span>Datum</span><input type="date" name="date" required value="${escapeAttribute(value('date', initialDate))}"></label>
            <label class="form-field"><span>Začátek</span><input type="time" name="startTime" value="${escapeAttribute(value('startTime'))}"></label>
            <label class="form-field form-field--wide"><span>Název hodiny</span><input name="title" required value="${escapeAttribute(value('title'))}" placeholder="Unit 4 · Listening and discussion"></label>
            <label class="form-field"><span>Stav</span><select name="status">${statusOptions(value('status', initialStatus))}</select></label>
            <label class="form-field"><span>Délka</span><div class="input-with-suffix"><input type="number" min="5" max="240" name="plannedDuration" value="${escapeAttribute(value('plannedDuration', 45))}"><span>min</span></div></label>
          </div>
        </div>
        <div class="form-section">
          <div class="form-section__title"><span>2</span><div><strong>Příprava</strong><small>Rozšířená pole jsou dobrovolná.</small></div></div>
          <div class="form-grid">
            <label class="form-field"><span>Téma nebo učivo</span><input name="topic" value="${escapeAttribute(value('topic'))}" placeholder="Travel and transport"></label>
            <label class="form-field"><span>Cíle hodiny</span><input name="objectives" value="${escapeAttribute(value('objectives'))}" placeholder="Student rozumí hlavní myšlence poslechu"></label>
          </div>
          <label class="form-field"><span>Plánovaný průběh</span><textarea name="plannedOutline" rows="5" placeholder="Warm-up, poslech, kontrola, diskuse…">${escapeHtml(value('plannedOutline'))}</textarea></label>
        </div>
        <details class="form-details" ${lesson && ['completed', 'unfinished'].includes(lesson.status) ? 'open' : ''}>
          <summary>Skutečný průběh a návaznost</summary>
          <div class="form-stack form-details__body">
            <label class="form-field"><span>Co se skutečně dělalo</span><textarea name="actualProgress" rows="4">${escapeHtml(value('actualProgress'))}</textarea></label>
            <div class="form-grid">
              <label class="form-field"><span>Kde se skončilo</span><textarea name="endedAtText" rows="3">${escapeHtml(value('endedAtText'))}</textarea></label>
              <label class="form-field"><span>Co se nestihlo</span><textarea name="unfinishedText" rows="3">${escapeHtml(value('unfinishedText'))}</textarea></label>
              <label class="form-field"><span>Domácí úkol</span><textarea name="homework" rows="3">${escapeHtml(value('homework'))}</textarea></label>
              <label class="form-field"><span>Poznámka pro příště</span><textarea name="nextLessonNote" rows="3">${escapeHtml(value('nextLessonNote'))}</textarea></label>
            </div>
          </div>
        </details>
        <div class="form-save-status" aria-live="polite" data-draft-status>${recovered ? 'Pracujete s obnoveným konceptem.' : 'Koncept se při psaní ukládá lokálně.'}</div>
        <p class="form-error" data-form-error hidden></p>
      </form>`,
    actions: `<button class="button button--ghost" type="button" data-close-modal>Zrušit</button><button class="button button--primary" type="submit" form="lesson-form">${lesson ? 'Uložit hodinu' : 'Vytvořit hodinu'}</button>`,
    onOpen(backdrop, close) {
      const form = backdrop.querySelector('#lesson-form');
      const cycleHint = backdrop.querySelector('[data-cycle-hint]');
      const updateCycleHint = () => {
        if (!cycleHint) return;
        const groupIdValue = form.elements.groupInstanceId?.value || selectedGroupId;
        const assignment = cycleAssignments.find((item) => item.group.id === groupIdValue);
        cycleHint.innerHTML = assignment?.step ? `<span>Aktuální cyklus</span><strong>${escapeHtml(assignment.step.label)}</strong><small>${escapeHtml(assignment.cycle.name)} · ${escapeHtml(assignment.step.startDate)}–${escapeHtml(assignment.step.endDate)}</small>` : '<span>Výukový cyklus</span><strong>Není přiřazen</strong><small>Hodinu lze plánovat běžně bez cyklu.</small>';
      };
      form.elements.groupInstanceId?.addEventListener('change', updateCycleHint);
      updateCycleHint();
      backdrop.querySelector('[data-template-picker]')?.addEventListener('change', (event) => {
        const template = templates.find((item) => item.id === event.target.value);
        if (!template) return;
        const values = appState.templateCycleService.lessonTemplatePrefill(template);
        for (const [name, fieldValue] of Object.entries(values || {})) {
          const field = form.elements[name];
          if (field && fieldValue != null) field.value = fieldValue;
        }
        form.dispatchEvent(new Event('input', { bubbles: true }));
        showToast(`Šablona „${template.title}“ byla načtena do editoru.`, 'info');
      });
      const cleanupAutosave = bindDraftAutosave(form, key, backdrop.querySelector('[data-draft-status]'));
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submit = backdrop.querySelector('button[form="lesson-form"]');
        submit.disabled = true;
        form.querySelector('[data-form-error]')?.setAttribute('hidden', '');
        try {
          const data = new FormData(form);
          const input = Object.fromEntries(data);
          input.groupInstanceId = lesson?.groupInstanceId || formValue(data, 'groupInstanceId');
          const stored = lesson
            ? await appState.lessonService.updateLesson(lesson.id, input)
            : await appState.lessonService.createLesson(input);
          clearLessonDraft(key);
          cleanupAutosave();
          showToast(lesson ? 'Hodina byla upravena.' : 'Hodina byla vytvořena.', 'success');
          close();
          navigate('plan', [stored.id]);
        } catch (error) {
          showFormError(form, error);
        } finally {
          submit.disabled = false;
        }
      });
    },
  });
}

async function resolveQuickLesson(groupId, lessonId) {
  if (lessonId) {
    const detail = await appState.lessonService.getLesson(lessonId);
    if (!detail) throw new Error('Hodina nebyla nalezena.');
    if (detail.lesson.status !== 'in_progress') await appState.lessonService.startLesson(lessonId);
    return appState.lessonService.getLesson(lessonId);
  }
  const created = await appState.lessonService.createQuickLesson(groupId);
  return appState.lessonService.getLesson(created.id);
}

export async function openQuickLessonDialog({ groupId = '', lessonId = '' } = {}) {
  let resolvedGroupId = groupId;
  if (!resolvedGroupId && !lessonId) {
    const currentYear = appState.academic.currentYear;
    const groups = currentYear ? await appState.academicService.listGroups({ schoolYearId: currentYear.id, status: 'active' }) : [];
    if (!groups.length) {
      showToast('Nejprve vytvořte aktivní skupinu.', 'warning');
      return null;
    }
    if (groups.length > 1) {
      return openGroupPicker(groups);
    }
    resolvedGroupId = groups[0].id;
  }

  const detail = await resolveQuickLesson(resolvedGroupId, lessonId);
  const { lesson, group, subject } = detail;
  let saveTimer = null;
  let isSaving = false;

  return openModal({
    id: 'quick-lesson-modal',
    eyebrow: 'Rychlý zápis během hodiny',
    title: `${group?.displayName || 'Skupina'} · ${subject?.shortName || subject?.name || ''}`,
    wide: true,
    body: `
      <form id="quick-lesson-form" class="form-stack quick-lesson-form">
        <aside class="live-lesson-banner"><span class="live-dot"></span><div><strong>Hodina právě probíhá</strong><small>Změny se automaticky ukládají do lokální databáze.</small></div><span data-live-save-status>Uloženo</span></aside>
        <label class="form-field"><span>Co právě probíhá</span><textarea name="actualProgress" rows="4" placeholder="Stručně zapište průběh hodiny…">${escapeHtml(lesson.actualProgress || '')}</textarea></label>
        <div class="form-grid">
          <label class="form-field"><span>Kde jsme skončili</span><textarea name="endedAtText" rows="3" placeholder="Učebnice str. 42, cvičení 5…">${escapeHtml(lesson.endedAtText || '')}</textarea></label>
          <label class="form-field"><span>Co se nestihlo</span><textarea name="unfinishedText" rows="3">${escapeHtml(lesson.unfinishedText || '')}</textarea></label>
          <label class="form-field"><span>Domácí úkol</span><textarea name="homework" rows="3">${escapeHtml(lesson.homework || '')}</textarea></label>
          <label class="form-field"><span>Poznámka pro příště</span><textarea name="nextLessonNote" rows="3">${escapeHtml(lesson.nextLessonNote || '')}</textarea></label>
        </div>
        <label class="form-field"><span>Rychlá poznámka do časové osy</span><div class="inline-entry"><input name="quickNote" placeholder="Např. zopakovat nepravidelná slovesa"><button class="button button--secondary button--small" type="button" data-add-quick-note>Přidat</button></div></label>
        <section class="quick-follow-up">
          <div><strong>Úkol pro příští hodinu</strong><small>Po dokončení hodiny se automaticky přidá mezi otevřené úkoly skupiny.</small></div>
          <div class="quick-follow-up__fields"><input name="nextTask" placeholder="Např. zkontrolovat cvičení 6"><select name="nextTaskPriority" aria-label="Priorita úkolu"><option value="normal">Běžná priorita</option><option value="high">Vysoká priorita</option><option value="urgent">Naléhavá</option><option value="low">Nízká</option></select></div>
        </section>
        <p class="form-error" data-form-error hidden></p>
      </form>`,
    actions: `<button class="button button--ghost" type="button" data-close-modal>Zavřít a pokračovat později</button><button class="button button--secondary" type="button" data-finish-unfinished>Uložit jako nedokončenou</button><button class="button button--primary" type="button" data-finish-completed>Dokončit hodinu</button>`,
    onOpen(backdrop, close) {
      const form = backdrop.querySelector('#quick-lesson-form');
      const status = backdrop.querySelector('[data-live-save-status]');
      const collect = () => {
        const data = new FormData(form);
        return {
          actualProgress: formValue(data, 'actualProgress'),
          endedAtText: formValue(data, 'endedAtText'),
          unfinishedText: formValue(data, 'unfinishedText'),
          homework: formValue(data, 'homework'),
          nextLessonNote: formValue(data, 'nextLessonNote'),
          status: 'in_progress',
        };
      };
      const persist = async () => {
        if (isSaving) return;
        isSaving = true;
        status.textContent = 'Ukládám…';
        try {
          await appState.lessonService.updateLesson(lesson.id, collect(), { audit: false });
          status.textContent = `Uloženo ${new Date().toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}`;
        } catch (error) {
          status.textContent = 'Uložení selhalo';
          showFormError(form, error);
        } finally {
          isSaving = false;
        }
      };
      form.addEventListener('input', (event) => {
        if (['quickNote', 'nextTask', 'nextTaskPriority'].includes(event.target.name)) return;
        status.textContent = 'Čeká na uložení…';
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => void persist(), 650);
      });
      backdrop.querySelector('[data-add-quick-note]')?.addEventListener('click', async () => {
        const input = form.elements.quickNote;
        try {
          await appState.lessonService.addQuickNote({ lessonId: lesson.id, groupInstanceId: group.id, text: input.value });
          input.value = '';
          showToast('Rychlá poznámka byla přidána.', 'success');
        } catch (error) {
          showFormError(form, error);
        }
      });
      const finish = async (unfinished) => {
        clearTimeout(saveTimer);
        try {
          await appState.lessonService.completeLesson(lesson.id, { unfinished, patch: collect() });
          const taskTitle = String(form.elements.nextTask?.value || '').trim();
          if (taskTitle) {
            await appState.workService.createTask({
              title: taskTitle,
              type: 'next_lesson',
              priority: String(form.elements.nextTaskPriority?.value || 'normal'),
              groupInstanceId: group.id,
              lessonId: lesson.id,
              nextLessonTrigger: true,
            });
          }
          showToast(taskTitle
            ? 'Hodina byla dokončena a úkol pro příště byl přidán.'
            : unfinished ? 'Hodina byla uložena jako nedokončená.' : 'Hodina byla dokončena.', 'success');
          close();
          navigate('plan', [lesson.id]);
        } catch (error) {
          showFormError(form, error);
        }
      };
      backdrop.querySelector('[data-finish-unfinished]')?.addEventListener('click', () => void finish(true));
      backdrop.querySelector('[data-finish-completed]')?.addEventListener('click', () => void finish(false));
    },
  });
}

function openGroupPicker(groups) {
  return openModal({
    id: 'quick-group-picker',
    eyebrow: 'Rychlý zápis',
    title: 'Vyberte skupinu',
    body: `<div class="quick-group-picker">${groups.map((group) => `<button type="button" data-quick-group="${group.id}"><strong>${escapeHtml(group.displayName)}</strong><span>${escapeHtml(group.subject?.name || '')}</span></button>`).join('')}</div>`,
    onOpen(backdrop, close) {
      backdrop.querySelectorAll('[data-quick-group]').forEach((button) => button.addEventListener('click', () => {
        const selected = button.dataset.quickGroup;
        close();
        void openQuickLessonDialog({ groupId: selected });
      }));
    },
  });
}

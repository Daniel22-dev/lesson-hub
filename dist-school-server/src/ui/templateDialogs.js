import { appState } from '../core/appState.js';
import { APP_EVENTS } from '../core/constants.js';
import { eventBus } from '../core/eventBus.js';
import { escapeAttribute, escapeHtml } from '../core/html.js';
import { ACTIVITY_TYPES, SKILL_TYPES } from '../services/lessonService.js';
import { openModal } from './modal.js';
import { navigate } from './router.js';
import { showToast } from './toast.js';

const COLORS = Object.freeze([
  ['teal', 'Tyrkysová'], ['blue', 'Modrá'], ['violet', 'Fialová'], ['amber', 'Jantarová'], ['rose', 'Růžová'], ['slate', 'Šedá'],
]);

function todayIso() { return new Date().toISOString().slice(0, 10); }
function formValue(data, key) { return String(data.get(key) || '').trim(); }
function colorOptions(selected = 'teal') { return COLORS.map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join(''); }
function skillOptions(selected = '') { return `<option value="">Bez určení</option>${Object.entries(SKILL_TYPES).map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('')}`; }
function activityOptions(selected = '') { return `<option value="">Bez určení</option>${Object.entries(ACTIVITY_TYPES).map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('')}`; }
function subjectOptions(subjects, selected = '') { return `<option value="">Univerzální šablona</option>${subjects.map((subject) => `<option value="${subject.id}" ${subject.id === selected ? 'selected' : ''}>${escapeHtml(subject.name)}</option>`).join('')}`; }
function groupOptions(groups, selected = '') { return groups.map((group) => `<option value="${group.id}" ${group.id === selected ? 'selected' : ''}>${escapeHtml(group.displayName)} · ${escapeHtml(group.subject?.shortName || group.subject?.name || '')}</option>`).join(''); }
function showError(form, error) { const region = form.querySelector('[data-form-error]'); if (region) { region.hidden = false; region.textContent = error.message || 'Operaci se nepodařilo dokončit.'; } }

function bindSubmit(backdrop, selector, handler, close) {
  const form = backdrop.querySelector(selector);
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = backdrop.querySelector(`button[form="${form.id}"]`);
    submit && (submit.disabled = true);
    form.querySelector('[data-form-error]')?.setAttribute('hidden', '');
    try {
      await handler(new FormData(form), form);
      close();
    } catch (error) {
      showError(form, error);
    } finally {
      submit && (submit.disabled = false);
    }
  });
}

export function openTemplateDialog(template = null) {
  const subjects = appState.academic.subjects.filter((subject) => subject.status === 'active' || subject.id === template?.subjectId);
  return openModal({
    id: 'template-editor-modal',
    eyebrow: template ? 'Úprava šablony' : 'Nová šablona',
    title: template ? template.title : 'Vytvořit šablonu hodiny',
    wide: true,
    body: `
      <form id="template-form" class="form-stack">
        <div class="form-section">
          <div class="form-section__title"><span>1</span><div><strong>Základ šablony</strong><small>Šablona je osobní předloha, nikoli uskutečněná hodina.</small></div></div>
          <div class="form-grid form-grid--3">
            <label class="form-field form-field--wide"><span>Název šablony</span><input name="title" required value="${escapeAttribute(template?.title || '')}" placeholder="Poslech · práce s autentickým videem"></label>
            <label class="form-field"><span>Předmět</span><select name="subjectId">${subjectOptions(subjects, template?.subjectId || '')}</select></label>
            <label class="form-field"><span>Délka</span><div class="input-with-suffix"><input type="number" min="5" max="240" name="plannedDuration" value="${template?.plannedDuration || 45}"><span>min</span></div></label>
            <label class="form-field form-field--wide"><span>Krátký popis</span><input name="description" value="${escapeAttribute(template?.description || '')}" placeholder="Kdy a pro jaké skupiny se šablona hodí"></label>
            <label class="check-card"><input type="checkbox" name="favorite" ${template?.favorite ? 'checked' : ''}><span><strong>Oblíbená šablona</strong><small>Zobrazí se mezi prvními.</small></span></label>
          </div>
        </div>
        <div class="form-section">
          <div class="form-section__title"><span>2</span><div><strong>Obsah a metodika</strong><small>Vše lze při použití šablony upravit.</small></div></div>
          <div class="form-grid">
            <label class="form-field"><span>Téma nebo učivo</span><input name="topic" value="${escapeAttribute(template?.topic || '')}"></label>
            <label class="form-field"><span>Cíle hodiny</span><input name="objectives" value="${escapeAttribute(template?.objectives || '')}"></label>
            <label class="form-field"><span>Typ aktivity</span><select name="activityType">${activityOptions(template?.activityType)}</select></label>
            <label class="form-field"><span>Dovednost</span><select name="skillType">${skillOptions(template?.skillType)}</select></label>
            <label class="form-field"><span>Úroveň</span><input name="level" value="${escapeAttribute(template?.level || '')}" placeholder="B1"></label>
          </div>
          <label class="form-field"><span>Plánovaný průběh</span><textarea name="plannedOutline" rows="6">${escapeHtml(template?.plannedOutline || '')}</textarea></label>
          <div class="form-grid">
            <label class="form-field"><span>Výchozí domácí úkol</span><textarea name="homework" rows="3">${escapeHtml(template?.homework || '')}</textarea></label>
            <label class="form-field"><span>Poznámka pro navazující hodinu</span><textarea name="nextLessonNote" rows="3">${escapeHtml(template?.nextLessonNote || '')}</textarea></label>
          </div>
        </div>
        <p class="form-error" data-form-error hidden></p>
      </form>`,
    actions: `<button class="button button--ghost" type="button" data-close-modal>Zrušit</button><button class="button button--primary" type="submit" form="template-form">${template ? 'Uložit změny' : 'Vytvořit šablonu'}</button>`,
    onOpen(backdrop, close) {
      bindSubmit(backdrop, '#template-form', async (data) => {
        const input = Object.fromEntries(data);
        input.favorite = data.has('favorite');
        if (template) await appState.templateCycleService.updateTemplate(template.id, input);
        else await appState.templateCycleService.createTemplate(input);
        showToast(template ? 'Šablona byla upravena.' : 'Šablona byla vytvořena.', 'success');
        eventBus.emit(APP_EVENTS.templateChanged);
      }, close);
    },
  });
}

export function openTemplateFromLessonDialog(lesson) {
  return openModal({
    id: 'template-from-lesson-modal',
    eyebrow: 'Opakované použití',
    title: 'Uložit hodinu jako šablonu',
    body: `
      <form id="template-from-lesson-form" class="form-stack">
        <p class="modal-lead">Zkopírují se cíle, plán, metodické kategorie a návaznost. Skutečný průběh a osobní reflexe zůstanou pouze u původní hodiny.</p>
        <label class="form-field"><span>Název šablony</span><input name="title" required value="${escapeAttribute(lesson.title || '')}"></label>
        <label class="form-field"><span>Popis použití</span><textarea name="description" rows="3" placeholder="Například: funguje dobře pro B1, ideálně 45 minut"></textarea></label>
        <label class="check-card"><input type="checkbox" name="favorite" ${['excellent', 'good'].includes(lesson.successRating) ? 'checked' : ''}><span><strong>Označit jako oblíbenou</strong><small>Povedené předlohy budou lépe dostupné.</small></span></label>
        <p class="form-error" data-form-error hidden></p>
      </form>`,
    actions: `<button class="button button--ghost" type="button" data-close-modal>Zrušit</button><button class="button button--primary" type="submit" form="template-from-lesson-form">Uložit šablonu</button>`,
    onOpen(backdrop, close) {
      bindSubmit(backdrop, '#template-from-lesson-form', async (data) => {
        const created = await appState.templateCycleService.createTemplateFromLesson(lesson.id, { title: formValue(data, 'title'), description: formValue(data, 'description'), favorite: data.has('favorite') });
        showToast(`Šablona „${created.title}“ byla vytvořena.`, 'success');
        eventBus.emit(APP_EVENTS.templateChanged);
      }, close);
    },
  });
}

export async function openUseTemplateDialog(template, { groupId = '' } = {}) {
  const currentYear = appState.academic.currentYear;
  const groups = currentYear ? await appState.academicService.listGroups({ schoolYearId: currentYear.id, status: 'active' }) : await appState.academicService.listGroups({ status: 'active' });
  if (!groups.length) { showToast('Nejprve vytvořte aktivní skupinu.', 'warning'); return null; }
  return openModal({
    id: 'use-template-modal',
    eyebrow: 'Nová plánovaná hodina',
    title: `Použít šablonu „${template.title}“`,
    body: `
      <form id="use-template-form" class="form-stack">
        <label class="form-field"><span>Skupina</span><select name="groupInstanceId">${groupOptions(groups, groupId || groups[0].id)}</select></label>
        <div class="form-grid">
          <label class="form-field"><span>Datum</span><input type="date" name="date" required value="${todayIso()}"></label>
          <label class="form-field"><span>Začátek</span><input type="time" name="startTime"></label>
        </div>
        <label class="form-field"><span>Název konkrétní hodiny</span><input name="title" value="${escapeAttribute(template.title)}"></label>
        <aside class="template-preview"><strong>${escapeHtml(template.topic || template.description || 'Bez tématu')}</strong><span>${escapeHtml(template.objectives || 'Cíle doplníte v editoru hodiny.')} · ${template.plannedDuration || 45} min</span></aside>
        <p class="form-error" data-form-error hidden></p>
      </form>`,
    actions: `<button class="button button--ghost" type="button" data-close-modal>Zrušit</button><button class="button button--primary" type="submit" form="use-template-form">Vytvořit plán</button>`,
    onOpen(backdrop, close) {
      bindSubmit(backdrop, '#use-template-form', async (data) => {
        const lesson = await appState.templateCycleService.createLessonFromTemplate(template.id, Object.fromEntries(data));
        showToast('Plánovaná hodina byla vytvořena ze šablony.', 'success');
        close();
        navigate('plan', [lesson.id]);
      }, close);
    },
  });
}

export async function openDuplicateLessonDialog(lesson) {
  const currentYear = appState.academic.currentYear;
  const groups = currentYear ? await appState.academicService.listGroups({ schoolYearId: currentYear.id, status: 'active' }) : await appState.academicService.listGroups({ status: 'active' });
  return openModal({
    id: 'duplicate-lesson-modal',
    eyebrow: 'Kopie bez změny originálu',
    title: 'Duplikovat hodinu',
    body: `
      <form id="duplicate-lesson-form" class="form-stack">
        <label class="form-field"><span>Cílová skupina</span><select name="groupInstanceId">${groupOptions(groups, lesson.groupInstanceId)}</select></label>
        <div class="form-grid"><label class="form-field"><span>Datum</span><input type="date" name="date" required value="${todayIso()}"></label><label class="form-field"><span>Začátek</span><input type="time" name="startTime"></label></div>
        <label class="form-field"><span>Název kopie</span><input name="title" required value="${escapeAttribute(lesson.title)}"></label>
        <p class="privacy-hint">Zkopíruje se příprava, metodické kategorie a návaznost. Skutečný průběh, reflexe, úkoly a připomínky se nepřenášejí.</p>
        <p class="form-error" data-form-error hidden></p>
      </form>`,
    actions: `<button class="button button--ghost" type="button" data-close-modal>Zrušit</button><button class="button button--primary" type="submit" form="duplicate-lesson-form">Vytvořit kopii</button>`,
    onOpen(backdrop, close) {
      bindSubmit(backdrop, '#duplicate-lesson-form', async (data) => {
        const copy = await appState.templateCycleService.duplicateLesson(lesson.id, Object.fromEntries(data));
        showToast('Kopie hodiny byla vytvořena.', 'success');
        close();
        navigate('plan', [copy.id]);
      }, close);
    },
  });
}

function stepsToText(steps = []) {
  return steps.map((step) => `${step.label}|${step.skillType || 'other'}|${step.colorToken || 'teal'}`).join('\n');
}

function parseSteps(value) {
  return String(value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line, index) => {
    const [label, skillType = 'other', colorToken = COLORS[index % COLORS.length][0]] = line.split('|').map((item) => item.trim());
    return { label, skillType: SKILL_TYPES[skillType] ? skillType : 'other', colorToken: COLORS.some(([color]) => color === colorToken) ? colorToken : COLORS[index % COLORS.length][0] };
  });
}

export function openCycleDialog(cycle = null) {
  const defaultSteps = [
    { label: 'Poslech', skillType: 'listening', colorToken: 'teal' },
    { label: 'Mluvení', skillType: 'speaking', colorToken: 'blue' },
    { label: 'Čtení', skillType: 'reading', colorToken: 'violet' },
    { label: 'Psaní', skillType: 'writing', colorToken: 'amber' },
    { label: 'Gramatika', skillType: 'grammar', colorToken: 'rose' },
  ];
  return openModal({
    id: 'cycle-editor-modal',
    eyebrow: cycle ? 'Úprava cyklu' : 'Nový výukový cyklus',
    title: cycle ? cycle.name : 'Vytvořit cyklus',
    wide: true,
    body: `
      <form id="cycle-form" class="form-stack">
        <div class="form-grid">
          <label class="form-field"><span>Název cyklu</span><input name="name" required value="${escapeAttribute(cycle?.name || '')}" placeholder="Jazykové dovednosti"></label>
          <label class="form-field"><span>Délka jednoho kroku</span><div class="input-with-suffix"><input type="number" min="1" max="12" name="stepDurationWeeks" value="${cycle?.stepDurationWeeks || 1}"><span>týdnů</span></div></label>
        </div>
        <label class="form-field"><span>Popis</span><input name="description" value="${escapeAttribute(cycle?.description || '')}" placeholder="Volitelný popis organizace výuky"></label>
        <label class="form-field"><span>Kroky cyklu</span><textarea name="steps" rows="8" required>${escapeHtml(stepsToText(cycle?.steps?.length ? cycle.steps : defaultSteps))}</textarea><small>Jeden krok na řádek: název | kód dovednosti | barva. Příklad: Poslech | listening | teal.</small></label>
        <div class="cycle-help"><strong>Podporované kódy dovedností</strong><span>${Object.keys(SKILL_TYPES).join(', ')}</span><strong>Barvy</strong><span>${COLORS.map(([value]) => value).join(', ')}</span></div>
        <label class="check-card"><input type="checkbox" name="favorite" ${cycle?.favorite ? 'checked' : ''}><span><strong>Oblíbený cyklus</strong><small>Zobrazí se mezi prvními.</small></span></label>
        <p class="form-error" data-form-error hidden></p>
      </form>`,
    actions: `<button class="button button--ghost" type="button" data-close-modal>Zrušit</button><button class="button button--primary" type="submit" form="cycle-form">${cycle ? 'Uložit cyklus' : 'Vytvořit cyklus'}</button>`,
    onOpen(backdrop, close) {
      bindSubmit(backdrop, '#cycle-form', async (data) => {
        const input = Object.fromEntries(data);
        input.steps = parseSteps(input.steps);
        input.favorite = data.has('favorite');
        if (cycle) await appState.templateCycleService.updateCycle(cycle.id, input);
        else await appState.templateCycleService.createCycle(input);
        showToast(cycle ? 'Cyklus byl upraven.' : 'Cyklus byl vytvořen.', 'success');
        eventBus.emit(APP_EVENTS.cycleChanged);
      }, close);
    },
  });
}

export async function openAssignCycleDialog(cycle) {
  const currentYear = appState.academic.currentYear;
  const groups = currentYear ? await appState.academicService.listGroups({ schoolYearId: currentYear.id, status: 'active' }) : await appState.academicService.listGroups({ status: 'active' });
  return openModal({
    id: 'assign-cycle-modal',
    eyebrow: 'Cyklická organizace',
    title: `Přiřadit cyklus „${cycle.name}“`,
    wide: true,
    body: `
      <form id="assign-cycle-form" class="form-stack">
        <div class="form-grid"><label class="form-field"><span>Začátek cyklu</span><input type="date" name="anchorDate" required value="${todayIso()}"></label><label class="form-field"><span>Délka kroku</span><div class="input-with-suffix"><input type="number" name="stepDurationWeeks" min="1" max="12" value="${cycle.stepDurationWeeks || 1}"><span>týdnů</span></div></label></div>
        <fieldset class="selection-fieldset"><legend>Skupiny</legend><div class="selection-grid">${groups.map((group) => `<label class="check-card"><input type="checkbox" name="groupIds" value="${group.id}" ${group.cycleId === cycle.id ? 'checked' : ''}><span><strong>${escapeHtml(group.displayName)}</strong><small>${escapeHtml(group.subject?.name || '')}${group.cycleId && group.cycleId !== cycle.id ? ' · jiný cyklus bude nahrazen' : ''}</small></span></label>`).join('')}</div></fieldset>
        <p class="form-error" data-form-error hidden></p>
      </form>`,
    actions: `<button class="button button--ghost" type="button" data-close-modal>Zrušit</button><button class="button button--primary" type="submit" form="assign-cycle-form">Přiřadit vybraným skupinám</button>`,
    onOpen(backdrop, close) {
      bindSubmit(backdrop, '#assign-cycle-form', async (data) => {
        const updated = await appState.templateCycleService.assignCycleToGroups(cycle.id, { groupIds: data.getAll('groupIds'), anchorDate: formValue(data, 'anchorDate'), stepDurationWeeks: formValue(data, 'stepDurationWeeks') });
        await appState.refreshAcademic({ emit: false });
        showToast(`Cyklus byl přiřazen ${updated.length} skupinám.`, 'success');
        eventBus.emit(APP_EVENTS.cycleChanged);
      }, close);
    },
  });
}

export async function openBulkPlanDialog(templateId = '') {
  const [templates, groups] = await Promise.all([
    appState.templateCycleService.listTemplates({ status: 'active' }),
    appState.academic.currentYear ? appState.academicService.listGroups({ schoolYearId: appState.academic.currentYear.id, status: 'active' }) : appState.academicService.listGroups({ status: 'active' }),
  ]);
  if (!templates.length) { showToast('Nejprve vytvořte alespoň jednu aktivní šablonu.', 'warning'); return openTemplateDialog(); }
  return openModal({
    id: 'bulk-plan-modal',
    eyebrow: 'Hromadná operace',
    title: 'Naplánovat z jedné šablony více skupinám',
    wide: true,
    body: `
      <form id="bulk-plan-form" class="form-stack">
        <div class="form-grid form-grid--3">
          <label class="form-field form-field--wide"><span>Šablona</span><select name="templateId">${templates.map((template) => `<option value="${template.id}" ${template.id === templateId ? 'selected' : ''}>${escapeHtml(template.title)}${template.subject ? ` · ${escapeHtml(template.subject.shortName || template.subject.name)}` : ''}</option>`).join('')}</select></label>
          <label class="form-field"><span>Datum</span><input type="date" name="date" required value="${todayIso()}"></label>
          <label class="form-field"><span>Začátek</span><input type="time" name="startTime"></label>
        </div>
        <label class="form-field"><span>Volitelný společný název</span><input name="title" placeholder="Ponechte prázdné pro název šablony"></label>
        <fieldset class="selection-fieldset"><legend>Cílové skupiny</legend><div class="selection-grid">${groups.map((group) => `<label class="check-card"><input type="checkbox" name="groupIds" value="${group.id}"><span><strong>${escapeHtml(group.displayName)}</strong><small>${escapeHtml(group.subject?.name || '')}</small></span></label>`).join('')}</div></fieldset>
        <p class="privacy-hint">Pro každou vybranou skupinu vznikne samostatná naplánovaná hodina. Původní šablona se nezmění.</p>
        <p class="form-error" data-form-error hidden></p>
      </form>`,
    actions: `<button class="button button--ghost" type="button" data-close-modal>Zrušit</button><button class="button button--primary" type="submit" form="bulk-plan-form">Vytvořit plány</button>`,
    onOpen(backdrop, close) {
      bindSubmit(backdrop, '#bulk-plan-form', async (data) => {
        const created = await appState.templateCycleService.bulkPlanFromTemplate(formValue(data, 'templateId'), { groupIds: data.getAll('groupIds'), date: formValue(data, 'date'), startTime: formValue(data, 'startTime'), title: formValue(data, 'title') });
        showToast(`Vytvořeno ${created.length} plánovaných hodin.`, 'success');
        close();
        navigate('plan');
      }, close);
    },
  });
}

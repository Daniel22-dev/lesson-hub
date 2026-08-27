import { appState } from '../core/appState.js';
import { escapeAttribute, escapeHtml } from '../core/html.js';
import { navigate } from './router.js';
import { openModal } from './modal.js';
import { showToast } from './toast.js';

export const COLOR_OPTIONS = Object.freeze([
  ['teal', 'Tyrkysová'],
  ['blue', 'Modrá'],
  ['violet', 'Fialová'],
  ['amber', 'Jantarová'],
  ['rose', 'Růžová'],
  ['slate', 'Šedá'],
]);

function suggestedYear() {
  const now = new Date();
  const start = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return {
    label: `${start}/${start + 1}`,
    startDate: `${start}-09-01`,
    endDate: `${start + 1}-08-31`,
  };
}

function colorOptions(selected = 'teal') {
  return COLOR_OPTIONS.map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('');
}

function showFormError(form, error) {
  const region = form.querySelector('[data-form-error]');
  if (region) {
    region.hidden = false;
    region.textContent = error.message || 'Operaci se nepodařilo dokončit.';
  }
}

function bindSubmit(backdrop, selector, handler, close) {
  const form = backdrop.querySelector(selector);
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]') || backdrop.querySelector(`[type="submit"][form="${form.id}"]`);
    if (submit) submit.disabled = true;
    form.querySelector('[data-form-error]')?.setAttribute('hidden', '');
    try {
      await handler(new FormData(form), form);
      close();
    } catch (error) {
      showFormError(form, error);
    } finally {
      if (submit) submit.disabled = false;
    }
  });
}

export function openQuickSetupDialog() {
  const suggestion = suggestedYear();
  return openModal({
    id: 'quick-setup-modal',
    eyebrow: 'První spuštění',
    title: 'Připravit první skupinu',
    wide: true,
    body: `
      <form id="quick-setup-form" class="form-stack">
        <p class="form-intro">Jedním krokem vytvoříte aktuální školní rok, první předmět a první skupinu. Vše lze později upravit.</p>
        <div class="form-section">
          <div class="form-section__title"><span>1</span><div><strong>Školní rok</strong><small>Základní období pro organizaci skupin.</small></div></div>
          <div class="form-grid form-grid--3">
            <label class="form-field"><span>Označení</span><input name="yearLabel" required value="${suggestion.label}" placeholder="2026/2027"></label>
            <label class="form-field"><span>Začátek</span><input name="startDate" type="date" value="${suggestion.startDate}"></label>
            <label class="form-field"><span>Konec</span><input name="endDate" type="date" value="${suggestion.endDate}"></label>
          </div>
        </div>
        <div class="form-section">
          <div class="form-section__title"><span>2</span><div><strong>Předmět</strong><small>Barevné označení pomůže s rychlou orientací.</small></div></div>
          <div class="form-grid form-grid--3">
            <label class="form-field form-field--wide"><span>Název předmětu</span><input name="subjectName" required placeholder="Anglický jazyk"></label>
            <label class="form-field"><span>Zkratka</span><input name="subjectShortName" placeholder="AJ" maxlength="10"></label>
            <label class="form-field"><span>Barva</span><select name="colorToken">${colorOptions()}</select></label>
          </div>
        </div>
        <div class="form-section">
          <div class="form-section__title"><span>3</span><div><strong>Skupina</strong><small>Například 2.4 AJ nebo 3.A.</small></div></div>
          <div class="form-grid">
            <label class="form-field"><span>Označení skupiny</span><input name="groupName" required placeholder="2.4 AJ"></label>
            <label class="form-field"><span>Ročník</span><input name="grade" placeholder="2. ročník"></label>
          </div>
        </div>
        <p class="form-error" data-form-error hidden></p>
      </form>`,
    actions: `
      <button class="button button--ghost" type="button" data-close-modal>Zrušit</button>
      <button class="button button--primary" type="submit" form="quick-setup-form">Vytvořit pracovní prostor</button>`,
    onOpen(backdrop, close) {
      bindSubmit(backdrop, '#quick-setup-form', async (data) => {
        const result = await appState.academicService.quickSetup(Object.fromEntries(data));
        await appState.refreshAcademic();
        showToast(`Skupina ${result.group.displayName} byla vytvořena.`, 'success');
        navigate('groups', [result.group.id]);
      }, close);
    },
  });
}

export function openYearDialog(year = null) {
  const suggestion = suggestedYear();
  return openModal({
    id: 'year-modal',
    eyebrow: year ? 'Úprava období' : 'Nové období',
    title: year ? `Upravit ${year.label}` : 'Přidat školní rok',
    body: `
      <form id="year-form" class="form-stack">
        <div class="form-grid">
          <label class="form-field"><span>Označení školního roku</span><input name="label" required value="${escapeAttribute(year?.label || suggestion.label)}" placeholder="2026/2027"></label>
          <label class="form-field"><span>Stav</span><select name="status"><option value="active" ${(year?.status || 'active') === 'active' ? 'selected' : ''}>Aktivní</option><option value="archived" ${year?.status === 'archived' ? 'selected' : ''}>Archivovaný</option></select></label>
          <label class="form-field"><span>Začátek</span><input name="startDate" type="date" value="${escapeAttribute(year?.startDate || suggestion.startDate)}"></label>
          <label class="form-field"><span>Konec</span><input name="endDate" type="date" value="${escapeAttribute(year?.endDate || suggestion.endDate)}"></label>
        </div>
        <label class="check-field"><input name="isCurrent" type="checkbox" ${year?.isCurrent || (!year && !appState.academic.currentYear) ? 'checked' : ''}><span><strong>Nastavit jako aktuální</strong><small>Aktuální rok se používá na dashboardu a při vytváření skupin.</small></span></label>
        <p class="form-error" data-form-error hidden></p>
      </form>`,
    actions: `<button class="button button--ghost" type="button" data-close-modal>Zrušit</button><button class="button button--primary" type="submit" form="year-form">${year ? 'Uložit změny' : 'Přidat školní rok'}</button>`,
    onOpen(backdrop, close) {
      bindSubmit(backdrop, '#year-form', async (data) => {
        const input = Object.fromEntries(data);
        input.isCurrent = data.get('isCurrent') === 'on';
        if (year) await appState.academicService.updateSchoolYear(year.id, input);
        else await appState.academicService.createSchoolYear(input);
        await appState.refreshAcademic();
        showToast(year ? 'Školní rok byl upraven.' : 'Školní rok byl přidán.', 'success');
      }, close);
    },
  });
}

export function openSubjectDialog(subject = null) {
  return openModal({
    id: 'subject-modal',
    eyebrow: subject ? 'Úprava předmětu' : 'Nový předmět',
    title: subject ? `Upravit ${subject.name}` : 'Přidat předmět',
    body: `
      <form id="subject-form" class="form-stack">
        <div class="form-grid">
          <label class="form-field"><span>Název předmětu</span><input name="name" required value="${escapeAttribute(subject?.name || '')}" placeholder="Anglický jazyk"></label>
          <label class="form-field"><span>Zkratka</span><input name="shortName" value="${escapeAttribute(subject?.shortName || '')}" placeholder="AJ" maxlength="10"></label>
          <label class="form-field"><span>Barevné označení</span><select name="colorToken">${colorOptions(subject?.colorToken)}</select></label>
          <label class="form-field"><span>Stav</span><select name="status"><option value="active" ${(subject?.status || 'active') === 'active' ? 'selected' : ''}>Aktivní</option><option value="archived" ${subject?.status === 'archived' ? 'selected' : ''}>Archivovaný</option></select></label>
        </div>
        <p class="form-error" data-form-error hidden></p>
      </form>`,
    actions: `<button class="button button--ghost" type="button" data-close-modal>Zrušit</button><button class="button button--primary" type="submit" form="subject-form">${subject ? 'Uložit změny' : 'Přidat předmět'}</button>`,
    onOpen(backdrop, close) {
      bindSubmit(backdrop, '#subject-form', async (data) => {
        const input = Object.fromEntries(data);
        if (subject) await appState.academicService.updateSubject(subject.id, input);
        else await appState.academicService.createSubject(input);
        await appState.refreshAcademic();
        showToast(subject ? 'Předmět byl upraven.' : 'Předmět byl přidán.', 'success');
      }, close);
    },
  });
}

export function openGroupDialog(group = null) {
  const years = appState.academic.years.filter((year) => year.status === 'active' || year.id === group?.schoolYearId);
  const subjects = appState.academic.subjects.filter((subject) => subject.status === 'active' || subject.id === group?.subjectId);
  if (!years.length || !subjects.length) {
    showToast('Nejprve vytvořte školní rok a alespoň jeden předmět.', 'warning');
    navigate('academic');
    return null;
  }
  const selectedYear = group?.schoolYearId || appState.academic.currentYear?.id || years[0].id;
  const selectedSubject = group?.subjectId || subjects[0].id;
  return openModal({
    id: 'group-modal',
    eyebrow: group ? 'Úprava skupiny' : 'Nová skupina',
    title: group ? `Upravit ${group.displayName}` : 'Přidat skupinu',
    wide: true,
    body: `
      <form id="group-form" class="form-stack">
        <div class="form-grid form-grid--3">
          <label class="form-field"><span>Školní rok</span><select name="schoolYearId" ${group ? 'disabled' : ''}>${years.map((year) => `<option value="${year.id}" ${year.id === selectedYear ? 'selected' : ''}>${escapeHtml(year.label)}${year.isCurrent ? ' · aktuální' : ''}</option>`).join('')}</select></label>
          <label class="form-field"><span>Předmět</span><select name="subjectId">${subjects.map((subject) => `<option value="${subject.id}" ${subject.id === selectedSubject ? 'selected' : ''}>${escapeHtml(subject.name)}</option>`).join('')}</select></label>
          <label class="form-field"><span>Barva karty</span><select name="colorToken">${colorOptions(group?.colorToken || subjects.find((subject) => subject.id === selectedSubject)?.colorToken)}</select></label>
          <label class="form-field"><span>Označení skupiny</span><input name="displayName" required value="${escapeAttribute(group?.displayName || '')}" placeholder="2.4 AJ"></label>
          <label class="form-field"><span>Ročník</span><input name="grade" value="${escapeAttribute(group?.grade || '')}" placeholder="2. ročník"></label>
          <label class="form-field form-field--wide"><span>Krátká interní poznámka</span><input name="note" value="${escapeAttribute(group?.note || '')}" placeholder="Volitelná organizační poznámka"></label>
        </div>
        <p class="privacy-hint">Skupina získá trvalou identitu. Při změně názvu nebo postupu do dalšího ročníku zůstane její historie zachována.</p>
        <p class="form-error" data-form-error hidden></p>
      </form>`,
    actions: `<button class="button button--ghost" type="button" data-close-modal>Zrušit</button><button class="button button--primary" type="submit" form="group-form">${group ? 'Uložit změny' : 'Přidat skupinu'}</button>`,
    onOpen(backdrop, close) {
      bindSubmit(backdrop, '#group-form', async (data) => {
        const input = Object.fromEntries(data);
        if (group) {
          input.schoolYearId = group.schoolYearId;
          await appState.academicService.updateGroup(group.id, input);
        } else {
          await appState.academicService.createGroup(input);
        }
        await appState.refreshAcademic();
        showToast(group ? 'Skupina byla upravena.' : 'Skupina byla vytvořena.', 'success');
      }, close);
    },
  });
}

function nextGrade(value) {
  const match = String(value || '').match(/(\d+)/);
  if (!match) return value || '';
  return String(value).replace(match[1], String(Number(match[1]) + 1));
}

function nextGroupName(value) {
  const match = String(value || '').match(/\d+/);
  if (!match) return value || '';
  return String(value).replace(match[0], String(Number(match[0]) + 1));
}

export function openPromotionDialog() {
  const years = appState.academic.years;
  if (years.length < 2) {
    showToast('Pro postup skupin vytvořte alespoň dva školní roky.', 'warning');
    return openYearDialog();
  }
  return openModal({
    id: 'promotion-modal',
    eyebrow: 'Přechod školního roku',
    title: 'Postup skupin',
    wide: true,
    body: `
      <form id="promotion-form" class="form-stack">
        <div class="form-grid">
          <label class="form-field"><span>Zdrojový školní rok</span><select name="sourceYearId" id="promotion-source">${years.map((year, index) => `<option value="${year.id}" ${!year.isCurrent && index === 1 ? 'selected' : ''}>${escapeHtml(year.label)}</option>`).join('')}</select></label>
          <label class="form-field"><span>Cílový školní rok</span><select name="targetYearId" id="promotion-target">${years.map((year) => `<option value="${year.id}" ${year.isCurrent ? 'selected' : ''}>${escapeHtml(year.label)}${year.isCurrent ? ' · aktuální' : ''}</option>`).join('')}</select></label>
        </div>
        <div id="promotion-rows" class="promotion-rows"><div class="inline-loading">Načítám skupiny…</div></div>
        <p class="privacy-hint">Postup vytvoří novou podobu stejné skupiny v cílovém roce. Původní záznam se archivuje, ale jeho historie zůstane zachována.</p>
        <p class="form-error" data-form-error hidden></p>
      </form>`,
    actions: `<button class="button button--ghost" type="button" data-close-modal>Zrušit</button><button class="button button--primary" type="submit" form="promotion-form">Provést vybrané změny</button>`,
    async onOpen(backdrop, close) {
      const form = backdrop.querySelector('#promotion-form');
      const rowsRegion = backdrop.querySelector('#promotion-rows');
      const renderRows = async () => {
        const sourceYearId = form.elements.sourceYearId.value;
        const targetYearId = form.elements.targetYearId.value;
        if (sourceYearId === targetYearId) {
          rowsRegion.innerHTML = '<div class="notice notice--warning"><div><strong>Vyberte různé roky</strong><p>Zdrojový a cílový školní rok nemohou být stejné.</p></div></div>';
          return;
        }
        const groups = await appState.academicService.listGroups({ schoolYearId: sourceYearId, status: '', includeAllStatuses: false });
        const active = groups.filter((group) => group.status !== 'archived');
        rowsRegion.innerHTML = /* qa-safe-html: all group-controlled fields are escaped */ active.length ? active.map((group) => `
          <article class="promotion-row" data-promotion-row data-group-id="${escapeAttribute(group.id)}">
            <div class="promotion-row__identity"><span class="color-swatch color-swatch--${escapeAttribute(group.colorToken)}"></span><div><strong>${escapeHtml(group.displayName)}</strong><small>${escapeHtml(group.subject?.name || 'Bez předmětu')} · ${escapeHtml(group.grade || 'ročník neuveden')}</small></div></div>
            <label class="form-field"><span>Akce</span><select name="action-${escapeAttribute(group.id)}"><option value="promote">Převést</option><option value="archive">Pouze archivovat</option><option value="skip">Přeskočit</option></select></label>
            <label class="form-field"><span>Nové označení</span><input name="name-${escapeAttribute(group.id)}" value="${escapeAttribute(nextGroupName(group.displayName))}"></label>
            <label class="form-field"><span>Nový ročník</span><input name="grade-${escapeAttribute(group.id)}" value="${escapeAttribute(nextGrade(group.grade))}"></label>
          </article>`).join('') : '<div class="calm-empty calm-empty--neutral"><div><strong>Žádné skupiny k převodu</strong><span>Ve zdrojovém roce nejsou aktivní ani skryté skupiny.</span></div></div>';
      };
      form.elements.sourceYearId.addEventListener('change', renderRows);
      form.elements.targetYearId.addEventListener('change', renderRows);
      await renderRows();
      bindSubmit(backdrop, '#promotion-form', async (data) => {
        const rows = [...backdrop.querySelectorAll('[data-promotion-row]')].map((row) => {
          const id = row.dataset.groupId;
          return { id, action: data.get(`action-${id}`), displayName: data.get(`name-${id}`), grade: data.get(`grade-${id}`) };
        });
        const result = await appState.academicService.promoteGroups({
          sourceYearId: data.get('sourceYearId'),
          targetYearId: data.get('targetYearId'),
          rows,
        });
        await appState.refreshAcademic();
        showToast(`Převedeno: ${result.promoted}, archivováno: ${result.archived}, přeskočeno: ${result.skipped}.`, 'success');
      }, close);
    },
  });
}

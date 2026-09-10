import { appState } from '../core/appState.js';
import { APP_EVENTS } from '../core/constants.js';
import { eventBus } from '../core/eventBus.js';
import { escapeAttribute, escapeHtml } from '../core/html.js';
import { openModal } from './modal.js';
import { showToast } from './toast.js';

function showError(form, error) {
  const region = form.querySelector('[data-form-error]');
  if (region) { region.hidden = false; region.textContent = error.message || 'Operaci se nepodařilo dokončit.'; }
}
function dateInput(value = '') { return value ? new Date(value).toISOString().slice(0, 10) : ''; }
function groupsOptions(groups, selected = '') {
  return groups.map((group) => `<option value="${escapeAttribute(group.id)}" ${group.id === selected ? 'selected' : ''}>${escapeHtml(group.displayName)}${group.subject ? ` · ${escapeHtml(group.subject.shortName || group.subject.name)}` : ''}</option>`).join('');
}

export function openSubstitutionPeriodDialog(period = null) {
  return openModal({
    id: 'substitution-period-modal', eyebrow: period ? 'Úprava zastupování' : 'Nové zastupování', title: period?.title || 'Připravit období nepřítomnosti', wide: true,
    body: `<form id="substitution-period-form" class="form-stack"><label class="form-field"><span>Název</span><input name="title" required value="${escapeAttribute(period?.title || '')}" placeholder="Nepřítomnost – září"></label><div class="form-grid"><label class="form-field"><span>Od</span><input name="startDate" type="date" required value="${dateInput(period?.startDate)}"></label><label class="form-field"><span>Do</span><input name="endDate" type="date" required value="${dateInput(period?.endDate)}"></label><label class="form-field"><span>Přístup</span><select name="accessMode"><option value="all_substitutes" ${period?.accessMode !== 'selected' ? 'selected' : ''}>Všichni přihlášení suplující</option><option value="selected" ${period?.accessMode === 'selected' ? 'selected' : ''}>Pouze vybraní uživatelé</option></select></label><label class="form-field"><span>Stav</span><select name="status"><option value="draft" ${period?.status === 'draft' ? 'selected' : ''}>Koncept</option><option value="active" ${period?.status === 'active' ? 'selected' : ''}>Aktivní</option><option value="closed" ${period?.status === 'closed' ? 'selected' : ''}>Uzavřené</option></select></label></div><label class="form-field"><span>Veřejné shrnutí pro kolegy</span><textarea name="summary" rows="4">${escapeHtml(period?.summary || '')}</textarea></label><label class="form-field"><span>Soukromá poznámka</span><textarea name="privateNotes" rows="3">${escapeHtml(period?.privateNotes || '')}</textarea><small>Toto pole se suplujícím učitelům nikdy neposílá.</small></label><p class="form-error" data-form-error hidden></p></form>`,
    actions: '<button class="button button--ghost" type="button" data-close-modal>Zrušit</button><button class="button button--primary" type="submit" form="substitution-period-form">Uložit</button>',
    onOpen(backdrop, close) {
      const form = backdrop.querySelector('#substitution-period-form');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
          const input = Object.fromEntries(new FormData(form));
          if (period) await appState.substitutionService.updatePeriod(period.id, input); else await appState.substitutionService.createPeriod(input);
          close(); eventBus.emit(APP_EVENTS.substitutionChanged, {}); showToast('Zastupovací období bylo uloženo.', 'success');
        } catch (error) { showError(form, error); }
      });
    },
  });
}

export async function openSubstitutionPlanDialog(period, plan = null) {
  const groups = await appState.academicService.listGroups({ includeAllStatuses: false, status: 'active' });
  return openModal({
    id: 'substitution-plan-modal', eyebrow: 'Podklady pro skupinu', title: plan?.title || 'Přidat zastupovací plán', wide: true,
    body: `<form id="substitution-plan-form" class="form-stack"><input type="hidden" name="periodId" value="${escapeAttribute(period.id)}"><div class="form-grid"><label class="form-field"><span>Skupina</span><select name="groupInstanceId" data-sub-group required><option value="">Vyberte skupinu</option>${groupsOptions(groups, plan?.groupInstanceId || '')}</select></label><label class="form-field"><span>Typ plánu</span><select name="planType"><option value="lessons" ${plan?.planType !== 'horizon' ? 'selected' : ''}>Po jednotlivých hodinách</option><option value="horizon" ${plan?.planType === 'horizon' ? 'selected' : ''}>Pro celé období</option></select></label><label class="form-field"><span>Pořadí</span><select name="ordering"><option value="fixed">Pevné</option><option value="recommended" selected>Doporučené</option><option value="free">Libovolné</option><option value="substitute">Rozhodne suplující</option><option value="students">Rozhodnou studenti</option></select></label><label class="form-field"><span>Připravenost</span><select name="status"><option value="ready">Plán připraven</option><option value="partial">Částečně připraven</option><option value="missing">Bez připraveného plánu</option></select></label></div><input type="hidden" name="groupName" data-sub-group-name value="${escapeAttribute(plan?.groupName || '')}"><input type="hidden" name="subjectName" data-sub-subject-name value="${escapeAttribute(plan?.subjectName || '')}"><label class="form-field"><span>Název plánu</span><input name="title" required value="${escapeAttribute(plan?.title || '')}"></label><label class="form-field"><span>Pokyny pro suplujícího učitele</span><textarea name="instructions" rows="5">${escapeHtml(plan?.instructions || '')}</textarea></label><label class="form-field"><span>Pokyny pro studenty</span><textarea name="studentInstructions" rows="4">${escapeHtml(plan?.studentInstructions || '')}</textarea></label><label class="form-field"><span>Soukromá metodická poznámka</span><textarea name="privateNotes" rows="3">${escapeHtml(plan?.privateNotes || '')}</textarea><small>Suplující učitel ji neuvidí.</small></label><p class="form-error" data-form-error hidden></p></form>`,
    actions: '<button class="button button--ghost" type="button" data-close-modal>Zrušit</button><button class="button button--primary" type="submit" form="substitution-plan-form">Uložit plán</button>',
    onOpen(backdrop, close) {
      const form = backdrop.querySelector('#substitution-plan-form');
      const select = form.querySelector('[data-sub-group]');
      const groupMap = new Map(groups.map((group) => [group.id, group]));
      const syncGroup = () => { const group = groupMap.get(select.value); form.querySelector('[data-sub-group-name]').value = group?.displayName || ''; form.querySelector('[data-sub-subject-name]').value = group?.subject?.name || ''; if (!form.elements.title.value && group) form.elements.title.value = `Plán pro ${group.displayName}`; };
      select.addEventListener('change', syncGroup); syncGroup();
      form.addEventListener('submit', async (event) => { event.preventDefault(); try { const input = Object.fromEntries(new FormData(form)); if (plan) await appState.substitutionService.updatePlan(plan.id, input); else await appState.substitutionService.createPlan(input); close(); eventBus.emit(APP_EVENTS.substitutionChanged, {}); showToast('Zastupovací plán byl uložen.', 'success'); } catch (error) { showError(form, error); } });
    },
  });
}

export function openSubstitutionItemDialog(plan, item = null) {
  return openModal({
    id: 'substitution-item-modal', eyebrow: 'Výukový úkol', title: item?.title || 'Přidat položku plánu', wide: true,
    body: `<form id="substitution-item-form" class="form-stack"><input type="hidden" name="planId" value="${escapeAttribute(plan.id)}"><div class="form-grid"><label class="form-field"><span>Název</span><input name="title" required value="${escapeAttribute(item?.title || '')}"></label><label class="form-field"><span>Datum</span><input name="date" type="date" value="${dateInput(item?.date)}"></label><label class="form-field"><span>Téma</span><input name="topic" value="${escapeAttribute(item?.topic || '')}"></label><label class="form-field"><span>Cíl</span><input name="objective" value="${escapeAttribute(item?.objective || '')}"></label></div><label class="form-field"><span>Postup a pokyny</span><textarea name="instructions" rows="6">${escapeHtml(item?.instructions || '')}</textarea></label><label class="form-field"><span>Očekávaný výstup</span><textarea name="expectedOutput" rows="3">${escapeHtml(item?.expectedOutput || '')}</textarea></label><label class="form-field"><span>Poznámka pro suplujícího</span><textarea name="teacherNote" rows="3">${escapeHtml(item?.teacherNote || '')}</textarea></label><label class="form-field"><span>Soukromá poznámka</span><textarea name="privateNotes" rows="3">${escapeHtml(item?.privateNotes || '')}</textarea></label><p class="form-error" data-form-error hidden></p></form>`,
    actions: '<button class="button button--ghost" type="button" data-close-modal>Zrušit</button><button class="button button--primary" type="submit" form="substitution-item-form">Uložit položku</button>',
    onOpen(backdrop, close) { const form = backdrop.querySelector('#substitution-item-form'); form.addEventListener('submit', async (event) => { event.preventDefault(); try { const input = Object.fromEntries(new FormData(form)); if (item) await appState.substitutionService.updateItem(item.id, input); else await appState.substitutionService.createItem(input); close(); eventBus.emit(APP_EVENTS.substitutionChanged, {}); showToast('Položka zastupovacího plánu byla uložena.', 'success'); } catch (error) { showError(form, error); } }); },
  });
}

export function openSubstitutionProgressDialog(item) {
  return openModal({
    id: 'substitution-progress-modal', eyebrow: 'Záznam suplujícího učitele', title: item.title,
    body: `<form id="substitution-progress-form" class="form-stack"><label class="form-field"><span>Stav</span><select name="status"><option value="completed">Splněno</option><option value="partial">Částečně splněno</option><option value="not_completed">Nesplněno</option><option value="moved">Přesunuto</option><option value="adjusted">Upraveno</option><option value="impossible">Nebylo možné realizovat</option></select></label><label class="form-field"><span>Datum realizace</span><input name="realizedAt" type="date" value="${dateInput(item.realizedAt || new Date())}"></label><label class="form-field"><span>Co se podařilo a kde se skončilo</span><textarea name="substituteNote" rows="6">${escapeHtml(item.substituteNote || '')}</textarea></label><p class="form-error" data-form-error hidden></p></form>`,
    actions: '<button class="button button--ghost" type="button" data-close-modal>Zrušit</button><button class="button button--primary" type="submit" form="substitution-progress-form">Uložit stav</button>',
    onOpen(backdrop, close) { const form = backdrop.querySelector('#substitution-progress-form'); form.addEventListener('submit', async (event) => { event.preventDefault(); try { await appState.substitutionService.updateItem(item.id, Object.fromEntries(new FormData(form))); close(); eventBus.emit(APP_EVENTS.substitutionChanged, {}); showToast('Průběh zastupování byl uložen.', 'success'); } catch (error) { showError(form, error); } }); },
  });
}

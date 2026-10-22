import { appState } from '../core/appState.js';
import { escapeAttribute, escapeHtml } from '../core/html.js';
import { listCentralGroupMetadata } from '../integration/centralGroupsClient.js';
import { CanonicalGroupLinkService } from '../services/canonicalGroupLinkService.js';
import { openModal, confirmAction } from './modal.js';
import { showToast } from './toast.js';

function getLinkService() {
  return new CanonicalGroupLinkService(appState.repositories, appState.academicService);
}
function option(value, label, selected = false) {
  return `<option value="${escapeAttribute(value)}" ${selected ? 'selected' : ''}>${escapeHtml(label)}</option>`;
}
function fingerprintForm(form, group) {
  if (group) return String(group.id);
  return JSON.stringify({
    year: form.elements.schoolYearId.value,
    subject: form.elements.subjectId.value,
    name: form.elements.displayName.value.trim(),
    grade: form.elements.grade.value.trim(),
  });
}
function groupInput(form) {
  return {
    schoolYearId: form.elements.schoolYearId.value,
    subjectId: form.elements.subjectId.value,
    displayName: form.elements.displayName.value.trim(),
    grade: form.elements.grade.value.trim(),
  };
}
function publicError(error) {
  const code = String(error?.code || error?.message || '');
  const messages = {
    CENTRAL_YEAR_MISMATCH: 'Školní roky v AI Studiu a Lesson Hubu se neshodují. Vyberte správný místní rok.',
    CENTRAL_LINK_ALREADY_USED: 'Tato centrální skupina již patří k jinému místnímu záznamu. Propojení se neprovedlo.',
    CENTRAL_LINK_SWITCH_REQUIRES_UNLINK: 'Skupina už je propojená. Nejdříve vědomě odpojte starou vazbu.',
    CENTRAL_ARCHIVED_CANNOT_LINK: 'Archivovanou centrální skupinu nelze nově připojit.',
    CENTRAL_ARCHIVED_CANNOT_CREATE: 'Z archivované centrální skupiny nelze vytvořit aktivní místní skupinu.',
    CENTRAL_REVISION_ROLLBACK: 'Zdroj má starší revizi. Změna byla bezpečně odmítnuta.',
    CENTRAL_SAME_REVISION_CONFLICT: 'Metadata se změnila bez nové revize. Kontaktujte správce.',
    CENTRAL_LOCAL_STALE_PREVIEW: 'Místní skupina se mezitím změnila. Vytvořte nový náhled.',
    CENTRAL_PREVIEW_STALE: 'Centrální skupina se mezitím změnila. Vytvořte nový náhled.',
    CENTRAL_LOCAL_NAME_DUPLICATE: 'Stejně pojmenovaná místní skupina už v daném předmětu a roce existuje.',
    CENTRAL_LOCAL_SELECTION_INVALID: 'Vyberte platný místní školní rok a aktivní předmět.',
  };
  return messages[code] || 'Údaje nelze bezpečně ověřit. Nic se nezměnilo; místní skupiny zůstávají dostupné.';
}

export function openCentralGroupDialog({ group = null, returnToLocal = null } = {}) {
  if (!appState.isReady || !appState.repositories || !appState.academicService) {
    showToast('Nejprve dokončete načtení Lesson Hubu.', 'warning');
    return null;
  }
  const years = appState.academic.years.filter((y) => y.status === 'active');
  const subjects = appState.academic.subjects.filter((s) => s.status === 'active');
  if (!group && (!years.length || !subjects.length)) {
    showToast('Nejprve vytvořte místní školní rok a alespoň jeden předmět.', 'warning');
    return null;
  }
  const currentYear = appState.academic.currentYear?.id || years[0]?.id;
  return openModal({
    id: 'canonical-group-modal',
    eyebrow: 'AI Studio · Moje skupiny',
    title: group ? `Propojení: ${group.displayName}` : 'Vytvořit z Moje skupiny',
    wide: true,
    body: `
      <form id="canonical-group-form" class="form-stack">
        <p class="privacy-hint">Přenášejí se pouze metadata skupiny: stabilní ID, název, školní rok, předmět, ročník a revize. <strong>Seznam studentů ani e-maily se nenačítají.</strong> Hodiny, historie, poznámky, úkoly, materiály a cykly zůstávají pouze v Lesson Hubu.</p>
        ${group ? `<p class="privacy-hint">Místní skupina: <strong>${escapeHtml(group.displayName)}</strong>. Současná vazba: ${escapeHtml(group.canonicalGroupId || 'pouze lokální')}.</p>` : `
          <div class="form-grid form-grid--3">
            <label class="form-field"><span>Místní školní rok</span><select name="schoolYearId" required>${years.map((year) => option(year.id, year.label, year.id === currentYear)).join('')}</select></label>
            <label class="form-field"><span>Místní předmět</span><select name="subjectId" required>${subjects.map((subject) => option(subject.id, subject.name)).join('')}</select></label>
            <label class="form-field"><span>Ročník (místní)</span><input name="grade" maxlength="120" placeholder="Např. 3. ročník"></label>
            <label class="form-field form-field--wide"><span>Místní název skupiny</span><input name="displayName" required maxlength="120" placeholder="Vyberte centrální skupinu"></label>
          </div>`}
        <label class="form-field"><span>Skupina v AI Studiu</span><select name="canonicalGroupId" required><option value="">Načítám metadata skupin…</option></select></label>
        <div class="notice" data-canonical-preview aria-live="polite">Vybírá se pouze podle ID. Shoda názvů není automatickým souhlasem s propojením.</div>
        <label class="check-field"><input name="accept" type="checkbox"><span><strong>Potvrzuji vybranou centrální skupinu a kontrolu náhledu</strong><small>Místní výuková data se nepřesouvají ani neslučují.</small></span></label>
        <p class="form-error" data-canonical-error hidden role="alert"></p>
      </form>`,
    actions: `<button type="button" class="button button--ghost" data-canonical-close>${group ? 'Zavřít bez změny' : 'Nechat pouze lokální skupinu'}</button>
      ${group?.canonicalGroupId ? '<button class="button button--secondary" type="button" data-canonical-unlink>Odpojit vazbu</button>' : ''}
      <button class="button button--primary" type="button" data-canonical-apply disabled>Potvrdit propojení</button>`,
    onOpen(backdrop, close) {
      backdrop.querySelector('[data-canonical-close]')?.addEventListener('click', () => {
        close();
        // When entered from the local editor, return to the normal local-only
        // creation/editing form instead of silently discarding that choice.
        if (typeof returnToLocal === 'function') returnToLocal();
      });
      const form = backdrop.querySelector('#canonical-group-form');
      const choice = form.elements.canonicalGroupId;
      const previewArea = backdrop.querySelector('[data-canonical-preview]');
      const errorArea = backdrop.querySelector('[data-canonical-error]');
      const apply = backdrop.querySelector('[data-canonical-apply]');
      const linkService = getLinkService();
      let groups = [];
      let preview = null;
      let generation = 0;
      const error = (problem) => { errorArea.textContent = publicError(problem); errorArea.hidden = false; };
      const clearError = () => { errorArea.hidden = true; errorArea.textContent = ''; };
      const updateApply = () => { apply.disabled = !preview || !form.elements.accept.checked; };
      async function previewSelected() {
        const ticket = ++generation;
        preview = null;
        form.elements.accept.checked = false;
        updateApply(); clearError();
        const id = choice.value;
        if (!id) { previewArea.textContent = 'Vyberte centrální skupinu. Automatické párování podle názvu není povoleno.'; return; }
        try {
          const metadata = groups.find((candidate) => candidate.groupId === id);
          if (!metadata) throw new Error('CENTRAL_PREVIEW_STALE');
          const input = group ? null : groupInput(form);
          const plan = group
            ? await linkService.previewExisting(group.id, metadata)
            : await linkService.previewCreate(input, metadata);
          if (ticket !== generation || choice.value !== id) return;
          const hints = [
            `Zdroj: ${metadata.displayName}; školní rok ${metadata.schoolYear}; revize ${metadata.revision}; stav ${metadata.status}.`,
            group ? `Místní záznam: ${plan.localDisplayName}; akce: ${plan.mode === 'link' ? 'nová vazba' : 'aktualizace metadat'}.` :
              `Nová místní skupina: ${plan.displayName} (${plan.localSchoolYear}, ${plan.localSubject}).`,
            ...plan.warnings,
            'Nedochází ke změně existujících hodin, jejich kontinuity ani členství studentů.',
          ];
          previewArea.replaceChildren();
          for (const sentence of hints) { const p = document.createElement('p'); p.textContent = sentence; previewArea.append(p); }
          preview = { metadata, input, plan, fingerprint: fingerprintForm(form, group) };
          updateApply();
        } catch (problem) {
          if (ticket !== generation) return;
          previewArea.textContent = 'Náhled nebylo možné bezpečně připravit.';
          error(problem);
        }
      }
      choice.addEventListener('change', () => {
        if (!group) {
          const chosen = groups.find((item) => item.groupId === choice.value);
          if (chosen && !form.elements.displayName.value.trim()) form.elements.displayName.value = chosen.displayName;
          if (chosen?.grade && !form.elements.grade.value.trim()) form.elements.grade.value = chosen.grade;
        }
        void previewSelected();
      });
      form.elements.accept.addEventListener('change', updateApply);
      if (!group) for (const name of ['schoolYearId', 'subjectId', 'displayName', 'grade']) {
        const field = form.elements[name];
        field.addEventListener('input', () => void previewSelected());
        field.addEventListener('change', () => void previewSelected());
      }
      apply.addEventListener('click', async () => {
        if (!preview || !form.elements.accept.checked) return;
        apply.disabled = true; clearError();
        try {
          if (preview.fingerprint !== fingerprintForm(form, group)) throw new Error('CENTRAL_PREVIEW_STALE');
          const fresh = await listCentralGroupMetadata();
          const actual = fresh.find((meta) => meta.groupId === preview.metadata.groupId);
          if (!actual || JSON.stringify(actual) !== JSON.stringify(preview.metadata)) throw new Error('CENTRAL_PREVIEW_STALE');
          if (group) {
            await linkService.linkExisting(group.id, actual, preview.plan.expectedUpdatedAt, preview.plan.expectedLocalSnapshot);
          } else {
            await linkService.createFromCentral(preview.input, actual);
          }
          close();
          await appState.refreshAcademic();
          showToast('Propojení Moje skupiny je uložené. Místní historie zůstala beze změny.', 'success');
        } catch (problem) {
          preview = null; form.elements.accept.checked = false; updateApply(); error(problem);
        }
      });
      backdrop.querySelector('[data-canonical-unlink]')?.addEventListener('click', () => {
        // Explicit teacher confirmation; unlink never deletes or migrates academic data.
        confirmAction({
          title: `Odpojit ${group.displayName} od Moje skupiny?`,
          message: 'Odstraní se pouze centrální vazba a uložená metadata. Hodiny, historie a pedagogické záznamy zůstanou beze změny.',
          confirmLabel: 'Odpojit centrální vazbu',
          onConfirm: async () => {
            await linkService.unlink(group.id, group.updatedAt, JSON.stringify(group));
            await appState.refreshAcademic();
            showToast('Centrální vazba odpojena, místní historie zachována.', 'success');
          },
        });
      });
      (async () => {
        try {
          groups = await listCentralGroupMetadata();
          if (!backdrop.isConnected) return;
          choice.replaceChildren(new Option('Vyberte skupinu – bez automatického párování', ''));
          for (const item of groups) {
            const suffix = item.status === 'archived' ? ' · archiv v AI Studiu' : '';
            choice.add(new Option(`${item.displayName} · ${item.schoolYear} · rev. ${item.revision}${suffix}`, item.groupId));
          }
          if (group?.canonicalGroupId && groups.some((item) => item.groupId === group.canonicalGroupId)) {
            choice.value = group.canonicalGroupId;
            await previewSelected();
          } else previewArea.textContent = group?.canonicalGroupId ?
            'Dříve propojená skupina není aktuálně v centrální evidenci. Historie Lesson Hubu zůstává dostupná; lze ji vědomě odpojit.' :
            'Vyberte centrální skupinu. Název a školní rok zkontrolujte v náhledu.';
        } catch {
          if (!backdrop.isConnected) return;
          choice.replaceChildren(new Option('Centrální služba není dostupná', ''));
          previewArea.textContent = 'Moje skupiny nyní nejsou bezpečně dostupné. Místní skupina a celá její historie fungují dál.';
          apply.disabled = true;
        }
      })();
    },
  });
}
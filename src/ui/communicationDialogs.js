import { appState } from '../core/appState.js';
import { APP_EVENTS } from '../core/constants.js';
import { eventBus } from '../core/eventBus.js';
import { escapeAttribute, escapeHtml } from '../core/html.js';
import { MESSAGE_TYPES } from '../services/communicationService.js';
import { openModal } from './modal.js';
import { showToast } from './toast.js';

function showError(form, error) {
  const region = form.querySelector('[data-form-error]');
  if (region) { region.hidden = false; region.textContent = error.message || 'Operaci se nepodařilo dokončit.'; }
}
function options(items, selected = '', valueKey = 'id', label = (item) => item.displayName || item.title) {
  return items.map((item) => `<option value="${escapeAttribute(item[valueKey])}" ${item[valueKey] === selected ? 'selected' : ''}>${escapeHtml(label(item))}</option>`).join('');
}
function datetimeLocal(value = '') {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
function typeOptions(selected = 'general') {
  return Object.entries(MESSAGE_TYPES).map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('');
}

export async function openStudentImportDialog() {
  const groups = await appState.academicService.listGroups({ includeAllStatuses: false, status: 'active' });
  return openModal({
    id: 'student-import-modal', eyebrow: 'Hromadný import', title: 'Načíst školní e-maily studentů', wide: true,
    body: `<form id="student-import-form" class="form-stack"><label class="form-field"><span>Skupina</span><select name="groupInstanceId" required><option value="">Vyberte skupinu</option>${options(groups)}</select></label><label class="form-field"><span>Seznam e-mailových adres</span><textarea name="rawEmails" rows="9" required placeholder="jmeno.prijmeni [zavináč] skola.cz, další.student [zavináč] skola.cz"></textarea><small>Adresy mohou být oddělené čárkou, středníkem, mezerou nebo novým řádkem. Jména se odvodí z adresy a lze je později upravit.</small></label><p class="privacy-note">Ukládejte pouze údaje nezbytné pro výukovou komunikaci. Lesson Hub nenahrazuje oficiální školní evidenci.</p><p class="form-error" data-form-error hidden></p></form>`,
    actions: '<button class="button button--ghost" type="button" data-close-modal>Zrušit</button><button class="button button--primary" type="submit" form="student-import-form">Importovat adresy</button>',
    onOpen(backdrop, close) {
      const form = backdrop.querySelector('#student-import-form');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submit = backdrop.querySelector('button[form="student-import-form"]'); submit.disabled = true;
        try {
          const input = Object.fromEntries(new FormData(form));
          const result = await appState.communicationService.importStudents(input);
          close();
          eventBus.emit(APP_EVENTS.communicationChanged, {});
          showToast(`Import dokončen: ${result.created.length} nových, ${result.updated.length} aktualizovaných${result.invalid.length ? `, ${result.invalid.length} neplatných` : ''}.`, result.invalid.length ? 'info' : 'success');
        } catch (error) { showError(form, error); } finally { submit.disabled = false; }
      });
    },
  });
}

export function openStudentDialog(student) {
  return openModal({
    id: 'student-editor-modal', eyebrow: 'Minimální kontaktní údaje', title: student.displayName,
    body: `<form id="student-form" class="form-stack"><label class="form-field"><span>Jméno</span><input name="displayName" required value="${escapeAttribute(student.displayName)}"></label><label class="form-field"><span>Školní e-mail</span><input name="email" type="email" required value="${escapeAttribute(student.email)}"></label><label class="form-field"><span>Interní provozní poznámka</span><textarea name="notes" rows="4">${escapeHtml(student.notes || '')}</textarea><small>Nevkládejte citlivé osobní profily, zdravotní údaje ani kázeňskou dokumentaci.</small></label><p class="form-error" data-form-error hidden></p></form>`,
    actions: '<button class="button button--ghost" type="button" data-close-modal>Zrušit</button><button class="button button--primary" type="submit" form="student-form">Uložit</button>',
    onOpen(backdrop, close) {
      const form = backdrop.querySelector('#student-form');
      form.addEventListener('submit', async (event) => { event.preventDefault(); try { await appState.communicationService.updateStudent(student.id, Object.fromEntries(new FormData(form))); close(); eventBus.emit(APP_EVENTS.communicationChanged, {}); showToast('Kontakt studenta byl upraven.', 'success'); } catch (error) { showError(form, error); } });
    },
  });
}

export function openMessageTemplateDialog(template = null) {
  return openModal({
    id: 'message-template-modal', eyebrow: template ? 'Úprava šablony' : 'Nová šablona', title: template?.title || 'Šablona zprávy', wide: true,
    body: `<form id="message-template-form" class="form-stack"><div class="form-grid"><label class="form-field"><span>Název šablony</span><input name="title" required value="${escapeAttribute(template?.title || '')}" placeholder="Připomínka testu"></label><label class="form-field"><span>Typ</span><select name="type">${typeOptions(template?.type)}</select></label></div><label class="form-field"><span>Předmět zprávy</span><input name="subject" required value="${escapeAttribute(template?.subject || '')}"></label><label class="form-field"><span>Text</span><textarea name="body" rows="8" required>${escapeHtml(template?.body || '')}</textarea><small>Proměnné: {{studentName}}, {{groupName}}, {{subjectName}}, {{date}}, {{taskName}}</small></label><label class="form-field"><span>Podpis</span><textarea name="signature" rows="3">${escapeHtml(template?.signature || '')}</textarea></label><p class="form-error" data-form-error hidden></p></form>`,
    actions: `<button class="button button--ghost" type="button" data-close-modal>Zrušit</button><button class="button button--primary" type="submit" form="message-template-form">${template ? 'Uložit změny' : 'Vytvořit šablonu'}</button>`,
    onOpen(backdrop, close) {
      const form = backdrop.querySelector('#message-template-form');
      form.addEventListener('submit', async (event) => { event.preventDefault(); try { const input = Object.fromEntries(new FormData(form)); if (template) await appState.communicationService.updateTemplate(template.id, input); else await appState.communicationService.createTemplate(input); close(); eventBus.emit(APP_EVENTS.communicationChanged, {}); showToast('Šablona zprávy byla uložena.', 'success'); } catch (error) { showError(form, error); } });
    },
  });
}

export async function openMessageDialog(message = null) {
  const [groups, students, templates] = await Promise.all([
    appState.academicService.listGroups({ includeAllStatuses: false, status: 'active' }),
    appState.communicationService.listStudents({ status: 'active' }),
    appState.communicationService.listTemplates(),
  ]);
  const recipientIds = new Set((message?.recipients || []).map((item) => item.studentId));
  const templatesJson = escapeAttribute(JSON.stringify(templates.map((item) => ({ id: item.id, subject: item.subject, body: item.body, signature: item.signature || '', type: item.type }))));
  return openModal({
    id: 'message-editor-modal', eyebrow: message ? 'Úprava komunikace' : 'Nová komunikace', title: message?.subject || 'Připravit zprávu studentům', wide: true,
    body: `<form id="message-form" class="form-stack" data-templates="${templatesJson}"><div class="form-grid"><label class="form-field"><span>Skupina</span><select name="groupInstanceId" data-message-group required><option value="">Vyberte skupinu</option>${options(groups, message?.groupInstanceId || '')}</select></label><label class="form-field"><span>Šablona</span><select name="templateId" data-message-template><option value="">Bez šablony</option>${options(templates, message?.templateId || '')}</select></label><label class="form-field"><span>Typ</span><select name="type" data-message-type>${typeOptions(message?.type)}</select></label><label class="form-field"><span>Režim</span><select name="status" data-message-status><option value="draft" ${message?.status === 'draft' ? 'selected' : ''}>Uložit jako koncept</option><option value="scheduled" ${['scheduled','approval_required'].includes(message?.status) ? 'selected' : ''}>Naplánovat</option></select></label><label class="form-field" data-scheduled-field><span>Datum a čas</span><input name="scheduledAt" type="datetime-local" value="${escapeAttribute(datetimeLocal(message?.scheduledAt))}"></label></div><label class="form-field"><span>Předmět</span><input name="subject" required value="${escapeAttribute(message?.subject || '')}"></label><label class="form-field"><span>Text zprávy</span><textarea name="body" rows="8" required>${escapeHtml(message?.body || '')}</textarea></label><fieldset class="recipient-selector"><legend>Příjemci</legend><div class="recipient-selector__list">${students.map((student) => `<label class="recipient-check" data-student-groups="${escapeAttribute((student.groupIdentityIds || [student.groupIdentityId]).filter(Boolean).join(','))}"><input type="checkbox" name="studentIds" value="${student.id}" ${recipientIds.has(student.id) ? 'checked' : ''}><span><strong>${escapeHtml(student.displayName)}</strong><small>${escapeHtml(student.email)}</small></span></label>`).join('') || '<p>Nejprve importujte studenty.</p>'}</div><button class="button button--ghost button--small" type="button" data-select-visible>Vybrat viditelné</button></fieldset><div class="form-grid"><label class="check-card"><input type="checkbox" name="sensitive" ${message?.sensitive ? 'checked' : ''}><span><strong>Citlivější sdělení</strong><small>Automaticky vyžaduje ruční schválení.</small></span></label><label class="check-card"><input type="checkbox" name="requireApproval" ${message?.requireApproval ? 'checked' : ''}><span><strong>Vyžadovat schválení</strong><small>Zpráva nebude připravena bez potvrzení.</small></span></label></div><p class="privacy-note">Skutečné odeslání provádí pouze Lesson Hub Server. Heslo ani token e-mailové brány se nikdy neukládají do prohlížeče. Citlivější zprávy vyžadují schválení.</p><p class="form-error" data-form-error hidden></p></form>`,
    actions: `<button class="button button--ghost" type="button" data-close-modal>Zrušit</button><button class="button button--primary" type="submit" form="message-form">${message ? 'Uložit zprávu' : 'Vytvořit zprávu'}</button>`,
    onOpen(backdrop, close) {
      const form = backdrop.querySelector('#message-form');
      const groupSelect = form.querySelector('[data-message-group]');
      const templateSelect = form.querySelector('[data-message-template]');
      const statusSelect = form.querySelector('[data-message-status]');
      const scheduleField = form.querySelector('[data-scheduled-field]');
      const groupsById = new Map(groups.map((item) => [item.id, item]));
      const filterStudents = () => {
        const identity = groupsById.get(groupSelect.value)?.groupIdentityId || '';
        form.querySelectorAll('[data-student-groups]').forEach((label) => { label.hidden = Boolean(identity) && !label.dataset.studentGroups.split(',').includes(identity); });
      };
      const updateSchedule = () => { scheduleField.hidden = statusSelect.value !== 'scheduled'; };
      groupSelect.addEventListener('change', filterStudents); statusSelect.addEventListener('change', updateSchedule);
      filterStudents(); updateSchedule();
      templateSelect.addEventListener('change', () => {
        const template = templates.find((item) => item.id === templateSelect.value); if (!template) return;
        form.elements.subject.value = template.subject; form.elements.body.value = `${template.body}${template.signature ? `\n\n${template.signature}` : ''}`; form.elements.type.value = template.type;
      });
      form.querySelector('[data-select-visible]')?.addEventListener('click', () => form.querySelectorAll('[data-student-groups]:not([hidden]) input').forEach((input) => { input.checked = true; }));
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const data = new FormData(form); const input = Object.fromEntries(data); input.studentIds = data.getAll('studentIds'); input.sensitive = data.get('sensitive') === 'on'; input.requireApproval = data.get('requireApproval') === 'on';
        try { if (message) await appState.communicationService.updateMessage(message.id, input); else await appState.communicationService.createMessage(input); close(); eventBus.emit(APP_EVENTS.communicationChanged, {}); showToast('Komunikační záznam byl uložen.', 'success'); } catch (error) { showError(form, error); }
      });
    },
  });
}

export function openAttachmentDialog() {
  return openModal({
    id: 'attachment-upload-modal', eyebrow: 'Serverové úložiště', title: 'Nahrát přílohu',
    body: `<form id="attachment-upload-form" class="form-stack"><label class="form-field"><span>Soubor</span><input name="file" type="file" required accept=".pdf,.docx,.xlsx,.pptx,.txt,.csv,.jpg,.jpeg,.png,.webp,.mp3,.wav,.ogg"></label><div class="form-grid"><label class="form-field"><span>Účel</span><select name="purpose"><option value="material">Materiál</option><option value="student">Pro studenty</option><option value="teacher">Pro učitele</option><option value="solution">Řešení / klíč</option></select></label><label class="form-field"><span>Viditelnost</span><select name="visibility"><option value="private">Pouze já</option><option value="shared">Sdílené</option><option value="substitution">Pro zastupování</option></select></label></div><p class="privacy-note">Maximální velikost určuje server; výchozí limit je 8 MB. Nepřidávejte dokumenty s nadbytečnými osobními údaji.</p><p class="form-error" data-form-error hidden></p></form>`,
    actions: '<button class="button button--ghost" type="button" data-close-modal>Zrušit</button><button class="button button--primary" type="submit" form="attachment-upload-form">Nahrát</button>',
    onOpen(backdrop, close) {
      const form = backdrop.querySelector('#attachment-upload-form');
      form.addEventListener('submit', async (event) => { event.preventDefault(); const submit = backdrop.querySelector('button[form="attachment-upload-form"]'); submit.disabled = true; try { const data = new FormData(form); const result = await appState.serverService.uploadAttachment(data.get('file'), { purpose: data.get('purpose'), visibility: data.get('visibility') }); await appState.communicationService.rememberServerAttachment(result.attachment); close(); eventBus.emit(APP_EVENTS.communicationChanged, {}); showToast(result.duplicate ? 'Stejná příloha už na serveru existovala; použil se původní záznam.' : 'Příloha byla bezpečně uložena na server.', result.duplicate ? 'info' : 'success'); } catch (error) { showError(form, error); } finally { submit.disabled = false; } });
    },
  });
}

export function openPrivacyPolicyDialog(policy) {
  return openModal({
    id: 'privacy-policy-modal', eyebrow: 'Minimalizace osobních údajů', title: 'Retenční pravidla serveru',
    body: `<form id="privacy-policy-form" class="form-stack"><label class="form-field"><span>Archivovaní studenti — uchovat dní</span><input name="studentRetentionDays" type="number" min="30" max="3650" value="${escapeAttribute(policy.studentRetentionDays)}"></label><label class="form-field"><span>Uzavřená komunikace — uchovat dní</span><input name="communicationRetentionDays" type="number" min="30" max="3650" value="${escapeAttribute(policy.communicationRetentionDays)}"></label><label class="form-field"><span>Nepřipojené přílohy — uchovat dní</span><input name="orphanAttachmentRetentionDays" type="number" min="30" max="3650" value="${escapeAttribute(policy.orphanAttachmentRetentionDays)}"></label><p class="privacy-note">Mazání se nikdy nespustí automaticky z tohoto dialogu. Nejprve se provede náhled a následně samostatné potvrzení.</p><p class="form-error" data-form-error hidden></p></form>`,
    actions: '<button class="button button--ghost" type="button" data-close-modal>Zrušit</button><button class="button button--primary" type="submit" form="privacy-policy-form">Uložit pravidla</button>',
    onOpen(backdrop, close) { const form = backdrop.querySelector('#privacy-policy-form'); form.addEventListener('submit', async (event) => { event.preventDefault(); try { await appState.serverService.updatePrivacyPolicy(Object.fromEntries(new FormData(form))); close(); eventBus.emit(APP_EVENTS.communicationChanged, {}); showToast('Retenční pravidla byla uložena.', 'success'); } catch (error) { showError(form, error); } }); },
  });
}

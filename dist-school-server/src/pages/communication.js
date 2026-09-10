import { appState } from '../core/appState.js';
import { APP_EVENTS, ROUTES } from '../core/constants.js';
import { eventBus } from '../core/eventBus.js';
import { escapeHtml } from '../core/html.js';
import { MESSAGE_STATUSES, MESSAGE_TYPES } from '../services/communicationService.js';
import { icon } from '../ui/icons.js';
import { confirmAction } from '../ui/modal.js';
import { navigate } from '../ui/router.js';
import { showToast } from '../ui/toast.js';
import {
  openAttachmentDialog,
  openMessageDialog,
  openMessageTemplateDialog,
  openPrivacyPolicyDialog,
  openStudentDialog,
  openStudentImportDialog,
} from '../ui/communicationDialogs.js';
import { emptyState, sectionHeader, statusPill } from './shared.js';

const TABS = Object.freeze({
  students: 'Studenti',
  messages: 'Zprávy',
  templates: 'Šablony',
  attachments: 'Přílohy',
  deliveries: 'Doručení',
  privacy: 'Soukromí',
});

function formatDateTime(value) {
  if (!value) return 'Bez termínu';
  return new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
function messageVariant(status) {
  return ({ draft: 'neutral', scheduled: 'info', approval_required: 'warning', ready: 'success', sending: 'warning', sent: 'success', partially_failed: 'warning', failed: 'danger', cancelled: 'danger' })[status] || 'neutral';
}
function tabNav(active, counts) {
  return `<nav class="detail-tabs communication-tabs" aria-label="Komunikační sekce">${Object.entries(TABS).map(([key, label]) => `<a href="#/${ROUTES.communication}?tab=${key}" class="${active === key ? 'is-active' : ''}">${escapeHtml(label)}${counts[key] != null ? `<b>${counts[key]}</b>` : ''}</a>`).join('')}</nav>`;
}
function summary(snapshot, serverReady) {
  const cards = [
    ['Aktivní studenti', snapshot.activeStudents, 'user'],
    ['Koncepty', snapshot.drafts, 'edit'],
    ['Naplánované', snapshot.scheduled, 'calendar'],
    ['Serverové přílohy', snapshot.attachments, 'materials'],
  ];
  return `<section class="summary-grid communication-summary">${cards.map(([label, value, iconName]) => `<article class="summary-card"><span>${icon(iconName, 20)}</span><div><strong>${value}</strong><small>${label}</small></div></article>`).join('')}<article class="summary-card ${serverReady ? 'is-positive' : 'is-warning'}"><span>${icon('shield', 20)}</span><div><strong>${serverReady ? 'Připojeno' : 'Lokálně'}</strong><small>${serverReady ? 'Serverová komunikace aktivní' : 'Přílohy a retence vyžadují server'}</small></div></article></section>`;
}
function studentsView(model) {
  if (!model.students.length) return emptyState({ iconName: 'groups', title: 'Zatím nejsou importováni studenti', text: 'Vložte seznam školních e-mailových adres a Lesson Hub vytvoří minimální kontaktní evidenci bez duplicit.', action: '<button class="button button--primary" type="button" data-student-import>Importovat e-maily</button>' });
  return `<section class="content-card">${sectionHeader('Kontakty studentů', 'Pouze minimální údaje potřebné pro výukovou komunikaci.', '<button class="button button--primary" type="button" data-student-import>'+icon('upload',16)+' Importovat</button>')}<div class="communication-list">${model.students.map((student) => `<article class="communication-row"><div class="communication-row__icon">${icon('user',18)}</div><div class="communication-row__main"><strong>${escapeHtml(student.displayName)}</strong><span>${escapeHtml(student.email)}</span><small>${student.groupNames.length ? escapeHtml(student.groupNames.join(' · ')) : 'Bez aktivní skupiny'}</small></div><div class="communication-row__status">${statusPill(student.status === 'active' ? 'Aktivní' : 'Archivovaný', student.status === 'active' ? 'success' : 'neutral')}</div><div class="communication-row__actions"><button class="button button--ghost button--small" type="button" data-student-edit="${student.id}">${icon('edit',14)} Upravit</button>${student.status === 'active' ? `<button class="icon-button icon-button--small" type="button" data-student-archive="${student.id}" title="Archivovat">${icon('archive',15)}</button>` : `<button class="button button--secondary button--small" type="button" data-student-restore="${student.id}">Obnovit</button>`}</div></article>`).join('')}</div></section>`;
}
function messagesView(model) {
  if (!model.messages.length) return emptyState({ iconName: 'plan', title: 'Zatím nejsou připravené žádné zprávy', text: 'Vytvořte koncept nebo naplánovanou zprávu. Citlivější komunikace bude automaticky čekat na ruční schválení.', action: '<button class="button button--primary" type="button" data-message-create>Nová zpráva</button>' });
  return `<section class="content-card">${sectionHeader('Komunikační historie', 'Koncepty, plánování, skutečné odesílání a auditní stavy každého příjemce.', '<div class="button-cluster"><button class="button button--secondary" type="button" data-process-due>'+icon('restore',16)+' Připravit splatné</button><button class="button button--primary" type="button" data-message-create>'+icon('plus',16)+' Nová zpráva</button></div>')}<div class="message-grid">${model.messages.map((message) => `<article class="message-card"><div class="message-card__top"><div><span class="message-card__eyebrow">${escapeHtml(MESSAGE_TYPES[message.type] || 'Sdělení')} · ${message.recipients?.length || 0} příjemců</span><h3>${escapeHtml(message.subject)}</h3></div>${statusPill(MESSAGE_STATUSES[message.status] || message.status, messageVariant(message.status), message.status === 'ready' || message.status === 'sent' ? 'check' : 'plan')}</div><p>${escapeHtml(message.body).slice(0,260)}${message.body.length > 260 ? '…' : ''}</p><div class="message-card__meta"><span>${message.group ? escapeHtml(message.group.displayName) : 'Bez skupiny'}</span><span>${message.scheduledAt ? formatDateTime(message.scheduledAt) : 'Bez naplánování'}</span>${message.sensitive ? '<span>Citlivější komunikace</span>' : ''}</div><div class="message-card__actions">${!['sent','cancelled'].includes(message.status) ? `<button class="button button--ghost button--small" type="button" data-message-edit="${message.id}">${icon('edit',14)} Upravit</button>` : ''}${message.status === 'approval_required' ? `<button class="button button--primary button--small" type="button" data-message-approve="${message.id}">${icon('check',14)} Schválit</button>` : ''}${message.status === 'ready' ? `<button class="button button--primary button--small" type="button" data-message-send="${message.id}">${icon('send',14)} Odeslat</button>` : ''}${['failed','partially_failed'].includes(message.status) ? `<button class="button button--secondary button--small" type="button" data-message-retry="${message.id}">${icon('restore',14)} Opakovat</button>` : ''}${!['sent','cancelled'].includes(message.status) ? `<button class="button button--ghost button--small" type="button" data-message-cancel="${message.id}">Zrušit</button>` : ''}</div></article>`).join('')}</div></section>`;
}
function templatesView(model) {
  if (!model.templates.length) return emptyState({ iconName: 'book', title: 'Zatím nejsou vytvořené šablony zpráv', text: 'Připravte si opakovaně používané texty pro testy, domácí úkoly nebo chybějící práce.', action: '<button class="button button--primary" type="button" data-template-create>Nová šablona</button>' });
  return `<section class="content-card">${sectionHeader('Šablony zpráv', 'Upravitelné texty s proměnnými pro jméno, skupinu, datum a úkol.', '<button class="button button--primary" type="button" data-template-create>'+icon('plus',16)+' Nová šablona</button>')}<div class="template-message-grid">${model.templates.map((template) => `<article class="template-message-card"><span>${escapeHtml(MESSAGE_TYPES[template.type] || 'Sdělení')}</span><h3>${escapeHtml(template.title)}</h3><strong>${escapeHtml(template.subject)}</strong><p>${escapeHtml(template.body).slice(0,220)}${template.body.length > 220 ? '…' : ''}</p><div><button class="button button--ghost button--small" type="button" data-template-edit="${template.id}">${icon('edit',14)} Upravit</button><button class="icon-button icon-button--small" type="button" data-template-archive="${template.id}" title="Archivovat">${icon('archive',15)}</button></div></article>`).join('')}</div></section>`;
}

function deliveriesView(model) {
  if (!model.serverReady) return emptyState({ iconName: 'shield', title: 'Doručenky vyžadují server', text: 'Přihlaste se k Lesson Hub Serveru. Přístupové údaje e-mailové brány zůstávají pouze na serveru.', action: `<a class="button button--primary" href="#/${ROUTES.server}">Otevřít serverové centrum</a>` });
  const gateway = model.mailStatus || { mode: 'disabled', configured: false };
  const gatewayCard = `<section class="content-card"><div class="section-heading"><div><h2>E-mailová brána</h2><p>Serverový adaptér bez zpřístupnění hesla nebo tokenu klientské aplikaci.</p></div>${statusPill(gateway.configured ? 'Připravena' : 'Nenakonfigurována', gateway.configured ? 'success' : 'warning')}</div><div class="delivery-gateway-grid"><article><strong>${escapeHtml(gateway.mode || 'disabled')}</strong><span>režim</span></article><article><strong>${escapeHtml(gateway.from || '—')}</strong><span>odesílatel</span></article><article><strong>${gateway.maxAttempts || '—'}</strong><span>pokusů</span></article><article><strong>${gateway.retryMinutes || '—'} min</strong><span>opakování</span></article></div></section>`;
  if (!model.deliveries.length) return `${gatewayCard}${emptyState({ iconName: 'plan', title: 'Zatím nejsou žádné doručenky', text: 'Po prvním skutečném odeslání se zde zobrazí samostatný stav každého příjemce.' })}`;
  return `${gatewayCard}<section class="content-card">${sectionHeader('Historie doručení', 'Každý student má samostatný záznam; adresy se navzájem neodhalují.')}<div class="communication-list">${model.deliveries.map((delivery) => `<article class="communication-row"><div class="communication-row__icon">${icon(delivery.status === 'sent' ? 'check' : delivery.status === 'failed' ? 'warning' : 'restore',18)}</div><div class="communication-row__main"><strong>${escapeHtml(delivery.recipientName || delivery.recipientEmail)}</strong><span>${escapeHtml(delivery.recipientEmail)}</span><small>${delivery.sentAt ? `Odesláno ${formatDateTime(delivery.sentAt)}` : delivery.nextAttemptAt ? `Další pokus ${formatDateTime(delivery.nextAttemptAt)}` : `Poslední pokus ${formatDateTime(delivery.lastAttemptAt)}`}${delivery.errorMessage ? ` · ${escapeHtml(delivery.errorMessage)}` : ''}</small></div><div class="communication-row__status">${statusPill(({ sent:'Odesláno', failed:'Selhalo', retrying:'Bude opakováno', sending:'Odesílá se', pending:'Čeká' })[delivery.status] || delivery.status, delivery.status === 'sent' ? 'success' : delivery.status === 'failed' ? 'danger' : 'warning')}</div><div class="communication-row__actions"><small>${delivery.attemptCount || 0}. pokus</small></div></article>`).join('')}</div></section>`;
}

function attachmentsView(model) {
  if (!model.serverReady) return emptyState({ iconName: 'shield', title: 'Serverové přílohy nejsou dostupné', text: 'Nejprve se přihlaste k Lesson Hub Serveru. Lokální odkazy v knihovně materiálů zůstávají funkční bez serveru.', action: `<a class="button button--primary" href="#/${ROUTES.server}">Otevřít serverové centrum</a>` });
  if (!model.attachments.length) return emptyState({ iconName: 'materials', title: 'Na serveru zatím nejsou přílohy', text: 'Nahrajte PDF, dokument, prezentaci, obrázek nebo zvukovou nahrávku.', action: '<button class="button button--primary" type="button" data-attachment-upload>Nahrát přílohu</button>' });
  return `<section class="content-card">${sectionHeader('Serverové přílohy', 'Soubory jsou uloženy odděleně od databázového JSON a chráněny vlastnictvím účtu.', '<button class="button button--primary" type="button" data-attachment-upload>'+icon('upload',16)+' Nahrát</button>')}<div class="communication-list">${model.attachments.map((attachment) => `<article class="communication-row"><div class="communication-row__icon">${icon('materials',18)}</div><div class="communication-row__main"><strong>${escapeHtml(attachment.fileName)}</strong><span>${escapeHtml(attachment.mimeType)}</span><small>${formatBytes(attachment.size)} · ${escapeHtml(attachment.purpose || 'material')} · ${formatDateTime(attachment.serverCreatedAt || attachment.createdAt)}</small></div><div class="communication-row__status">${statusPill(attachment.visibility === 'private' ? 'Soukromé' : attachment.visibility === 'substitution' ? 'Zastupování' : 'Sdílené', attachment.visibility === 'private' ? 'neutral' : 'info')}</div><div class="communication-row__actions"><button class="button button--secondary button--small" type="button" data-attachment-download="${attachment.serverId}">${icon('download',14)} Stáhnout</button><button class="icon-button icon-button--small" type="button" data-attachment-delete="${attachment.id}" data-server-id="${attachment.serverId}" title="Odstranit">${icon('trash',15)}</button></div></article>`).join('')}</div></section>`;
}
function retentionPreviewMarkup(preview) {
  const owners = Object.values(preview?.summary?.byOwner || {});
  const rows = owners.map((owner) => `<tr><td>${escapeHtml(owner.displayName || owner.ownerId || 'Neznámý uživatel')}</td><td>${Number(owner.students || 0)}</td><td>${Number(owner.messages || 0)}</td><td>${Number(owner.attachments || 0)}</td></tr>`).join('');
  return `<div class="privacy-preview-grid"><article><strong>${Number(preview.summary.students || 0)}</strong><span>studentů</span></article><article><strong>${Number(preview.summary.messages || 0)}</strong><span>zpráv</span></article><article><strong>${Number(preview.summary.attachments || 0)}</strong><span>příloh</span></article></div>${owners.length ? `<div class="table-scroll"><table class="data-table retention-owner-table"><thead><tr><th>Vlastník</th><th>Studenti</th><th>Zprávy</th><th>Přílohy</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted-text">Nebyly nalezeny žádné záznamy splňující retenční podmínky.</p>'}`;
}

function privacyView(model) {
  if (!model.serverReady) return emptyState({ iconName: 'shield', title: 'Retenční pravidla vyžadují server', text: 'Lokální data můžete spravovat exportem a importem. Automatizovaná retenční kontrola je součástí serverové vrstvy.', action: `<a class="button button--primary" href="#/${ROUTES.server}">Přihlásit k serveru</a>` });
  const policy = model.policy;
  const scopeControl = model.canManagePrivacyAll
    ? '<label class="form-field retention-scope-field"><span>Rozsah náhledu a výmazu</span><select data-privacy-scope><option value="self">Pouze moje záznamy</option><option value="all">Všichni uživatelé serveru</option></select></label>'
    : '<p class="privacy-note"><strong>Rozsah:</strong> pouze vaše vlastní záznamy.</p>';
  return `<div class="server-page-grid"><section class="content-card">${sectionHeader('Minimalizace osobních údajů', 'Výchozí stav je soukromý a ukládají se pouze provozně nezbytné údaje.', '<button class="button button--secondary" type="button" data-privacy-edit>'+icon('edit',16)+' Upravit pravidla</button>')}<div class="privacy-policy-grid"><article><strong>${Number(policy.studentRetentionDays)}</strong><span>dní pro archivované studenty</span></article><article><strong>${Number(policy.communicationRetentionDays)}</strong><span>dní pro uzavřenou komunikaci</span></article><article><strong>${Number(policy.orphanAttachmentRetentionDays)}</strong><span>dní pro nepřipojené přílohy</span></article></div><p class="privacy-note">Retence se týká pouze záznamů splňujících podmínky. Aktivní studenti, otevřené zprávy a připojené přílohy se nemažou.</p></section><section class="content-card">${sectionHeader('Kontrola retence', 'Nejdříve zobrazte náhled. Mazání vyžaduje další výslovné potvrzení.')}${scopeControl}<div class="retention-preview" data-retention-preview><p>Zatím nebyl proveden náhled položek k odstranění.</p></div><div class="button-cluster"><button class="button button--secondary" type="button" data-privacy-preview>${icon('eye',16)} Zobrazit náhled</button><button class="button button--danger" type="button" data-privacy-purge disabled>${icon('trash',16)} Provést výmaz</button></div></section></div>`;
}

async function loadModel(activeTab) {
  const service = appState.communicationService;
  const [snapshot, groups, allStudents, templates, messages, attachments] = await Promise.all([
    service.snapshot(), appState.academicService.listGroups({ includeAllStatuses: false, status: 'active' }), service.listStudents({ status: '' }), service.listTemplates(), service.listMessages(), service.listAttachments(),
  ]);
  const identityNames = new Map();
  groups.forEach((group) => { const list = identityNames.get(group.groupIdentityId) || []; list.push(group.displayName); identityNames.set(group.groupIdentityId, list); });
  const students = allStudents.map((student) => ({ ...student, groupNames: [...new Set([...(student.groupIdentityIds || []), student.groupIdentityId].filter(Boolean).flatMap((id) => identityNames.get(id) || []))] }));
  let policy = { studentRetentionDays: 730, communicationRetentionDays: 1095, orphanAttachmentRetentionDays: 180 };
  let deliveries = []; let mailStatus = null;
  if (appState.serverService?.isAuthenticated && ['messages','deliveries'].includes(activeTab)) {
    try { await service.syncMessagesFromServer(); deliveries = await service.syncDeliveriesFromServer(); mailStatus = await appState.serverService.mailStatus(); } catch { /* server state handled in UI */ }
  }
  if (appState.serverService?.isAuthenticated && activeTab === 'privacy') {
    try { policy = await appState.serverService.getPrivacyPolicy(); } catch { /* offline state handled in UI */ }
  }
  return { snapshot, students, templates, messages, attachments, groups, policy, deliveries, mailStatus, serverReady: Boolean(appState.serverService?.isAuthenticated), canManagePrivacyAll: Boolean(appState.serverService?.canManageUsers) };
}

export async function communicationPage(context) {
  const activeTab = TABS[context.query.get('tab')] ? context.query.get('tab') : 'students';
  const model = await loadModel(activeTab);
  const counts = { students: model.snapshot.activeStudents, messages: model.messages.length, templates: model.snapshot.templates, attachments: model.snapshot.attachments, deliveries: model.deliveries.length };
  const view = ({ students: studentsView, messages: messagesView, templates: templatesView, attachments: attachmentsView, deliveries: deliveriesView, privacy: privacyView })[activeTab](model);
  return { title: 'Komunikace', description: 'Studenti, skutečné odesílání zpráv, serverové přílohy a ochrana osobních údajů.', actions: activeTab === 'messages' ? '<button class="button button--primary" type="button" data-message-create>'+icon('plus',16)+' Nová zpráva</button>' : activeTab === 'students' ? '<button class="button button--primary" type="button" data-student-import>'+icon('upload',16)+' Importovat</button>' : '', content: `${summary(model.snapshot, model.serverReady)}${tabNav(activeTab, counts)}${view}` };
}

export async function bindCommunicationPage() {
  document.querySelectorAll('[data-student-import]').forEach((button) => button.addEventListener('click', openStudentImportDialog));
  document.querySelectorAll('[data-student-edit]').forEach((button) => button.addEventListener('click', async () => { const student = await appState.repositories.students.get(button.dataset.studentEdit); if (student) openStudentDialog(student); }));
  document.querySelectorAll('[data-student-archive]').forEach((button) => button.addEventListener('click', () => confirmAction({ title: 'Archivovat studenta?', message: 'Kontakt zmizí z aktivních seznamů, ale zůstane v auditní historii a může podléhat retenčnímu výmazu.', confirmLabel: 'Archivovat', onConfirm: async () => { await appState.communicationService.archiveStudent(button.dataset.studentArchive); eventBus.emit(APP_EVENTS.communicationChanged, {}); } })));
  document.querySelectorAll('[data-student-restore]').forEach((button) => button.addEventListener('click', async () => { await appState.communicationService.restoreStudent(button.dataset.studentRestore); eventBus.emit(APP_EVENTS.communicationChanged, {}); }));
  document.querySelectorAll('[data-template-create]').forEach((button) => button.addEventListener('click', () => openMessageTemplateDialog()));
  document.querySelectorAll('[data-template-edit]').forEach((button) => button.addEventListener('click', async () => { const template = await appState.repositories.messageTemplates.get(button.dataset.templateEdit); if (template) openMessageTemplateDialog(template); }));
  document.querySelectorAll('[data-template-archive]').forEach((button) => button.addEventListener('click', () => confirmAction({ title: 'Archivovat šablonu?', message: 'Existující zprávy se nezmění.', confirmLabel: 'Archivovat', onConfirm: async () => { await appState.communicationService.archiveTemplate(button.dataset.templateArchive); eventBus.emit(APP_EVENTS.communicationChanged, {}); } })));
  document.querySelectorAll('[data-message-create]').forEach((button) => button.addEventListener('click', () => openMessageDialog()));
  document.querySelectorAll('[data-message-edit]').forEach((button) => button.addEventListener('click', async () => { const message = await appState.repositories.messages.get(button.dataset.messageEdit); if (message) openMessageDialog(message); }));
  document.querySelectorAll('[data-message-approve]').forEach((button) => button.addEventListener('click', async () => { try { const local = await appState.repositories.messages.get(button.dataset.messageApprove); if (!appState.serverService.isAuthenticated) throw new Error('Schválení pro skutečné odeslání vyžaduje serverovou relaci.'); await appState.serverService.saveServerMessage(local); const serverMessage = await appState.serverService.approveServerMessage(local.id); await appState.repositories.messages.update(local.id, serverMessage); eventBus.emit(APP_EVENTS.communicationChanged, {}); showToast('Zpráva byla schválena serverem.', 'success'); } catch (error) { showToast(error.message, 'error'); } }));
  document.querySelectorAll('[data-message-send]').forEach((button) => button.addEventListener('click', async () => { button.disabled = true; try { if (!appState.serverService.isAuthenticated) throw new Error('Odeslání vyžaduje serverovou relaci.'); const local = await appState.repositories.messages.get(button.dataset.messageSend); await appState.serverService.saveServerMessage(local); const result = await appState.serverService.sendServerMessage(local.id); await appState.communicationService.applyServerDeliveryResult(result); eventBus.emit(APP_EVENTS.communicationChanged, {}); showToast(result.message.status === 'sent' ? 'Zpráva byla odeslána všem příjemcům.' : 'Odeslání bylo dokončeno s dílčími chybami.', result.message.status === 'sent' ? 'success' : 'warning'); } catch (error) { showToast(error.message, 'error'); } finally { button.disabled = false; } }));
  document.querySelectorAll('[data-message-retry]').forEach((button) => button.addEventListener('click', async () => { button.disabled = true; try { const result = await appState.serverService.retryServerMessage(button.dataset.messageRetry); await appState.communicationService.applyServerDeliveryResult(result); eventBus.emit(APP_EVENTS.communicationChanged, {}); showToast('Opakované odeslání bylo zpracováno.', result.message.status === 'sent' ? 'success' : 'warning'); } catch (error) { showToast(error.message, 'error'); } finally { button.disabled = false; } }));
  document.querySelectorAll('[data-message-cancel]').forEach((button) => button.addEventListener('click', () => confirmAction({ title: 'Zrušit zprávu?', message: 'Záznam zůstane v historii jako zrušený.', confirmLabel: 'Zrušit zprávu', onConfirm: async () => { await appState.communicationService.cancelMessage(button.dataset.messageCancel); eventBus.emit(APP_EVENTS.communicationChanged, {}); } })));
  document.querySelectorAll('[data-process-due]').forEach((button) => button.addEventListener('click', async () => { button.disabled = true; try { const local = await appState.communicationService.processDueLocal(); if (!appState.serverService.isAuthenticated) throw new Error(`Lokálně připraveno ${local.length} zpráv, skutečné odeslání však vyžaduje serverovou relaci.`); const ready = await appState.communicationService.listMessages(); for (const message of ready.filter((item) => ['scheduled','approval_required','ready','failed','partially_failed'].includes(item.status))) await appState.serverService.saveServerMessage(message); const server = await appState.serverService.processDueMessages(); await appState.communicationService.syncDeliveriesFromServer(); eventBus.emit(APP_EVENTS.communicationChanged, {}); showToast(`Server zpracoval ${server.length} zpráv.`, 'success'); } catch (error) { showToast(error.message, 'error'); } finally { button.disabled = false; } }));
  document.querySelectorAll('[data-attachment-upload]').forEach((button) => button.addEventListener('click', openAttachmentDialog));
  document.querySelectorAll('[data-attachment-download]').forEach((button) => button.addEventListener('click', async () => { button.disabled = true; try { const result = await appState.serverService.downloadAttachment(button.dataset.attachmentDownload); const url = URL.createObjectURL(result.blob); const link = document.createElement('a'); link.href = url; link.download = ''; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); } catch (error) { showToast(error.message, 'error'); } finally { button.disabled = false; } }));
  document.querySelectorAll('[data-attachment-delete]').forEach((button) => button.addEventListener('click', () => confirmAction({ title: 'Odstranit serverovou přílohu?', message: 'Soubor bude fyzicky odstraněn ze serveru. Tuto operaci nelze vrátit.', confirmLabel: 'Odstranit', danger: true, onConfirm: async () => { await appState.serverService.deleteAttachment(button.dataset.serverId); await appState.communicationService.removeAttachmentLocal(button.dataset.attachmentDelete); eventBus.emit(APP_EVENTS.communicationChanged, {}); } })));
  document.querySelectorAll('[data-privacy-edit]').forEach((button) => button.addEventListener('click', async () => openPrivacyPolicyDialog(await appState.serverService.getPrivacyPolicy())));
  let latestPreview = null;
  let latestScope = 'self';
  document.querySelector('[data-privacy-scope]')?.addEventListener('change', () => {
    latestPreview = null;
    document.querySelector('[data-retention-preview]').textContent = 'Rozsah se změnil. Proveďte nový náhled.';
    document.querySelector('[data-privacy-purge]').disabled = true;
  });
  document.querySelectorAll('[data-privacy-preview]').forEach((button) => button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      latestScope = document.querySelector('[data-privacy-scope]')?.value || 'self';
      latestPreview = await appState.serverService.previewPrivacyPurge(latestScope);
      const region = document.querySelector('[data-retention-preview]');
      region.innerHTML = /* qa-safe-html: retentionPreviewMarkup escapes owner names and renders numeric counts */ retentionPreviewMarkup(latestPreview);
      const total = Number(latestPreview.summary.students || 0) + Number(latestPreview.summary.messages || 0) + Number(latestPreview.summary.attachments || 0);
      document.querySelector('[data-privacy-purge]').disabled = total === 0;
    } catch (error) { showToast(error.message, 'error'); }
    finally { button.disabled = false; }
  }));
  document.querySelectorAll('[data-privacy-purge]').forEach((button) => button.addEventListener('click', () => confirmAction({
    title: 'Trvale odstranit retenční kandidáty?',
    message: latestPreview ? `Rozsah: ${latestScope === 'all' ? 'všichni uživatelé' : 'pouze moje data'}. Bude odstraněno ${Number(latestPreview.summary.students || 0)} studentů, ${Number(latestPreview.summary.messages || 0)} zpráv a ${Number(latestPreview.summary.attachments || 0)} příloh.` : 'Nejprve proveďte náhled.',
    confirmLabel: 'Trvale odstranit', danger: true,
    onConfirm: async () => {
      const result = await appState.serverService.commitPrivacyPurge(latestScope);
      const total = Number(result.summary.students || 0) + Number(result.summary.messages || 0) + Number(result.summary.attachments || 0);
      showToast(`Retenční výmaz dokončen: ${total} položek.`, 'success');
      navigate(ROUTES.communication, [], { tab: 'privacy' });
    },
  })));
}

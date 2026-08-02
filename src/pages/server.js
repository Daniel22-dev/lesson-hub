import { appState } from '../core/appState.js';
import { APP_EVENTS } from '../core/constants.js';
import { eventBus } from '../core/eventBus.js';
import { escapeHtml, escapeAttribute } from '../core/html.js';
import { icon } from '../ui/icons.js';
import { openModal, confirmAction } from '../ui/modal.js';
import { showToast } from '../ui/toast.js';
import { emptyState, statusPill } from './shared.js';

function roleLabel(role) {
  return ({ owner: 'Vlastník serveru', admin: 'Správce', teacher: 'Učitel', substitute: 'Suplující učitel' })[role] || role || 'Nepřihlášen';
}
function roleVariant(role) { return ['owner', 'admin'].includes(role) ? 'success' : role === 'teacher' ? 'info' : 'neutral'; }
function dateTime(value) { return value ? new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—'; }
function bytes(value) { const amount = Number(value) || 0; if (amount < 1024) return `${amount} B`; if (amount < 1024 ** 2) return `${(amount / 1024).toFixed(1)} KB`; if (amount < 1024 ** 3) return `${(amount / 1024 ** 2).toFixed(1)} MB`; return `${(amount / 1024 ** 3).toFixed(2)} GB`; }
function duration(seconds) { const total = Math.max(0, Number(seconds) || 0); const days = Math.floor(total / 86400); const hours = Math.floor((total % 86400) / 3600); const minutes = Math.floor((total % 3600) / 60); return days ? `${days} d ${hours} h` : hours ? `${hours} h ${minutes} min` : `${minutes} min`; }
function serverError(error) { return escapeHtml(error?.message || 'Serverová operace se nepodařila.'); }

async function loadModel() {
  const server = appState.serverService;
  const sync = await appState.syncService.summary();
  let health = server.healthState;
  let info = null;
  let users = [];
  let audit = [];
  let operations = null;
  let backups = [];
  let error = '';
  if (server.isAuthenticated) {
    try {
      info = await server.serverInfo();
      if (server.canManageUsers) users = await server.listUsers();
      if (server.canReadAudit) audit = await server.audit(20);
      if (server.canManageOperations) { operations = await server.operationsStatus(); backups = await server.listServerBackups(); }
    } catch (caught) { error = caught.message; }
  }
  return { server, sync, health, info, users, audit, operations, backups, error, conflicts: await appState.syncService.conflicts() };
}

function summaryCards(model) {
  const { server, sync, health, info } = model;
  return `<section class="server-summary">
    <div><span>Server</span><strong>${health?.status === 'ok' ? 'Dostupný' : 'Neověřený'}</strong><small>${escapeHtml(server.config.baseUrl)}</small></div>
    <div><span>Relace</span><strong>${server.isAuthenticated ? escapeHtml(server.profile.displayName) : 'Odpojeno'}</strong><small>${server.isAuthenticated ? roleLabel(server.role) : 'Vyžaduje přihlášení'}</small></div>
    <div><span>Fronta změn</span><strong>${sync.pending + sync.failed}</strong><small>${sync.failed ? `${sync.failed} se nezdařilo` : 'čeká na synchronizaci'}</small></div>
    <div><span>Konflikty</span><strong>${sync.conflicts}</strong><small>kurzor ${sync.lastCursor || info?.currentCursor || 0}</small></div>
  </section>`;
}

function connectionCard(model) {
  const { server, health, info, error } = model;
  return `<section class="content-card server-connection-card">
    <div class="section-heading"><div><h2>Serverové připojení</h2><p>Samostatná serverová relace nenahrazuje centrální vstup přes AI Studio.</p></div>
      <div class="section-actions">
        <button class="button button--secondary" type="button" data-server-config>${icon('settings', 17)} Nastavit</button>
        <button class="button button--secondary" type="button" data-server-test>${icon('diagnostics', 17)} Ověřit</button>
      </div>
    </div>
    ${error ? `<div class="inline-alert inline-alert--danger">${serverError({ message: error })}</div>` : ''}
    <dl class="server-definition-list">
      <div><dt>Adresa API</dt><dd>${escapeHtml(server.config.baseUrl)}</dd></div>
      <div><dt>Stav služby</dt><dd>${health?.status === 'ok' ? statusPill('Dostupná', 'success', 'check') : statusPill('Neověřená', 'neutral')}</dd></div>
      <div><dt>API kontrakt</dt><dd>${escapeHtml(info?.apiContract || health?.apiContract || 'lesson-hub-api-v1')}</dd></div>
      <div><dt>Synchronizace</dt><dd>${server.config.syncEnabled ? 'Povolena uživatelem' : 'Ruční režim'}</dd></div>
    </dl>
    <div class="server-auth-panel">
      ${server.isAuthenticated ? `
        <div class="server-user-card"><span class="server-user-card__avatar">${escapeHtml(server.profile.displayName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase())}</span><div><strong>${escapeHtml(server.profile.displayName)}</strong><small>${escapeHtml(server.profile.email)} · ${roleLabel(server.role)}</small></div></div>
        <button class="button button--ghost" type="button" data-server-logout>Odhlásit serverovou relaci</button>` : `
        <div><strong>Serverová relace není aktivní</strong><p>Přihlášení je potřeba pouze pro synchronizaci a serverové funkce.</p></div>
        <button class="button button--primary" type="button" data-server-login>${icon('user', 17)} Přihlásit</button>`}
    </div>
  </section>`;
}

function syncCard(model) {
  const { server, sync } = model;
  return `<section class="content-card">
    <div class="section-heading"><div><h2>Obousměrná synchronizace</h2><p>Nejdříve odešle lokální změny, potom bezpečně stáhne změny ze serveru.</p></div></div>
    <div class="sync-metrics">
      <div><strong>${sync.pending}</strong><span>čeká</span></div><div><strong>${sync.failed}</strong><span>selhalo</span></div><div><strong>${sync.synced}</strong><span>odesláno</span></div><div><strong>${sync.conflicts}</strong><span>konflikty</span></div>
    </div>
    <div class="server-action-row">
      <button class="button button--secondary" type="button" data-sync-prepare ${server.isAuthenticated ? '' : 'disabled'}>${icon('database', 17)} Připravit frontu</button>
      <button class="button button--primary" type="button" data-sync-now ${server.isAuthenticated ? '' : 'disabled'}>${icon('restore', 17)} Synchronizovat nyní</button>
      <button class="button button--ghost" type="button" data-sync-clear ${sync.synced ? '' : 'disabled'}>Vyčistit odeslané</button>
    </div>
    <p class="form-hint">Automatická synchronizace není v této fázi zapnuta bez výslovného rozhodnutí uživatele. Lokální databáze zůstává primárním pracovním úložištěm.</p>
  </section>`;
}

function conflictsCard(conflicts) {
  if (!conflicts.length) return `<section class="content-card"><div class="section-heading"><div><h2>Konflikty</h2><p>Rozdílné verze stejného záznamu se zde objeví k ručnímu rozhodnutí.</p></div></div>${emptyState({ iconName: 'check', title: 'Žádné otevřené konflikty', text: 'Lokální a serverová data si v tuto chvíli neodporují.' })}</section>`;
  return `<section class="content-card"><div class="section-heading"><div><h2>Konflikty</h2><p>Vyberte, která verze má zůstat platná.</p></div></div><div class="server-conflict-list">${conflicts.map((item) => `<article class="server-conflict-card"><div><strong>${escapeHtml(item.resource)} · ${escapeHtml(item.entityId)}</strong><small>Zjištěno ${dateTime(item.detectedAt)}</small></div><div class="section-actions"><button class="button button--secondary button--small" data-conflict-server="${escapeAttribute(item.id)}">Použít server</button><button class="button button--primary button--small" data-conflict-local="${escapeAttribute(item.id)}">Ponechat lokální</button></div></article>`).join('')}</div></section>`;
}

function usersCard(model) {
  if (!model.server.canManageUsers) return '';
  return `<section class="content-card"><div class="section-heading"><div><h2>Uživatelské účty</h2><p>Správa serverových rolí a přístupu k synchronizovaným datům.</p></div><button class="button button--secondary" type="button" data-user-create>${icon('plus', 17)} Přidat účet</button></div>
    <div class="server-user-list">${model.users.map((user) => `<article><div><strong>${escapeHtml(user.displayName)}</strong><small>${escapeHtml(user.email)}</small></div>${statusPill(roleLabel(user.role), roleVariant(user.role))}<span>${user.status === 'active' ? 'Aktivní' : 'Zakázaný'}</span><button class="button button--ghost button--small" type="button" data-user-toggle="${escapeAttribute(user.id)}" data-user-status="${escapeAttribute(user.status)}">${user.status === 'active' ? 'Zakázat' : 'Aktivovat'}</button></article>`).join('') || '<p class="muted-text">Server zatím nemá další účty.</p>'}</div>
  </section>`;
}

function operationsCard(model) {
  if (!model.server.canManageOperations) return '';
  const status = model.operations;
  if (!status) return `<section class="content-card"><div class="section-heading"><div><h2>Provoz serveru</h2><p>Provozní přehled se nepodařilo načíst.</p></div></div><div class="inline-alert inline-alert--warning">Přihlaste se znovu nebo ověřte dostupnost serveru.</div></section>`;
  const lastBackup = status.backups?.last;
  return `<section class="content-card server-operations-card">
    <div class="section-heading"><div><h2>Provoz, zálohy a obnova</h2><p>Kontrola kapacity, plánovaných snapshotů a bezpečného návratu serverových dat.</p></div><div class="section-actions"><button class="button button--secondary" type="button" data-server-maintenance>${icon('diagnostics', 17)} Údržba</button><button class="button button--primary" type="button" data-server-backup>${icon('database', 17)} Vytvořit zálohu</button></div></div>
    <div class="operations-metrics">
      <div><span>Provoz</span><strong>${duration(status.uptimeSeconds)}</strong><small>Node ${escapeHtml(status.process?.node || '—')}</small></div>
      <div><span>Databáze</span><strong>${bytes(status.storage?.dataBytes)}</strong><small>${status.records?.totalResources || 0} pracovních záznamů</small></div>
      <div><span>Přílohy</span><strong>${bytes(status.storage?.attachmentBytes)}</strong><small>${status.storage?.attachmentFiles || 0} souborů</small></div>
      <div><span>Automatické zálohy</span><strong>${status.backups?.enabled ? 'Zapnuté' : 'Vypnuté'}</strong><small>${status.backups?.enabled ? `každých ${status.backups.intervalHours} h` : 'aktivují se na serveru'}</small></div>
    </div>
    <div class="server-backup-summary"><div><strong>${lastBackup ? `Poslední záloha ${dateTime(lastBackup.createdAt)}` : 'Zatím bez serverové zálohy'}</strong><small>${lastBackup ? `${bytes(lastBackup.storeBytes + lastBackup.attachmentBytes)} · ${escapeHtml(lastBackup.reason)}` : `Uchovává se maximálně ${status.backups?.retentionCount || 0} snapshotů.`}</small></div>${status.maintenance?.lastRunAt ? `<span>${statusPill(`Údržba ${dateTime(status.maintenance.lastRunAt)}`, 'info', 'diagnostics')}</span>` : ''}</div>
    <div class="server-backup-list">${model.backups.map((item) => `<article><div><strong>${dateTime(item.createdAt)}</strong><small>${escapeHtml(item.reason)} · ${bytes((item.storeBytes || 0) + (item.attachmentBytes || 0))} · ${item.resources || 0} záznamů</small></div><div class="section-actions">${model.server.canRestoreServerBackup ? `<button class="button button--secondary button--small" type="button" data-server-backup-restore="${escapeAttribute(item.id)}">Obnovit</button>` : ''}<button class="button button--ghost button--small" type="button" data-server-backup-delete="${escapeAttribute(item.id)}">Odstranit</button></div></article>`).join('') || '<p class="muted-text">Server zatím nemá žádný provozní snapshot.</p>'}</div>
    <p class="form-hint">Obnova je dostupná pouze vlastníkovi. Před návratem se automaticky vytvoří bezpečnostní snapshot a všechny serverové relace se ukončí.</p>
  </section>`;
}

function auditCard(model) {
  if (!model.server.canReadAudit) return '';
  return `<section class="content-card"><div class="section-heading"><div><h2>Serverová auditní historie</h2><p>Interní technická stopa přihlášení, správy účtů a synchronizace.</p></div></div><div class="server-audit-list">${model.audit.map((item) => `<article><span>${icon(item.action.includes('failed') ? 'warning' : 'shield', 17)}</span><div><strong>${escapeHtml(item.action)}</strong><small>${escapeHtml(item.entityType)}${item.entityId ? ` · ${escapeHtml(item.entityId)}` : ''}</small></div><time>${dateTime(item.timestamp)}</time></article>`).join('') || '<p class="muted-text">Auditní historie je zatím prázdná.</p>'}</div></section>`;
}

export async function serverPage() {
  const model = await loadModel();
  return {
    title: 'Server a synchronizace',
    description: 'Účty, role, obousměrná synchronizace, konflikty a serverový audit.',
    actions: model.server.isAuthenticated ? `<button class="button button--primary" type="button" data-sync-now>${icon('restore', 18)} Synchronizovat</button>` : `<button class="button button--primary" type="button" data-server-login>${icon('user', 18)} Přihlásit k serveru</button>`,
    content: `${summaryCards(model)}<div class="server-page-grid">${connectionCard(model)}${syncCard(model)}</div>${conflictsCard(model.conflicts)}${usersCard(model)}${operationsCard(model)}${auditCard(model)}`,
  };
}

function configDialog() {
  const server = appState.serverService;
  openModal({
    id: 'server-config-modal', eyebrow: 'Lesson Hub Server', title: 'Nastavit serverové připojení',
    body: `<form id="server-config-form" class="form-grid"><label class="form-field form-field--full"><span>Adresa serveru</span><input name="baseUrl" type="url" value="${escapeAttribute(server.config.baseUrl)}" required placeholder="https://lesson-hub.example.cz"></label><label class="check-card form-field--full"><input name="syncEnabled" type="checkbox" ${server.config.syncEnabled ? 'checked' : ''}><span><strong>Povolit automatickou synchronizaci v budoucnu</strong><small>V této verzi zůstává synchronizace ruční; volba pouze uchová váš záměr.</small></span></label><p class="form-error" data-form-error hidden></p></form>`,
    actions: '<button class="button button--ghost" type="button" data-close-modal>Zrušit</button><button class="button button--primary" type="submit" form="server-config-form">Uložit</button>',
    onOpen(backdrop, close) { backdrop.querySelector('#server-config-form').addEventListener('submit', (event) => { event.preventDefault(); try { const form = new FormData(event.currentTarget); server.configure({ baseUrl: form.get('baseUrl'), syncEnabled: form.get('syncEnabled') === 'on' }); close(); eventBus.emit(APP_EVENTS.serverChanged, {}); showToast('Serverové nastavení bylo uloženo.', 'success'); } catch (error) { const region = backdrop.querySelector('[data-form-error]'); region.hidden = false; region.textContent = error.message; } }); },
  });
}

function loginDialog() {
  const server = appState.serverService;
  openModal({
    id: 'server-login-modal', eyebrow: 'Serverová relace', title: 'Přihlásit k Lesson Hub Serveru',
    body: `<form id="server-login-form" class="form-grid"><label class="form-field form-field--full"><span>Školní e-mail</span><input name="email" type="email" autocomplete="username" required></label><label class="form-field form-field--full"><span>Heslo</span><input name="password" type="password" autocomplete="current-password" required></label><label class="check-card form-field--full"><input name="remember" type="checkbox"><span><strong>Pamatovat relaci v tomto prohlížeči</strong><small>Na sdíleném zařízení ponechte vypnuté.</small></span></label><p class="form-error" data-form-error hidden></p></form>`,
    actions: '<button class="button button--ghost" type="button" data-close-modal>Zrušit</button><button class="button button--primary" type="submit" form="server-login-form">Přihlásit</button>',
    onOpen(backdrop, close) { backdrop.querySelector('#server-login-form').addEventListener('submit', async (event) => { event.preventDefault(); const button = backdrop.querySelector('button[type="submit"]'); button.disabled = true; try { const form = new FormData(event.currentTarget); const profile = await server.login({ email: form.get('email'), password: form.get('password'), rememberSession: form.get('remember') === 'on' }); appState.setServerSession(profile); close(); showToast(`Přihlášen uživatel ${profile.displayName}.`, 'success'); } catch (error) { const region = backdrop.querySelector('[data-form-error]'); region.hidden = false; region.textContent = error.message; } finally { button.disabled = false; } }); },
  });
}

function userDialog() {
  const server = appState.serverService;
  openModal({
    id: 'server-user-modal', eyebrow: 'Správa účtů', title: 'Přidat serverový účet',
    body: `<form id="server-user-form" class="form-grid"><label class="form-field"><span>Jméno</span><input name="displayName" required></label><label class="form-field"><span>E-mail</span><input name="email" type="email" required></label><label class="form-field"><span>Role</span><select name="role"><option value="teacher">Učitel</option><option value="substitute">Suplující učitel</option><option value="admin">Správce</option></select></label><label class="form-field"><span>Počáteční heslo</span><input name="password" type="password" minlength="12" required></label><p class="form-error form-field--full" data-form-error hidden></p></form>`,
    actions: '<button class="button button--ghost" type="button" data-close-modal>Zrušit</button><button class="button button--primary" type="submit" form="server-user-form">Vytvořit účet</button>',
    onOpen(backdrop, close) { backdrop.querySelector('#server-user-form').addEventListener('submit', async (event) => { event.preventDefault(); try { const form = Object.fromEntries(new FormData(event.currentTarget)); await server.createUser(form); close(); eventBus.emit(APP_EVENTS.serverChanged, {}); showToast('Serverový účet byl vytvořen.', 'success'); } catch (error) { const region = backdrop.querySelector('[data-form-error]'); region.hidden = false; region.textContent = error.message; } }); },
  });
}

async function runSync() {
  const buttonList = document.querySelectorAll('[data-sync-now]'); buttonList.forEach((button) => { button.disabled = true; });
  try { const result = await appState.syncService.synchronize(); await appState.refreshAcademic({ emit: false }); showToast(`Synchronizace dokončena: odesláno ${result.pushed.accepted}, přijato ${result.pulled.applied}.`, result.pushed.conflicts + result.pulled.conflicts ? 'info' : 'success'); eventBus.emit(APP_EVENTS.serverChanged, {}); }
  catch (error) { showToast(error.message, 'error'); }
  finally { buttonList.forEach((button) => { button.disabled = false; }); }
}

export function bindServerPage() {
  document.querySelectorAll('[data-server-config]').forEach((button) => button.addEventListener('click', configDialog));
  document.querySelectorAll('[data-server-login]').forEach((button) => button.addEventListener('click', loginDialog));
  document.querySelectorAll('[data-server-test]').forEach((button) => button.addEventListener('click', async () => { button.disabled = true; try { const health = await appState.serverService.health(); showToast(`Server ${health.version} odpovídá.`, 'success'); eventBus.emit(APP_EVENTS.serverChanged, {}); } catch (error) { showToast(error.message, 'error'); } finally { button.disabled = false; } }));
  document.querySelectorAll('[data-server-logout]').forEach((button) => button.addEventListener('click', () => confirmAction({ title: 'Odhlásit serverovou relaci?', message: 'Lokální data zůstanou zachována. Synchronizace se zastaví.', confirmLabel: 'Odhlásit', onConfirm: async () => { await appState.serverService.logout(); appState.setServerSession(null); showToast('Serverová relace byla ukončena.', 'success'); } })));
  document.querySelectorAll('[data-sync-prepare]').forEach((button) => button.addEventListener('click', async () => { button.disabled = true; try { const items = await appState.syncService.prepareFromAudit(); showToast(`Do fronty bylo připraveno ${items.length} změn.`, 'success'); eventBus.emit(APP_EVENTS.serverChanged, {}); } catch (error) { showToast(error.message, 'error'); } finally { button.disabled = false; } }));
  document.querySelectorAll('[data-sync-now]').forEach((button) => button.addEventListener('click', runSync));
  document.querySelectorAll('[data-sync-clear]').forEach((button) => button.addEventListener('click', async () => { const count = await appState.syncService.clearSynced(); showToast(`Odstraněno ${count} odeslaných položek.`, 'success'); eventBus.emit(APP_EVENTS.serverChanged, {}); }));
  document.querySelectorAll('[data-user-create]').forEach((button) => button.addEventListener('click', userDialog));
  document.querySelectorAll('[data-user-toggle]').forEach((button) => button.addEventListener('click', () => confirmAction({ title: button.dataset.userStatus === 'active' ? 'Zakázat účet?' : 'Aktivovat účet?', message: 'Změna se projeví při nejbližším serverovém požadavku uživatele.', confirmLabel: 'Potvrdit', onConfirm: async () => { await appState.serverService.updateUser(button.dataset.userToggle, { status: button.dataset.userStatus === 'active' ? 'disabled' : 'active' }); eventBus.emit(APP_EVENTS.serverChanged, {}); } })));
  document.querySelectorAll('[data-conflict-server]').forEach((button) => button.addEventListener('click', async () => { await appState.syncService.resolveConflict(button.dataset.conflictServer, 'server'); showToast('Byla použita serverová verze.', 'success'); eventBus.emit(APP_EVENTS.serverChanged, {}); }));
  document.querySelectorAll('[data-conflict-local]').forEach((button) => button.addEventListener('click', async () => { await appState.syncService.resolveConflict(button.dataset.conflictLocal, 'local'); showToast('Lokální verze bude znovu odeslána.', 'success'); eventBus.emit(APP_EVENTS.serverChanged, {}); }));

  document.querySelectorAll('[data-server-backup]').forEach((button) => button.addEventListener('click', async () => {
    button.disabled = true;
    try { const backup = await appState.serverService.createServerBackup('manual'); showToast(`Serverová záloha ${backup.id} byla vytvořena.`, 'success'); eventBus.emit(APP_EVENTS.serverChanged, {}); }
    catch (error) { showToast(error.message, 'error'); }
    finally { button.disabled = false; }
  }));
  document.querySelectorAll('[data-server-maintenance]').forEach((button) => button.addEventListener('click', () => confirmAction({
    title: 'Spustit bezpečnou údržbu serveru?', message: 'Server odstraní vypršené relace, zpracuje splatné zprávy a vytvoří nový provozní snapshot.', confirmLabel: 'Spustit údržbu',
    onConfirm: async () => { const result = await appState.serverService.runServerMaintenance({ createBackup: true, processMessages: true }); showToast(`Údržba dokončena. Záloha: ${result.result.backup?.id || 'nevytvořena'}.`, 'success'); eventBus.emit(APP_EVENTS.serverChanged, {}); },
  })));
  document.querySelectorAll('[data-server-backup-delete]').forEach((button) => button.addEventListener('click', () => confirmAction({
    title: 'Odstranit serverovou zálohu?', message: 'Tento snapshot už nebude možné použít k obnově.', confirmLabel: 'Odstranit', danger: true,
    onConfirm: async () => { await appState.serverService.deleteServerBackup(button.dataset.serverBackupDelete); showToast('Serverová záloha byla odstraněna.', 'success'); eventBus.emit(APP_EVENTS.serverChanged, {}); },
  })));
  document.querySelectorAll('[data-server-backup-restore]').forEach((button) => button.addEventListener('click', () => confirmAction({
    title: 'Obnovit celý server ze zálohy?', message: 'Současná databáze a přílohy budou nahrazeny. Nejdříve se vytvoří bezpečnostní snapshot a potom se ukončí všechny serverové relace.', confirmLabel: 'Obnovit server', danger: true,
    onConfirm: async () => { await appState.serverService.restoreServerBackup(button.dataset.serverBackupRestore); appState.serverService.clearSession(); appState.setServerSession(null); showToast('Server byl obnoven. Přihlaste se znovu.', 'success'); },
  })));
}

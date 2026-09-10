import { appState } from '../core/appState.js';
import { escapeHtml } from '../core/html.js';
import { icon } from '../ui/icons.js';
import { openModal, confirmAction } from '../ui/modal.js';
import { showToast } from '../ui/toast.js';
import { navigate } from '../ui/router.js';
import { ROUTES } from '../core/constants.js';
import { MAX_IMPORT_BYTES } from '../services/backupService.js';

function formatBytes(bytes = 0) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** exponent);
  return `${new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: exponent ? 1 : 0 }).format(value)} ${units[exponent]}`;
}

function formatDate(value) {
  if (!value) return 'Neuvedeno';
  return new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function reasonLabel(reason) {
  return {
    manual: 'Ruční',
    'pre-import': 'Před importem',
    'pre-restore': 'Před obnovou',
  }[reason] || reason || 'Záloha';
}

function backupCard(snapshot) {
  return `
    <article class="backup-card" data-backup-id="${escapeHtml(snapshot.id)}">
      <div class="backup-card__icon">${icon(snapshot.reason === 'manual' ? 'database' : 'shield', 22)}</div>
      <div class="backup-card__body">
        <div class="backup-card__title"><strong>${escapeHtml(snapshot.label)}</strong><span class="status-pill status-pill--neutral">${escapeHtml(reasonLabel(snapshot.reason))}</span></div>
        <p>${formatDate(snapshot.createdAt)} · ${snapshot.totalRecords ?? 0} záznamů · ${formatBytes(snapshot.sizeBytes)}</p>
        <small>Schéma ${escapeHtml(snapshot.schemaVersion || '—')} · kontrolní součet ${escapeHtml(String(snapshot.checksum || '').slice(0, 12))}…</small>
      </div>
      <div class="backup-card__actions">
        <button class="button button--secondary button--small" type="button" data-restore-backup="${escapeHtml(snapshot.id)}">${icon('restore', 17)} Obnovit</button>
        <button class="icon-button icon-button--danger" type="button" data-delete-backup="${escapeHtml(snapshot.id)}" aria-label="Odstranit bod obnovy">${icon('trash', 18)}</button>
      </div>
    </article>`;
}

export async function dataPage() {
  const [backups, storage, integrity, restoreSync] = await Promise.all([
    appState.backupService.listLocalBackups(),
    appState.backupService.storageEstimate(),
    appState.backupService.integrityReport(),
    appState.backupService.restoreSyncStatus(),
  ]);

  const storageText = storage.supported
    ? `${formatBytes(storage.usage)} z přibližně ${formatBytes(storage.quota)} (${new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 1 }).format(storage.percent)} %)`
    : 'Prohlížeč neposkytuje odhad využití úložiště.';

  return {
    title: 'Data a zálohy',
    description: 'Export, bezpečný import, lokální body obnovy a kontrola integrity dat.',
    actions: `
      <button class="button button--secondary" type="button" data-create-backup>${icon('database', 18)} Vytvořit bod obnovy</button>
      <button class="button button--primary" type="button" data-export-database>${icon('download', 18)} Stáhnout zálohu</button>`,
    content: `
      ${restoreSync ? `<aside class="warning-panel restore-sync-warning" role="status"><div><strong>Obnovený stav zatím nebyl odeslán na server.</strong><span>Ve frontě je ${Number(restoreSync.queued || 0)} obnovených záznamů. Dokud je neodešlete, může serverová verze při další synchronizaci vytvořit konflikty.</span></div>${appState.serverService?.isAuthenticated ? '<button class="button button--primary" type="button" data-sync-restored>Odeslat obnovený stav</button>' : `<a class="button button--secondary" href="#/${ROUTES.server}">Přihlásit k serveru</a>`}</aside>` : ''}
      <section class="data-summary-grid">
        <article class="summary-card"><span class="summary-card__icon">${icon('database', 22)}</span><div><strong>${integrity.summary.lessons}</strong><span>hodin v databázi</span></div></article>
        <article class="summary-card"><span class="summary-card__icon">${icon('materials', 22)}</span><div><strong>${integrity.summary.materials}</strong><span>materiálů</span></div></article>
        <article class="summary-card"><span class="summary-card__icon">${icon(integrity.valid ? 'check' : 'warning', 22)}</span><div><strong>${integrity.valid ? 'V pořádku' : integrity.issues.length}</strong><span>${integrity.valid ? 'integrita vazeb' : 'nalezených problémů'}</span></div></article>
        <article class="summary-card"><span class="summary-card__icon">${icon('shield', 22)}</span><div><strong>${backups.length}</strong><span>lokálních bodů obnovy</span></div></article>
      </section>

      <div class="data-page-grid">
        <section class="content-card data-action-card">
          <div class="data-action-card__icon">${icon('download', 26)}</div>
          <div><h2>Úplný export databáze</h2><p>Vytvoří jeden JSON soubor s výukou, skupinami, materiály, povinnostmi, štítky a uživatelským nastavením. Soubor obsahuje kontrolní součet SHA-256.</p></div>
          <button class="button button--primary" type="button" data-export-database>${icon('download', 18)} Stáhnout export</button>
        </section>

        <section class="content-card data-action-card">
          <div class="data-action-card__icon">${icon('upload', 26)}</div>
          <div><h2>Import nebo obnova ze souboru</h2><p>Nejdřív proběhne kontrola formátu, verze a kontrolního součtu. Před nahrazením dat Lesson Hub automaticky vytvoří bezpečnostní bod obnovy.</p></div>
          <button class="button button--secondary" type="button" data-select-import>${icon('upload', 18)} Vybrat soubor</button>
          <input type="file" accept="application/json,.json" data-import-file hidden />
        </section>
      </div>

      <section class="content-card">
        <div class="section-heading"><div><h2>Lokální body obnovy</h2><p>Body obnovy zůstávají v tomto prohlížeči a nejsou náhradou externě uloženého exportu.</p></div><button class="button button--secondary" type="button" data-create-backup>${icon('plus', 17)} Nový bod</button></div>
        <div class="backup-list">
          ${backups.length ? backups.map(backupCard).join('') : `<div class="empty-state empty-state--compact"><div class="empty-state__icon">${icon('database', 26)}</div><h3>Zatím bez bodu obnovy</h3><p>Vytvořte první lokální bod před větší úpravou nebo importem.</p></div>`}
        </div>
      </section>

      <section class="content-card data-safety-panel">
        <div class="data-safety-panel__icon">${icon('shield', 25)}</div>
        <div><h2>Stav lokálního úložiště</h2><p>${escapeHtml(storageText)}</p><p>${integrity.valid ? 'Kontrola vazeb mezi skupinami, hodinami, materiály a povinnostmi nenašla problém.' : `Kontrola integrity našla ${integrity.issues.length} problémů. Podrobnosti zobrazí diagnostika.`}</p></div>
        <a class="button button--ghost" href="#/${ROUTES.diagnostics}">Otevřít diagnostiku</a>
      </section>

      <aside class="warning-panel"><strong>Důležité:</strong> Lokální data jsou vázaná na tento prohlížeč a zařízení. Pro skutečnou ochranu pravidelně stahujte export a ukládejte jej mimo počítač.</aside>
    `,
  };
}

function openCreateBackupDialog() {
  openModal({
    id: 'create-backup-modal',
    eyebrow: 'Lokální bod obnovy',
    title: 'Vytvořit bod obnovy',
    body: `<form id="create-backup-form" class="form-stack"><label class="form-field"><span>Název zálohy</span><input name="label" maxlength="100" placeholder="Např. Před začátkem nového školního roku" /></label><p class="form-hint">Bod se uloží pouze do lokální databáze tohoto prohlížeče.</p><p class="form-error" data-form-error hidden></p></form>`,
    actions: `<button class="button button--ghost" type="button" data-close-modal>Zrušit</button><button class="button button--primary" type="submit" form="create-backup-form">Vytvořit zálohu</button>`,
    onOpen(backdrop, close) {
      backdrop.querySelector('#create-backup-form')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = backdrop.querySelector('button[form="create-backup-form"]');
        const errorRegion = backdrop.querySelector('[data-form-error]');
        button.disabled = true;
        try {
          const formData = new FormData(event.currentTarget);
          await appState.backupService.createLocalBackup({ label: formData.get('label'), reason: 'manual' });
          close();
          showToast('Lokální bod obnovy byl vytvořen.', 'success');
          navigate(ROUTES.data);
        } catch (error) {
          errorRegion.hidden = false;
          errorRegion.textContent = error.message;
        } finally {
          button.disabled = false;
        }
      });
    },
  });
}

async function exportDatabase(button) {
  button.disabled = true;
  const original = button.innerHTML;
  button.textContent = 'Připravuji export…';
  try {
    const backupPackage = await appState.backupService.exportPackage({ label: 'Úplný export Lesson Hubu', reason: 'manual' });
    const filename = await appState.backupService.createDownload(backupPackage);
    showToast(`Záloha ${filename} byla připravena ke stažení.`, 'success');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    button.disabled = false;
    button.innerHTML = original;
  }
}

function importPreviewMarkup(validation) {
  const packageInfo = validation.package;
  const warningMarkup = validation.warnings.length ? `<div class="warning-panel"><strong>Upozornění:</strong> ${validation.warnings.map(escapeHtml).join(' ')}</div>` : '';
  const importantCounts = [
    ['Skupiny', validation.summary.counts.groupInstances || 0],
    ['Hodiny', validation.summary.counts.lessons || 0],
    ['Povinnosti', (validation.summary.counts.tasks || 0) + (validation.summary.counts.reminders || 0)],
    ['Materiály', validation.summary.counts.materials || 0],
  ];
  return `
    <div class="import-preview">
      <div class="import-preview__status import-preview__status--valid">${icon('check', 22)}<div><strong>Soubor je platný</strong><span>Kontrolní součet SHA-256 souhlasí.</span></div></div>
      <dl class="definition-list">
        <div><dt>Vytvořeno</dt><dd>${formatDate(packageInfo.exportedAt)}</dd></div>
        <div><dt>Verze aplikace</dt><dd>${escapeHtml(packageInfo.appVersion || '—')}</dd></div>
        <div><dt>Datové schéma</dt><dd>${escapeHtml(packageInfo.schemaVersion || '—')}</dd></div>
        <div><dt>Velikost</dt><dd>${formatBytes(validation.sizeBytes)}</dd></div>
      </dl>
      <div class="import-count-grid">${importantCounts.map(([label, value]) => `<div><strong>${value}</strong><span>${label}</span></div>`).join('')}</div>
      ${warningMarkup}
      <fieldset class="choice-fieldset"><legend>Způsob importu</legend><label class="choice-card"><input type="radio" name="mode" value="replace" checked /><span><strong>Nahradit současná data</strong><small>Doporučeno pro úplnou obnovu. Před importem vznikne automatická bezpečnostní záloha.</small></span></label><label class="choice-card"><input type="radio" name="mode" value="merge" /><span><strong>Sloučit se současnými daty</strong><small>Záznamy se stejným ID se aktualizují, ostatní zůstanou zachované.</small></span></label></fieldset>
    </div>`;
}

async function handleImportFile(file) {
  if (!file) return;
  if (file.size > MAX_IMPORT_BYTES) {
    showToast('Soubor je větší než povolených 50 MB.', 'error');
    return;
  }
  const text = await file.text();
  const validation = await appState.backupService.validatePackage(text);
  if (!validation.valid) {
    openModal({
      id: 'invalid-import-modal',
      eyebrow: 'Import databáze',
      title: 'Soubor nelze bezpečně načíst',
      body: `<div class="diagnostic-summary diagnostic-summary--fail"><strong>Kontrola zálohy selhala.</strong></div><ul class="error-list">${validation.errors.map((message) => `<li>${escapeHtml(message)}</li>`).join('')}</ul>`,
      actions: `<button class="button button--primary" type="button" data-close-modal>Zavřít</button>`,
    });
    return;
  }

  openModal({
    id: 'import-preview-modal',
    eyebrow: 'Import databáze',
    title: 'Zkontrolujte obsah zálohy',
    body: `<form id="import-database-form">${importPreviewMarkup(validation)}<p class="form-error" data-form-error hidden></p></form>`,
    actions: `<button class="button button--ghost" type="button" data-close-modal>Zrušit</button><button class="button button--danger" type="submit" form="import-database-form">Provést import</button>`,
    wide: true,
    onOpen(backdrop) {
      backdrop.querySelector('#import-database-form')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = backdrop.querySelector('button[form="import-database-form"]');
        const errorRegion = backdrop.querySelector('[data-form-error]');
        const mode = new FormData(event.currentTarget).get('mode') || 'replace';
        button.disabled = true;
        button.textContent = 'Probíhá bezpečný import…';
        try {
          await appState.backupService.importPackage(validation.package, { mode, createSafetyBackup: true });
          showToast('Data byla bezpečně importována. Lesson Hub se znovu načte.', 'success');
          setTimeout(() => window.location.reload(), 700);
        } catch (error) {
          errorRegion.hidden = false;
          errorRegion.textContent = error.message;
          button.disabled = false;
          button.textContent = 'Provést import';
        }
      });
    },
  });
}

export function bindDataPage() {
  document.querySelectorAll('[data-export-database]').forEach((button) => button.addEventListener('click', () => exportDatabase(button)));
  document.querySelectorAll('[data-create-backup]').forEach((button) => button.addEventListener('click', openCreateBackupDialog));
  document.querySelector('[data-sync-restored]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    const original = button.textContent;
    button.textContent = 'Odesílám obnovený stav…';
    try {
      const result = await appState.syncService.synchronize();
      await appState.backupService.clearRestoreSyncStatus();
      showToast(`Obnovený stav byl zpracován: ${result.pushed.accepted || 0} změn odesláno, ${result.pushed.conflicts || 0} konfliktů.`, result.pushed.conflicts ? 'warning' : 'success');
      navigate(ROUTES.data);
    } catch (error) {
      showToast(error.message, 'error');
      button.disabled = false;
      button.textContent = original;
    }
  });

  const input = document.querySelector('[data-import-file]');
  document.querySelector('[data-select-import]')?.addEventListener('click', () => input?.click());
  input?.addEventListener('change', async () => {
    try {
      await handleImportFile(input.files?.[0]);
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      input.value = '';
    }
  });

  document.querySelectorAll('[data-restore-backup]').forEach((button) => button.addEventListener('click', () => {
    const id = button.dataset.restoreBackup;
    confirmAction({
      title: 'Obnovit tento bod?',
      message: 'Současná databáze bude nahrazena. Nejdřív automaticky vznikne bezpečnostní záloha aktuálního stavu.',
      confirmLabel: 'Obnovit data',
      danger: true,
      async onConfirm() {
        await appState.backupService.restoreLocalBackup(id);
        showToast('Data byla obnovena. Lesson Hub se znovu načte.', 'success');
        setTimeout(() => window.location.reload(), 700);
      },
    });
  }));

  document.querySelectorAll('[data-delete-backup]').forEach((button) => button.addEventListener('click', () => {
    const id = button.dataset.deleteBackup;
    confirmAction({
      title: 'Odstranit bod obnovy?',
      message: 'Tento lokální bod obnovy už nebude možné použít.',
      confirmLabel: 'Odstranit',
      danger: true,
      async onConfirm() {
        await appState.backupService.deleteLocalBackup(id);
        showToast('Bod obnovy byl odstraněn.', 'success');
        navigate(ROUTES.data);
      },
    });
  }));
}

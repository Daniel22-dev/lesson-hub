import { runDiagnostics } from '../core/diagnostics.js';
import { appState } from '../core/appState.js';
import { icon } from '../ui/icons.js';
import { showToast } from '../ui/toast.js';
import { escapeHtml } from '../core/html.js';

let latestReport = null;

function resultIcon(status) {
  return status === 'pass' ? 'check' : 'warning';
}

function statusLabel(status) {
  return status === 'pass' ? 'V pořádku' : status === 'warn' ? 'Upozornění' : 'Chyba';
}

function downloadReport(report) {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `lesson-hub-diagnostika-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function diagnosticsPage() {
  return {
    title: 'Diagnostika',
    description: 'Kontrola aplikace, databáze, záloh, integrity vazeb a lokálního úložiště.',
    actions: `
      <button id="download-diagnostics" class="button button--secondary" type="button" ${latestReport ? '' : 'disabled'}>${icon('download', 18)} Stáhnout protokol</button>
      <button id="run-diagnostics" class="button button--primary" type="button">Spustit self-testy</button>`,
    content: `
      <section id="diagnostics-panel" class="content-card">
        <div class="diagnostic-intro">
          <div class="diagnostic-intro__icon">${icon('diagnostics', 28)}</div>
          <div><h2>Interní diagnostika Lesson Hubu</h2><p>Testy používají pouze dočasné kontrolní záznamy. Ověří také export, kontrolní součet, bod obnovy a integritu vazeb.</p></div>
        </div>
        <div class="diagnostic-pending">Self-testy zatím nebyly spuštěny.</div>
      </section>
    `,
  };
}

export function bindDiagnosticsPage() {
  const button = document.querySelector('#run-diagnostics');
  const downloadButton = document.querySelector('#download-diagnostics');
  const panel = document.querySelector('#diagnostics-panel');
  if (!button || !panel) return;

  downloadButton?.addEventListener('click', () => {
    if (!latestReport) return;
    downloadReport(latestReport);
    showToast('Diagnostický protokol byl připraven ke stažení.', 'success');
  });

  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Probíhá kontrola…';
    panel.querySelectorAll('.diagnostic-summary, .diagnostic-list').forEach((element) => element.remove());
    panel.querySelector('.diagnostic-pending')?.remove();
    panel.insertAdjacentHTML('beforeend', '<div class="diagnostic-pending" id="diagnostic-running">Kontroluji datové jádro, komunikaci, zálohy a integritu…</div>');

    const report = await runDiagnostics({
      database: appState.database,
      repositories: appState.repositories,
      backupService: appState.backupService,
      templateCycleService: appState.templateCycleService,
      syncService: appState.syncService,
      serverService: appState.serverService,
      communicationService: appState.communicationService,
      substitutionService: appState.substitutionService,
    });
    latestReport = report;
    panel.querySelector('#diagnostic-running')?.remove();

    panel.insertAdjacentHTML(
      'beforeend',
      /* qa-safe-html: diagnostic strings are escaped below */ `<div class="diagnostic-summary diagnostic-summary--${escapeHtml(report.status)}">
        <strong>${escapeHtml(report.status === 'pass' ? 'Všechny základní testy prošly.' : report.status === 'warn' ? 'Diagnostika skončila s upozorněním.' : 'Diagnostika našla chyby k řešení.')}</strong>
        <span>Dokončeno ${escapeHtml(new Date(report.completedAt).toLocaleTimeString('cs-CZ'))} · ${Number(report.results.length)} kontrol</span>
      </div>
      <div class="diagnostic-list">
        ${report.results
          .map(
            (result) => `<article class="diagnostic-item diagnostic-item--${escapeHtml(result.status)}">
              <span class="diagnostic-item__icon">${icon(resultIcon(result.status), 20)}</span>
              <div><strong>${escapeHtml(result.label)}</strong><p>${escapeHtml(result.detail)}</p></div>
              <span class="diagnostic-item__status">${escapeHtml(statusLabel(result.status))}</span>
            </article>`,
          )
          .join('')}
      </div>`,
    );

    button.disabled = false;
    button.textContent = 'Spustit znovu';
    if (downloadButton) downloadButton.disabled = false;
  });
}

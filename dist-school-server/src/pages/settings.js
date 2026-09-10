import { APP_CONFIG } from '../core/config.js';
import { appState } from '../core/appState.js';

export function settingsPage() {
  const { theme, density } = appState.settings;
  return {
    title: 'Nastavení',
    description: 'Osobní vzhled a technické napojení aplikace.',
    content: `
      <div class="settings-grid">
        <section class="content-card">
          <div class="section-heading"><div><h2>Vzhled</h2><p>Nastavení se ukládá pouze jako uživatelská preference.</p></div></div>
          <div class="setting-row">
            <div><strong>Barevný režim</strong><span>Světlé nebo tmavé pracovní prostředí.</span></div>
            <select id="theme-select" class="select-control">
              <option value="light" ${theme === 'light' ? 'selected' : ''}>Světlý</option>
              <option value="dark" ${theme === 'dark' ? 'selected' : ''}>Tmavý</option>
            </select>
          </div>
          <div class="setting-row">
            <div><strong>Hustota zobrazení</strong><span>Komfortní režim nabízí více prostoru.</span></div>
            <select id="density-select" class="select-control">
              <option value="comfortable" ${density === 'comfortable' ? 'selected' : ''}>Komfortní</option>
              <option value="compact" ${density === 'compact' ? 'selected' : ''}>Kompaktní</option>
            </select>
          </div>
        </section>

        <section class="content-card">
          <div class="section-heading"><div><h2>AI Studio</h2><p>Hodnoty se zatím upravují v konfiguračním souboru.</p></div></div>
          <dl class="definition-list">
            <div><dt>Ekosystém</dt><dd>${APP_CONFIG.ecosystemName}</dd></div>
            <div><dt>Vlastník</dt><dd>${APP_CONFIG.ownerName}</dd></div>
            <div><dt>Autor a správce</dt><dd>${APP_CONFIG.authorName}</dd></div>
            <div><dt>Verze</dt><dd>${APP_CONFIG.version}</dd></div>
          </dl>
        </section>
      </div>
    `,
  };
}

export function bindSettingsPage() {
  document.querySelector('#theme-select')?.addEventListener('change', (event) => {
    appState.updateSettings({ theme: event.target.value });
  });
  document.querySelector('#density-select')?.addEventListener('change', (event) => {
    appState.updateSettings({ density: event.target.value });
  });
}

import { APP_CONFIG } from '../core/config.js';
import { ROUTES } from '../core/constants.js';
import { appState } from '../core/appState.js';
import { accessInitials, getAccessProfile, isAdmin, openAccessDialog } from '../core/access.js';
import { icon } from './icons.js';
import { escapeHtml } from '../core/html.js';

const NAV_ITEMS = [
  { route: ROUTES.overview, label: 'Přehled', icon: 'overview' },
  { route: ROUTES.groups, label: 'Skupiny', icon: 'groups' },
  { route: ROUTES.plan, label: 'Plán', icon: 'plan' },
  { route: ROUTES.work, label: 'Povinnosti', icon: 'check' },
  { route: ROUTES.materials, label: 'Materiály', icon: 'materials' },
  { route: ROUTES.templates, label: 'Šablony', icon: 'restore' },
  { route: ROUTES.search, label: 'Hledat', icon: 'search' },
  { route: ROUTES.communication, label: 'Komunikace', icon: 'user' },
  { route: ROUTES.substitution, label: 'Zastupování', icon: 'calendar' },
  { route: ROUTES.server, label: 'Server', icon: 'shield' },
  { route: ROUTES.more, label: 'Více', icon: 'more' },
];

function schoolMark() {
  return `<img class="brand__logo" src="${escapeHtml(APP_CONFIG.schoolLogoUrl)}" alt="Logo Gymnázia, Ostrava-Hrabůvka" />`;
}

function navMarkup(activeRoute, mobile = false) {
  const items = mobile
    ? NAV_ITEMS.filter(({ route }) => [ROUTES.overview, ROUTES.groups, ROUTES.plan, ROUTES.work, ROUTES.more].includes(route))
    : NAV_ITEMS;
  return items.map(
    ({ route, label, icon: iconName }) => `
      <a class="${mobile ? 'mobile-nav__item' : 'nav__item'} ${activeRoute === route ? 'is-active' : ''}"
         href="#/${escapeHtml(route)}"
         ${activeRoute === route ? 'aria-current="page"' : ''}>
        ${icon(iconName, mobile ? 21 : 20)}
        <span>${escapeHtml(label)}</span>
      </a>`,
  ).join('');
}

function studioImportBanner() {
  const imported = appState.studioImport?.stored;
  if (!imported) return '';
  return `
    <aside class="studio-import-banner" role="status" data-studio-import-banner>
      <span class="studio-import-banner__icon">${icon('materials', 21)}</span>
      <div>
        <strong>Materiál převzat z AI Studia</strong>
        <span>${escapeHtml(imported.title)}</span>
      </div>
      <a href="#/${escapeHtml(ROUTES.materials)}">Otevřít materiály</a>
      <button type="button" data-dismiss-studio-import aria-label="Skrýt oznámení">×</button>
    </aside>`;
}

export function renderLayout({ activeRoute, title, description, content, actions = '' }) {
  const isDark = appState.settings.theme === 'dark';
  const storageLabel = appState.database?.kind === 'indexeddb' ? 'Lokální databáze aktivní' : 'Dočasná paměť';
  const persistentStorage = appState.database?.kind === 'indexeddb';
  const profile = getAccessProfile();
  const localMode = profile.localDevelopment;

  return `
    <div class="app-shell">
      <aside class="sidebar" aria-label="Hlavní navigace">
        <div class="brand">
          ${schoolMark()}
          <div class="brand__text">
            <strong>${escapeHtml(APP_CONFIG.appName)}</strong>
            <span>${escapeHtml(APP_CONFIG.ecosystemName)}</span>
          </div>
        </div>

        <nav class="nav">${navMarkup(activeRoute)}</nav>

        <div class="sidebar__footer">
          <div class="storage-status" title="Způsob uložení dat">
            <span class="status-dot ${appState.database?.kind === 'indexeddb' ? 'is-online' : 'is-warning'}"></span>
            <span>${escapeHtml(storageLabel)}</span>
          </div>
          ${localMode ? '<div class="local-dev-badge">Lokální vývojový režim</div>' : ''}
          <a class="back-link" href="${escapeHtml(APP_CONFIG.aiStudioUrl)}">
            ${icon('arrowBack', 18)}
            <span>Zpět do AI Studia</span>
          </a>
        </div>
      </aside>

      <div class="workspace">
        <header class="topbar ${actions ? 'topbar--with-page-actions' : ''}">
          <div class="topbar__identity">
            <span class="topbar__eyebrow">${escapeHtml(appState.academic.currentYear ? `Školní rok ${appState.academic.currentYear.label}` : 'Školní rok není nastaven')}</span>
            <h1>${escapeHtml(title)}</h1>
            <p>${escapeHtml(description)}</p>
          </div>
          <div class="topbar__actions">
            <span class="topbar__page-actions">${actions}</span>
            ${isAdmin() ? `<a class="header-chip header-chip--admin" href="#/${ROUTES.diagnostics}" title="Interní diagnostika">${icon('shield', 17)}<span>Test Lab</span></a>` : ''}
            <a class="icon-button" href="${escapeHtml(APP_CONFIG.manualUrl)}" aria-label="Otevřít interaktivní manuál" title="Interaktivní manuál">
              ${icon('book', 20)}
            </a>
            <a class="server-status-chip ${appState.serverService?.isAuthenticated ? 'is-connected' : ''}" href="#/${escapeHtml(ROUTES.server)}" title="Server a synchronizace">${icon('database', 16)}<span>${appState.serverService?.isAuthenticated ? 'Server' : 'Lokálně'}</span></a>
            <span class="version-badge" title="Stav vydání: ${escapeHtml(APP_CONFIG.releaseStatus)}">v${escapeHtml(APP_CONFIG.version)}</span>
            <button class="access-chip" id="access-account" type="button" title="Centrální přístup AI Studio GHRAB">
              <span class="access-chip__avatar">${escapeHtml(accessInitials())}</span>
              <span class="access-chip__text"><strong>${escapeHtml(profile.displayName)}</strong><small>${escapeHtml(profile.role)}</small></span>
            </button>
            <button class="icon-button" id="theme-toggle" type="button" aria-label="Přepnout vzhled">
              ${icon(isDark ? 'sun' : 'moon', 20)}
            </button>
          </div>
        </header>

        ${persistentStorage ? '' : `<aside class="storage-warning-banner" role="alert"><strong>Data se nyní neukládají trvale.</strong><span>Aplikace používá pouze dočasnou paměť. Před další prací obnovte IndexedDB nebo stránku nezavírejte.</span></aside>`}

        ${studioImportBanner()}

        <main id="page-content" class="page-content" tabindex="-1">
          ${content}
        </main>

        <footer class="app-footer">
          <span>${escapeHtml(APP_CONFIG.ownerFooter)}</span>
          <span>${escapeHtml(APP_CONFIG.copyright)}</span>
          <span>Lesson Hub ${escapeHtml(APP_CONFIG.version)} · ${escapeHtml(APP_CONFIG.releaseStatus)}</span>
        </footer>
      </div>

      <nav class="mobile-nav" aria-label="Mobilní navigace">
        ${navMarkup(activeRoute, true)}
      </nav>
    </div>
  `;
}

export function bindLayoutEvents() {
  document.querySelector('#theme-toggle')?.addEventListener('click', () => {
    const nextTheme = appState.settings.theme === 'dark' ? 'light' : 'dark';
    appState.updateSettings({ theme: nextTheme });
  });
  document.querySelector('#access-account')?.addEventListener('click', openAccessDialog);
  document.querySelector('[data-dismiss-studio-import]')?.addEventListener('click', () => {
    appState.studioImport = null;
    document.querySelector('[data-studio-import-banner]')?.remove();
  });
}

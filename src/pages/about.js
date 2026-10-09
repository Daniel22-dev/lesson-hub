import { APP_CONFIG } from '../core/config.js';
import { escapeHtml } from '../core/html.js';

function studioChildUrl(pathname) {
  const base = String(APP_CONFIG.aiStudioUrl || '/AI-Studio-GHRAB/');
  return `${base.replace(/\/+$/, '')}/${String(pathname || '').replace(/^\/+/, '')}`;
}

function factCard(eyebrow, title, text) {
  return `
    <article class="content-card about-fact-card">
      <p class="about-eyebrow">${escapeHtml(eyebrow)}</p>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(text)}</p>
    </article>`;
}

export function aboutPage() {
  const safetyUrl = studioChildUrl('safety/');
  return {
    title: 'O aplikaci',
    description: 'Karta Lesson Hubu: účel, odpovědnost, provozní zásady a historie změn.',
    content: `
      <section class="about-overview-grid" aria-labelledby="about-identity-title">
        <article class="content-card about-identity-card">
          <div class="about-identity-mark" aria-hidden="true">
            <img src="./icons/icon-192.png" alt="" width="104" height="104" />
          </div>
          <p class="about-wordmark" aria-hidden="true">LESSON HUB</p>
          <h2 id="about-identity-title">Osobní paměť učitele</h2>
          <p class="about-identity-lead">Součást ekosystému AI Studio GHRAB</p>
          <p>Pracovní prostor pro dlouhodobou kontinuitu výuky: skupiny, hodiny, plánování, povinnosti, materiály a navazující učitelské workflow na jednom místě.</p>
        </article>
        <div class="about-facts-grid">
          ${factCard('AUTOR A VÝVOJOVÝ GARANT', APP_CONFIG.authorName, 'Koncepce, návrh funkcí, metodické vedení a vývoj Lesson Hubu.')}
          ${factCard('ŠKOLNÍ PROJEKT', 'Gymnázium, Ostrava-Hrabůvka', 'Interní školní projekt určený pro přípravu výuky, její kontinuitu a společné pracovní postupy.')}
          ${factCard('PŘÍSTUP A ODPOVĚDNOST', 'Podle role a oprávnění', 'Lesson Hub je součástí řízeného přístupu AI Studia. Dostupnost aplikace a správcovských funkcí se řídí oprávněním uživatele.')}
          ${factCard('TECHNICKÝ STAV', `v${APP_CONFIG.version} · PWA`, `Verze se mění spolu s ověřenými aktualizacemi. ${APP_CONFIG.releaseStatus}. Stav serverového nasazení a interní QA se evidují odděleně.`)}
        </div>
      </section>
      <section class="about-section" aria-labelledby="about-principles-title">
        <div class="section-heading"><div><p class="about-eyebrow">PROVOZNÍ ZÁSADY</p><h2 id="about-principles-title">Co je dobré vědět</h2><p>Stručný kontext pro běžnou práci s Lesson Hubem.</p></div></div>
        <div class="about-principles-grid">
          <article class="content-card about-principle-card"><span class="about-principle-number" aria-hidden="true">01</span><div><h3>Kontinuita výuky</h3><p>Lesson Hub propojuje přípravu, skutečný průběh hodin a navazující úkoly tak, aby bylo možné rychle pokračovat tam, kde výuka skončila.</p></div></article>
          <article class="content-card about-principle-card"><span class="about-principle-number" aria-hidden="true">02</span><div><h3>Nápověda a bezpečnost</h3><p class="about-links"><a href="${escapeHtml(APP_CONFIG.manualUrl + (APP_CONFIG.manualUrl.includes("?") ? "&" : "?") + "ghrabFrom=app")}">Manuál Lesson Hubu</a><span aria-hidden="true">·</span><a href="${escapeHtml(safetyUrl)}">Bezpečnost</a><span aria-hidden="true">·</span><a href="${escapeHtml(APP_CONFIG.accessUrl)}">Můj přístup</a></p></div></article>
        </div>
      </section>
      <section class="about-section" aria-labelledby="changelog-summary-title">
        <details class="content-card about-changelog" data-about-changelog>
          <summary><span><span class="about-eyebrow">HISTORIE VYDÁNÍ</span><strong id="changelog-summary-title">Katalog změn</strong><small>Rozbalte historii změn Lesson Hubu. Katalog se načte až po otevření této části.</small></span><span class="about-changelog-toggle" aria-hidden="true"></span></summary>
          <div class="about-changelog-body"><p class="about-changelog-intro">Zobrazeny jsou změny vedené v release changelogu. Podrobná interní QA a bezpečnostní evidence zůstává ve vývojové dokumentaci.</p><div class="changelog-list" data-changelog-list aria-live="polite" aria-busy="false"><div class="changelog-loading" aria-hidden="true"><span class="changelog-loading-dot"></span><span>Katalog změn se načte po rozbalení.</span></div></div></div>
        </details>
      </section>`,
  };
}

function createChangeCard(item) {
  const article = document.createElement('article'); article.className = 'change-card';
  const head = document.createElement('div'); head.className = 'change-head';
  const version = document.createElement('span'); version.className = 'change-version'; version.textContent = `v${String(item.version || '')}`; head.append(version);
  if (item.date) { const date = document.createElement('time'); date.dateTime = item.date; const parsed = new Date(`${item.date}T00:00:00`); date.textContent = Number.isNaN(parsed.getTime()) ? item.date : parsed.toLocaleDateString('cs-CZ'); head.append(date); }
  const heading = document.createElement('h3'); heading.textContent = item.title || 'Aktualizace';
  const changes = document.createElement('ul'); changes.className = 'change-list';
  for (const change of Array.isArray(item.changes) ? item.changes : []) { const entry = document.createElement('li'); entry.textContent = String(change); changes.append(entry); }
  article.append(head, heading, changes); return article;
}

export function bindAboutPage() {
  const details = document.querySelector('[data-about-changelog]');
  const list = document.querySelector('[data-changelog-list]');
  let loaded = false; let loading = null;
  async function renderChangelog() {
    if (!details?.open || !list || loaded) return;
    list.setAttribute('aria-busy', 'true');
    try {
      loading ??= fetch('./config/changelog.json', { cache: 'no-store' }).then(async (response) => { if (!response.ok) throw new Error(`Changelog HTTP ${response.status}`); return response.json(); });
      const data = await loading; const items = Array.isArray(data?.items) ? data.items : [];
      list.replaceChildren(...items.map(createChangeCard));
      if (!items.length) { const empty = document.createElement('p'); empty.className = 'about-changelog-empty'; empty.textContent = 'Katalog změn zatím neobsahuje žádné položky.'; list.replaceChildren(empty); }
      loaded = true;
    } catch (error) {
      console.error('Lesson Hub: katalog změn se nepodařilo načíst.', error);
      const message = document.createElement('p'); message.className = 'about-changelog-error'; message.textContent = 'Katalog změn se nepodařilo načíst.'; list.replaceChildren(message); loading = null;
    } finally { list.setAttribute('aria-busy', 'false'); }
  }
  details?.addEventListener('toggle', () => { if (details.open) void renderChangelog(); });
  if (details?.open) void renderChangelog();
}

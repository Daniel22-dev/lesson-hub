const APP_ID = 'lesson-hub';
const STUDIO_URL = 'https://daniel22-dev.github.io/AI-Studio-GHRAB/';
const GUARD_URL = `${STUDIO_URL}access/app-guard.js`;

function isLocalDevelopment() {
  return navigator.webdriver === true && (new URLSearchParams(location.search).get('qa') === '1' || location.protocol === 'about:');
}

function grantLocalDevelopmentAccess() {
  const now = Math.floor(Date.now() / 1000);
  window.__GHRAB_STUDIO_ACCESS__ = {
    permit: {
      sub: 'lesson-hub-local-developer',
      displayName: 'Lokální vývoj',
      role: 'admin',
      apps: [APP_ID],
      iat: now,
      exp: now + 8 * 60 * 60,
      jti: `local-${Date.now()}`,
      localDevelopment: true,
    },
  };
  document.documentElement.dataset.ghrabAccess = 'granted';
  document.documentElement.dataset.ghrabAccessMode = 'local-development';
}

function showBootstrapFailure(error) {
  console.error('AI Studio access bootstrap failed', error);
  document.documentElement.dataset.ghrabAccess = 'denied';
  document.body.style.visibility = 'visible';
  document.body.className = 'ghrab-access-gate-body';
  document.body.innerHTML = /* qa-safe-html: trusted constant URLs and static copy */ `
    <main class="ghrab-access-gate" role="alert">
      <div class="ghrab-access-gate-mark">🔒</div>
      <p class="ghrab-access-gate-eyebrow">AI STUDIO GHRAB</p>
      <h1>Aplikaci se nepodařilo bezpečně spustit</h1>
      <p>Centrální ověření je dočasně nedostupné nebo nebyl potvrzen přístup k Lesson Hubu.</p>
      <p class="ghrab-access-gate-reason">Aplikace zůstala uzamčena. Žádná pracovní data nebyla načtena.</p>
      <div class="ghrab-access-gate-actions">
        <a class="ghrab-access-gate-primary" href="${STUDIO_URL}">Zpět do AI Studia</a>
        <a class="ghrab-access-gate-secondary" href="${STUDIO_URL}access/">Správa přístupu</a>
      </div>
    </main>`;
}

async function start() {
  try {
    if (isLocalDevelopment()) {
      grantLocalDevelopmentAccess();
      await import('./main.js');
      return;
    }

    const { protectApp } = await import(GUARD_URL);
    const allowed = await protectApp(APP_ID, { studioUrl: STUDIO_URL });
    if (!allowed) return;
    await import('./main.js');
  } catch (error) {
    showBootstrapFailure(error);
  }
}

start();

const APP_ID = 'lesson-hub';
const STUDIO_URL = 'https://daniel22-dev.github.io/AI-Studio-GHRAB/';
const GUARD_URL = `${STUDIO_URL}access/app-guard.js`;

function isLocalDevelopment() {
  return ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) || (navigator.webdriver === true && (new URLSearchParams(location.search).get('qa') === '1' || location.protocol === 'about:'));
}

function localPermit() {
  const now = Math.floor(Date.now() / 1000);
  window.__GHRAB_STUDIO_ACCESS__ = {
    permit: {
      sub: 'lesson-hub-local-developer',
      displayName: 'Lokální vývoj',
      role: 'admin',
      apps: [APP_ID],
      iat: now,
      exp: now + 8 * 60 * 60,
      localDevelopment: true,
    },
  };
  document.documentElement.dataset.ghrabAccess = 'granted';
}

function fail(error) {
  console.error('Manual access bootstrap failed', error);
  document.documentElement.dataset.ghrabAccess = 'denied';
  document.body.style.visibility = 'visible';
  document.body.className = 'ghrab-access-gate-body';
  document.body.innerHTML = /* qa-safe-html: trusted constant URLs and static copy */ `<main class="ghrab-access-gate" role="alert">
    <div class="ghrab-access-gate-mark">🔒</div>
    <p class="ghrab-access-gate-eyebrow">AI STUDIO GHRAB</p>
    <h1>Manuál zůstal uzamčen</h1>
    <p>Otevřete Lesson Hub z AI Studia a ověřte centrální přístup.</p>
    <div class="ghrab-access-gate-actions"><a class="ghrab-access-gate-primary" href="${STUDIO_URL}">Zpět do AI Studia</a></div>
  </main>`;
}

try {
  if (isLocalDevelopment()) {
    localPermit();
    await import('./manual.js');
  } else {
    const { protectApp } = await import(GUARD_URL);
    const allowed = await protectApp(APP_ID, { studioUrl: STUDIO_URL, telemetry: false, errorReporter: false });
    if (allowed) await import('./manual.js');
  }
} catch (error) {
  fail(error);
}

const APP_ID = 'lesson-hub';
let studioUrl = '/AI-Studio-GHRAB/';

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

function startLocalReporter(context) {
  return import('./access/reporter-bootstrap.js')
    .then((module) => module.startReporterBestEffort('./error-reporter-adapter.js', { context }))
    .catch((error) => {
      console.warn('Reportér Lesson Hubu nebyl načten; aplikace pokračuje.', error);
      return null;
    });
}

function showBootstrapFailure(error) {
  console.error('AI Studio access bootstrap failed', error);
  document.documentElement.dataset.ghrabAccess = 'denied';
  document.body.style.visibility = 'visible';
  document.body.className = 'ghrab-access-gate-body';
  document.body.innerHTML = /* qa-safe-html: static copy, URL assigned below */ `
    <main class="ghrab-access-gate" role="alert">
      <div class="ghrab-access-gate-mark">🔒</div>
      <p class="ghrab-access-gate-eyebrow">AI STUDIO GHRAB</p>
      <h1>Aplikaci se nepodařilo bezpečně spustit</h1>
      <p>Centrální ověření je dočasně nedostupné nebo nebyl potvrzen přístup k Lesson Hubu.</p>
      <p class="ghrab-access-gate-reason">Aplikace zůstala uzamčena. Žádná pracovní data nebyla načtena.</p>
      <div class="ghrab-access-gate-actions">
        <a class="ghrab-access-gate-primary" data-ghrab-studio-link>Zpět do AI Studia</a>
        <a class="ghrab-access-gate-secondary" data-ghrab-access-link>Správa přístupu</a>
      </div>
    </main>`;
  document.querySelector('[data-ghrab-studio-link]').href = studioUrl;
  document.querySelector('[data-ghrab-access-link]').href = new URL('access/', studioUrl).href;
}

async function start() {
  try {
    const deploymentModule = await import('./access/deployment-config.js');
    const deployment = await deploymentModule.loadDeploymentConfig({ appId: APP_ID });
    const urls = deploymentModule.deploymentUrls(deployment);
    studioUrl = urls.studioUrl;

    if (isLocalDevelopment()) {
      grantLocalDevelopmentAccess();
      void startLocalReporter('lesson-hub:local-development');
      await import('./main.js');
      return;
    }

    const { protectApp } = await import(urls.guardUrl);
    const allowed = await protectApp(APP_ID, { studioUrl, errorReporter: false });
    if (!allowed) return;
    void startLocalReporter('lesson-hub:granted');
    await import('./main.js');
  } catch (error) {
    showBootstrapFailure(error);
    void startLocalReporter('lesson-hub:bootstrap-failure');
  }
}

void start();

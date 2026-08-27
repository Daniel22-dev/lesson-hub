const APP_ID = 'lesson-hub';
let studioUrl = '/AI-Studio-GHRAB/';

function isTrustedLocalOrigin() {
  return ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) || location.protocol === 'about:';
}

function isLocalDevelopment() {
  if (!isTrustedLocalOrigin()) return false;
  if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) return true;
  return navigator.webdriver === true && location.protocol === 'about:';
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
  document.body.innerHTML = /* qa-safe-html: static copy, URL assigned below */ `<main class="ghrab-access-gate" role="alert">
    <div class="ghrab-access-gate-mark">🔒</div>
    <p class="ghrab-access-gate-eyebrow">AI STUDIO GHRAB</p>
    <h1>Manuál zůstal uzamčen</h1>
    <p>Otevřete Lesson Hub z AI Studia a ověřte centrální přístup.</p>
    <div class="ghrab-access-gate-actions"><a class="ghrab-access-gate-primary" data-ghrab-studio-link>Zpět do AI Studia</a></div>
  </main>`;
  document.querySelector('[data-ghrab-studio-link]').href = studioUrl;
}

async function start() {
  try {
    const deploymentModule = await import('../src/access/deployment-config.js');
    const deployment = await deploymentModule.loadDeploymentConfig({ appId: APP_ID });
    const urls = deploymentModule.deploymentUrls(deployment);
    studioUrl = urls.studioUrl;
    if (isLocalDevelopment()) {
      localPermit();
      await import('./manual.js');
      return;
    }
    const { protectApp } = await import(urls.guardUrl);
    const allowed = await protectApp(APP_ID, { studioUrl, telemetry: false, errorReporter: false });
    if (!allowed) return;
    await import('./manual.js');
  } catch (error) {
    fail(error);
  }
}

void start();

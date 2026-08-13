#!/usr/bin/env node
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, join, normalize, relative, resolve, sep } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = join(ROOT, 'reporter-test.config.json');
function findChromium() {
  const explicit = process.env.CHROMIUM_PATH || process.env.CHROME_PATH;
  const candidates = [
    explicit,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  const playwrightRoot = process.env.PLAYWRIGHT_BROWSERS_PATH && process.env.PLAYWRIGHT_BROWSERS_PATH !== '0'
    ? process.env.PLAYWRIGHT_BROWSERS_PATH
    : join(homedir(), '.cache', 'ms-playwright');
  if (existsSync(playwrightRoot)) {
    const versions = readdirSync(playwrightRoot)
      .filter((name) => name.startsWith('chromium-'))
      .sort()
      .reverse();
    for (const version of versions) {
      for (const relativePath of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
        const candidate = join(playwrightRoot, version, relativePath);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return explicit || '/usr/bin/chromium';
}
const CHROMIUM = findChromium();
const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const TEST_SENSITIVE_EMAIL = ['student.fixture', 'example.test'].join(String.fromCharCode(64));
const results = [];
const failures = [];

function browserEnvironmentStatus() {
  if (!existsSync(CHROMIUM)) {
    return {
      status: 'not-ready',
      reason: `Chromium není dostupné: ${CHROMIUM}`,
    };
  }
  const policyFiles = [
    '/etc/chromium/policies/managed/000_policy_merge.json',
    '/etc/opt/chrome/policies/managed/000_policy_merge.json',
  ];
  for (const file of policyFiles) {
    if (!existsSync(file)) continue;
    try {
      const policy = JSON.parse(readFileSync(file, 'utf8'));
      if (Array.isArray(policy.URLBlocklist) && policy.URLBlocklist.includes('*')) {
        return {
          status: 'not-ready',
          reason: `Spravovaná politika URLBlocklist blokuje všechny testovací stránky (${file}).`,
        };
      }
    } catch {
      // Nečitelná politika nesmí zakrýt skutečný browserový běh.
    }
  }
  return { status: 'ready', reason: '' };
}

function record(name, ok, detail = '') {
  const item = { name, ok, detail };
  results.push(item);
  const prefix = ok ? 'PASS' : 'FAIL';
  console.log(`${prefix}: ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(item);
}
function check(name, condition, detail = '') {
  record(name, Boolean(condition), detail);
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ''}`);
}
function text(path) {
  return readFileSync(join(ROOT, path), 'utf8');
}
function pathExists(path) {
  return existsSync(join(ROOT, path));
}
function count(source, pattern) {
  return [...source.matchAll(pattern)].length;
}
function staticAudit() {
  check('Patch verze v package.json', packageJson.version === config.version, packageJson.version);
  for (const path of [config.reporterPath, config.stylePath, config.adapterPath]) {
    check(`Existuje ${path}`, pathExists(path));
  }
  const reporter = text(config.reporterPath);
  const css = text(config.stylePath);
  const adapter = text(config.adapterPath);

  check('Ochrana jediné instance používá ghrab-error-reporter', reporter.includes('const REPORTER_ID = "ghrab-error-reporter"'));
  check('Kanonický reportér má verzi 1.1.2', reporter.includes('const REPORTER_VERSION = "1.1.2"'));
  check('Limit je přesně pět screenshotů', reporter.includes('const MAX_SCREENSHOTS = 5'));
  check('Finální compose URL je omezena na 7000 znaků', reporter.includes('const MAX_COMPOSE_URL_LENGTH = 7000') && reporter.includes('export function fitMailBodyToComposeUrl'));
  check('Zkracování zachovává plné tělo a krátí diagnostiku jako první', reporter.includes('const fullBody = makeBody') && reporter.includes('currentDiagnostics = currentDiagnostics.slice(0, 3)'));
  check('Primární akce pouze připraví ZIP', reporter.includes('const prepareLink = button(') && reporter.includes('Připravit ZIP balíček'));
  check('ZIP má po vytvoření přímý odkaz download', reporter.includes('download.download = info.file.name') && reporter.includes('download.dataset.reportDownload = "zip"'));
  check('Gmail se zpřístupní až po kliknutí na stažení', reporter.includes('mailStep.hidden = true') && reporter.includes('mailStep.hidden = false') && reporter.includes('ZIP mám stažený – otevřít Gmail'));
  check('Zakázaný window.open se nepoužívá', !/\bwindow\.open\s*\(/.test(reporter));
  check('Neexistuje stará přímá funkce sdílení balíčku', !/navigator\.share|Sdílet balíček přímo/.test(reporter));
  check('ZIP obsahuje povinné soubory', ['00-PREHLED-HLASENI.html', 'hlaseni.txt', 'technicke-udaje.json', 'screenshot-'].every((value) => reporter.includes(value)));
  check('ZIP vyžaduje alespoň jeden screenshot', reporter.includes('Přiložte prosím alespoň jeden screenshot'));
  check('Schéma ZIP diagnostiky je v3 a rozlišuje tři časy', reporter.includes('ghrab-error-report-v3') && ['createdAt', 'updatedAt', 'packageCreatedAt'].every((value) => reporter.includes(value)));
  check('Zavření používá jednotný requestClose', ['closeButton.addEventListener("click", requestClose)', 'cancelButton.addEventListener("click", requestClose)', 'if (event.target === backdrop) requestClose()', 'else if (!backdrop.hidden) requestClose()'].every((value) => reporter.includes(value)));
  check('Úplné smazání maže data, ID, chyby, ZIP a stream', ['state.screenshots = []', 'state.preparedFile = null', 'state.preparedBlob = null', 'state.reportId = reportId()', 'state.technicalErrors = []', 'stopCapture()'].every((value) => reporter.includes(value)));
  check('Nové hlášení po dokončeném reportu dostane nové ID', reporter.includes('if (state.completed) resetDraft()') && reporter.includes('state.completed = true'));
  check('Dialog obsahuje focus trap a obnovu předchozího fokusu', reporter.includes('function trapDialogFocus(event)') && reporter.includes('previousFocus') && reporter.includes('target.focus?.({ preventScroll: true })'));
  check('Rozhraní i e-mail výslovně upozorňují na ruční přílohu', reporter.includes('Gmail místní soubor z bezpečnostních důvodů nepřipojí automaticky') && reporter.includes('PŘÍLOHA NENÍ PŘIPOJENA AUTOMATICKY'));
  check('Přechod do aplikace je samostatné tlačítko', reporter.includes('"Přejít do aplikace"') && reporter.includes('showApplicationForCapture'));
  check('Plovoucí panel má všechny tři akce', ['"Pořídit snímek"', '"Zpět k hlášení"', '"Ukončit snímání"'].every((value) => reporter.includes(value)));
  check('Reportér se při pořízení snímku skrývá', reporter.includes('root.classList.add("ghrab-capture-hidden")') && reporter.includes('root.classList.remove("ghrab-capture-hidden")'));
  check('Technické chyby pokrývají JS, Promise, HTTP a síť', ['"javascript"', '"promise"', '"http"', '"network"'].every((value) => reporter.includes(value)));
  check('Citlivé technické texty se sanitizují', reporter.includes('[e-mail odstraněn]') && reporter.includes('[obsah odstraněn]') && reporter.includes('[odstraněno]'));
  check('Bezpečná URL odstraňuje query/hash a citlivé segmenty', reporter.includes('safePageUrl()') && reporter.includes('safeUrlPath(location.pathname)'));

  check('CSS podporuje světlý režim', css.includes('[data-theme="light"]'));
  check('CSS podporuje tmavý režim', css.includes('color-scheme: dark'));
  check('CSS respektuje safe-area', css.includes('safe-area-inset-bottom') && css.includes('safe-area-inset-right'));
  check('CSS má responzivní panel snímání', css.includes('@media (max-width: 430px)') && css.includes('.ghrab-capture-bar'));
  check('CSS skrývá reportér při samotném snímku', css.includes('.ghrab-error-reporter.ghrab-capture-hidden'));
  check('Živý obraz je uvnitř reportéru a skrytý CSS i inline',
    reporter.includes('root.append(video)') &&
    !reporter.includes('document.body.append(video)') &&
    reporter.includes('visibility: "hidden"') &&
    css.includes('.ghrab-error-reporter .ghrab-capture-video') &&
    css.includes('visibility: hidden !important') &&
    css.includes('pointer-events: none !important'));
  check('Reportér používá jediný trvalý stav místo duplicitních toastů',
    count(reporter, /const captureStatus = element\(/g) === 1 &&
    count(reporter, /const finalStatus = element\(/g) === 1 &&
    !/toast|snackbar/i.test(reporter));

  check('Adaptér má správné appId', adapter.includes(`appId: '${config.appId}'`));
  check('Adaptér má správnou verzi', adapter.includes(`appVersion: '${config.version}'`));
  check('Adaptér má bezpečný e-mailový fallback', adapter.includes("supportEmail: 'balaz@ghrabuvka.cz'"));
  check('Adaptér odkazuje na deployment-aware centrální návod', adapter.includes('deployment?.access?.guideUrl') || adapter.includes('reporterGuideUrl') || adapter.includes("guideUrl: '/AI-Studio-GHRAB/manualy/error-report.html'"));
  check('Adaptér má aplikační resolver motivu', adapter.includes('themeResolver:'));

  for (const path of config.bootstrapPaths) {
    const source = text(path);
    check(`${path}: centrální reportér je vypnut`, /errorReporter\s*:\s*false/.test(source));
    check(`${path}: lokální adaptér se načítá`, source.includes('error-reporter-adapter.js'));
    if (config.appId === 'correspondence') {
      check(
        `${path}: KS spouští reportér neblokujícím importem s catch`,
        /void\s+import\([^)]*error-reporter-adapter\.js[^)]]*\)\.catch/.test(source) &&
          !/await\s+import\(['"][^'"]*error-reporter-adapter\.js['"]\)/.test(source),
      );
    } else if (config.appId !== 'ai-studio-reporter') {
      check(`${path}: reportér není blokující await`, source.includes('startReporterBestEffort') && !/await\s+import\(['"][^'"]*error-reporter-adapter\.js['"]\)/.test(source));
    }
  }
  const manual = text(config.manualContentPath || config.manualPath);
  const manualGuard = text(config.manualGuardPath || config.manualPath);
  check('Lokální manuál odkazuje na aktuální centrální návod', manual.includes('Jak poslat správci srozumitelné hlášení bez focení monitoru'));
  check('Lokální manuál nevytváří vlastní reportér', !manual.includes('error-reporter-adapter.js') && /errorReporter\s*:\s*false/.test(manualGuard));
  check('Lokální manuál popisuje pět snímků, koncept, ZIP, Gmail a soukromí', ['pět', 'koncept', 'ZIP', 'Gmail', 'citliv'].every((value) => manual.toLowerCase().includes(value.toLowerCase())));

  for (const path of config.serviceWorkerPaths) {
    const sw = text(path);
    const assets = config.serviceWorkerAssets || ['error-reporter.js', 'error-reporter.css', 'error-reporter-adapter.js'];
    check(`${path}: service worker cachuje společné soubory reportéru`, assets.every((value) => sw.includes(value)));
  }
  if (config.centralAppGuardPath) {
    const guard = text(config.centralAppGuardPath);
    check('Centrální app-guard nemá statický import reportéru', !/^import[^;]*error-reporter/m.test(guard));
    check('Centrální app-guard načítá reportér dynamicky best-effort', guard.includes('startErrorReporterBestEffort') && guard.includes('import(reporterModuleUrl)') && guard.includes('.catch((error)'));
    check('Centrální app-guard respektuje errorReporter:false a denied fallback', guard.includes('options.errorReporter !== false') && guard.includes('options.errorReporterOnDenied !== false'));
  }
  for (const path of config.versionPaths || []) {
    check(`${path}: obsahuje verzi ${config.version}`, text(path).includes(config.version));
  }
  check('Nezůstala stará paralelní implementace KS', !pathExists('src/access/error-reporter-ks.js') && !pathExists('src/js/26-error-reporter-compat.js'));
}

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAD0lEQVR42mNk+M/AwMAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
};

function harnessHtml() {
  const initialTheme = config.theme?.initial || config.theme?.light || '';
  const adapterUrl = `/${config.adapterPath.replaceAll('\\', '/')}`;
  const reporterUrl = `/${config.reporterPath.replaceAll('\\', '/')}`;
  return `<!doctype html>
<html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GHRAB reporter harness</title></head>
<body><main><h1>Testovací aplikace</h1><p id="visible-error">Viditelná anonymizovaná chyba TEST-42</p></main>
<script>
(() => {
  ${initialTheme}
  window.__themeLight = () => { ${config.theme?.light || ''} };
  window.__themeDark = () => { ${config.theme?.dark || ''} };
  const nativeAdd = window.addEventListener.bind(window);
  window.__listenerCounts = { error: 0, unhandledrejection: 0 };
  window.addEventListener = function(type, listener, options) {
    if (type === 'error' || type === 'unhandledrejection') window.__listenerCounts[type] += 1;
    return nativeAdd(type, listener, options);
  };
  window.__nativeFetch = window.fetch;
  window.__clipboardText = '';
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: async (value) => { window.__clipboardText = String(value); },
  }});
  class FakeTrack extends EventTarget { stop() { this.stopped = true; } }
  window.__fakeTrack = new FakeTrack();
  const fakeStream = {
    getTracks: () => [window.__fakeTrack],
    getVideoTracks: () => [window.__fakeTrack],
  };
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
    getDisplayMedia: async () => fakeStream,
  }});
  Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
    configurable: true,
    get() { return this.__srcObject || null; },
    set(value) { this.__srcObject = value; },
  });
  HTMLMediaElement.prototype.play = async function() {
    const video = this;
    setTimeout(() => {
      Object.defineProperty(video, 'videoWidth', { configurable: true, value: 640 });
      Object.defineProperty(video, 'videoHeight', { configurable: true, value: 360 });
    }, 80);
  };
  const nativeDrawImage = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function(source, ...args) {
    if (source instanceof HTMLVideoElement) {
      this.fillStyle = '#cbd5e1';
      const width = args.at(-2) || this.canvas.width || 1;
      const height = args.at(-1) || this.canvas.height || 1;
      this.fillRect(0, 0, width, height);
      return;
    }
    return nativeDrawImage.call(this, source, ...args);
  };
  window.__captureHiddenObserved = false;
  const nativeToBlob = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function(callback, ...args) {
    if (document.getElementById('ghrab-error-reporter')?.classList.contains('ghrab-capture-hidden')) {
      window.__captureHiddenObserved = true;
    }
    return nativeToBlob.call(this, callback, ...args);
  };
  window.__sensitiveFixtures = {
    prompt: 'ANON_PROMPT_TOKEN',
    originalText: 'ANON_ORIGINAL_TEXT_TOKEN',
    modelAnswer: 'ANON_MODEL_OUTPUT_TOKEN',
    documentContent: 'ANON_DOCUMENT_TOKEN',
    studentName: 'ANON_PERSON_TOKEN',
    studentEmail: ${JSON.stringify(TEST_SENSITIVE_EMAIL)},
  };
})();
</script>
<script type="module">
try {
  await import(${JSON.stringify(adapterUrl)});
  const firstFetch = window.fetch;
  const { setupErrorReporter } = await import(${JSON.stringify(reporterUrl)});
  setupErrorReporter({ appId: ${JSON.stringify(config.appId)}, appName: ${JSON.stringify(config.appName)}, appVersion: ${JSON.stringify(config.version)} });
  window.__duplicateSetupKeptFetch = window.fetch === firstFetch;
  window.__harnessReady = true;
} catch (error) {
  window.__harnessError = error?.stack || String(error);
}
</script></body></html>`;
}

function guardModule() {
  return `export async function protectApp(appId, options = {}) {
    window.__guardCalls = window.__guardCalls || [];
    window.__guardCalls.push({ appId, options });
    const permit = { appId, token: 'TEST_ANONYMIZED_PERMIT' };
    document.documentElement.dataset.ghrabAccess = 'granted';
    document.dispatchEvent(new CustomEvent('ghrab:app-access-granted', { detail: { appId, permit } }));
    return true;
  }
  export default protectApp;`;
}

function startServer() {
  let supportMode = 'ok';
  let supportHits = 0;
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    const send = (status, body, type = 'text/plain; charset=utf-8') => {
      res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(body);
    };
    if (pathname === '/harness.html') return send(200, harnessHtml(), 'text/html; charset=utf-8');
    if (pathname === '/embed.html') {
      const entry = url.searchParams.get('entry') || `/${config.distEntry}`;
      return send(200, `<!doctype html><html><body><iframe id="app" src="${entry}" style="width:100vw;height:100vh;border:0"></iframe></body></html>`, 'text/html; charset=utf-8');
    }
    if (pathname === '/new-tab.html') return send(200, '<!doctype html><title>GHRAB local new-tab test</title><h1>OK</h1>', 'text/html; charset=utf-8');
    if (pathname === '/__support-mode') {
      supportMode = url.searchParams.get('mode') || 'ok';
      return send(200, JSON.stringify({ supportMode, supportHits }), 'application/json');
    }
    if (pathname === '/__support-hits') return send(200, JSON.stringify({ supportMode, supportHits }), 'application/json');
    if (pathname === '/http-failure') return send(503, JSON.stringify({ error: 'ANONYMIZED_TEST_FAILURE' }), 'application/json');
    if (pathname === '/network-failure') {
      req.socket.destroy();
      return;
    }
    if (pathname === '/AI-Studio-GHRAB/access/app-guard.js') return send(200, guardModule(), 'text/javascript; charset=utf-8');
    if (pathname === '/AI-Studio-GHRAB/access/access-gate.css') return send(200, ':root{--access-test:1}', 'text/css; charset=utf-8');
    if (pathname === '/AI-Studio-GHRAB/config/support.json') {
      supportHits += 1;
      if (supportMode === '404') return send(404, '{}', 'application/json');
      return send(200, JSON.stringify({ administratorEmail: 'balaz@ghrabuvka.cz' }), 'application/json');
    }
    if (pathname === '/AI-Studio-GHRAB/config/apps.generated.json') {
      return send(200, JSON.stringify([{ id: config.appId, version: config.version, name: { cs: config.appName, en: config.appName } }]), 'application/json');
    }
    if (pathname === '/AI-Studio-GHRAB/manualy/error-report.html') {
      return send(200, '<!doctype html><title>Jak poslat správci srozumitelné hlášení bez focení monitoru</title>', 'text/html; charset=utf-8');
    }
    if (pathname.startsWith('/AI-Studio-GHRAB/assets/brand/')) {
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
      return res.end(TINY_PNG);
    }
    if (pathname.startsWith('/api/')) return send(200, JSON.stringify({ ok: true, data: [] }), 'application/json');

    let requested = pathname === '/' ? `/${config.distEntry}` : pathname;
    requested = requested.replace(/^\/+/, '');
    let absolute = normalize(join(ROOT, requested));
    if (absolute !== ROOT && !absolute.startsWith(`${ROOT}${sep}`)) return send(403, 'forbidden');
    if (existsSync(absolute) && statSync(absolute).isDirectory()) absolute = join(absolute, 'index.html');
    if (!existsSync(absolute) || !statSync(absolute).isFile()) return send(404, 'not found');
    const type = MIME[extname(absolute).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(readFileSync(absolute));
  });
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolvePromise({ server, port: address.port });
    });
  });
}

class CdpClient {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.seq = 0;
    this.pending = new Map();
    this.listeners = new Map();
  }
  async open() {
    await new Promise((resolvePromise, reject) => {
      this.ws.onopen = resolvePromise;
      this.ws.onerror = reject;
    });
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
        else pending.resolve(message.result);
        return;
      }
      const callbacks = this.listeners.get(message.method) || [];
      for (const callback of callbacks) callback(message.params || {});
    };
  }
  on(method, callback) {
    const callbacks = this.listeners.get(method) || [];
    callbacks.push(callback);
    this.listeners.set(method, callbacks);
  }
  call(method, params = {}) {
    return new Promise((resolvePromise, reject) => {
      const id = ++this.seq;
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.call('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed');
    }
    return result.result.value;
  }
  close() { this.ws.close(); }
}

async function waitJson(url, attempts = 200) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {}
    await sleep(75);
  }
  throw new Error(`Timeout: ${url}`);
}
async function findPageTarget(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const targets = await response.json();
    return targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl) || null;
  } catch {
    return null;
  }
}
async function waitPageTarget(listUrl, browserWebSocketDebuggerUrl) {
  const deadline = Date.now() + 12000;
  let createAttempts = 0;
  let nextCreateAt = 0;
  while (Date.now() < deadline) {
    const page = await findPageTarget(listUrl);
    if (page) return page;
    if (browserWebSocketDebuggerUrl && createAttempts < 4 && Date.now() >= nextCreateAt) {
      createAttempts += 1;
      nextCreateAt = Date.now() + 500;
      let browserClient;
      try {
        browserClient = new CdpClient(browserWebSocketDebuggerUrl);
        await browserClient.open();
        await browserClient.call('Target.createTarget', { url: 'about:blank' });
      } catch {} finally {
        try { browserClient?.close(); } catch {}
      }
    }
    await sleep(75);
  }
  throw new Error(`Chromium nemá page target ani po čekání (pokusy o vytvoření: ${createAttempts})`);
}
async function waitFor(client, expression, label, attempts = 240) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      if (await client.evaluate(expression)) return;
    } catch {}
    await sleep(50);
  }
  const diagnostic = await client.evaluate(`({href:location.href,ready:window.__harnessReady||false,error:window.__harnessError||null,body:document.body?.innerText?.slice(0,300)||'',root:!!document.querySelector('#ghrab-error-reporter')})`).catch(() => null);
  throw new Error(`${label}${diagnostic ? `: ${JSON.stringify(diagnostic)}` : ''}`);
}
function zipDownloadSnapshot(directory) {
  const snapshot = new Map();
  for (const name of readdirSync(directory)) {
    if (!name.toLowerCase().endsWith('.zip')) continue;
    const info = statSync(join(directory, name));
    snapshot.set(name, `${info.size}:${info.mtimeMs}`);
  }
  return snapshot;
}
async function waitForZipDownload(directory, previous, label, attempts = 400) {
  for (let index = 0; index < attempts; index += 1) {
    for (const name of readdirSync(directory)) {
      if (!name.toLowerCase().endsWith('.zip')) continue;
      const path = join(directory, name);
      const info = statSync(path);
      const signature = `${info.size}:${info.mtimeMs}`;
      if (info.size > 0 && previous.get(name) !== signature) {
        return { filename: name, base64: readFileSync(path).toString('base64') };
      }
    }
    await sleep(50);
  }
  const files = readdirSync(directory).join(', ') || 'prázdná složka';
  throw new Error(`${label}: ${files}`);
}
async function navigate(client, url) {
  await client.call('Page.navigate', { url });
  await waitFor(client, 'document.readyState === "complete" || document.readyState === "interactive"', `Navigation failed: ${url}`, 300);
}
function inspectZip(base64, label, { expectedScreenshots = 1, forbidden = [], requiredTypes = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), `ghrab-reporter-zip-${process.pid}-`));
  const zipPath = join(dir, `${label}.zip`);
  writeFileSync(zipPath, Buffer.from(base64, 'base64'));
  const names = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
  for (const required of ['00-PREHLED-HLASENI.html', 'hlaseni.txt', 'technicke-udaje.json']) {
    if (!names.includes(required)) throw new Error(`${label}: ZIP neobsahuje ${required}`);
  }
  const screenshots = names.filter((name) => /^screenshot-\d\d\.jpg$/.test(name));
  if (screenshots.length !== expectedScreenshots) throw new Error(`${label}: očekáváno ${expectedScreenshots} screenshotů, nalezeno ${screenshots.length}`);
  const metadataText = execFileSync('unzip', ['-p', zipPath, 'technicke-udaje.json'], { encoding: 'utf8' });
  const reportText = execFileSync('unzip', ['-p', zipPath, 'hlaseni.txt'], { encoding: 'utf8' });
  const overview = execFileSync('unzip', ['-p', zipPath, '00-PREHLED-HLASENI.html'], { encoding: 'utf8' });
  const metadata = JSON.parse(metadataText);
  if (metadata.appId !== config.appId || metadata.appVersion !== config.version) throw new Error(`${label}: nesprávná identita aplikace`);
  if (!metadata.reportId || !metadata.createdAt) throw new Error(`${label}: chybí ID nebo čas`);
  if (/[?#]/.test(metadata.page) || /@|%40/i.test(metadata.page)) throw new Error(`${label}: URL není bezpečná`);
  if (!metadata.viewport?.width || !metadata.screen?.width || !metadata.browser || !metadata.platform || typeof metadata.online !== 'boolean') throw new Error(`${label}: chybí technické prostředí`);
  const types = new Set((metadata.technicalErrors || []).map((item) => item.type));
  for (const type of requiredTypes) if (!types.has(type)) throw new Error(`${label}: chybí technická chyba typu ${type}`);
  const allText = `${metadataText}\n${reportText}\n${overview}`;
  for (const secret of forbidden) if (allText.includes(secret)) throw new Error(`${label}: citlivý testovací údaj unikl do ZIPu: ${secret}`);
  rmSync(dir, { recursive: true, force: true });
  return { names, metadata, allText };
}

async function runBrowserTests() {
  if (!existsSync(CHROMIUM)) throw new Error(`Chromium není dostupné: ${CHROMIUM}`);
  check('Build obsahuje přímý vstup aplikace', pathExists(config.distEntry), config.distEntry);
  for (const path of config.distCachePaths || []) check(`Build obsahuje ${path}`, pathExists(path));
  for (const path of config.extraDistEntries || []) {
    const source = text(path);
    const runtimeIntegrations = count(source, /startReporterBestEffort/g) + count(source, /await\s+import\(['"][^'"]*error-reporter-adapter\.js['"]\)/g);
    check(`${path}: jedna best-effort lokální integrace bez centrální instance`, /errorReporter\s*:\s*false/.test(source) && runtimeIntegrations >= 1, `integrací: ${runtimeIntegrations}`);
  }

  const { server, port } = await startServer();
  const debugPort = 12000 + (process.pid % 2000);
  const profile = mkdtempSync(join(tmpdir(), `ghrab-chromium-profile-${process.pid}-`));
  const downloadDir = mkdtempSync(join(tmpdir(), `ghrab-browser-downloads-${process.pid}-`));
  const chrome = spawn(CHROMIUM, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--disable-default-apps', '--no-first-run', '--no-proxy-server',
    '--disable-background-networking', '--disable-component-update',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore'] });

  let client;
  const runtimeExceptions = [];
  try {
    const version = await waitJson(`http://127.0.0.1:${debugPort}/json/version`);
    const page = await waitPageTarget(`http://127.0.0.1:${debugPort}/json`, version.webSocketDebuggerUrl);
    client = new CdpClient(page.webSocketDebuggerUrl);
    await client.open();
    client.on('Runtime.exceptionThrown', (params) => runtimeExceptions.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || 'unknown'));
    await client.call('Runtime.enable');
    await client.call('Page.enable');
    await client.call('DOM.enable');
    await client.call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir, eventsEnabled: true });

    const appBase = `http://127.0.0.1:${port}`;
    const localBase = `http://127.0.0.1:${port}`;
    await navigate(client, `${appBase}/harness.html?student=student.fixture%40example.test#SECRET_HASH_FIXTURE`);
    await waitFor(client, 'window.__harnessReady === true && document.querySelector("#ghrab-error-reporter")', 'Reportér se v harnessu nespustil');

    const initial = await client.evaluate(`(() => {
      const root = document.getElementById('ghrab-error-reporter');
      const ids = [...document.querySelectorAll('[id]')].map((node) => node.id);
      return {
        roots: document.querySelectorAll('#ghrab-error-reporter').length,
        launchers: root.querySelectorAll('.ghrab-report-button.launcher').length,
        launcherLabel: root.querySelector('.ghrab-report-button.launcher')?.getAttribute('aria-label') || '',
        panels: root.querySelectorAll('.ghrab-report-panel').length,
        duplicateIds: [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))],
        listeners: window.__listenerCounts,
        fetchWrappedOnce: window.__duplicateSetupKeptFetch,
      };
    })()`);
    check('Právě jedna instance, jedno tlačítko a jeden dialog', initial.roots === 1 && initial.launchers === 1 && initial.panels === 1, JSON.stringify(initial));
    check('Spouštěcí tlačítko má přístupný název', Boolean(initial.launcherLabel.trim()), initial.launcherLabel);
    check('Právě jedna sada posluchačů technických chyb', initial.listeners.error === 1 && initial.listeners.unhandledrejection === 1 && initial.fetchWrappedOnce === true, JSON.stringify(initial.listeners));
    check('Žádná duplicitní ID v reportéru', initial.duplicateIds.length === 0, initial.duplicateIds.join(', '));

    const ui = await client.evaluate(`(async () => {
      const root = document.getElementById('ghrab-error-reporter');
      const wait = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
      const until = async (test, label, loops = 160) => { for (let i = 0; i < loops; i += 1) { if (test()) return; await wait(25); } throw new Error(label); };
      const byText = (selector, value) => [...root.querySelectorAll(selector)].find((node) => node.textContent.trim() === value);
      const assert = (condition, message) => { if (!condition) throw new Error(message); };
      const rgb = (value) => (value.match(/[\\d.]+/g) || []).slice(0, 3).map(Number);
      const luminance = (triplet) => { const values = triplet.map((value) => { const s = value / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2]; };
      const contrast = (a, b) => { const x = luminance(rgb(a)); const y = luminance(rgb(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
      const launcher = root.querySelector('.launcher');
      const backdrop = root.querySelector('.ghrab-report-backdrop');
      const closeX = root.querySelector('.ghrab-report-header .icon');
      const footerClose = root.querySelector('.ghrab-report-footer button');
      const discard = root.querySelector('.ghrab-discard-backdrop');
      const textareas = root.querySelectorAll('textarea');
      const comment = textareas[0];
      const steps = textareas[1];
      const upload = root.querySelector('input[type=file]');
      launcher.click(); await wait(80);

      window.__themeLight(); await wait(80);
      assert(root.dataset.theme === 'light', 'Světlý motiv se neaplikoval');
      const lightStyle = getComputedStyle(comment);
      const lightContrast = contrast(lightStyle.color, lightStyle.backgroundColor);
      assert(lightContrast >= 4.5, 'Nízký kontrast světlého textového pole: ' + lightContrast);
      window.__themeDark(); await wait(80);
      assert(root.dataset.theme === 'dark', 'Tmavý motiv se za běhu neaplikoval');
      const darkStyle = getComputedStyle(comment);
      const darkContrast = contrast(darkStyle.color, darkStyle.backgroundColor);
      assert(darkContrast >= 4.5, 'Nízký kontrast tmavého textového pole: ' + darkContrast);
      window.__themeLight(); await wait(60);

      byText('button', 'Povolit snímání obrazovky').click();
      await until(() => !byText('button', 'Přejít do aplikace').disabled, 'Snímání se neaktivovalo');
      const captureVideo = root.querySelector(':scope > video.ghrab-capture-video');
      assert(captureVideo && captureVideo.getAttribute('aria-hidden') === 'true', 'Pomocné video není uvnitř reportéru nebo není skryté pro asistivní technologie');
      const captureVideoStyle = getComputedStyle(captureVideo);
      const captureVideoRect = captureVideo.getBoundingClientRect();
      assert(captureVideoStyle.opacity === '0' && captureVideoStyle.visibility === 'hidden' && captureVideoStyle.pointerEvents === 'none' && captureVideoRect.right <= 0, 'Pomocné video je viditelné a může vytvořit zrcadlovou chodbu');
      document.body.style.minHeight = '2400px';
      window.scrollTo(0, 900);
      await wait(80);
      const captureVideoAfterScroll = captureVideo.getBoundingClientRect();
      const captureStyleAfterScroll = getComputedStyle(captureVideo);
      assert(root.contains(captureVideo) && captureVideoAfterScroll.right <= 0 && captureStyleAfterScroll.opacity === '0' && captureStyleAfterScroll.visibility === 'hidden' && captureStyleAfterScroll.pointerEvents === 'none', 'Po scrollování se pomocné video dostalo do obrazu nebo mimo kořen reportéru');
      window.scrollTo(0, 0);
      assert(!backdrop.hidden, 'Povolení snímání nesmí samo skrýt hlášení');
      assert(root.querySelector('.ghrab-capture-bar').hidden, 'Panel se zobrazil před explicitním přechodem');
      byText('.ghrab-report-section button', 'Pořídit snímek').click();
      await until(() => root.querySelectorAll('.ghrab-screenshot-card').length === 1, 'Snímek z otevřeného hlášení se nepřidal');
      assert(root.querySelector('.ghrab-report-status').textContent.includes('Snímek 1/5'), 'Pořízení snímku nemá viditelnou odezvu');
      assert(root.querySelectorAll('.ghrab-report-status').length === 1 && root.querySelectorAll('.ghrab-report-final').length === 1, 'Reportér vytváří duplicitní stavová oznámení');
      root.querySelector('.ghrab-screenshot-card button.danger').click();
      assert(root.querySelectorAll('.ghrab-screenshot-card').length === 0, 'Testovací screenshot se nepodařilo odstranit');
      byText('button', 'Přejít do aplikace').click(); await wait(60);
      assert(backdrop.hidden && !root.querySelector('.ghrab-capture-bar').hidden, 'Přejít do aplikace neotevřelo plovoucí panel');
      byText('.ghrab-capture-bar button', 'Pořídit snímek').click();
      await until(() => root.querySelectorAll('.ghrab-screenshot-card').length === 1, 'Přímý screenshot se nepřidal');
      assert(window.__captureHiddenObserved, 'Reportér nebyl při samotném screenshotu skryt');
      assert(root.querySelector('.ghrab-capture-bar-state strong').textContent.includes('Snímek uložen'), 'Plovoucí panel nepotvrdil uložení snímku');
      byText('.ghrab-capture-bar button', 'Zpět k hlášení').click(); await wait(50);
      assert(!backdrop.hidden, 'Návrat do hlášení selhal');
      byText('.ghrab-report-section button', 'Ukončit snímání').click(); await wait(40);

      const pngBytes = Uint8Array.from(atob(${JSON.stringify(TINY_PNG.toString('base64'))}), (character) => character.charCodeAt(0));
      const addFiles = async (number, prefix) => {
        const transfer = new DataTransfer();
        for (let i = 0; i < number; i += 1) transfer.items.add(new File([pngBytes], prefix + '-' + i + '.png', { type: 'image/png' }));
        upload.files = transfer.files;
        upload.dispatchEvent(new Event('change', { bubbles: true }));
      };
      await addFiles(5, 'limit');
      await until(() => root.querySelectorAll('.ghrab-screenshot-card').length === 5, 'Limit pěti screenshotů nebyl dosažen');
      await addFiles(1, 'sixth'); await wait(120);
      assert(root.querySelectorAll('.ghrab-screenshot-card').length === 5, 'Byl překročen limit pěti screenshotů');
      assert(root.querySelectorAll('.ghrab-screenshot-card img').length === 5, 'Chybí náhledy screenshotů');
      root.querySelector('.ghrab-screenshot-card button.small:not(.danger)').click();
      await until(() => !root.querySelector('.ghrab-redaction-backdrop').hidden, 'Editor začernění se neotevřel');
      byText('.ghrab-redaction-backdrop button', 'Zrušit').click();
      root.querySelector('.ghrab-screenshot-card button.danger').click();
      assert(root.querySelectorAll('.ghrab-screenshot-card').length === 4, 'Odstranění screenshotu selhalo');
      await addFiles(1, 'replacement');
      await until(() => root.querySelectorAll('.ghrab-screenshot-card').length === 5, 'Náhradní screenshot se nepřidal');

      comment.value = 'Anonymizovaný test hlášení chyby v aplikaci.';
      comment.dispatchEvent(new Event('input', { bubbles: true }));
      steps.value = '1. Otevřít test. 2. Kliknout. 3. Pozorovat chybu.';
      steps.dispatchEvent(new Event('input', { bubbles: true }));
      const samePrompt = async (action, label) => {
        action(); await wait(50);
        assert(!discard.hidden, label + ': neotevřel se potvrzovací dialog');
        byText('.ghrab-discard-backdrop button', 'Zpět do hlášení').click(); await wait(30);
        assert(discard.hidden && !backdrop.hidden, label + ': návrat do hlášení selhal');
      };
      await samePrompt(() => closeX.click(), 'křížek');
      await samePrompt(() => footerClose.click(), 'tlačítko Zavřít');
      await samePrompt(() => backdrop.click(), 'kliknutí mimo dialog');
      await samePrompt(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), 'Escape');

      const idBeforeKeep = root.querySelector('button.ghrab-report-button.primary[data-support-email]').dataset.reportId;
      footerClose.click(); await wait(30);
      byText('.ghrab-discard-backdrop button', 'Ponechat rozepsané a zavřít').click(); await wait(40);
      launcher.click(); await wait(40);
      assert(comment.value.includes('Anonymizovaný test'), 'Ponechaný koncept ztratil popis');
      assert(steps.value.includes('Otevřít test'), 'Ponechaný koncept ztratil postup');
      assert(root.querySelectorAll('.ghrab-screenshot-card').length === 5, 'Ponechaný koncept ztratil screenshoty');
      assert(root.querySelector('button.ghrab-report-button.primary[data-support-email]').dataset.reportId === idBeforeKeep, 'Ponechaný koncept změnil ID');

      window.dispatchEvent(new ErrorEvent('error', { message: 'JS_MARKER', filename: location.origin + '/safe-script.js', lineno: 7, colno: 3 }));
      const rejection = new Event('unhandledrejection');
      Object.defineProperty(rejection, 'reason', { value: new Error('PROMISE_MARKER') });
      window.dispatchEvent(rejection);
      await fetch('/http-failure');
      try { await fetch('/network-failure'); } catch {}
      window.GHRABErrorReporter.recordTechnicalError({
        type: 'custom',
        message: 'OLD_DRAFT_MARKER ' + ${JSON.stringify(TEST_SENSITIVE_EMAIL)} + ' api_key=ANON_KEY_TOKEN prompt: ANON_PROMPT_TOKEN',
        source: location.origin + '/private/' + encodeURIComponent(${JSON.stringify(TEST_SENSITIVE_EMAIL)}) + '?token=SECRET_QUERY',
      });
      await wait(80);

      const primary = root.querySelector('button.ghrab-report-button.primary[data-support-email]');
      assert(primary.tagName === 'BUTTON' && primary.textContent.includes('Připravit ZIP'), 'Primární akce není tlačítko pro přípravu ZIP');
      assert(primary.dataset.supportEmail === 'balaz@ghrabuvka.cz', 'Tlačítko nemá správného příjemce pro následný Gmail koncept');
      return { lightContrast, darkContrast, idBeforeKeep };
    })()`);
    check('Světlý režim, tmavý režim a změna motivu za běhu', ui.lightContrast >= 4.5 && ui.darkContrast >= 4.5, `kontrast ${ui.lightContrast.toFixed(2)} / ${ui.darkContrast.toFixed(2)}`);
    check('Screenshot workflow, limit 5, návrat, náhled, odstranění a editor', true);
    check('Všechny čtyři způsoby zavření používají stejný dialog', true);
    check('Ponechání konceptu zachová text, screenshoty a ID', true, ui.idBeforeKeep);
    check('Primární akce před otevřením Gmailu pouze připravuje ZIP', true);

    const clickBox = await client.evaluate(`(() => {
      const control = document.querySelector('#ghrab-error-reporter button.ghrab-report-button.primary[data-support-email]');
      control.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = control.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    await client.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: clickBox.x, y: clickBox.y, button: 'left', clickCount: 1 });
    await client.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: clickBox.x, y: clickBox.y, button: 'left', clickCount: 1 });
    await waitFor(client, 'document.querySelector(".ghrab-report-final a[data-report-download=zip]") && document.querySelector(".ghrab-report-mail-step")?.hidden === true', 'ZIP se nepřipravil do samostatného kroku', 400);
    const staged = await client.evaluate(`(() => {
      const root = document.getElementById('ghrab-error-reporter');
      const download = root.querySelector('a[data-report-download=zip]');
      const gmail = [...root.querySelectorAll('.ghrab-report-mail-step a')].find((node) => node.textContent.includes('otevřít Gmail'));
      const parsed = new URL(gmail.href);
      return {
        downloadName: download.download,
        mailHidden: root.querySelector('.ghrab-report-mail-step').hidden,
        gmailHref: gmail.href,
        recipient: parsed.searchParams.get('to'),
        subject: parsed.searchParams.get('su'),
        body: parsed.searchParams.get('body'),
      };
    })()`);
    check('Gmail zůstává skrytý, dokud uživatel nestáhne ZIP', staged.mailHidden && staged.downloadName.endsWith('.zip'));
    check('Předvyplněný Gmail má správného příjemce a upozornění na přílohu', staged.gmailHref.includes('mail.google.com') && staged.recipient === 'balaz@ghrabuvka.cz' && staged.subject.includes(ui.idBeforeKeep) && staged.body.includes('PŘÍLOHA NENÍ PŘIPOJENA AUTOMATICKY'));

    const firstDownloadSnapshot = zipDownloadSnapshot(downloadDir);
    const downloadBox = await client.evaluate(`(() => {
      const link = document.querySelector('#ghrab-error-reporter a[data-report-download=zip]');
      link.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = link.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    await client.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: downloadBox.x, y: downloadBox.y, button: 'left', clickCount: 1 });
    await client.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: downloadBox.x, y: downloadBox.y, button: 'left', clickCount: 1 });
    await waitFor(client, 'document.querySelector(".ghrab-report-mail-step")?.hidden === false', 'Přímé stažení ZIP neodemklo Gmail', 400);
    const firstDownload = await waitForZipDownload(downloadDir, firstDownloadSnapshot, 'Chromium fyzicky nestáhl první ZIP');

    const beforeTargets = new Set((await waitJson(`http://127.0.0.1:${debugPort}/json`)).filter((item) => item.type === 'page').map((item) => item.id));
    const gmailBox = await client.evaluate(`(() => {
      const link = [...document.querySelectorAll('#ghrab-error-reporter .ghrab-report-mail-step a')].find((node) => node.textContent.includes('otevřít Gmail'));
      link.href = ${JSON.stringify(`${appBase}/new-tab.html`)};
      link.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = link.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    await client.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: gmailBox.x, y: gmailBox.y, button: 'left', clickCount: 1 });
    await client.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: gmailBox.x, y: gmailBox.y, button: 'left', clickCount: 1 });
    let openedTarget = null;
    for (let index = 0; index < 100; index += 1) {
      const targets = await waitJson(`http://127.0.0.1:${debugPort}/json`);
      openedTarget = targets.find((item) => item.type === 'page' && !beforeTargets.has(item.id));
      if (openedTarget) break;
      await sleep(50);
    }
    check('Gmail se otevře až samostatným fyzickým kliknutím po stažení', Boolean(openedTarget), openedTarget?.url || 'žádný nový target');
    const prepared = await client.evaluate(`(() => {
      const root = document.getElementById('ghrab-error-reporter');
      const final = root.querySelector('.ghrab-report-final');
      const links = [...final.querySelectorAll('a')].map((node) => ({ text: node.textContent.trim(), href: node.href, target: node.target }));
      const copy = [...final.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Zkopírovat údaje e-mailu');
      copy.click();
      return new Promise((resolve) => setTimeout(() => resolve({
        links, clipboard: window.__clipboardText,
      }), 80));
    })()`);
    check('Po stažení jsou dostupné Gmail / poštovní aplikace / kopírování', prepared.links.some((item) => item.text.includes('otevřít Gmail')) && prepared.links.some((item) => item.text === 'Otevřít poštovní aplikaci' && item.href.startsWith('mailto:')) && prepared.clipboard.includes('balaz@ghrabuvka.cz'));

    const zip1 = inspectZip(firstDownload.base64, 'first-draft', {
      expectedScreenshots: 5,
      requiredTypes: ['javascript', 'promise', 'http', 'network'],
      forbidden: [
        TEST_SENSITIVE_EMAIL, 'ANON_KEY_TOKEN', 'ANON_PROMPT_TOKEN',
        'ANON_ORIGINAL_TEXT_TOKEN', 'ANON_MODEL_OUTPUT_TOKEN',
        'ANON_DOCUMENT_TOKEN', 'ANON_PERSON_TOKEN', 'SECRET_HASH_FIXTURE', 'SECRET_QUERY',
      ],
    });
    check('Stažený ZIP má přesný obsah a bezpečná metadata', zip1.names.length === 8, `${zip1.names.length} souborů`);
    check('ZIP zachytil JS, Promise, HTTP a síťové chyby bez citlivých dat', zip1.metadata.technicalErrors.length >= 4);
    check('Prohlížeč fyzicky stáhl ZIP na původní kartě', firstDownload.filename.toLowerCase().endsWith('.zip'), firstDownload.filename);

    const reset = await client.evaluate(`(async () => {
      const root = document.getElementById('ghrab-error-reporter');
      const wait = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
      const byText = (selector, value) => [...root.querySelectorAll(selector)].find((node) => node.textContent.trim() === value);
      root.querySelector('.ghrab-report-footer button').click(); await wait();
      byText('.ghrab-discard-backdrop button', 'Smazat hlášení a zavřít').click(); await wait();
      root.querySelector('.launcher').click(); await wait();
      const textareas = root.querySelectorAll('textarea');
      const clean = {
        description: textareas[0].value,
        steps: textareas[1].value,
        screenshots: root.querySelectorAll('.ghrab-screenshot-card').length,
        finalHidden: root.querySelector('.ghrab-report-final').hidden,
        newId: root.querySelector('button.ghrab-report-button.primary[data-support-email]').dataset.reportId,
      };
      textareas[0].value = 'Druhý anonymizovaný koncept po úplném smazání.';
      textareas[0].dispatchEvent(new Event('input', { bubbles: true }));
      const pngBytes = Uint8Array.from(atob(${JSON.stringify(TINY_PNG.toString('base64'))}), (character) => character.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([pngBytes], 'second-draft.png', { type: 'image/png' }));
      const upload = root.querySelector('input[type=file]');
      upload.files = transfer.files;
      upload.dispatchEvent(new Event('change', { bubbles: true }));
      for (let i = 0; i < 160 && root.querySelectorAll('.ghrab-screenshot-card').length !== 1; i += 1) await wait(25);
      return clean;
    })()`);
    check('Úplné smazání otevře čistý formulář', reset.description === '' && reset.steps === '' && reset.screenshots === 0 && reset.finalHidden === true, JSON.stringify(reset));
    check('Po smazání vznikne nové ID', reset.newId && reset.newId !== ui.idBeforeKeep, `${ui.idBeforeKeep} → ${reset.newId}`);

    const secondBox = await client.evaluate(`(() => {
      const control = document.querySelector('#ghrab-error-reporter button.ghrab-report-button.primary[data-support-email]');
      control.scrollIntoView({ block: 'center' });
      const rect = control.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    await client.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: secondBox.x, y: secondBox.y, button: 'left', clickCount: 1 });
    await client.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: secondBox.x, y: secondBox.y, button: 'left', clickCount: 1 });
    await waitFor(client, 'document.querySelector("#ghrab-error-reporter a[data-report-download=zip]")', 'Druhý ZIP se nepřipravil', 400);
    const secondDownloadSnapshot = zipDownloadSnapshot(downloadDir);
    const secondDownloadBox = await client.evaluate(`(() => {
      const link = document.querySelector('#ghrab-error-reporter a[data-report-download=zip]');
      link.scrollIntoView({ block: 'center' });
      const rect = link.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    await client.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: secondDownloadBox.x, y: secondDownloadBox.y, button: 'left', clickCount: 1 });
    await client.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: secondDownloadBox.x, y: secondDownloadBox.y, button: 'left', clickCount: 1 });
    const secondDownload = await waitForZipDownload(downloadDir, secondDownloadSnapshot, 'Chromium fyzicky nestáhl druhý ZIP');
    const zip2 = inspectZip(secondDownload.base64, 'second-draft', {
      expectedScreenshots: 1,
      forbidden: ['OLD_DRAFT_MARKER', TEST_SENSITIVE_EMAIL, 'ANON_KEY_TOKEN', 'ANON_PROMPT_TOKEN'],
    });
    check('Smazané technické chyby ani původní ID se nevrátily', !zip2.allText.includes('OLD_DRAFT_MARKER') && zip2.metadata.reportId === reset.newId);
    const beforeSecondTargets = new Set((await waitJson(`http://127.0.0.1:${debugPort}/json`)).filter((item) => item.type === 'page').map((item) => item.id));
    const secondGmailBox = await client.evaluate(`(() => {
      const link = [...document.querySelectorAll('#ghrab-error-reporter .ghrab-report-mail-step a')].find((node) => node.textContent.includes('otevřít Gmail'));
      link.href = ${JSON.stringify(`${appBase}/new-tab.html?second=1`)};
      link.scrollIntoView({ block: 'center' });
      const rect = link.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    await client.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: secondGmailBox.x, y: secondGmailBox.y, button: 'left', clickCount: 1 });
    await client.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: secondGmailBox.x, y: secondGmailBox.y, button: 'left', clickCount: 1 });
    let secondOpened = false;
    for (let index = 0; index < 100; index += 1) {
      const targets = await waitJson(`http://127.0.0.1:${debugPort}/json`);
      secondOpened = targets.some((item) => item.type === 'page' && !beforeSecondTargets.has(item.id));
      if (secondOpened) break;
      await sleep(50);
    }
    check('Druhý Gmail se opět otevře až po samostatném kliknutí', secondOpened);

    await client.call('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 1, mobile: true });
    const mobile = await client.evaluate(`(async () => {
      const root = document.getElementById('ghrab-error-reporter');
      const wait = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
      const byText = (selector, value) => [...root.querySelectorAll(selector)].find((node) => node.textContent.trim() === value);
      byText('button', 'Povolit snímání obrazovky').click();
      for (let i = 0; i < 120 && byText('button', 'Přejít do aplikace').disabled; i += 1) await wait(25);
      byText('button', 'Přejít do aplikace').click(); await wait(60);
      const bar = root.querySelector('.ghrab-capture-bar');
      const rect = bar.getBoundingClientRect();
      const result = { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, vw: innerWidth, vh: innerHeight };
      byText('.ghrab-capture-bar button', 'Ukončit snímání').click();
      return result;
    })()`);
    check('Plovoucí panel je responzivní a uvnitř bezpečných okrajů', mobile.left >= 0 && mobile.right <= mobile.vw + 0.5 && mobile.bottom <= mobile.vh + 0.5 && mobile.width <= mobile.vw, JSON.stringify(mobile));
    await client.call('Emulation.clearDeviceMetricsOverride');

    const supportHits = await fetch(`${localBase}/__support-hits`).then((response) => response.json());
    check('Reportér přednostně načetl centrální support.json', supportHits.supportHits >= 1, JSON.stringify(supportHits));
    await fetch(`${localBase}/__support-mode?mode=404`);
    await navigate(client, `${appBase}/harness.html?fallback=1`);
    await waitFor(client, 'window.__harnessReady === true', 'Fallback harness se nespustil');
    await waitFor(client, 'document.querySelector("#ghrab-error-reporter button.ghrab-report-button.primary[data-support-email]")?.dataset.supportEmail === "balaz@ghrabuvka.cz"', 'Fallback e-mail se nepoužil');
    check('Při nedostupném support.json se použije bezpečný fallback', true, 'balaz@ghrabuvka.cz');
    await fetch(`${localBase}/__support-mode?mode=ok`);

    runtimeExceptions.length = 0;
    await navigate(client, `${appBase}/${config.distEntry}`);
    await waitFor(client, 'document.querySelectorAll("#ghrab-error-reporter").length === 1', 'Samostatné spuštění nevytvořilo reportér', 400);
    await sleep(500);
    const standalone = await client.evaluate(`(() => {
      const ids = [...document.querySelectorAll('[id]')].map((node) => node.id);
      return {
        roots: document.querySelectorAll('#ghrab-error-reporter').length,
        launchers: document.querySelectorAll('#ghrab-error-reporter .launcher').length,
        duplicateReporterIds: ids.filter((id, index) => id === 'ghrab-error-reporter' && ids.indexOf(id) !== index).length,
      };
    })()`);
    check('Samostatné spuštění aplikace má právě jeden reportér', standalone.roots === 1 && standalone.launchers === 1 && standalone.duplicateReporterIds === 0, JSON.stringify(standalone));
    check('Samostatné spuštění nemá runtime výjimku reportéru', runtimeExceptions.length === 0, runtimeExceptions.join(' | '));

    runtimeExceptions.length = 0;
    await navigate(client, `${appBase}/embed.html?entry=${encodeURIComponent(`/${config.distEntry}`)}`);
    await waitFor(client, `(() => { const frame = document.getElementById('app'); return frame?.contentDocument?.querySelectorAll('#ghrab-error-reporter').length === 1; })()`, 'Spuštění přes AI Studio iframe nevytvořilo reportér', 500);
    await sleep(500);
    const embedded = await client.evaluate(`(() => {
      const win = document.getElementById('app').contentWindow;
      const doc = win.document;
      const calls = win.__guardCalls || [];
      return {
        roots: doc.querySelectorAll('#ghrab-error-reporter').length,
        launchers: doc.querySelectorAll('#ghrab-error-reporter .launcher').length,
        guardCalls: calls.length,
        centralDisabled: calls.every((call) => call.options?.errorReporter === false),
      };
    })()`);
    check('Spuštění přes AI Studio má jedinou lokální instanci a vypnutou centrální', embedded.roots === 1 && embedded.launchers === 1 && embedded.guardCalls >= 1 && embedded.centralDisabled, JSON.stringify(embedded));
    check('Spuštění přes AI Studio nemá runtime výjimku reportéru', runtimeExceptions.length === 0, runtimeExceptions.join(' | '));

    for (const entry of config.browserExtraEntries || []) {
      runtimeExceptions.length = 0;
      await navigate(client, `${appBase}/${entry}`);
      await waitFor(client, 'document.querySelectorAll("#ghrab-error-reporter").length === 1', `${entry}: reportér se nespustil`, 400);
      check(`${entry}: právě jedna instance reportéru`, (await client.evaluate('document.querySelectorAll("#ghrab-error-reporter").length')) === 1);
      check(`${entry}: bez runtime výjimky reportéru`, runtimeExceptions.length === 0, runtimeExceptions.join(' | '));
    }
  } finally {
    try { client?.close(); } catch {}
    chrome.kill('SIGKILL');
    server.close();
    await sleep(250);
    rmSync(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
    rmSync(downloadDir, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  }
}

let browser = browserEnvironmentStatus();
try {
  staticAudit();
  if (browser.status === 'ready') {
    await runBrowserTests();
    browser = { status: 'passed', reason: '' };
  } else {
    console.log(`NOT_READY: Prohlížečová část reportéru nebyla spuštěna — ${browser.reason}`);
  }
} catch (error) {
  browser = { status: 'failed', reason: error.message || String(error) };
  if (!failures.length || !failures.at(-1)?.detail?.includes(error.message)) {
    record('Neočekávaná chyba regresního testu', false, error.stack || String(error));
  }
} finally {
  const report = {
    schema: 'ghrab-error-reporter-test-v1',
    appId: config.appId,
    appName: config.appName,
    version: config.version,
    createdAt: new Date().toISOString(),
    browser,
    passed: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
    results,
  };
  mkdirSync(join(ROOT, 'test-results'), { recursive: true });
  writeFileSync(join(ROOT, 'test-results', 'error-reporter.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nSouhrn reportéru ${config.appName} ${config.version}: ${report.passed} PASS / ${report.failed} FAIL`);
  if (report.failed) process.exitCode = 1;
}

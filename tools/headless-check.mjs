import { spawn } from 'node:child_process';
import path from 'node:path';
import { startStaticServer } from '../scripts/qa-core.mjs';

const root = path.resolve('dist');
const { server, baseUrl } = await startStaticServer(root, { qaAppId: 'lesson-hub' });
let exitCode = 1;

async function run(command, args, env = {}) {
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: { ...process.env, ...env },
    });
    child.on('exit', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}

function qaRoute(route) {
  if (!route.startsWith("/index.html")) return route;
  const hashIndex = route.indexOf("#");
  const beforeHash = hashIndex >= 0 ? route.slice(0, hashIndex) : route;
  const hash = hashIndex >= 0 ? route.slice(hashIndex) : "";
  return `${beforeHash}${beforeHash.includes("?") ? "&" : "?"}qa=1${hash}`;
}

function expectedHashRoute(route) {
  const hashIndex = route.indexOf("#");
  if (hashIndex < 0) return "";
  return route.slice(hashIndex + 1).replace(/^\/?/, "") || "overview";
}

async function waitForMainApp(page, route, timeout = 20000) {
  const expectedRoute = expectedHashRoute(route);
  await page.waitForFunction(
    (routeKey) => {
      const app = document.querySelector("#app");
      return Boolean(
        document.documentElement.dataset.ghrabAccess === "granted" &&
        app &&
        !app.hasAttribute("aria-busy") &&
        app.dataset.renderedRoute === routeKey &&
        getComputedStyle(document.body).visibility !== "hidden"
      );
    },
    expectedRoute,
    { timeout },
  );
}

try {
  try {
    const { chromium } = await import('playwright');
    console.log('HEADLESS_RUNTIME: node-playwright');
    const browser = await chromium.launch({ headless: true });
    const scenarios = [
      ['/index.html#/overview', 'Připravte Lesson Hub na svou výuku'],
      ['/index.html#/groups', 'Skupiny'],
      ['/index.html#/diagnostics', 'Interní diagnostika Lesson Hubu'],
      ['/index.html#/data', 'Úplný export databáze'],
      ['/manual/index.html', 'Interaktivní manuál'],
    ];
    let failed = false;
    for (const [route, expected] of scenarios) {
      const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, serviceWorkers: 'block' });
      const page = await context.newPage();
      const errors = [];
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('**/*', async (requestRoute) => {
        const pathname = new URL(requestRoute.request().url()).pathname;
        if (pathname.endsWith('/AI-Studio-GHRAB/access/access-gate.css')) {
          await requestRoute.fulfill({ status: 200, contentType: 'text/css', body: '' });
        } else if (pathname.endsWith('/AI-Studio-GHRAB/config/support.json')) {
          await requestRoute.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ supportEmail: 'balaz@ghrabuvka.cz' }) });
        } else if (pathname.endsWith('/AI-Studio-GHRAB/config/apps.generated.json')) {
          await requestRoute.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'lesson-hub', version: '1.2.16', name: { cs: 'Lesson Hub', en: 'Lesson Hub' } }]) });
        } else {
          await requestRoute.continue();
        }
      });
      const targetRoute = qaRoute(route);
      const response = await page.goto(`${baseUrl}${targetRoute}`, { waitUntil: 'networkidle', timeout: 20000 });
      if (route.startsWith('/index.html')) await waitForMainApp(page, route);
      else await page.getByText(expected, { exact: false }).first().waitFor({ state: 'visible', timeout: 20000 });
      const body = await page.textContent('body');
      const access = route.startsWith('/index.html')
        ? await page.evaluate(() => document.documentElement.dataset.ghrabAccess || '')
        : 'granted';
      const localErrors = errors.filter((message) => /404|Failed to load resource/.test(message));
      const ok = response?.ok() && body?.includes(expected) && access === 'granted' && !localErrors.length;
      console.log(`${ok ? 'PASS' : 'FAIL'} ${route}`);
      if (!ok) {
        failed = true;
        console.error(JSON.stringify({ route, expectedPresent: Boolean(body?.includes(expected)), access, localErrors, errors }, null, 2));
      }
      await context.close();
    }
    await browser.close();
    exitCode = failed ? 1 : 0;
  } catch (nodeError) {
    console.warn(`Node Playwright není dostupný (${nodeError.code || nodeError.message}); používám Python Playwright.`);
    console.log('HEADLESS_RUNTIME: python-playwright-fallback');
    exitCode = await run('python3', ['tools/headless_check.py'], { LESSON_HUB_BASE_URL: baseUrl });
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}

if (exitCode) process.exit(exitCode);
console.log('Headless smoke test prošel.');

import { spawn } from 'node:child_process';
import path from 'node:path';
import { startStaticServer } from '../scripts/qa-core.mjs';

const root = path.resolve('dist');
const { server, baseUrl } = await startStaticServer(root);
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

try {
  try {
    const { chromium } = await import('playwright');
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
      const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
      const errors = [];
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('pageerror', (error) => errors.push(error.message));
      const response = await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle', timeout: 20000 });
      const body = await page.textContent('body');
      const access = await page.evaluate(() => document.documentElement.dataset.ghrabAccess || '');
      const localErrors = errors.filter((message) => /404|Failed to load resource/.test(message));
      const ok = response?.ok() && body?.includes(expected) && access === 'granted' && !localErrors.length;
      console.log(`${ok ? 'PASS' : 'FAIL'} ${route}`);
      if (!ok) failed = true;
      await page.close();
    }
    await browser.close();
    exitCode = failed ? 1 : 0;
  } catch (nodeError) {
    console.warn(`Node Playwright není dostupný (${nodeError.code || nodeError.message}); používám Python Playwright.`);
    exitCode = await run('python3', ['tools/headless_check.py'], { LESSON_HUB_BASE_URL: baseUrl });
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}

if (exitCode) process.exit(exitCode);
console.log('Headless smoke test prošel.');

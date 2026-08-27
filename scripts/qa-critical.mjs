import { spawn } from 'node:child_process';

let playwrightAvailable = true;
try {
  await import('playwright');
} catch (error) {
  playwrightAvailable = false;
  console.warn(`Node Playwright není dostupný (${error.code || error.message}); používám Python QA fallback.`);
}

if (playwrightAvailable) {
  await import('./qa-critical-playwright.mjs');
} else {
  const code = await new Promise((resolve) => {
    const child = spawn('sh', ['tools/qa_critical_fallback.sh'], { stdio: 'inherit', env: process.env });
    child.on('exit', (status) => resolve(status ?? 1));
    child.on('error', () => resolve(1));
  });
  if (code) process.exit(code);
}

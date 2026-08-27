import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const required = [
  'index.html',
  'src/bootstrap.js',
  'src/main.js',
  'src/styles.css',
  'src/core/access.js',
  'src/core/database.js',
  'src/core/studioBridge.js',
  'src/core/release.js',
  'src/repositories/BaseRepository.js',
  'src/ui/layout.js',
  'public/manifest.webmanifest',
  'public/sw.js',
  'public/manual/index.html',
  'studio/app-manifest.template.json',
  'qa/qa-manifest.json',
  'src/services/serverService.js',
  'src/pages/server.js',
  'server/app.mjs',
  'server/index.mjs',
];

let failed = false;
for (const file of required) {
  try {
    await access(resolve(file));
    console.log(`OK  ${file}`);
  } catch {
    failed = true;
    console.error(`CHYBÍ  ${file}`);
  }
}

const bootstrap = await readFile('src/bootstrap.js', 'utf8');
if (!bootstrap.includes("const APP_ID = 'lesson-hub'")) {
  failed = true;
  console.error('CHYBA  Bootstrap nepoužívá appId lesson-hub.');
}
if (!bootstrap.includes('protectApp(APP_ID')) {
  failed = true;
  console.error('CHYBA  Bootstrap nevolá centrální protectApp.');
}
if (/catch[\s\S]{0,400}import\(['"]\.\/main\.js/.test(bootstrap)) {
  failed = true;
  console.error('CHYBA  Přístupová brána může při chybě spustit aplikaci (fail-open).');
}

const index = await readFile('index.html', 'utf8');
for (const marker of ['data-ghrab-access="checking"', 'manifest.webmanifest', 'src/bootstrap.js']) {
  if (!index.includes(marker)) {
    failed = true;
    console.error(`CHYBA  index.html neobsahuje ${marker}.`);
  }
}

if (failed) process.exit(1);
console.log('\nProjektová kontrola prošla.');

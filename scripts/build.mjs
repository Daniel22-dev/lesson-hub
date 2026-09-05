import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');
const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
const version = String(pkg.version || '').trim();
const buildTime = new Date().toISOString();

async function walkFiles(root, current = root) {
  const result = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const target = path.join(current, entry.name);
    if (entry.isDirectory()) result.push(...await walkFiles(root, target));
    else if (entry.isFile()) result.push(path.relative(root, target).split(path.sep).join('/'));
  }
  return result;
}

await import('./check-versions.mjs');
await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });
await cp(path.join(ROOT, 'src'), path.join(DIST, 'src'), { recursive: true });
await cp(path.join(ROOT, 'public'), DIST, { recursive: true });
await mkdir(path.join(DIST, 'config'), { recursive: true });
await cp(path.join(ROOT, 'src', 'config', 'data-manifest.json'), path.join(DIST, 'config', 'data-manifest.json'));

const manualPath = path.join(DIST, 'manual', 'manual.js');
const manualSource = await readFile(manualPath, 'utf8');
if (!manualSource.includes('__APP_VERSION__')) throw new Error('Interaktivní manuál neobsahuje řízenou značku verze.');
await writeFile(manualPath, manualSource.replaceAll('__APP_VERSION__', version));

let index = await readFile(path.join(ROOT, 'index.html'), 'utf8');
index = index.replace(/(<html[^>]*>)/i, `$1\n<!-- BUILD: ${buildTime} · VERSION: ${version} -->`);
await writeFile(path.join(DIST, 'index.html'), index);

const template = await readFile(path.join(ROOT, 'studio', 'app-manifest.template.json'), 'utf8');
const studioManifest = template.replaceAll('__APP_VERSION__', version).replaceAll('__BUILD_TIME__', buildTime);
const parsed = JSON.parse(studioManifest);
const status = `${parsed.status?.cs || ''} ${parsed.status?.en || ''}`.toLowerCase();
if (/produk|production/.test(status)) throw new Error('Neodsouhlasená verze nesmí deklarovat produkční provoz.');
await writeFile(path.join(DIST, 'studio-manifest.json'), `${JSON.stringify(parsed, null, 2)}\n`);
await writeFile(path.join(DIST, 'build-info.json'), `${JSON.stringify({ appId: 'lesson-hub', version, buildTime, source: 'src' }, null, 2)}\n`);

const PRECACHE_EXCLUDE = new Set(['icons/icon-maskable-512.png']);
const assetFiles = (await walkFiles(DIST)).filter((file) => file !== 'sw.js' && !file.startsWith('platform/') && !PRECACHE_EXCLUDE.has(file)).sort();
const assets = ['./', ...assetFiles.map((file) => `./${file}`)];
const swPath = path.join(DIST, 'sw.js');
let serviceWorker = await readFile(swPath, 'utf8');
const marker = /\/\*__CORE_ASSETS__\*\/[\s\S]*?;\n\nself\.addEventListener\('message'/;
if (!marker.test(serviceWorker)) throw new Error('Service worker neobsahuje značku pro generovaný precache seznam.');
serviceWorker = serviceWorker.replace(marker, `${JSON.stringify(assets, null, 2)};\n\nself.addEventListener('message'`);
await writeFile(swPath, serviceWorker);

console.log(`Build Lesson Hub ${version} dokončen: ${path.relative(ROOT, DIST)}/ · ${assets.length} offline souborů`);

// P2: canonical cross-application platform post-processing.
await import("./apply-ghrab-platform.mjs");

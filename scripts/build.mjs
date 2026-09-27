import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');
const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
const version = String(pkg.version || '').trim();
function deterministicNowIso() {
  const raw = String(process.env.SOURCE_DATE_EPOCH || '').trim();
  if (!raw) return new Date().toISOString();
  const seconds = Number(raw);
  if (!Number.isSafeInteger(seconds) || seconds < 0) throw new Error('SOURCE_DATE_EPOCH musí být nezáporné celé číslo sekund.');
  return new Date(seconds * 1000).toISOString();
}
const buildTime = deterministicNowIso();

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

function plainChangelogText(value) {
  return String(value || '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1').replace(/\s+/g, ' ').trim();
}
function compareSemverDesc(a,b){const l=String(a.version||'').split('.').map(x=>Number(x)||0);const r=String(b.version||'').split('.').map(x=>Number(x)||0);for(let i=0;i<Math.max(l.length,r.length);i+=1){const d=(r[i]||0)-(l[i]||0);if(d)return d;}return 0;}
function parseChangelog(markdown){const map=new Map();let current=null;for(const rawLine of String(markdown||'').split(/\r?\n/u)){const heading=rawLine.match(/^##\s+(\d+\.\d+\.\d+)\s*(?:[—–-]\s*(.*))?$/u);if(heading){const versionLabel=heading[1];const rest=String(heading[2]||'').trim();const dateMatch=rest.match(/\((\d{4}-\d{2}-\d{2})\)\s*$/u);const title=plainChangelogText(dateMatch?rest.slice(0,dateMatch.index).trim():rest)||'Aktualizace';const existing=map.get(versionLabel);current=existing||{version:versionLabel,date:dateMatch?.[1]||'',title,changes:[]};if(!existing)map.set(versionLabel,current);continue;}if(!current)continue;const bullet=rawLine.match(/^\s*[-*]\s+(.+)$/u);if(!bullet)continue;const change=plainChangelogText(bullet[1]);if(change&&!current.changes.includes(change))current.changes.push(change);}return [...map.values()].sort(compareSemverDesc);}
const changelogItems=parseChangelog(await readFile(path.join(ROOT,'CHANGELOG.md'),'utf8'));
if(!changelogItems.some(item=>item.version===version)) throw new Error(`CHANGELOG.md neobsahuje aktuální verzi ${version}.`);
await writeFile(path.join(DIST,'config','changelog.json'),`${JSON.stringify({schema:'lesson-hub-changelog-v1',current:version,items:changelogItems})}\n`);

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

const PRECACHE_EXCLUDE = new Set(['icons/icon-maskable-512.png', 'config/changelog.json']);
const criticalListPath = path.join(ROOT, 'security', 'security-critical-assets.json');
const securityCritical = JSON.parse(await readFile(criticalListPath, 'utf8'));
if (!Array.isArray(securityCritical) || !securityCritical.length || securityCritical.some((item) => typeof item !== 'string' || !item.trim())) {
  throw new Error('security/security-critical-assets.json musí být neprázdný JSON array stringů.');
}
const normaliseSecurityPath = (value) => String(value || '').replace(/^\.\//, '').replace(/^\//, '');
const isSecurityCriticalAsset = (value) => {
  const file = normaliseSecurityPath(value);
  return securityCritical.some((item) => {
    const critical = normaliseSecurityPath(item);
    return critical && (file.includes(critical) || critical.includes(file));
  });
};
const assetFiles = (await walkFiles(DIST)).filter((file) =>
  file !== 'sw.js' &&
  !file.startsWith('platform/') &&
  !PRECACHE_EXCLUDE.has(file) &&
  !isSecurityCriticalAsset(file)
).sort();
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

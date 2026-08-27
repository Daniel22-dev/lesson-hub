#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto, { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const pkg = readJson(path.join(root, 'package.json'));
const consumer = readJson(path.join(root, 'ghrab-platform.consumer.json'));
const vendor = path.join(root, 'vendor', `ghrab-platform-${consumer.platform.version}`);
const release = readJson(path.join(vendor, `ghrab-platform-manifest-${consumer.platform.version}.json`));
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const checks = [];
const check = (condition, label, detail = '') => checks.push({ label, ok: Boolean(condition), detail: String(detail || '') });
const walk = (dir) => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const target = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(target) : [target];
}) : [];
const posix = (value) => value.split(path.sep).join('/');

check(fs.existsSync(dist), 'dist exists');
check(consumer.appId === 'ai-studio' || !fs.existsSync(path.join(dist, 'platform')), 'satellite dist has no duplicate platform tree');
check(consumer.appId === 'ai-studio' || (!fs.existsSync(path.join(root, 'src', 'platform')) && !fs.existsSync(path.join(root, 'public', 'platform'))), 'satellite source has no duplicate platform tree');
check(consumer.schema === 'ghrab-platform-consumer-v1', 'consumer schema');
check(pkg.version === consumer.appVersion, 'package ↔ consumer version', `${pkg.version} / ${consumer.appVersion}`);
check(consumer.platform.contract === 'ghrab-platform-v1', 'platform contract');
check(consumer.bridge.contract === 'ghrab-studio-handoff-v2', 'Studio Bridge contract');
check(consumer.artifact.schema === 'ghrab-artifact-envelope-v1', 'artifact envelope contract');
check(Array.isArray(consumer.artifact.exports), 'artifact exports declared');
check(Array.isArray(consumer.artifact.imports), 'artifact imports declared');
check(Array.isArray(consumer.artifact.nativeFormats), 'native export formats declared');
check(typeof consumer.artifact.acceptsLegacyJson === 'boolean', 'legacy JSON import policy declared');
check(consumer.cache.name === `ghrab-${consumer.appId}-v${consumer.appVersion}`, 'cache naming', consumer.cache.name);
check(Array.isArray(consumer.storageMigration?.mappings) && consumer.storageMigration.mappings.length > 0, 'storage migration declared');
for (const mapping of consumer.storageMigration?.mappings || []) {
  const canonical = mapping.canonical || mapping.canonicalPrefix || '';
  check(canonical.startsWith(`ghrab.${consumer.appId}.`), `storage namespace ${mapping.legacy || mapping.legacyPrefix}`, canonical);
}

for (const [name, meta] of Object.entries(release.artifacts || {})) {
  const source = path.join(vendor, name);
  const built = name === 'school-logo.png' ? path.join(dist, 'assets', 'brand', name) : path.join(dist, 'ghrab', name);
  check(fs.existsSync(source), `vendor ${name}`);
  if (fs.existsSync(source)) check(sha(fs.readFileSync(source)) === meta.sha256, `vendor hash ${name}`);
  check(fs.existsSync(built), `dist ${name}`);
  if (fs.existsSync(built)) check(sha(fs.readFileSync(built)) === meta.sha256, `dist hash ${name}`);
}

for (const rel of ['ghrab-platform.consumer.json', 'config/platform-manifest.json', 'config/brand-manifest.json', 'platform-build-info.json']) {
  check(fs.existsSync(path.join(dist, rel)), `dist ${rel}`);
}
const builtConsumer = fs.existsSync(path.join(dist, 'ghrab-platform.consumer.json')) ? readJson(path.join(dist, 'ghrab-platform.consumer.json')) : {};
check(builtConsumer.appId === consumer.appId && builtConsumer.appVersion === consumer.appVersion, 'built consumer identity');
const builtIntegration = fs.existsSync(path.join(dist, 'config/platform-manifest.json')) ? readJson(path.join(dist, 'config/platform-manifest.json')) : {};
check(builtIntegration.contract === consumer.platform.contract, 'built platform manifest contract');
check(builtIntegration.cacheName === consumer.cache.name, 'built platform cache metadata');
check(builtIntegration.swContract === 'ghrab-service-worker-v1', 'built service-worker contract');
check(JSON.stringify(builtIntegration.artifactContracts || {}) === JSON.stringify(consumer.artifact), 'built artifact contracts');
const builtData = fs.existsSync(path.join(dist, 'config/data-manifest.json')) ? readJson(path.join(dist, 'config/data-manifest.json')) : {};
check(builtData.storageNamespace?.migrationId === consumer.storageMigration.id, 'data manifest migration id');
check(builtData.storageNamespace?.prefix === `ghrab.${consumer.appId}.`, 'data manifest canonical prefix');
check(JSON.stringify(builtData.export?.artifactTypes || []) === JSON.stringify(consumer.artifact.exports), 'data manifest artifact exports');
check(JSON.stringify(builtData.import?.artifactTypes || []) === JSON.stringify(consumer.artifact.imports), 'data manifest artifact imports');
const builtBrand = fs.existsSync(path.join(dist, 'config/brand-manifest.json')) ? readJson(path.join(dist, 'config/brand-manifest.json')) : {};
check(builtBrand.logo?.sha256 === release.artifacts?.['school-logo.png']?.sha256, 'canonical logo manifest hash');

if (fs.existsSync(dist)) {
  const textFiles = walk(dist).filter((file) => /\.(?:html|js|css|json|webmanifest)$/i.test(file));
  const allText = textFiles.map((file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } }).join('\n');
  check(!/data:image\/(?:png|jpe?g);base64,[A-Za-z0-9+/=]{50000,}/.test(allText), 'no inline school logo base64');
  check(!/(?:assets\/school-logo\.png|assets\/ghrab-logo\.png|school-logo\.jpg)/.test(allText), 'no legacy school logo reference');
  check(consumer.appId === 'ai-studio' || !/["']\.\/platform\/(?:ghrab-platform-config\.js|ghrab-platform\.js|ghrab-platform\.css|ghrab-platform-manifest-1\.0\.0\.json|ghrab-artifact-envelope-v1\.schema\.json|ghrab-app-registry-v2\.schema\.json)["']/.test(allText), 'no obsolete top-level platform references in satellite build');
  check(allText.includes('ghrab-platform-v1'), 'platform contract present in build');
  const htmlFiles = textFiles.filter((file) => file.endsWith('.html'));
  const eligible = htmlFiles.filter((file) => /<html\b[^>]*>[\s\S]*<\/html>/i.test(fs.readFileSync(file, 'utf8')) && !(consumer.html?.exclude || []).some((prefix) => posix(path.relative(dist, file)).startsWith(prefix)));
  check(eligible.length > 0, 'full eligible HTML documents found');
  for (const file of eligible) {
    const rel = posix(path.relative(dist, file));
    const text = fs.readFileSync(file, 'utf8');
    const loaderCount = (text.match(/data-ghrab-platform-loader/g) || []).length;
    const configCount = (text.match(/id=["']ghrab-platform-config["']/g) || []).length;
    check(loaderCount === 1, `exactly one platform loader ${rel}`, loaderCount);
    check(configCount === 1, `exactly one platform config ${rel}`, configCount);
    check(text.includes(`data-ghrab-app-id="${consumer.appId}"`) || text.includes(`data-ghrab-app-id='${consumer.appId}'`), `app identity ${rel}`);
    check(text.includes('data-theme='), `theme root contract ${rel}`);
  }
}

const swPath = path.join(dist, 'sw.js');
check(fs.existsSync(swPath), 'service worker exists');
if (fs.existsSync(swPath)) {
  const sw = fs.readFileSync(swPath, 'utf8');
  check(sw.includes(consumer.cache.name), 'service worker canonical cache');
  check(sw.includes('ghrab-service-worker-v1'), 'service worker contract marker');
  check(sw.includes('CACHE_PREFIXES'), 'service worker legacy cleanup list');
  check(sw.includes('GHRAB_SKIP_WAITING'), 'service worker update protocol');
  check(sw.includes('ghrab/ghrab-platform.js'), 'service worker platform precache');
  check(sw.includes('GHRAB_PLATFORM_P3_ASSETS'), 'service worker P3 asset list');
  const firstInstall = sw.indexOf("addEventListener('install'");
  const firstActivate = sw.indexOf("addEventListener('activate'");
  const installBody = firstInstall >= 0 && firstActivate > firstInstall ? sw.slice(firstInstall, firstActivate) : '';
  check(!installBody.includes('skipWaiting'), 'no automatic skipWaiting during install');
  check(sw.includes("request.cache === 'no-store'"), 'service worker no-store bypass');
  check(consumer.appId === 'ai-studio' || !/["']\.\/platform\/(?:ghrab-platform-config\.js|ghrab-platform\.js|ghrab-platform\.css|ghrab-platform-manifest-1\.0\.0\.json|ghrab-artifact-envelope-v1\.schema\.json|ghrab-app-registry-v2\.schema\.json)["']/.test(sw), 'service worker no obsolete satellite platform asset');
}
const manifestPath = path.join(dist, 'manifest.webmanifest');
check(fs.existsSync(manifestPath), 'PWA manifest exists');
if (fs.existsSync(manifestPath)) {
  const manifest = readJson(manifestPath);
  check(manifest.version === consumer.appVersion, 'PWA version');
  check(manifest.ghrab_platform?.contract === consumer.platform.contract, 'PWA platform contract');
  check(manifest.ghrab_platform?.cache_name === consumer.cache.name, 'PWA cache metadata');
  check(manifest.ghrab_platform?.app_id === consumer.appId, 'PWA app identity');
}

class FakeStorage {
  constructor() { this.map = new Map(); }
  get length() { return this.map.size; }
  key(index) { return [...this.map.keys()][index] ?? null; }
  getItem(key) { return this.map.has(String(key)) ? this.map.get(String(key)) : null; }
  setItem(key, value) { this.map.set(String(key), String(value)); }
  removeItem(key) { this.map.delete(String(key)); }
  clear() { this.map.clear(); }
}
class FakeClassList {
  constructor() { this.values = new Set(); }
  contains(value) { return this.values.has(value); }
  toggle(value, force) { if (force === true) this.values.add(value); else if (force === false) this.values.delete(value); else this.values.has(value) ? this.values.delete(value) : this.values.add(value); return this.values.has(value); }
  add(...values) { values.forEach((value) => this.values.add(value)); }
}
const element = () => ({
  dataset: {}, style: {}, classList: new FakeClassList(), children: [], attributes: [],
  hasAttribute() { return false; }, setAttribute() {}, getAttribute() { return null; }, remove() {}, replaceWith() {}, replaceChildren(...nodes) { this.children = nodes; },
  append(...nodes) { this.children.push(...nodes); }, prepend(...nodes) { this.children.unshift(...nodes); }, addEventListener() {}, querySelectorAll() { return []; }, querySelector() { return null; }, click() {},
});
const localStorage = new FakeStorage();
const sessionStorage = new FakeStorage();
const runtimeConfig = {
  schema: 'ghrab-platform-app-config-v1', appId: consumer.appId, appName: consumer.appName, appVersion: consumer.appVersion,
  requiredPlatformRange: consumer.platform.requiredRange, autoFooter: false, bridgeWriteLegacy: true,
  bridgeMaxBytes: consumer.bridge.maxBytes, theme: { contract: 'ghrab-theme-v1', ...consumer.theme }, storageMigration: consumer.storageMigration,
};
const sample = consumer.storageMigration.mappings[0];
const sampleStore = sample.store === 'session' ? sessionStorage : localStorage;
const legacyKey = sample.legacy || `${sample.legacyPrefix}sample`;
const canonicalKey = sample.canonical || `${sample.canonicalPrefix}sample`;
sampleStore.setItem(legacyKey, 'original-value');
const rootElement = element();
const body = element();
const document = {
  currentScript: { src: 'https://example.test/app/ghrab/ghrab-platform.js' }, documentElement: rootElement, body, readyState: 'loading',
  getElementById() { return null; }, addEventListener() {}, dispatchEvent() {}, querySelector() { return null; }, querySelectorAll() { return []; }, createElement() { return element(); }, createTextNode(text) { return { textContent: text }; },
};
const context = {
  console, URL, URLSearchParams, TextEncoder, TextDecoder, Blob, setTimeout, clearTimeout,
  crypto: webcrypto, location: new URL('https://example.test/app/index.html'), navigator: {}, document,
  localStorage, sessionStorage, Storage: FakeStorage, MutationObserver: class { observe() {} disconnect() {} },
  CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  GHRAB_PLATFORM_CONFIG: runtimeConfig,
};
context.window = context; context.globalThis = context;
try {
  vm.runInNewContext(fs.readFileSync(path.join(vendor, 'ghrab-platform.js'), 'utf8'), context, { filename: 'ghrab-platform.js' });
  const api = context.GHRAB_PLATFORM;
  check(api?.version === consumer.platform.version && api?.contract === consumer.platform.contract, 'runtime identity');
  check(api.satisfies('1.0.0', consumer.platform.requiredRange) === false, 'runtime previous platform rejected');
  check(api.satisfies('1.1.0', consumer.platform.requiredRange) === true, 'runtime current accepted');
  check(api.satisfies('1.2.0', consumer.platform.requiredRange) === true, 'runtime n+1 accepted');
  check(api.satisfies('2.0.0', consumer.platform.requiredRange) === false, 'runtime major rejected');
  check(sampleStore.getItem(legacyKey) === 'original-value', 'storage alias reads migrated value');
  check(sampleStore.getItem(canonicalKey) === 'original-value', 'canonical storage value created');
  sampleStore.setItem(legacyKey, 'updated-value');
  check(sampleStore.getItem(canonicalKey) === 'updated-value', 'storage alias writes canonical key');
  check(api.migrateStorage().status === 'already-done', 'storage migration idempotent');
  const rollback = api.rollbackStorageMigration();
  check(rollback.status === 'restored', 'storage migration rollback');
  check(sampleStore.map.get(legacyKey) === 'original-value', 'rollback restored original value');
  const material = { schema: 'ghrab-material-v1', id: 'runtime-test', title: 'Test', subject: 'Test', content: { text: 'Ahoj' } };
  const handoff = api.bridge.create({ target: consumer.appId, sourceAppId: 'ai-studio', sourceAppVersion: '1.0.0', targetVersionRange: '*', material });
  check(handoff?.schema === 'ghrab-studio-handoff-v2', 'Studio Bridge v2 create');
  check(api.bridge.peek({ target: consumer.appId })?.material?.id === material.id, 'Studio Bridge v2 peek');
  check(api.bridge.take({ target: consumer.appId })?.material?.id === material.id, 'Studio Bridge v2 take');
  check(api.bridge.peek({ target: consumer.appId }) === null, 'Studio Bridge consumes once');
  const envelope = await api.artifact.create({ artifactType: 'runtime-test', payload: { value: 1 } });
  const validation = await api.artifact.validate(envelope, { expectedAppId: consumer.appId });
  check(validation.ok, 'artifact envelope SHA-256');
  check((await api.artifact.unwrap(envelope, { expectedAppId: consumer.appId })).value === 1, 'artifact envelope unwrap');
  check(api.artifact.isEnvelope(envelope) === true, 'artifact envelope detection');
  const maybeEnvelope = await api.artifact.unwrapMaybe(envelope, { expectedAppId: consumer.appId });
  check(maybeEnvelope.legacy === false && maybeEnvelope.payload.value === 1, 'artifact envelope unwrapMaybe');
  const maybeLegacy = await api.artifact.unwrapMaybe({ value: 2 }, { allowLegacy: true });
  check(maybeLegacy.legacy === true && maybeLegacy.payload.value === 2, 'legacy artifact compatibility');
  check(api.theme.set(consumer.theme.supported.includes('dark') ? 'dark' : consumer.theme.default).contract === 'ghrab-theme-v1', 'theme contract runtime');
  check(context.GHRABArtifact === api.artifact, 'artifact compatibility facade');
  check(api.a11y?.contract === consumer.quality.accessibilityContract, 'accessibility runtime contract');
  check(api.performance?.contract === consumer.quality.performanceContract, 'performance runtime contract');
  check(api.modules?.contract === consumer.quality.moduleContract, 'lazy module runtime contract');
  check(typeof api.modules?.loadScript === 'function', 'lazy script loader available');
} catch (error) {
  check(false, 'runtime conformance', error?.stack || error);
}

const failed = checks.filter((item) => !item.ok);
console.log(JSON.stringify({ schema: 'ghrab-platform-conformance-result-v1', appId: consumer.appId, appVersion: consumer.appVersion, total: checks.length, passed: checks.length - failed.length, failed: failed.length, checks }, null, 2));
if (failed.length) process.exit(1);

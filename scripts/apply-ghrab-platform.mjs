#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const dist = path.join(root, 'dist');
const consumerPath = path.join(root, 'ghrab-platform.consumer.json');
const consumer = JSON.parse(fs.readFileSync(consumerPath, 'utf8'));
const vendor = path.join(root, 'vendor', `ghrab-platform-${consumer.platform.version}`);
const releaseManifestPath = path.join(vendor, `ghrab-platform-manifest-${consumer.platform.version}.json`);
const release = JSON.parse(fs.readFileSync(releaseManifestPath, 'utf8'));

if (!fs.existsSync(dist)) throw new Error('P3 postprocessor: chybí dist/.');
if (consumer.schema !== 'ghrab-platform-consumer-v1') throw new Error('P3 postprocessor: neplatné consumer schema.');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (pkg.version !== consumer.appVersion) throw new Error(`P3 postprocessor: package ${pkg.version} != consumer ${consumer.appVersion}.`);

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const posix = (value) => value.split(path.sep).join('/');
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(target));
    else if (entry.isFile()) out.push(target);
  }
  return out;
}
function copyVerified(name, target) {
  const source = path.join(vendor, name);
  const bytes = fs.readFileSync(source);
  const expected = release.artifacts?.[name]?.sha256;
  if (!expected || sha256(bytes) !== expected) throw new Error(`P3 postprocessor: hash nesouhlasí pro ${name}.`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
}

const legacyPlatformDir = path.join(dist, 'platform');
if (consumer.appId !== 'ai-studio') {
  fs.rmSync(legacyPlatformDir, { recursive: true, force: true });
}

const ghrabDir = path.join(dist, 'ghrab');
fs.rmSync(ghrabDir, { recursive: true, force: true });
fs.mkdirSync(ghrabDir, { recursive: true });
for (const name of [
  'ghrab-platform.js',
  'ghrab-platform.css',
  'ghrab-artifact-envelope-v1.schema.json',
  'ghrab-app-registry-v2.schema.json',
]) copyVerified(name, path.join(ghrabDir, name));
fs.copyFileSync(releaseManifestPath, path.join(ghrabDir, path.basename(releaseManifestPath)));
copyVerified('school-logo.png', path.join(dist, 'assets', 'brand', 'school-logo.png'));

const obsoleteLogoPaths = [
  path.join(dist, 'assets', 'brand', 'school-logo.jpg'),
  path.join(dist, 'assets', 'school-logo.png'),
  path.join(dist, 'assets', 'ghrab-logo.png'),
  path.join(dist, 'src', 'assets', 'brand', 'school-logo.jpg'),
  path.join(dist, 'src', 'assets', 'school-logo.png'),
  path.join(dist, 'src', 'assets', 'ghrab-logo.png'),
];
for (const file of obsoleteLogoPaths) fs.rmSync(file, { force: true });

const legacyLogoHashes = new Set([
  '300396a48cc36d8c2abda0aea673273d4d985476ba88fb0430630ef89ac86770',
  'a68cc41ee17cb6742ea1f6983af9e8bb942da58bd0d0cf446fa668136a4b853a',
  'ed048d3f8b6eace2145fa48d09a8c5f31c83ade19dcf4faa3ff69fc24040896f',
]);
const fullHtml = /<html\b[^>]*>[\s\S]*<\/html>/i;
const excludes = consumer.html?.exclude || [];
const noFooter = consumer.html?.noFooter || [];
const matchesPrefix = (rel, list) => list.some((item) => rel === item || rel.startsWith(item.endsWith('/') ? item : `${item}/`));
const relativeAsset = (htmlFile, targetRel) => {
  const rel = posix(path.relative(path.dirname(htmlFile), path.join(dist, targetRel)));
  return rel.startsWith('.') ? rel : `./${rel}`;
};
function addHtmlAttribute(tag, name, value) {
  const pattern = new RegExp(`\\s${name}=(?:"[^"]*"|'[^']*')`, 'i');
  if (pattern.test(tag)) return tag.replace(pattern, ` ${name}="${value}"`);
  return tag.replace(/>$/, ` ${name}="${value}">`);
}
function replaceLogoDataUris(text, canonicalRelative) {
  return text.replace(/data:image\/(?:png|jpeg|jpg);base64,([A-Za-z0-9+/=]{1000,})/g, (whole, encoded) => {
    try { return legacyLogoHashes.has(sha256(Buffer.from(encoded, 'base64'))) ? canonicalRelative : whole; }
    catch { return whole; }
  });
}
function replaceLogoPaths(text, canonicalRelative) {
  return text
    .replace(/(?:\.\.\/|\.\/)*(?:src\/)?assets\/brand\/school-logo\.jpg/gi, canonicalRelative)
    .replace(/(?:\.\.\/|\.\/)*(?:src\/)?assets\/(?:school-logo|ghrab-logo)\.png/gi, canonicalRelative);
}

let htmlCount = 0;
for (const file of walk(dist).filter((item) => item.toLowerCase().endsWith('.html'))) {
  const rel = posix(path.relative(dist, file));
  let html = fs.readFileSync(file, 'utf8');
  if (!fullHtml.test(html) || matchesPrefix(rel, excludes)) continue;
  const canonicalLogo = relativeAsset(file, 'assets/brand/school-logo.png');
  html = replaceLogoDataUris(html, canonicalLogo);
  html = replaceLogoPaths(html, canonicalLogo);
  html = html.replace(/<html\b[^>]*>/i, (tag) => {
    let next = tag;
    next = addHtmlAttribute(next, 'data-ghrab-app-id', consumer.appId);
    next = addHtmlAttribute(next, 'data-ghrab-app-version', consumer.appVersion);
    next = addHtmlAttribute(next, 'data-ghrab-platform-contract', consumer.platform.contract);
    if (!/\sdata-theme=/.test(next)) next = addHtmlAttribute(next, 'data-theme', consumer.theme.default === 'system' ? consumer.theme.systemFallback || 'dark' : consumer.theme.default);
    if (!/\sdata-theme-preference=/.test(next)) next = addHtmlAttribute(next, 'data-theme-preference', consumer.theme.default);
    return next;
  });
  if (!html.includes('data-ghrab-platform-loader')) {
    const runtimeConfig = {
      appId: consumer.appId,
      appName: consumer.appName,
      appVersion: consumer.appVersion,
      requiredPlatformRange: consumer.platform.requiredRange,
      platformContract: consumer.platform.contract,
      brandVersion: consumer.brand.version,
      autoFooter: !matchesPrefix(rel, noFooter),
      theme: consumer.theme,
      storageMigration: consumer.storageMigration,
      bridgeMaxBytes: consumer.bridge.maxBytes,
      artifactContract: consumer.artifact.schema,
      quality: consumer.quality,
    };
    const configText = JSON.stringify(runtimeConfig).replaceAll('<', '\\u003c');
    const css = relativeAsset(file, 'ghrab/ghrab-platform.css');
    const js = relativeAsset(file, 'ghrab/ghrab-platform.js');
    const block = `\n    <!-- GHRAB Platform ${consumer.platform.version} · generated -->\n    <link rel="stylesheet" href="${css}" data-ghrab-platform-style>\n    <script id="ghrab-platform-config" type="application/json">${configText}</script>\n    <script defer src="${js}" data-ghrab-platform-loader></script>\n`;
    html = html.replace(/<\/head>/i, `${block}  </head>`);
  }
  fs.writeFileSync(file, html);
  htmlCount += 1;
}

for (const file of walk(dist).filter((item) => /\.(?:js|css|json|webmanifest)$/i.test(item))) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
  const before = text;
  text = text
    .replaceAll('assets/brand/school-logo.jpg', 'assets/brand/school-logo.png')
    .replaceAll('./src/assets/brand/school-logo.jpg', './assets/brand/school-logo.png')
    .replaceAll('../../src/assets/brand/school-logo.jpg', '../../assets/brand/school-logo.png')
    .replaceAll('./assets/school-logo.png', './assets/brand/school-logo.png')
    .replaceAll('./assets/ghrab-logo.png', './assets/brand/school-logo.png');
  if (text !== before) fs.writeFileSync(file, text);
}

const manifestPath = path.join(dist, 'manifest.webmanifest');
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.version = consumer.appVersion;
  manifest.ghrab_platform = {
    contract: consumer.platform.contract,
    platform_version: consumer.platform.version,
    required_range: consumer.platform.requiredRange,
    brand_version: consumer.brand.version,
    app_id: consumer.appId,
    cache_name: consumer.cache.name,
    theme_contract: 'ghrab-theme-v1',
    storage_contract: 'ghrab-storage-namespace-v1',
    bridge_contract: consumer.bridge.contract,
    artifact_contract: consumer.artifact.schema,
    accessibility_contract: consumer.quality.accessibilityContract,
    performance_contract: consumer.quality.performanceContract,
    module_contract: consumer.quality.moduleContract,
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

for (const name of ['studio-manifest.json', 'app-manifest.json']) {
  const target = path.join(dist, name);
  if (!fs.existsSync(target)) continue;
  const manifest = JSON.parse(fs.readFileSync(target, 'utf8'));
  manifest.platform = {
    contract: consumer.platform.contract,
    platformVersion: consumer.platform.version,
    requiredRange: consumer.platform.requiredRange,
    brandVersion: consumer.brand.version,
    themeContract: 'ghrab-theme-v1',
    storageContract: 'ghrab-storage-namespace-v1',
    bridgeContract: consumer.bridge.contract,
    artifactContract: consumer.artifact.schema,
    accessibilityContract: consumer.quality.accessibilityContract,
    performanceContract: consumer.quality.performanceContract,
    moduleContract: consumer.quality.moduleContract,
    cacheName: consumer.cache.name,
  };
  fs.writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
}

const swPath = path.join(dist, 'sw.js');
if (fs.existsSync(swPath)) {
  let sw = fs.readFileSync(swPath, 'utf8');
  sw = sw.replace(/\n\/\* GHRAB_PLATFORM_P3_START \*\/[\s\S]*?\/\* GHRAB_PLATFORM_P3_END \*\/\n?/g, '\n');
  const platformAssets = [
    './ghrab/ghrab-platform.js',
    './ghrab/ghrab-platform.css',
    './ghrab/ghrab-artifact-envelope-v1.schema.json',
    './ghrab/ghrab-app-registry-v2.schema.json',
    `./ghrab/ghrab-platform-manifest-${consumer.platform.version}.json`,
    './assets/brand/school-logo.png',
    './ghrab-platform.consumer.json',
  ];
  const hasUpdateProtocol = sw.includes('GHRAB_SKIP_WAITING');
  sw += `\n/* GHRAB_PLATFORM_P3_START */\nconst GHRAB_PLATFORM_P3_ASSETS=${JSON.stringify(platformAssets)};\nself.addEventListener('install',event=>event.waitUntil((async()=>{const cache=await caches.open(${JSON.stringify(consumer.cache.name)});const results=await Promise.allSettled(GHRAB_PLATFORM_P3_ASSETS.map(asset=>cache.add(asset)));const failed=results.filter(item=>item.status==='rejected');if(failed.length)throw new Error('GHRAB Platform P3 precache selhal: '+failed.length);})()));\n${hasUpdateProtocol ? '' : "self.addEventListener('message',event=>{if(event.data?.type==='GHRAB_SKIP_WAITING')self.skipWaiting();});\n"}/* GHRAB_PLATFORM_P3_END */\n`;
  fs.writeFileSync(swPath, sw);
}

const configDir = path.join(dist, 'config');
fs.mkdirSync(configDir, { recursive: true });
const integrationManifest = {
  schema: 'ghrab-platform-app-integration-v1',
  appId: consumer.appId,
  appVersion: consumer.appVersion,
  contract: consumer.platform.contract,
  requiredPlatformRange: consumer.platform.requiredRange,
  platformVersion: consumer.platform.version,
  brandVersion: consumer.brand.version,
  themeContract: 'ghrab-theme-v1',
  swContract: 'ghrab-service-worker-v1',
  studioBridge: consumer.bridge.contract,
  artifactEnvelope: consumer.artifact.schema,
  artifactContracts: consumer.artifact,
  storagePrefix: `ghrab.${consumer.appId}.`,
  cacheName: consumer.cache.name,
  capabilities: ['ghrab-platform-v1','canonical-branding','theme-contract-v1','storage-namespace-v1','artifact-envelope-v1','sw-contract-v1','a11y-contract-v1','performance-budget-v1','lazy-modules-v1'],
  quality: consumer.quality,
  artifacts: release.artifacts,
};
const brandManifest = {
  schema: 'ghrab-brand-release-v1',
  brandVersion: consumer.brand.version,
  appId: consumer.appId,
  owner: 'Gymnázium, Ostrava-Hrabůvka',
  author: 'Daniel Baláž',
  asset: { path: 'assets/brand/school-logo.png', mediaType: 'image/png', sha256: release.artifacts?.['school-logo.png']?.sha256 || '', bytes: release.artifacts?.['school-logo.png']?.bytes || 0 },
  logo: { path: 'assets/brand/school-logo.png', sha256: release.artifacts?.['school-logo.png']?.sha256 || '', bytes: release.artifacts?.['school-logo.png']?.bytes || 0 },
  footer: { contract: consumer.brand.footerContract, ownerLine: 'Autor a vývojový garant: Daniel Baláž', schoolLine: 'Gymnázium, Ostrava-Hrabůvka · Součást AI Studia GHRAB' },
  footerContract: consumer.brand.footerContract,
};
fs.writeFileSync(path.join(configDir, 'platform-manifest.json'), `${JSON.stringify(integrationManifest, null, 2)}\n`);
fs.writeFileSync(path.join(configDir, 'brand-manifest.json'), `${JSON.stringify(brandManifest, null, 2)}\n`);

if (consumer.appId !== 'ai-studio') {
  fs.rmSync(path.join(dist, 'platform'), { recursive: true, force: true });
}

fs.writeFileSync(path.join(dist, 'ghrab-platform.consumer.json'), `${JSON.stringify(consumer, null, 2)}\n`);
fs.writeFileSync(path.join(dist, 'platform-build-info.json'), `${JSON.stringify({
  schema: 'ghrab-platform-build-v1',
  appId: consumer.appId,
  appVersion: consumer.appVersion,
  platformVersion: consumer.platform.version,
  platformContract: consumer.platform.contract,
  brandVersion: consumer.brand.version,
  cacheName: consumer.cache.name,
  processedHtmlFiles: htmlCount,
  qualityContracts: { accessibility: consumer.quality.accessibilityContract, performance: consumer.quality.performanceContract, modules: consumer.quality.moduleContract },
  builtAt: new Date().toISOString(),
}, null, 2)}\n`);

console.log(`[P3] ${consumer.appId} ${consumer.appVersion}: platform ${consumer.platform.version}, HTML ${htmlCount}, cache ${consumer.cache.name}`);

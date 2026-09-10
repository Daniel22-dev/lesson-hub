const GHRAB_SW_CONTRACT='ghrab-service-worker-v1';
/* GHRAB service-worker contract v1 · update activation is user-controlled. */
const CACHE_NAME = "ghrab-lesson-hub-v1.2.22";
const CACHE_PREFIXES = ["ghrab-lesson-hub-v", "lesson-hub-pwa-v"];
const CORE_ASSETS = [
  "./",
  "./assets/brand/school-logo.png",
  "./build-info.json",
  "./config/brand-manifest.json",
  "./config/data-manifest.json",
  "./config/platform-manifest.json",
  "./config/release-acceptance.json",
  "./ghrab-platform.consumer.json",
  "./icons/apple-touch-icon.png",
  "./icons/icon-128.png",
  "./icons/icon-192.png",
  "./icons/icon-32.png",
  "./icons/icon-48.png",
  "./icons/icon-512.png",
  "./icons/icon-72.png",
  "./icons/icon-96.png",
  "./index.html",
  "./manifest.webmanifest",
  "./manual/bootstrap.js",
  "./manual/index.html",
  "./manual/manual.js",
  "./manual/styles.css",
  "./src/access/access-gate.css",
  "./src/access/error-reporter-adapter.js",
  "./src/access/error-reporter.css",
  "./src/access/error-reporter.js",
  "./src/access/reporter-bootstrap.js",
  "./src/assets/README.md",
  "./src/assets/brand/app-icon.svg",
  "./src/bootstrap.js",
  "./src/config/data-manifest.json",
  "./src/config/release-acceptance.json",
  "./src/config/security-headers.json",
  "./src/core/access.js",
  "./src/core/appState.js",
  "./src/core/config.js",
  "./src/core/constants.js",
  "./src/core/database.js",
  "./src/core/diagnostics.js",
  "./src/core/draftStorage.js",
  "./src/core/eventBus.js",
  "./src/core/html.js",
  "./src/core/migrations.js",
  "./src/core/persistenceGuard.js",
  "./src/core/pwa.js",
  "./src/core/release.js",
  "./src/core/schema.js",
  "./src/core/settings.js",
  "./src/core/studioBridge.js",
  "./src/core/suiteSession.js",
  "./src/core/telemetry.js",
  "./src/core/untrustedData.js",
  "./src/main.js",
  "./src/pages/academic.js",
  "./src/pages/communication.js",
  "./src/pages/data.js",
  "./src/pages/diagnostics.js",
  "./src/pages/groups.js",
  "./src/pages/index.js",
  "./src/pages/materials.js",
  "./src/pages/more.js",
  "./src/pages/overview.js",
  "./src/pages/plan.js",
  "./src/pages/search.js",
  "./src/pages/server.js",
  "./src/pages/settings.js",
  "./src/pages/shared.js",
  "./src/pages/substitution.js",
  "./src/pages/templates.js",
  "./src/pages/work.js",
  "./src/repositories/BaseRepository.js",
  "./src/repositories/repositoryFactory.js",
  "./src/server/dataGateway.js",
  "./src/services/academicService.js",
  "./src/services/backupService.js",
  "./src/services/communicationService.js",
  "./src/services/lessonService.js",
  "./src/services/materialService.js",
  "./src/services/searchService.js",
  "./src/services/serverService.js",
  "./src/services/substitutionService.js",
  "./src/services/syncService.js",
  "./src/services/templateCycleService.js",
  "./src/services/workService.js",
  "./src/styles.css",
  "./src/ui/academicDialogs.js",
  "./src/ui/communicationDialogs.js",
  "./src/ui/icons.js",
  "./src/ui/layout.js",
  "./src/ui/lessonDialogs.js",
  "./src/ui/materialDialogs.js",
  "./src/ui/modal.js",
  "./src/ui/router.js",
  "./src/ui/substitutionDialogs.js",
  "./src/ui/templateDialogs.js",
  "./src/ui/toast.js",
  "./src/ui/workDialogs.js",
  "./studio-manifest.json"
];

self.addEventListener('message', (event) => {
  if (['GHRAB_SKIP_WAITING', 'SKIP_WAITING'].includes(event.data?.type)) self.skipWaiting();
});

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE_ASSETS);
    const optionalAssets = [];
    if (optionalAssets.length) {
      const results = await Promise.allSettled(optionalAssets.map((asset) => cache.add(asset)));
      const failed = results.filter((item) => item.status === 'rejected').length;
      if (failed) console.warn(`[GHRAB SW] ${failed} volitelných assetů nebylo uloženo do offline cache.`);
    }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => CACHE_PREFIXES.some((prefix) => key.startsWith(prefix)) && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function networkFirst(request, fallbackUrl = '') {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (!response || !response.ok) throw new Error(`HTTP ${response?.status || 0}`);
    await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (fallbackUrl) {
      const fallback = await cache.match(fallbackUrl, { ignoreSearch: true });
      if (fallback) return fallback;
    }
    throw error;
  }
}

async function networkOnlyNoStore(request) {
  return fetch(request, { cache: 'no-store' });
}

function isSecurityCriticalRequest(url, scopePath) {
  const relative = url.pathname.slice(scopePath.length);
  return relative === 'runtime-config.js' ||
    relative === 'src/access/deployment-config.js' ||
    relative === 'ghrab/ghrab-platform.js' ||
    relative === 'release-integrity.json' ||
    relative === 'release-integrity.sig' ||
    relative === 'integrity-status.json' ||
    relative.endsWith('/config/deployment.json') ||
    relative.endsWith('/config/deployment.school-server-p0.json') ||
    relative.endsWith('/config/deployment.school-server.example.json') ||
    relative.endsWith('/config/deployment.school-server.json') ||
    relative.endsWith('/app-guard.js') ||
    relative.endsWith('/access-control.js') ||
    relative.endsWith('/revoked-access.json');
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response?.ok) await cache.put(request, response.clone());
  return response;
}

function isRuntimeRequest(url, scopePath) {
  const relative = url.pathname.slice(scopePath.length);
  return relative === 'runtime-config.js' ||
    relative === 'config/deployment.json' ||
    relative === 'config/deployment.school-server-p0.json' ||
    relative === 'config/deployment.school-server.example.json' ||
    /^(?:api|auth|session|health)(?:\/|$)/.test(relative);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const scopePath = new URL('./', self.location.href).pathname;
  if (!url.pathname.startsWith(scopePath)) return;
  if (isSecurityCriticalRequest(url, scopePath)) {
    event.respondWith(networkOnlyNoStore(request));
    return;
  }
  if (isRuntimeRequest(url, scopePath)) return;
  // Non-critical static metadata requested with no-store keeps the established
  // offline fallback. Security-critical paths have already returned network-only above.
  if (request.cache === 'no-store') {
    event.respondWith(networkFirst(request));
    return;
  }
  if (request.mode === 'navigate') {
    const fallback = url.pathname.includes('/manual/') ? './manual/index.html' : './index.html';
    event.respondWith(networkFirst(request, fallback));
    return;
  }
  if (url.pathname.endsWith('/manifest.webmanifest') || url.pathname.endsWith('/build-info.json')) {
    event.respondWith(networkFirst(request));
    return;
  }
  event.respondWith(cacheFirst(request));
});

/* GHRAB_PLATFORM_P3_START */
const GHRAB_PLATFORM_P3_ASSETS=["./ghrab/ghrab-platform.css","./ghrab/ghrab-artifact-envelope-v1.schema.json","./ghrab/ghrab-app-registry-v2.schema.json","./ghrab/ghrab-platform-manifest-1.1.2.json","./assets/brand/school-logo.png","./ghrab-platform.consumer.json"];
self.addEventListener('install',event=>event.waitUntil((async()=>{const cache=await caches.open("ghrab-lesson-hub-v1.2.22");const results=await Promise.allSettled(GHRAB_PLATFORM_P3_ASSETS.map(asset=>cache.add(asset)));const failed=results.filter(item=>item.status==='rejected');if(failed.length)throw new Error('GHRAB Platform P3 precache selhal: '+failed.length);})()));
/* GHRAB_PLATFORM_P3_END */

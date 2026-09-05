const GHRAB_SW_CONTRACT='ghrab-service-worker-v1';
/* GHRAB service-worker contract v1 · update activation is user-controlled. */
const CACHE_NAME = "ghrab-lesson-hub-v1.2.17";
const CACHE_PREFIXES = ["ghrab-lesson-hub-v", "lesson-hub-pwa-v"];
const CORE_ASSETS = /*__CORE_ASSETS__*/[
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./src/bootstrap.js",
  "./src/main.js",
  "./src/styles.css",
  "./src/access/error-reporter.js",
  "./src/access/error-reporter.css",
  "./src/access/error-reporter-adapter.js",
  "./config/brand-manifest.json",
  "./config/platform-manifest.json",
  "./assets/brand/school-logo.png",
  "./ghrab-platform.consumer.json"
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
  if (!url.pathname.startsWith(scopePath) || isRuntimeRequest(url, scopePath)) return;
  if (request.mode === 'navigate') {
    const fallback = url.pathname.includes('/manual/') ? './manual/index.html' : './index.html';
    event.respondWith(networkFirst(request, fallback));
    return;
  }
  // Static metadata explicitly requested with cache: 'no-store' still needs
  // an application-cache fallback offline. Runtime/API/auth/session/deployment
  // paths remain excluded above and are never satisfied from Cache Storage.
  if (request.cache === 'no-store') {
    event.respondWith(networkFirst(request));
    return;
  }
  if (url.pathname.endsWith('/manifest.webmanifest') || url.pathname.endsWith('/build-info.json')) {
    event.respondWith(networkFirst(request));
    return;
  }
  event.respondWith(cacheFirst(request));
});

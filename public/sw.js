const CACHE_PREFIX = 'lesson-hub-pwa-v';
const CACHE_NAME = 'lesson-hub-pwa-v1.1.6';
const CORE_ASSETS = /*__CORE_ASSETS__*/[
  './', './index.html', './manifest.webmanifest', './src/bootstrap.js', './src/main.js', './src/styles.css'
];

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const results = await Promise.allSettled(CORE_ASSETS.map(async (asset) => {
      try { await cache.add(asset); }
      catch (error) { console.error(`Lesson Hub precache selhal pro ${asset}:`, error); throw error; }
    }));
    const failed = results.filter((item) => item.status === 'rejected').length;
    if (failed) console.warn(`Lesson Hub PWA nenahrála ${failed} z ${CORE_ASSETS.length} souborů do offline cache.`);
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

async function networkFirst(request, fallbackUrl = '') {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response?.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (fallbackUrl) {
      const fallback = await cache.match(fallbackUrl);
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

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    const manualNavigation = url.pathname.includes('/manual/');
    event.respondWith(networkFirst(request, manualNavigation ? './manual/index.html' : './index.html'));
    return;
  }
  if (url.pathname.startsWith('/AI-Studio-GHRAB/') || url.pathname.endsWith('/manifest.webmanifest')) {
    event.respondWith(networkFirst(request));
    return;
  }
  event.respondWith(cacheFirst(request));
});

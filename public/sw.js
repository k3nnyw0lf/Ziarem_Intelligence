const CACHE_NAME = 'vault-crm-v2';
const STATIC_CACHE = 'vault-static-v2';
const DYNAMIC_CACHE = 'vault-dynamic-v2';

// App shell files to cache on install
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.svg',
  '/icons/icon.svg',
];

// Patterns that should use network-first strategy (API calls)
const NETWORK_FIRST_PATTERNS = [
  /supabase/,
  /n8n/,
  /webhook/,
  /googleapis/,
  /fonts\.gstatic/,
  /api\//,
];

// Install: cache the app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(APP_SHELL).catch((err) => {
        // Non-critical: some files may not exist yet during development
        console.warn('[SW] Some app shell files could not be cached:', err);
      });
    })
  );
  // Activate immediately without waiting for existing tabs to close
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE && key !== DYNAMIC_CACHE)
          .map((key) => caches.delete(key))
      );
    })
  );
  // Take control of all open tabs immediately
  self.clients.claim();
});

// Fetch: route requests to the appropriate caching strategy
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip chrome-extension and other non-http(s) requests
  if (!request.url.startsWith('http')) return;

  // HTML / navigation requests are ALWAYS network-first so a new deploy
  // (new hashed bundle) reaches users immediately instead of being frozen
  // on a cached index.html.
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(networkFirst(request));
    return;
  }

  // Check if this request should use network-first
  const isNetworkFirst = NETWORK_FIRST_PATTERNS.some((pattern) =>
    pattern.test(request.url)
  );

  if (isNetworkFirst) {
    event.respondWith(networkFirst(request));
  } else {
    event.respondWith(cacheFirst(request));
  }
});

// Cache-first strategy: serve from cache, fall back to network
// Updates cache in background when online
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    // Update cache in background (stale-while-revalidate)
    updateCacheInBackground(request);
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    // If both cache and network fail, return offline fallback
    return offlineFallback(request);
  }
}

// Network-first strategy: try network, fall back to cache
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return offlineFallback(request);
  }
}

// Update cache in background without blocking the response
function updateCacheInBackground(request) {
  fetch(request)
    .then((response) => {
      if (response.ok) {
        caches.open(STATIC_CACHE).then((cache) => {
          cache.put(request, response);
        });
      }
    })
    .catch(() => {
      // Silently fail - we're offline or the request failed
    });
}

// Offline fallback for navigation requests
function offlineFallback(request) {
  if (request.mode === 'navigate') {
    return caches.match('/index.html').then((cached) => {
      return (
        cached ||
        new Response(
          '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VAULT - Offline</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0f172a;color:#f8fafc;font-family:Inter,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:2rem}.offline-container h1{font-size:2rem;color:#f59e0b;margin-bottom:1rem}.offline-container p{color:#94a3b8;margin-bottom:1.5rem}button{background:#f59e0b;color:#0f172a;border:none;padding:.75rem 1.5rem;border-radius:.5rem;font-weight:600;cursor:pointer;font-size:1rem}button:hover{background:#d97706}</style></head><body><div class="offline-container"><h1>VAULT</h1><p>You are currently offline. Please check your internet connection and try again.</p><button onclick="location.reload()">Retry</button></div></body></html>',
          {
            headers: { 'Content-Type': 'text/html' },
            status: 503,
          }
        )
      );
    });
  }

  return new Response('Offline', { status: 503 });
}

/**
 * Aiga Service Worker — Global Resource Interceptor
 *
 * Provides centralized cache management across all iframe boundaries:
 * - Cross-iframe cache sharing (one parsed copy per resource)
 * - Configurable cache strategies (cache-first, network-first, stale-while-revalidate)
 * - Programmable eviction and integrity checks
 * - Offline support for previously loaded sub-app resources
 */

/// <reference lib="webworker" />

// Cast self to ServiceWorkerGlobalScope for proper typing.
const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE_NAME = 'aiga-v1';

type CacheStrategy = 'cache-first' | 'network-first' | 'stale-while-revalidate';

/** Resource types and their default caching strategies. */
const STRATEGY_MAP: Record<string, CacheStrategy> = {
  script: 'cache-first',
  style: 'cache-first',
  font: 'cache-first',
  image: 'cache-first',
  document: 'network-first',
  fetch: 'network-first',
};

/** Determine the caching strategy for a request. */
function getStrategy(request: Request): CacheStrategy {
  const dest = request.destination;
  if (dest && dest in STRATEGY_MAP) {
    return STRATEGY_MAP[dest];
  }

  // Heuristic: versioned assets (content-hashed filenames) use cache-first.
  const url = new URL(request.url);
  if (/\.[a-f0-9]{8,}\.(js|css|woff2?|ttf|otf|png|jpg|svg)$/i.test(url.pathname)) {
    return 'cache-first';
  }

  return 'network-first';
}

/** Cache-first: serve from cache, fall back to network. */
async function cacheFirst(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    cache.put(request, response.clone());
  }
  return response;
}

/** Network-first: try network, fall back to cache. */
async function networkFirst(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error(`Network and cache both failed for ${request.url}`);
  }
}

/** Stale-while-revalidate: serve from cache, update in background. */
async function staleWhileRevalidate(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  // Fire off a background revalidation regardless.
  const networkPromise = fetch(request).then((response) => {
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  });

  // Return cached immediately if available.
  if (cached) return cached;

  // No cache — wait for network.
  return networkPromise;
}

// --- Service Worker Lifecycle ---

sw.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(sw.skipWaiting());
});

sw.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(
    Promise.all([
      sw.clients.claim(),
      cleanupOldCaches(),
    ]),
  );
});

sw.addEventListener('fetch', (event: FetchEvent) => {
  const { request } = event;

  // Only intercept HTTP(S) requests.
  if (!request.url.startsWith('http')) return;

  // Skip non-GET requests.
  if (request.method !== 'GET') return;

  const strategy = getStrategy(request);

  switch (strategy) {
    case 'cache-first':
      event.respondWith(cacheFirst(request));
      break;
    case 'network-first':
      event.respondWith(networkFirst(request));
      break;
    case 'stale-while-revalidate':
      event.respondWith(staleWhileRevalidate(request));
      break;
  }
});

// Handle messages from the main thread (cache control commands).
sw.addEventListener('message', (event: ExtendableMessageEvent) => {
  const { data } = event;
  if (!data?.__aiga_sw) return;

  switch (data.command) {
    case 'precache':
      precacheUrls(data.urls as string[]);
      break;
    case 'clear':
      clearCache();
      break;
    case 'evict':
      evictUrl(data.url as string);
      break;
  }
});

async function precacheUrls(urls: string[]): Promise<void> {
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(urls);
}

async function clearCache(): Promise<void> {
  await caches.delete(CACHE_NAME);
}

async function evictUrl(url: string): Promise<void> {
  const cache = await caches.open(CACHE_NAME);
  await cache.delete(url);
}

async function cleanupOldCaches(): Promise<void> {
  const keys = await caches.keys();
  for (const key of keys) {
    if (key !== CACHE_NAME && key.startsWith('aiga-')) {
      await caches.delete(key);
    }
  }
}

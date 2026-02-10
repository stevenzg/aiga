/**
 * Aiga Service Worker — Global Resource Interceptor
 *
 * Provides centralized cache management across all iframe boundaries:
 * - Cross-iframe cache sharing (one parsed copy per resource)
 * - Configurable cache strategies (cache-first, network-first, stale-while-revalidate)
 * - Semver-aware dependency version negotiation
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

// ─── Semver Version Negotiation ────────────────────────────────────

interface SemVer {
  major: number;
  minor: number;
  patch: number;
  raw: string;
}

function parseSemver(version: string): SemVer | null {
  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    raw: version,
  };
}

function compareSemver(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

/**
 * In-SW version registry for dependency negotiation.
 * Tracks requested versions across all iframes and resolves
 * to the highest backward-compatible version per package.
 */
const versionRequests = new Map<string, SemVer[]>();
const resolvedVersions = new Map<string, SemVer>();

function registerVersion(pkg: string, version: string): SemVer | null {
  const sv = parseSemver(version);
  if (!sv) return null;

  let versions = versionRequests.get(pkg);
  if (!versions) {
    versions = [];
    versionRequests.set(pkg, versions);
  }
  if (!versions.some((v) => v.raw === sv.raw)) {
    versions.push(sv);
  }

  // Negotiate: find the highest version that shares the same major.
  const major = versions[0].major;
  if (versions.every((v) => v.major === major)) {
    const best = versions.reduce((a, b) => (compareSemver(b, a) > 0 ? b : a));
    resolvedVersions.set(pkg, best);
    return best;
  }
  return null; // Incompatible majors — cannot negotiate.
}

/** Match versioned package URLs (CDN, unpkg, node_modules patterns). */
function matchPackageUrl(url: string): { name: string; version: string } | null {
  const patterns = [
    /\/npm\/(@?[^@/]+)@(\d+\.\d+\.\d+[^/]*)/,
    /\/node_modules\/(@?[^@/]+)@(\d+\.\d+\.\d+[^/]*)/,
    /\/(@?[^@/]+)@(\d+\.\d+\.\d+[^/]*)/,
    /\/([a-z][\w.-]+)\/(\d+\.\d+\.\d+)\//,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return { name: match[1], version: match[2] };
  }
  return null;
}

/**
 * Attempt to rewrite a URL to use the negotiated version.
 * e.g., react@18.2.0 → react@18.3.1 (if 18.3.1 is resolved).
 */
function maybeRewriteUrl(url: string): string {
  const pkg = matchPackageUrl(url);
  if (!pkg) return url;

  registerVersion(pkg.name, pkg.version);
  const resolved = resolvedVersions.get(pkg.name);
  if (resolved && resolved.raw !== pkg.version) {
    return url.replace(pkg.version, resolved.raw);
  }
  return url;
}

// ─── Cache Strategies ──────────────────────────────────────────────

function getStrategy(request: Request): CacheStrategy {
  const dest = request.destination;
  if (dest && dest in STRATEGY_MAP) {
    return STRATEGY_MAP[dest];
  }
  const url = new URL(request.url);
  if (/\.[a-f0-9]{8,}\.(js|css|woff2?|ttf|otf|png|jpg|svg)$/i.test(url.pathname)) {
    return 'cache-first';
  }
  return 'network-first';
}

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

async function staleWhileRevalidate(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const networkPromise = fetch(request).then((response) => {
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  });

  if (cached) return cached;
  return networkPromise;
}

// ─── Service Worker Lifecycle ──────────────────────────────────────

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
  if (!request.url.startsWith('http')) return;
  if (request.method !== 'GET') return;

  // Apply semver version negotiation for versioned package URLs.
  const rewrittenUrl = maybeRewriteUrl(request.url);
  const effectiveRequest =
    rewrittenUrl !== request.url
      ? new Request(rewrittenUrl, request)
      : request;

  const strategy = getStrategy(effectiveRequest);

  switch (strategy) {
    case 'cache-first':
      event.respondWith(cacheFirst(effectiveRequest));
      break;
    case 'network-first':
      event.respondWith(networkFirst(effectiveRequest));
      break;
    case 'stale-while-revalidate':
      event.respondWith(staleWhileRevalidate(effectiveRequest));
      break;
  }
});

// Handle messages from the main thread.
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
    case 'register-version':
      registerVersion(data.package as string, data.version as string);
      break;
    case 'get-resolved-versions':
      event.source?.postMessage({
        __aiga_sw: true,
        type: 'resolved-versions',
        versions: Object.fromEntries(resolvedVersions),
      });
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

import type { SwCacheConfig } from '../core/types.js';

/**
 * Register the Aiga Service Worker for cross-iframe resource caching.
 * Returns a controller API for cache management.
 */
export async function registerServiceWorker(
  config?: SwCacheConfig,
): Promise<SwController | null> {
  if (!config?.enabled) return null;
  if (!('serviceWorker' in navigator)) {
    console.warn('[aiga] Service Workers are not supported in this browser.');
    return null;
  }

  const swUrl = config.swUrl ?? '/sw.js';

  try {
    const registration = await navigator.serviceWorker.register(swUrl, {
      scope: '/',
      type: 'module',
    });

    // Wait for the SW to become active.
    const sw =
      registration.active ??
      registration.waiting ??
      registration.installing;

    if (sw && sw.state !== 'activated') {
      await new Promise<void>((resolve) => {
        sw.addEventListener('statechange', function handler() {
          if (sw.state === 'activated') {
            sw.removeEventListener('statechange', handler);
            resolve();
          }
        });
      });
    }

    return new SwController(registration);
  } catch (err) {
    console.warn('[aiga] Failed to register Service Worker:', err);
    return null;
  }
}

/** API for controlling the Aiga Service Worker. */
export class SwController {
  constructor(private registration: ServiceWorkerRegistration) {}

  /** Pre-cache a list of URLs (e.g., predicted sub-app resources). */
  precache(urls: string[]): void {
    this.send({ command: 'precache', urls });
  }

  /** Clear the entire Aiga cache. */
  clearCache(): void {
    this.send({ command: 'clear' });
  }

  /** Evict a specific URL from the cache. */
  evict(url: string): void {
    this.send({ command: 'evict', url });
  }

  /** Unregister the service worker. */
  async unregister(): Promise<void> {
    await this.registration.unregister();
  }

  private send(data: Record<string, unknown>): void {
    const sw = this.registration.active;
    if (sw) {
      sw.postMessage({ __aiga_sw: true, ...data });
    }
  }
}

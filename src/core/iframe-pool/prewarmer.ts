/**
 * Smart Prewarmer — Predictive iframe & resource preloading.
 *
 * Analyzes route configuration and navigation patterns to predict
 * which sub-applications the user is likely to visit next. During
 * idle periods, it pre-creates iframes and pre-fetches resources
 * so navigation is near-instant.
 *
 * Strategies:
 *  1. Route adjacency: preload apps linked from the current route
 *  2. Frequency analysis: preload most-visited apps
 *  3. Explicit hints: honor `<link rel="prefetch">` style hints
 */

import type { IframePool } from './pool.js';

/** Route definition for prewarming analysis. */
export interface RouteConfig {
  /** Route path or pattern. */
  path: string;
  /** Sub-app URL to load for this route. */
  appSrc: string;
  /** Adjacent routes (likely navigation targets from this route). */
  adjacentPaths?: string[];
}

/** Navigation history entry for frequency analysis. */
interface NavEntry {
  path: string;
  timestamp: number;
}

export interface PrewarmerOptions {
  /** Route configuration for adjacency analysis. */
  routes?: RouteConfig[];
  /** Maximum number of apps to prewarm simultaneously. */
  maxPrewarm?: number;
  /** Whether to enable frequency-based prediction. Defaults to true. */
  frequencyAnalysis?: boolean;
}

export class Prewarmer {
  private routes: RouteConfig[];
  private routeMap = new Map<string, RouteConfig>();
  private navHistory: NavEntry[] = [];
  private frequencyCounts = new Map<string, number>();
  private maxPrewarm: number;
  private frequencyAnalysis: boolean;
  private pool: IframePool;
  private prewarmedUrls = new Set<string>();
  private prefetchLinks = new Map<string, HTMLLinkElement>();
  private idleCallbackId: number | null = null;

  constructor(pool: IframePool, options?: PrewarmerOptions) {
    this.pool = pool;
    this.routes = options?.routes ?? [];
    this.maxPrewarm = options?.maxPrewarm ?? 2;
    this.frequencyAnalysis = options?.frequencyAnalysis ?? true;

    for (const route of this.routes) {
      this.routeMap.set(route.path, route);
    }
  }

  /** Update route configuration (e.g., after dynamic route registration). */
  setRoutes(routes: RouteConfig[]): void {
    this.routes = routes;
    this.routeMap.clear();
    for (const route of routes) {
      this.routeMap.set(route.path, route);
    }
  }

  /**
   * Record a navigation event. This feeds the frequency analyzer
   * and triggers predictive prewarming in the next idle period.
   */
  recordNavigation(path: string): void {
    this.navHistory.push({ path, timestamp: Date.now() });
    this.frequencyCounts.set(
      path,
      (this.frequencyCounts.get(path) ?? 0) + 1,
    );

    // Trim old history (keep last 100 entries).
    if (this.navHistory.length > 100) {
      this.navHistory = this.navHistory.slice(-100);
    }

    this.schedulePrewarm(path);
  }

  /**
   * Get predicted next routes based on the current path.
   * Uses adjacency analysis + frequency analysis.
   */
  predict(currentPath: string): string[] {
    const candidates = new Map<string, number>();

    // Strategy 1: Route adjacency.
    const currentRoute = this.routeMap.get(currentPath);
    if (currentRoute?.adjacentPaths) {
      for (const adj of currentRoute.adjacentPaths) {
        const adjRoute = this.routeMap.get(adj);
        if (adjRoute) {
          candidates.set(
            adjRoute.appSrc,
            (candidates.get(adjRoute.appSrc) ?? 0) + 10,
          );
        }
      }
    }

    // Strategy 2: Frequency analysis.
    if (this.frequencyAnalysis) {
      for (let i = 0; i < this.navHistory.length - 1; i++) {
        if (this.navHistory[i].path === currentPath) {
          const nextPath = this.navHistory[i + 1].path;
          const nextRoute = this.routeMap.get(nextPath);
          if (nextRoute) {
            candidates.set(
              nextRoute.appSrc,
              (candidates.get(nextRoute.appSrc) ?? 0) + 5,
            );
          }
        }
      }

      for (const route of this.routes) {
        const freq = this.frequencyCounts.get(route.path) ?? 0;
        if (freq > 0) {
          candidates.set(
            route.appSrc,
            (candidates.get(route.appSrc) ?? 0) + freq,
          );
        }
      }
    }

    if (currentRoute) {
      candidates.delete(currentRoute.appSrc);
    }

    return [...candidates.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, this.maxPrewarm)
      .map(([url]) => url);
  }

  /** Explicitly add URLs to prewarm (like `<link rel="prefetch">`). */
  hint(urls: string[]): void {
    this.scheduleResourcePrefetch(urls);
  }

  private schedulePrewarm(currentPath: string): void {
    if (this.idleCallbackId !== null) {
      this.cancelIdle(this.idleCallbackId);
    }

    this.idleCallbackId = this.requestIdle(() => {
      this.idleCallbackId = null;

      const predictions = this.predict(currentPath);
      const toPrefetch = predictions.filter((url) => !this.prewarmedUrls.has(url));

      if (toPrefetch.length > 0) {
        this.scheduleResourcePrefetch(toPrefetch);
      }
    });
  }

  /** Prefetch resources for predicted sub-apps using <link rel="prefetch">. */
  private scheduleResourcePrefetch(urls: string[]): void {
    for (const url of urls) {
      if (this.prewarmedUrls.has(url)) continue;
      this.prewarmedUrls.add(url);

      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.href = url;
      link.as = 'document';
      document.head.appendChild(link);
      this.prefetchLinks.set(url, link);
    }
  }

  stats(): {
    prewarmedCount: number;
    navHistorySize: number;
    routeCount: number;
  } {
    return {
      prewarmedCount: this.prewarmedUrls.size,
      navHistorySize: this.navHistory.length,
      routeCount: this.routes.length,
    };
  }

  private requestIdle(cb: () => void): number {
    if (typeof requestIdleCallback !== 'undefined') {
      return requestIdleCallback(cb) as unknown as number;
    }
    return setTimeout(cb, 50) as unknown as number;
  }

  private cancelIdle(id: number): void {
    if (typeof cancelIdleCallback !== 'undefined') {
      cancelIdleCallback(id);
    } else {
      clearTimeout(id);
    }
  }

  dispose(): void {
    if (this.idleCallbackId !== null) {
      this.cancelIdle(this.idleCallbackId);
    }

    // Remove all prefetch <link> elements from the DOM.
    for (const link of this.prefetchLinks.values()) {
      link.remove();
    }
    this.prefetchLinks.clear();
    this.prewarmedUrls.clear();
    this.navHistory = [];
    this.frequencyCounts.clear();
  }
}

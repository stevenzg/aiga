/**
 * Aiga Router — URL-based routing for micro-frontend applications.
 *
 * Maps URL paths to sub-applications and manages navigation lifecycle.
 * Supports both history (pushState) and hash modes.
 *
 * Features:
 * - NAV-01: pushState-based sub-app switching
 * - NAV-02: sub-app internal routing preserved
 * - NAV-03/04: Browser back/forward navigation
 * - NAV-05: Direct URL entry
 * - NAV-06: Nested routes
 * - NAV-07: Hash mode support
 * - NAV-08: Route guards (beforeEach, afterEach)
 * - NAV-09: 404 handling
 */

import type { SandboxLevel } from '../types.js';

/** Configuration for a single route. */
export interface RouteConfig {
  /** URL path pattern (e.g., '/dashboard', '/settings/:id'). */
  path: string;
  /** Sub-app configuration for this route. */
  app?: {
    src: string;
    sandbox?: SandboxLevel;
    props?: Record<string, unknown>;
  };
  /** Nested child routes. */
  children?: RouteConfig[];
  /** Redirect to another path. */
  redirect?: string;
  /** Per-route guard. */
  beforeEnter?: NavigationGuard;
  /** Route metadata. */
  meta?: Record<string, unknown>;
}

/** Resolved route match. */
export interface MatchedRoute {
  path: string;
  config: RouteConfig;
  params: Record<string, string>;
  matched: RouteConfig[];
  fullPath: string;
  query: Record<string, string>;
  meta: Record<string, unknown>;
}

/** Navigation guard function. Return false to cancel navigation. */
export type NavigationGuard = (
  to: MatchedRoute,
  from: MatchedRoute | null,
) => boolean | Promise<boolean>;

/** Navigation hook called after navigation completes. */
export type NavigationHook = (
  to: MatchedRoute,
  from: MatchedRoute | null,
) => void;

/** Router configuration options. */
export interface RouterOptions {
  /** Routing mode: 'history' (pushState) or 'hash'. Defaults to 'history'. */
  mode?: 'history' | 'hash';
  /** Route definitions. */
  routes: RouteConfig[];
  /** 404 fallback configuration. */
  notFound?: {
    src: string;
    sandbox?: SandboxLevel;
  };
  /** Base path prefix (e.g., '/app'). */
  base?: string;
}

/** Events emitted by the router. */
export interface RouterEvents {
  'route-change': CustomEvent<{ to: MatchedRoute; from: MatchedRoute | null }>;
  'not-found': CustomEvent<{ path: string }>;
}

/**
 * Aiga Router.
 *
 * Manages URL-based routing for micro-frontend applications.
 * Works with `<mf-app>` elements via the `<mf-router-view>` component
 * or programmatic API.
 *
 * @example
 * ```ts
 * const router = new Router({
 *   mode: 'history',
 *   routes: [
 *     { path: '/dashboard', app: { src: 'https://dashboard.app/' } },
 *     { path: '/settings', app: { src: 'https://settings.app/' } },
 *     { path: '/users/:id', app: { src: 'https://users.app/' } },
 *   ],
 *   notFound: { src: 'https://404.app/' },
 * });
 * ```
 */
export class Router {
  private routes: RouteConfig[];
  private mode: 'history' | 'hash';
  private base: string;
  private notFoundConfig: RouterOptions['notFound'];
  private currentRoute: MatchedRoute | null = null;
  private beforeGuards: Set<NavigationGuard> = new Set();
  private afterHooks: Set<NavigationHook> = new Set();
  private popstateHandler: (() => void) | null = null;
  private eventTarget = new EventTarget();
  private disposed = false;

  constructor(options: RouterOptions) {
    this.routes = options.routes;
    this.mode = options.mode ?? 'history';
    this.base = options.base?.replace(/\/$/, '') ?? '';
    this.notFoundConfig = options.notFound;

    this.popstateHandler = () => this.onUrlChange();

    if (this.mode === 'hash') {
      window.addEventListener('hashchange', this.popstateHandler);
    } else {
      window.addEventListener('popstate', this.popstateHandler);
    }

    // Resolve initial route.
    this.onUrlChange();
  }

  /** Get the current matched route. */
  getCurrentRoute(): MatchedRoute | null {
    return this.currentRoute;
  }

  /**
   * Navigate to a new path (NAV-01).
   * Uses pushState in history mode, hash update in hash mode.
   */
  async push(path: string): Promise<void> {
    if (this.disposed) return;
    await this.navigate(path, false);
  }

  /** Replace the current route without adding a history entry. */
  async replace(path: string): Promise<void> {
    if (this.disposed) return;
    await this.navigate(path, true);
  }

  /** Go back one step (NAV-03). */
  back(): void {
    history.back();
  }

  /** Go forward one step (NAV-04). */
  forward(): void {
    history.forward();
  }

  /** Go to a specific history offset. */
  go(delta: number): void {
    history.go(delta);
  }

  /** Register a global before-each guard (NAV-08). */
  beforeEach(guard: NavigationGuard): () => void {
    this.beforeGuards.add(guard);
    return () => this.beforeGuards.delete(guard);
  }

  /** Register a global after-each hook. */
  afterEach(hook: NavigationHook): () => void {
    this.afterHooks.add(hook);
    return () => this.afterHooks.delete(hook);
  }

  /** Listen for router events. */
  on<K extends keyof RouterEvents>(
    event: K,
    handler: (e: RouterEvents[K]) => void,
  ): () => void {
    this.eventTarget.addEventListener(event, handler as EventListener);
    return () => this.eventTarget.removeEventListener(event, handler as EventListener);
  }

  /** Clean up the router. */
  dispose(): void {
    this.disposed = true;
    if (this.popstateHandler) {
      if (this.mode === 'hash') {
        window.removeEventListener('hashchange', this.popstateHandler);
      } else {
        window.removeEventListener('popstate', this.popstateHandler);
      }
      this.popstateHandler = null;
    }
    this.beforeGuards.clear();
    this.afterHooks.clear();
  }

  // --- Internal ---

  private getCurrentPath(): string {
    if (this.mode === 'hash') {
      return window.location.hash.slice(1) || '/';
    }
    const path = window.location.pathname;
    if (this.base && path.startsWith(this.base)) {
      return path.slice(this.base.length) || '/';
    }
    return path;
  }

  private getCurrentQuery(): Record<string, string> {
    const params: Record<string, string> = {};
    const searchParams = new URLSearchParams(window.location.search);
    for (const [key, value] of searchParams) {
      params[key] = value;
    }
    return params;
  }

  private async navigate(path: string, isReplace: boolean): Promise<void> {
    const matched = this.matchRoute(path, this.routes, []);

    if (!matched) {
      // NAV-09: 404 handling.
      this.handleNotFound(path, isReplace);
      return;
    }

    // Handle redirects.
    if (matched.config.redirect) {
      await this.navigate(matched.config.redirect, true);
      return;
    }

    // Run guards (NAV-08).
    const allowed = await this.runGuards(matched);
    if (!allowed) return;

    // Update URL.
    const fullPath = this.base + path;
    if (this.mode === 'hash') {
      if (isReplace) {
        const url = window.location.pathname + window.location.search + '#' + path;
        history.replaceState(null, '', url);
      } else {
        window.location.hash = path;
      }
    } else {
      if (isReplace) {
        history.replaceState(null, '', fullPath);
      } else {
        history.pushState(null, '', fullPath);
      }
    }

    // Update current route and notify.
    const from = this.currentRoute;
    this.currentRoute = matched;

    this.eventTarget.dispatchEvent(
      new CustomEvent('route-change', {
        detail: { to: matched, from },
      }),
    );

    for (const hook of this.afterHooks) {
      hook(matched, from);
    }
  }

  private async onUrlChange(): Promise<void> {
    const path = this.getCurrentPath();
    const matched = this.matchRoute(path, this.routes, []);

    if (!matched) {
      this.handleNotFound(path, true);
      return;
    }

    // Handle redirects.
    if (matched.config.redirect) {
      await this.navigate(matched.config.redirect, true);
      return;
    }

    // Run guards.
    const allowed = await this.runGuards(matched);
    if (!allowed) return;

    const from = this.currentRoute;
    this.currentRoute = matched;

    this.eventTarget.dispatchEvent(
      new CustomEvent('route-change', {
        detail: { to: matched, from },
      }),
    );

    for (const hook of this.afterHooks) {
      hook(matched, from);
    }
  }

  private handleNotFound(path: string, isReplace: boolean): void {
    if (this.notFoundConfig) {
      const notFoundRoute: MatchedRoute = {
        path,
        config: { path, app: this.notFoundConfig },
        params: {},
        matched: [{ path, app: this.notFoundConfig }],
        fullPath: this.base + path,
        query: this.getCurrentQuery(),
        meta: {},
      };

      const from = this.currentRoute;
      this.currentRoute = notFoundRoute;

      // Update URL for direct URL entry.
      if (!isReplace && this.mode !== 'hash') {
        history.replaceState(null, '', this.base + path);
      }

      this.eventTarget.dispatchEvent(
        new CustomEvent('route-change', {
          detail: { to: notFoundRoute, from },
        }),
      );
    }

    this.eventTarget.dispatchEvent(
      new CustomEvent('not-found', {
        detail: { path },
      }),
    );
  }

  private async runGuards(to: MatchedRoute): Promise<boolean> {
    // Per-route guard.
    if (to.config.beforeEnter) {
      const allowed = await to.config.beforeEnter(to, this.currentRoute);
      if (!allowed) return false;
    }

    // Global guards.
    for (const guard of this.beforeGuards) {
      const allowed = await guard(to, this.currentRoute);
      if (!allowed) return false;
    }

    return true;
  }

  /**
   * Match a path against the route definitions (NAV-06: supports nested routes).
   * Returns the matched route with params and full match chain.
   */
  private matchRoute(
    path: string,
    routes: RouteConfig[],
    parentChain: RouteConfig[],
  ): MatchedRoute | null {
    // Split off query string.
    const [pathOnly] = path.split('?');

    for (const route of routes) {
      const params: Record<string, string> = {};
      const matched = this.matchPath(pathOnly, route.path, params);

      if (matched) {
        const chain = [...parentChain, route];

        // Check children first (longest match wins).
        if (route.children?.length) {
          const remainder = pathOnly.slice(route.path.replace(/\/:[\w]+/g, '').length) || '/';
          const childMatch = this.matchRoute(remainder, route.children, chain);
          if (childMatch) {
            childMatch.params = { ...params, ...childMatch.params };
            return childMatch;
          }
        }

        // Leaf match.
        return {
          path: pathOnly,
          config: route,
          params,
          matched: chain,
          fullPath: this.base + path,
          query: this.getCurrentQuery(),
          meta: route.meta ?? {},
        };
      }
    }

    return null;
  }

  /**
   * Match a URL path against a route pattern.
   * Supports:
   * - Static segments: '/dashboard'
   * - Dynamic params: '/users/:id'
   * - Wildcards: '/docs/*' (catch-all)
   */
  private matchPath(
    urlPath: string,
    pattern: string,
    params: Record<string, string>,
  ): boolean {
    const urlParts = urlPath.split('/').filter(Boolean);
    const patternParts = pattern.split('/').filter(Boolean);

    // Wildcard catch-all.
    if (patternParts[patternParts.length - 1] === '*') {
      const staticParts = patternParts.slice(0, -1);
      if (urlParts.length < staticParts.length) return false;
      for (let i = 0; i < staticParts.length; i++) {
        if (staticParts[i].startsWith(':')) {
          params[staticParts[i].slice(1)] = urlParts[i];
        } else if (staticParts[i] !== urlParts[i]) {
          return false;
        }
      }
      params['*'] = urlParts.slice(staticParts.length).join('/');
      return true;
    }

    if (urlParts.length !== patternParts.length) return false;

    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith(':')) {
        params[patternParts[i].slice(1)] = urlParts[i];
      } else if (patternParts[i] !== urlParts[i]) {
        return false;
      }
    }

    return true;
  }
}

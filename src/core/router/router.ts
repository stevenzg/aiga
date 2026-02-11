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
import { matchRoute } from './route-matcher.js';

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
 * Works with `<aiga-app>` elements via the `<aiga-view>` component
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

  private parseQuery(search: string): Record<string, string> {
    const params: Record<string, string> = {};
    const searchParams = new URLSearchParams(search);
    for (const [key, value] of searchParams) {
      params[key] = value;
    }
    return params;
  }

  private parsePathQuery(path: string): Record<string, string> {
    const qIdx = path.indexOf('?');
    return qIdx >= 0 ? this.parseQuery(path.slice(qIdx)) : {};
  }

  /**
   * Resolve a matched route: run guards, handle redirects, and apply.
   * Shared by both navigate() and onUrlChange() to avoid duplication.
   */
  private async resolveAndApply(
    matched: MatchedRoute | null,
    path: string,
    isReplace: boolean,
    updateUrl: boolean,
  ): Promise<void> {
    if (!matched) {
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

    // Update URL if requested (programmatic navigation, not popstate).
    if (updateUrl) {
      this.updateUrl(path, isReplace);
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

  private async navigate(path: string, isReplace: boolean): Promise<void> {
    const query = this.parsePathQuery(path);
    const matched = matchRoute(path, this.routes, [], query, this.base);
    await this.resolveAndApply(matched, path, isReplace, true);
  }

  private async onUrlChange(): Promise<void> {
    const path = this.getCurrentPath();
    const query = this.parsePathQuery(path);
    const matched = matchRoute(path, this.routes, [], query, this.base);
    await this.resolveAndApply(matched, path, true, false);
  }

  private updateUrl(path: string, isReplace: boolean): void {
    if (this.mode === 'hash') {
      const url = window.location.pathname + window.location.search + '#' + path;
      if (isReplace) {
        history.replaceState(null, '', url);
      } else {
        history.pushState(null, '', url);
      }
    } else {
      const fullPath = this.base + path;
      if (isReplace) {
        history.replaceState(null, '', fullPath);
      } else {
        history.pushState(null, '', fullPath);
      }
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
        query: this.parseQuery(window.location.search),
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
}

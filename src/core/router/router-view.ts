/**
 * `<aiga-view>` — Declarative router outlet for Aiga.
 *
 * Listens to Router events and automatically renders the matched
 * `<aiga-app>` element with the correct src and sandbox attributes.
 *
 * @example
 * ```html
 * <aiga-view></aiga-view>
 * ```
 *
 * ```ts
 * const router = new Router({ routes: [...] });
 * const view = document.querySelector('aiga-view');
 * view.router = router;
 * ```
 */

import type { Router, MatchedRoute } from './router.js';

export class AigaViewElement extends HTMLElement {
  static readonly tagName = 'aiga-view';

  private _router: Router | null = null;
  private unsubscribe: (() => void) | null = null;
  private currentApp: HTMLElement | null = null;

  /** Set the router instance for this view. */
  get router(): Router | null {
    return this._router;
  }
  set router(r: Router | null) {
    // Clean up old subscription.
    this.unsubscribe?.();
    this.unsubscribe = null;
    this._router = r;

    if (r) {
      this.unsubscribe = r.on('route-change', (e) => {
        this.onRouteChange(e.detail.to);
      });
      // Render the current route immediately.
      const current = r.getCurrentRoute();
      if (current) {
        this.onRouteChange(current);
      }
    }
  }

  disconnectedCallback(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private onRouteChange(route: MatchedRoute): void {
    const appConfig = route.config.app;
    if (!appConfig) {
      // No app for this route — clear the view.
      this.innerHTML = '';
      this.currentApp = null;
      return;
    }

    // Check if we can reuse the existing element (same src).
    if (
      this.currentApp &&
      this.currentApp.getAttribute('src') === appConfig.src
    ) {
      // Same app, just update props if needed.
      if (appConfig.props) {
        (this.currentApp as unknown as { props: Record<string, unknown> }).props = {
          ...appConfig.props,
          $route: { params: route.params, query: route.query, path: route.path },
        };
      }
      return;
    }

    // Create a new <aiga-app> element.
    this.innerHTML = '';
    const aigaApp = document.createElement('aiga-app');
    aigaApp.setAttribute('src', appConfig.src);
    if (appConfig.sandbox) {
      aigaApp.setAttribute('sandbox', appConfig.sandbox);
    }

    // Pass route params and query as props.
    (aigaApp as unknown as { props: Record<string, unknown> }).props = {
      ...(appConfig.props ?? {}),
      $route: { params: route.params, query: route.query, path: route.path },
    };

    this.appendChild(aigaApp);
    this.currentApp = aigaApp;
  }
}

/** Register the `<aiga-view>` custom element. */
export function registerAigaView(): void {
  if (!customElements.get(AigaViewElement.tagName)) {
    customElements.define(AigaViewElement.tagName, AigaViewElement);
  }
}

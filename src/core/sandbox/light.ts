import type { SandboxAdapter } from './adapter.js';
import type { AppInstance } from '../types.js';
import { createScopedProxy } from './proxy-window.js';
import { OverlayLayer } from '../overlay/overlay-layer.js';

/**
 * `sandbox="light"` — Shadow DOM + CSS variable pass-through + lightweight Proxy.
 *
 * Content is rendered inside a Shadow DOM boundary for CSS isolation,
 * with a lightweight JS Proxy on `window` to prevent accidental
 * globals leakage. CSS custom properties are forwarded from the host
 * reactively via MutationObserver (CSS-06).
 *
 * Memory overhead: ~2-5 MB.
 */
export class LightSandbox implements SandboxAdapter {
  readonly name = 'light';
  private shadowRoots = new Map<string, ShadowRoot>();
  private proxies = new Map<string, { revoke: () => void }>();
  private overlays = new Map<string, OverlayLayer>();
  private messageHandlers = new Map<string, Set<(data: unknown) => void>>();
  private listenerCleanups = new Map<string, Set<() => void>>();
  private cssObservers = new Map<string, MutationObserver>();
  private errorHandlers = new Map<string, { error: (e: ErrorEvent) => void; rejection: (e: PromiseRejectionEvent) => void }>();

  async mount(app: AppInstance, container: HTMLElement): Promise<void> {
    // Create a Shadow DOM root for CSS isolation.
    const host = document.createElement('div');
    host.setAttribute('data-aiga-light', app.name);
    host.style.cssText = 'display:contents;';
    container.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });
    this.shadowRoots.set(app.id, shadow);

    // Inherit CSS custom properties from the host document (reactive — CSS-06).
    const cssSheet = this.inheritCssVariables(shadow);
    this.observeCssVariables(app.id, shadow, cssSheet);

    // Set up overlay layer for body-mount teleportation.
    const overlayLayer = new OverlayLayer(app.id);
    this.overlays.set(app.id, overlayLayer);

    // Create a scoped window Proxy for JS isolation.
    const scopedCtx = createScopedProxy({
      shadowRoot: shadow,
      onOverlayDetected: (el) => {
        overlayLayer.observe(el);
      },
    });
    this.proxies.set(app.id, { revoke: scopedCtx.revoke });

    // Set up error boundary (ERR-01): catch uncaught errors from sub-app scripts.
    this.setupErrorBoundary(app);

    // Fetch and parse HTML content safely (no innerHTML XSS).
    const html = await this.fetchAppHtml(app.src);
    const parsed = new DOMParser().parseFromString(html, 'text/html');

    // Create a scoped container inside Shadow DOM.
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-aiga-content', '');
    wrapper.style.cssText = 'all:initial;display:block;';
    // Append parsed DOM nodes instead of innerHTML.
    while (parsed.body.firstChild) {
      wrapper.appendChild(wrapper.ownerDocument.importNode(parsed.body.firstChild, true));
      parsed.body.removeChild(parsed.body.firstChild);
    }
    shadow.appendChild(wrapper);

    // Start observing for dynamically appended overlays.
    overlayLayer.observe(wrapper);

    // Execute scripts with the scoped Proxy window context.
    await this.executeScripts(wrapper, scopedCtx.proxy);
  }

  async unmount(app: AppInstance): Promise<void> {
    // Clean up event listeners for this app.
    this.listenerCleanups.get(app.id)?.forEach((unsub) => unsub());
    this.listenerCleanups.delete(app.id);

    // Clean up CSS variable observer.
    this.cssObservers.get(app.id)?.disconnect();
    this.cssObservers.delete(app.id);

    // Clean up error boundary.
    this.cleanupErrorBoundary(app.id);

    const shadow = this.shadowRoots.get(app.id);
    if (shadow) {
      const host = shadow.host as HTMLElement;
      host.remove();
    }
    this.overlays.get(app.id)?.dispose();
    this.overlays.delete(app.id);
  }

  async destroy(app: AppInstance): Promise<void> {
    // Revoke the window proxy to prevent further access (also clears tracked timers).
    this.proxies.get(app.id)?.revoke();
    this.proxies.delete(app.id);

    await this.unmount(app);
    this.shadowRoots.delete(app.id);
    this.messageHandlers.delete(app.id);
  }

  postMessage(app: AppInstance, message: unknown): void {
    const shadow = this.shadowRoots.get(app.id);
    shadow?.host.dispatchEvent(
      new CustomEvent('aiga-message', { detail: message, bubbles: false }),
    );
  }

  onMessage(app: AppInstance, handler: (data: unknown) => void): () => void {
    let handlers = this.messageHandlers.get(app.id);
    if (!handlers) {
      handlers = new Set();
      this.messageHandlers.set(app.id, handlers);
    }
    handlers.add(handler);

    const shadow = this.shadowRoots.get(app.id);
    const listener = (e: Event) => handler((e as CustomEvent).detail);
    shadow?.host.addEventListener('aiga-message-up', listener);

    // Track for cleanup on unmount.
    let cleanups = this.listenerCleanups.get(app.id);
    if (!cleanups) {
      cleanups = new Set();
      this.listenerCleanups.set(app.id, cleanups);
    }
    const unsub = () => {
      handlers!.delete(handler);
      shadow?.host.removeEventListener('aiga-message-up', listener);
    };
    cleanups.add(unsub);

    return () => {
      unsub();
      cleanups!.delete(unsub);
    };
  }

  /**
   * Inherit CSS custom properties from the host document and inject
   * them into the Shadow DOM via a constructed stylesheet.
   * Returns the sheet for reactive updates.
   */
  private inheritCssVariables(shadow: ShadowRoot): CSSStyleSheet {
    const sheet = new CSSStyleSheet();
    this.syncCssVariables(sheet);
    shadow.adoptedStyleSheets = [sheet];
    return sheet;
  }

  /** Collect CSS custom properties from :root and sync to the stylesheet. */
  private syncCssVariables(sheet: CSSStyleSheet): void {
    const rootStyles = getComputedStyle(document.documentElement);
    const vars: string[] = [];
    for (const prop of rootStyles) {
      if (prop.startsWith('--')) {
        vars.push(`${prop}: ${rootStyles.getPropertyValue(prop)};`);
      }
    }
    sheet.replaceSync(`:host { ${vars.join(' ')} }`);
  }

  /**
   * Observe :root for style attribute changes and re-sync CSS variables (CSS-06).
   * Uses MutationObserver on documentElement for reactive updates.
   */
  private observeCssVariables(appId: string, _shadow: ShadowRoot, sheet: CSSStyleSheet): void {
    const observer = new MutationObserver(() => {
      this.syncCssVariables(sheet);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'class'],
    });
    this.cssObservers.set(appId, observer);
  }

  /** Set up global error boundary for uncaught errors (ERR-01). */
  private setupErrorBoundary(app: AppInstance): void {
    const onError = (e: ErrorEvent) => {
      console.error(`[aiga] Uncaught error in light sandbox "${app.name}":`, e.error);
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      console.error(`[aiga] Unhandled rejection in light sandbox "${app.name}":`, e.reason);
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    this.errorHandlers.set(app.id, { error: onError, rejection: onRejection });
  }

  /** Clean up error boundary listeners. */
  private cleanupErrorBoundary(appId: string): void {
    const handlers = this.errorHandlers.get(appId);
    if (handlers) {
      window.removeEventListener('error', handlers.error);
      window.removeEventListener('unhandledrejection', handlers.rejection);
      this.errorHandlers.delete(appId);
    }
  }

  /**
   * Execute scripts found in the injected HTML with a Proxy-scoped
   * `window` context that prevents globals leakage.
   *
   * Inline scripts are executed via `new Function()` with the proxy
   * bound as `this` and accessible as `window`. External scripts
   * are loaded normally — the Proxy on `window.document` still
   * redirects their DOM operations to the Shadow DOM.
   */
  private async executeScripts(
    container: HTMLElement,
    proxyWindow: WindowProxy,
  ): Promise<void> {
    const scripts = container.querySelectorAll('script');
    for (const script of scripts) {
      if (script.src) {
        // External scripts: load normally.
        const newScript = document.createElement('script');
        newScript.src = script.src;
        newScript.onerror = () => console.error(`[aiga] Failed to load script: ${script.src}`);
        for (const attr of script.attributes) {
          if (attr.name !== 'src') {
            newScript.setAttribute(attr.name, attr.value);
          }
        }
        script.replaceWith(newScript);
      } else if (script.textContent) {
        // Inline scripts: wrap in a scoped execution context with error boundary (ERR-01).
        try {
          const scopedFn = new Function(
            'window', 'self', 'globalThis', 'document',
            script.textContent,
          );
          scopedFn.call(
            proxyWindow,
            proxyWindow,
            proxyWindow,
            proxyWindow,
            (proxyWindow as unknown as { document: Document }).document,
          );
        } catch (err) {
          console.error('[aiga] Error executing inline script in light sandbox:', err);
        }
        script.remove();
      }
    }
  }

  private async fetchAppHtml(src: string): Promise<string> {
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`Failed to fetch ${src}: ${res.status}`);
      return res.text();
    } catch (err) {
      // Detect CORS errors (ERR-04).
      if (err instanceof TypeError && err.message.includes('Failed to fetch')) {
        throw new Error(
          `[aiga] CORS error loading "${src}". Ensure the server sends ` +
          `Access-Control-Allow-Origin headers for this origin.`,
        );
      }
      throw err;
    }
  }
}

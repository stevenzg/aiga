import type { SandboxAdapter } from './adapter.js';
import type { AppInstance } from '../types.js';
import type { IframePool } from '../iframe-pool/pool.js';
import { setupDomBridge } from './dom-bridge.js';

/** Derive origin from a URL for secure postMessage. Throws on invalid URL. */
function getOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    throw new Error(`[aiga] Invalid URL for sandbox: ${url}`);
  }
}

/** Collect CSS custom properties from :root. */
function collectCssVariables(): Record<string, string> {
  const vars: Record<string, string> = {};
  const rootStyles = getComputedStyle(document.documentElement);
  for (const prop of rootStyles) {
    if (prop.startsWith('--')) {
      vars[prop] = rootStyles.getPropertyValue(prop).trim();
    }
  }
  return vars;
}

/**
 * `sandbox="strict"` — Pooled iframe + Shadow DOM + Proxy bridge + Overlay layer.
 *
 * The sub-application runs in a pooled iframe for full JS isolation.
 * A DOM proxy bridge intercepts overlay operations (modal, popover)
 * inside the iframe and promotes the iframe to viewport mode for
 * full interactivity. The iframe is visually embedded within a Shadow
 * DOM container so it participates in the host document's layout flow.
 *
 * Security overrides (via bridge script):
 * - window.top/parent are frozen to prevent iframe escape (SEC-01/02)
 * - localStorage/sessionStorage are namespaced per app (JS-06)
 * - CSS variables are synced from host to iframe via postMessage (CSS-03)
 *
 * Memory overhead: ~15-20 MB per sub-app.
 */
export class StrictSandbox implements SandboxAdapter {
  readonly name = 'strict';
  private iframes = new Map<string, HTMLIFrameElement>();
  private shadowRoots = new Map<string, ShadowRoot>();
  private wrappers = new Map<string, HTMLElement>();
  private messageListeners = new Map<string, (e: MessageEvent) => void>();
  private resizeListeners = new Map<string, (e: MessageEvent) => void>();
  private resizeObservers = new Map<string, ResizeObserver>();
  private bridgeCleanups = new Map<string, () => void>();
  private loadListeners = new Map<string, () => void>();
  private appOrigins = new Map<string, string>();
  private cssObservers = new Map<string, MutationObserver>();
  private promoted = new Map<string, { originalStyle: string }>();

  constructor(private pool: IframePool) {}

  async mount(app: AppInstance, container: HTMLElement): Promise<void> {
    const origin = getOrigin(app.src);
    this.appOrigins.set(app.id, origin);

    // Create Shadow DOM host for layout encapsulation.
    const host = document.createElement('div');
    host.setAttribute('data-aiga-strict', app.name);
    host.style.cssText = 'display:block;width:100%;position:relative;';
    container.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });
    this.shadowRoots.set(app.id, shadow);

    // Style the iframe container inside Shadow DOM.
    const style = new CSSStyleSheet();
    style.replaceSync(`
      :host {
        display: block;
        width: 100%;
        contain: layout;
      }
      .aiga-iframe-wrapper {
        width: 100%;
        overflow: hidden;
        position: relative;
      }
      .aiga-iframe-wrapper.aiga-promoted {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        z-index: 2147483647;
        overflow: visible;
      }
      iframe {
        border: none;
        width: 100%;
        display: block;
        min-height: 200px;
      }
      .aiga-promoted iframe {
        width: 100vw;
        height: 100vh;
      }
    `);
    shadow.adoptedStyleSheets = [style];

    // Reuse existing iframe (keepAlive restore) or acquire from pool.
    let iframe = this.iframes.get(app.id);
    const isRestore = !!iframe;
    if (!iframe) {
      iframe = this.pool.acquire(app.id);
      this.iframes.set(app.id, iframe);
    }

    // Wrap iframe in a container inside Shadow DOM.
    const wrapper = document.createElement('div');
    wrapper.className = 'aiga-iframe-wrapper';
    wrapper.appendChild(iframe);
    shadow.appendChild(wrapper);
    this.wrappers.set(app.id, wrapper);

    // Set up the DOM bridge with iframe promotion callbacks (OV-01~07).
    const cleanupBridge = setupDomBridge(iframe, {
      parentOrigin: origin,
      appId: app.id,
      onOverlayShow: () => this.promoteIframe(app.id),
      onOverlayHide: () => this.demoteIframe(app.id),
    });
    this.bridgeCleanups.set(app.id, cleanupBridge);

    // Set up auto-resizing: listen for height changes from the iframe.
    this.setupAutoResize(app.id, iframe);

    // Only navigate on fresh mount (not keepAlive restore).
    if (!isRestore) {
      // Note: allow-same-origin is needed for the DOM bridge to inject scripts
      // into same-origin iframes. The bridge script overrides window.top/parent
      // and namespaces localStorage/sessionStorage for security (SEC-01/02, JS-06).
      iframe.removeAttribute('sandbox');
      iframe.setAttribute(
        'sandbox',
        'allow-scripts allow-same-origin allow-forms allow-popups allow-modals',
      );
      iframe.setAttribute('allow', 'clipboard-read; clipboard-write');
      iframe.src = app.src;

      // Wait for the iframe to load.
      await new Promise<void>((resolve, reject) => {
        const onLoad = () => {
          iframe.removeEventListener('load', onLoad);
          iframe.removeEventListener('error', onError);
          resolve();
        };
        const onError = () => {
          iframe.removeEventListener('load', onLoad);
          iframe.removeEventListener('error', onError);
          reject(new Error(`Failed to load iframe for ${app.src}`));
        };
        iframe.addEventListener('load', onLoad);
        iframe.addEventListener('error', onError);
      });

      // Send CSS variables to iframe after load (CSS-03).
      this.sendCssVariables(iframe, origin);
      this.observeCssVariables(app.id, iframe, origin);
    }
  }

  async unmount(app: AppInstance): Promise<void> {
    // Demote iframe if promoted.
    this.demoteIframe(app.id);

    // Clean up resize observer.
    const observer = this.resizeObservers.get(app.id);
    if (observer) {
      observer.disconnect();
      this.resizeObservers.delete(app.id);
    }

    // Clean up resize message listener.
    const resizeListener = this.resizeListeners.get(app.id);
    if (resizeListener) {
      window.removeEventListener('message', resizeListener);
      this.resizeListeners.delete(app.id);
    }

    // Clean up load listener from setupAutoResize.
    const iframe = this.iframes.get(app.id);
    const loadListener = this.loadListeners.get(app.id);
    if (loadListener && iframe) {
      iframe.removeEventListener('load', loadListener);
      this.loadListeners.delete(app.id);
    }

    // Clean up app message listener.
    const listener = this.messageListeners.get(app.id);
    if (listener) {
      window.removeEventListener('message', listener);
      this.messageListeners.delete(app.id);
    }

    // Clean up DOM bridge.
    this.bridgeCleanups.get(app.id)?.();
    this.bridgeCleanups.delete(app.id);

    // Clean up CSS observer.
    this.cssObservers.get(app.id)?.disconnect();
    this.cssObservers.delete(app.id);

    // Clean up wrapper ref.
    this.wrappers.delete(app.id);

    // Preserve iframe reference for keepAlive restore.
    // Don't release to pool or delete — destroy() handles permanent cleanup.
    if (iframe) {
      app.iframe = iframe;
    }

    const shadow = this.shadowRoots.get(app.id);
    if (shadow) {
      (shadow.host as HTMLElement).remove();
      this.shadowRoots.delete(app.id);
    }

    this.appOrigins.delete(app.id);
  }

  async destroy(app: AppInstance): Promise<void> {
    // Save iframe ref before unmount clears it.
    const iframe = this.iframes.get(app.id);

    // Unmount first (cleans up listeners, overlays, shadow DOM).
    await this.unmount(app);

    // Permanently clean up iframe.
    this.iframes.delete(app.id);
    app.iframe = null;
    if (iframe) {
      this.pool.remove(iframe);
    }
  }

  postMessage(app: AppInstance, message: unknown): void {
    const iframe = this.iframes.get(app.id);
    const origin = this.appOrigins.get(app.id) ?? '*';
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage(
        { __aiga: true, payload: message },
        origin,
      );
    }
  }

  onMessage(app: AppInstance, handler: (data: unknown) => void): () => void {
    const iframe = this.iframes.get(app.id);
    const expectedOrigin = this.appOrigins.get(app.id);
    const listener = (e: MessageEvent) => {
      if (iframe?.contentWindow && e.source === iframe.contentWindow) {
        if (expectedOrigin && expectedOrigin !== '*' && e.origin !== expectedOrigin) return;
        if (e.data?.__aiga) {
          handler(e.data.payload);
        }
      }
    };
    window.addEventListener('message', listener);
    this.messageListeners.set(app.id, listener);

    return () => {
      window.removeEventListener('message', listener);
      this.messageListeners.delete(app.id);
    };
  }

  /**
   * Promote iframe to full-viewport mode for overlay display (OV-01~07).
   * The overlay inside the iframe covers the entire viewport with
   * full interactivity (clicks, scrolling, animations all work).
   */
  private promoteIframe(appId: string): void {
    if (this.promoted.has(appId)) return;
    const wrapper = this.wrappers.get(appId);
    if (!wrapper) return;

    this.promoted.set(appId, { originalStyle: wrapper.style.cssText });
    wrapper.classList.add('aiga-promoted');
    console.debug(`[aiga] Iframe promoted for overlay: ${appId}`);
  }

  /** Demote iframe back to inline mode after overlay is dismissed. */
  private demoteIframe(appId: string): void {
    const state = this.promoted.get(appId);
    if (!state) return;

    const wrapper = this.wrappers.get(appId);
    if (wrapper) {
      wrapper.classList.remove('aiga-promoted');
    }
    this.promoted.delete(appId);

    // Re-sync iframe height after demotion: content may have changed while promoted.
    const iframe = this.iframes.get(appId);
    if (iframe) {
      try {
        const doc = iframe.contentDocument;
        if (doc) {
          iframe.style.height = `${doc.documentElement.scrollHeight}px`;
        }
      } catch {
        // Cross-origin: rely on next resize message.
      }
    }
    console.debug(`[aiga] Iframe demoted: ${appId}`);
  }

  /** Send current CSS variables to iframe via postMessage (CSS-03). */
  private sendCssVariables(iframe: HTMLIFrameElement, origin: string): void {
    const vars = collectCssVariables();
    iframe.contentWindow?.postMessage(
      { __aiga_css_vars: true, vars },
      origin,
    );
  }

  /** Observe :root for CSS variable changes and re-send to iframe (CSS-03). */
  private observeCssVariables(appId: string, iframe: HTMLIFrameElement, origin: string): void {
    const observer = new MutationObserver(() => {
      this.sendCssVariables(iframe, origin);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'class'],
    });
    this.cssObservers.set(appId, observer);
  }

  /**
   * Set up automatic iframe height adjustment.
   * Uses postMessage-based protocol for cross-origin iframes,
   * plus ResizeObserver for same-origin iframes.
   */
  private setupAutoResize(appId: string, iframe: HTMLIFrameElement): void {
    const expectedOrigin = this.appOrigins.get(appId);

    // Message-based resize listener (cleaned up on unmount).
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframe.contentWindow) return;
      if (expectedOrigin && expectedOrigin !== '*' && e.origin !== expectedOrigin) return;
      if (e.data?.__aiga_resize) {
        // Don't resize when promoted (iframe is full viewport).
        if (this.promoted.has(appId)) return;
        iframe.style.height = `${e.data.height}px`;
      }
    };
    window.addEventListener('message', onMessage);
    this.resizeListeners.set(appId, onMessage);

    // Same-origin ResizeObserver fallback (one-time setup on load).
    const onLoad = () => {
      iframe.removeEventListener('load', onLoad);
      this.loadListeners.delete(appId);
      try {
        const doc = iframe.contentDocument;
        if (doc) {
          const ro = new ResizeObserver(() => {
            if (this.promoted.has(appId)) return;
            const height = doc.documentElement.scrollHeight;
            iframe.style.height = `${height}px`;
          });
          ro.observe(doc.documentElement);
          this.resizeObservers.set(appId, ro);
        }
      } catch {
        // Cross-origin: fall back to message-based resize.
      }
    };
    iframe.addEventListener('load', onLoad);
    this.loadListeners.set(appId, onLoad);
  }
}

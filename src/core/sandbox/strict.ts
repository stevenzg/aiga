import type { SandboxAdapter } from './adapter.js';
import type { AppInstance } from '../types.js';
import type { IframePool } from '../iframe-pool/pool.js';
import { setupDomBridge } from './dom-bridge.js';
import { deriveOrigin } from '../utils/origin.js';
import { collectCssVariables, observeCssVariablesDebounced } from '../utils/css-vars.js';

/** Per-app state managed by the strict sandbox. */
interface AppState {
  iframe: HTMLIFrameElement;
  origin: string;
  shadowRoot: ShadowRoot;
  wrapper: HTMLElement;
  messageListener?: (e: MessageEvent) => void;
  resizeListener?: (e: MessageEvent) => void;
  resizeObserver?: ResizeObserver;
  bridgeCleanup?: () => void;
  loadListener?: () => void;
  cssObserver?: MutationObserver;
  promoted?: { originalStyle: string };
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
  private apps = new Map<string, AppState>();
  /** Cache of last-sent CSS vars per app to avoid redundant postMessages. */
  private lastCssVarsJson = new Map<string, string>();

  constructor(private pool: IframePool) {}

  async mount(app: AppInstance, container: HTMLElement): Promise<void> {
    const origin = deriveOrigin(app.src);

    // Create Shadow DOM host for layout encapsulation.
    const host = document.createElement('div');
    host.setAttribute('data-aiga-strict', app.name);
    host.style.cssText = 'display:block;width:100%;height:100%;position:relative;';
    container.appendChild(host);

    const shadowRoot = host.attachShadow({ mode: 'open' });

    // Style the iframe container inside Shadow DOM.
    const style = new CSSStyleSheet();
    style.replaceSync(`
      :host {
        display: block;
        width: 100%;
        height: 100%;
        contain: layout;
      }
      .aiga-iframe-wrapper {
        width: 100%;
        height: 100%;
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
        height: 100%;
        display: block;
        min-height: 200px;
      }
      .aiga-promoted iframe {
        width: 100vw;
        height: 100vh;
      }
    `);
    shadowRoot.adoptedStyleSheets = [style];

    // Reuse existing iframe (keepAlive restore) or acquire from pool.
    const existing = this.apps.get(app.id);
    const isRestore = !!existing;
    const iframe = existing?.iframe ?? this.pool.acquire(app.id);

    // Expose iframe reference on the AppInstance so aiga-app.ts can find it
    // for RPC setup (querySelector can't pierce this nested Shadow DOM).
    app.iframe = iframe;

    // Wrap iframe in a container inside Shadow DOM.
    const wrapper = document.createElement('div');
    wrapper.className = 'aiga-iframe-wrapper';
    wrapper.appendChild(iframe);
    shadowRoot.appendChild(wrapper);

    // Initialize per-app state.
    const state: AppState = { iframe, origin, shadowRoot, wrapper };
    this.apps.set(app.id, state);

    // Set up the DOM bridge with iframe promotion callbacks (OV-01~07).
    state.bridgeCleanup = setupDomBridge(iframe, {
      parentOrigin: origin,
      appId: app.id,
      onOverlayShow: () => this.promoteIframe(app.id),
      onOverlayHide: () => this.demoteIframe(app.id),
    });

    // Set up auto-resizing: listen for height changes from the iframe.
    this.setupAutoResize(app.id, state);

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
    }

    // Sync CSS variables on both fresh mount and keep-alive restore (CSS-03).
    // The observer is cleaned up in unmount(), so it must be re-created on restore.
    this.sendCssVariables(app.id, iframe, origin);
    this.observeCssVariables(app.id, state, iframe, origin);
  }

  async unmount(app: AppInstance): Promise<void> {
    const state = this.apps.get(app.id);
    if (!state) return;

    // Demote iframe if promoted.
    this.demoteIframe(app.id);

    // Clean up all listeners and observers.
    state.resizeObserver?.disconnect();
    if (state.resizeListener) window.removeEventListener('message', state.resizeListener);
    if (state.loadListener) state.iframe.removeEventListener('load', state.loadListener);
    if (state.messageListener) window.removeEventListener('message', state.messageListener);
    state.bridgeCleanup?.();
    state.cssObserver?.disconnect();
    this.lastCssVarsJson.delete(app.id);

    // Preserve iframe reference for keepAlive restore.
    // Don't release to pool or delete — destroy() handles permanent cleanup.
    app.iframe = state.iframe;

    // Remove shadow DOM host.
    (state.shadowRoot.host as HTMLElement).remove();

    // Keep only iframe ref for potential restore; clear the rest.
    this.apps.set(app.id, {
      iframe: state.iframe,
      origin: state.origin,
      shadowRoot: state.shadowRoot,
      wrapper: state.wrapper,
    });
  }

  async destroy(app: AppInstance): Promise<void> {
    const state = this.apps.get(app.id);
    const iframe = state?.iframe;

    // Unmount first (cleans up listeners, overlays, shadow DOM).
    await this.unmount(app);

    // Permanently clean up iframe.
    this.apps.delete(app.id);
    app.iframe = null;
    if (iframe) {
      this.pool.remove(iframe);
    }
  }

  postMessage(app: AppInstance, message: unknown): void {
    const state = this.apps.get(app.id);
    if (state?.iframe.contentWindow) {
      state.iframe.contentWindow.postMessage(
        { __aiga: true, payload: message },
        state.origin,
      );
    }
  }

  onMessage(app: AppInstance, handler: (data: unknown) => void): () => void {
    const state = this.apps.get(app.id);
    if (!state) return () => {};

    // Remove any existing listener for this appId to prevent leaks
    // when onMessage is called multiple times for the same app.
    if (state.messageListener) {
      window.removeEventListener('message', state.messageListener);
    }

    const listener = (e: MessageEvent) => {
      if (state.iframe.contentWindow && e.source === state.iframe.contentWindow) {
        if (state.origin !== '*' && e.origin !== state.origin) return;
        if (e.data?.__aiga) {
          handler(e.data.payload);
        }
      }
    };
    window.addEventListener('message', listener);
    state.messageListener = listener;

    return () => {
      window.removeEventListener('message', listener);
      state.messageListener = undefined;
    };
  }

  /**
   * Promote iframe to full-viewport mode for overlay display (OV-01~07).
   * The overlay inside the iframe covers the entire viewport with
   * full interactivity (clicks, scrolling, animations all work).
   */
  private promoteIframe(appId: string): void {
    const state = this.apps.get(appId);
    if (!state || state.promoted) return;

    state.promoted = { originalStyle: state.wrapper.style.cssText };
    state.wrapper.classList.add('aiga-promoted');
    console.debug(`[aiga] Iframe promoted for overlay: ${appId}`);
  }

  /** Demote iframe back to inline mode after overlay is dismissed. */
  private demoteIframe(appId: string): void {
    const state = this.apps.get(appId);
    if (!state?.promoted) return;

    state.wrapper.classList.remove('aiga-promoted');
    state.promoted = undefined;

    // Re-sync iframe height after demotion: content may have changed while promoted.
    try {
      const doc = state.iframe.contentDocument;
      if (doc) {
        state.iframe.style.height = `${doc.documentElement.scrollHeight}px`;
      }
    } catch {
      // Cross-origin: rely on next resize message.
    }
    console.debug(`[aiga] Iframe demoted: ${appId}`);
  }

  /**
   * Send current CSS variables to iframe via postMessage (CSS-03).
   * Uses diff to avoid redundant messages when variables haven't changed.
   */
  private sendCssVariables(appId: string, iframe: HTMLIFrameElement, origin: string): void {
    const vars = collectCssVariables();
    // Only send if variables actually changed (avoids redundant postMessages).
    const json = JSON.stringify(vars);
    if (this.lastCssVarsJson.get(appId) === json) return;
    this.lastCssVarsJson.set(appId, json);

    iframe.contentWindow?.postMessage(
      { __aiga_css_vars: true, vars },
      origin,
    );
  }

  /**
   * Observe :root for CSS variable changes and re-send to iframe (CSS-03).
   * Uses debounced observer (rAF-coalesced) to avoid excessive reflows.
   */
  private observeCssVariables(
    appId: string,
    state: AppState,
    iframe: HTMLIFrameElement,
    origin: string,
  ): void {
    const observer = observeCssVariablesDebounced(() => {
      this.sendCssVariables(appId, iframe, origin);
    });
    state.cssObserver = observer;
  }

  /**
   * Set up automatic iframe height adjustment.
   * Uses postMessage-based protocol for cross-origin iframes,
   * plus ResizeObserver for same-origin iframes.
   */
  private setupAutoResize(appId: string, state: AppState): void {
    const { iframe, origin } = state;

    // Message-based resize listener (cleaned up on unmount).
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframe.contentWindow) return;
      if (origin !== '*' && e.origin !== origin) return;
      if (e.data?.__aiga_resize) {
        // Don't resize when promoted (iframe is full viewport).
        if (state.promoted) return;
        iframe.style.height = `${e.data.height}px`;
      }
    };
    window.addEventListener('message', onMessage);
    state.resizeListener = onMessage;

    // Same-origin ResizeObserver fallback (one-time setup on load).
    const onLoad = () => {
      iframe.removeEventListener('load', onLoad);
      state.loadListener = undefined;
      try {
        const doc = iframe.contentDocument;
        if (doc) {
          const ro = new ResizeObserver(() => {
            if (state.promoted) return;
            const height = doc.documentElement.scrollHeight;
            iframe.style.height = `${height}px`;
          });
          ro.observe(doc.documentElement);
          state.resizeObserver = ro;
        }
      } catch {
        // Cross-origin: fall back to message-based resize.
      }
    };
    iframe.addEventListener('load', onLoad);
    state.loadListener = onLoad;
  }
}

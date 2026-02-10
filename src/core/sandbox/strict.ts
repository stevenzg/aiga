import type { SandboxAdapter } from './adapter.js';
import type { AppInstance } from '../types.js';
import type { IframePool } from '../iframe-pool/pool.js';
import { setupDomBridge } from './dom-bridge.js';
import { OverlayLayer } from '../overlay/overlay-layer.js';

/** Derive origin from a URL for secure postMessage. */
function getOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '*';
  }
}

/**
 * `sandbox="strict"` — Pooled iframe + Shadow DOM + Proxy bridge + Overlay layer.
 *
 * The sub-application runs in a pooled iframe for full JS isolation.
 * A DOM proxy bridge intercepts overlay operations (modal, popover)
 * inside the iframe and mirrors them to the host's overlay layer.
 * The iframe is visually embedded within a Shadow DOM container so it
 * participates in the host document's layout flow.
 *
 * Memory overhead: ~15-20 MB per sub-app.
 */
export class StrictSandbox implements SandboxAdapter {
  readonly name = 'strict';
  private iframes = new Map<string, HTMLIFrameElement>();
  private shadowRoots = new Map<string, ShadowRoot>();
  private overlays = new Map<string, OverlayLayer>();
  private messageListeners = new Map<string, (e: MessageEvent) => void>();
  private resizeListeners = new Map<string, (e: MessageEvent) => void>();
  private resizeObservers = new Map<string, ResizeObserver>();
  private bridgeCleanups = new Map<string, () => void>();
  private appOrigins = new Map<string, string>();

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
      iframe {
        border: none;
        width: 100%;
        display: block;
        min-height: 200px;
      }
    `);
    shadow.adoptedStyleSheets = [style];

    // Acquire iframe from pool (near-instant, pre-created).
    const iframe = this.pool.acquire(app.id);
    this.iframes.set(app.id, iframe);

    // Wrap iframe in a container inside Shadow DOM.
    const wrapper = document.createElement('div');
    wrapper.className = 'aiga-iframe-wrapper';
    wrapper.appendChild(iframe);
    shadow.appendChild(wrapper);

    // Set up overlay layer for this app.
    const overlayLayer = new OverlayLayer(app.id);
    this.overlays.set(app.id, overlayLayer);

    // Set up the DOM proxy bridge with the host origin for secure postMessage.
    const cleanupBridge = setupDomBridge(iframe, overlayLayer, origin);
    this.bridgeCleanups.set(app.id, cleanupBridge);

    // Set up auto-resizing: listen for height changes from the iframe.
    this.setupAutoResize(app.id, iframe);

    // Navigate the iframe to the sub-app URL.
    // Note: allow-same-origin is needed for the DOM bridge to inject scripts
    // into same-origin iframes. The iframe itself provides JS isolation.
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

  async unmount(app: AppInstance): Promise<void> {
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

    // Clean up app message listener.
    const listener = this.messageListeners.get(app.id);
    if (listener) {
      window.removeEventListener('message', listener);
      this.messageListeners.delete(app.id);
    }

    // Clean up DOM bridge.
    this.bridgeCleanups.get(app.id)?.();
    this.bridgeCleanups.delete(app.id);

    // Clean up overlay layer.
    this.overlays.get(app.id)?.dispose();
    this.overlays.delete(app.id);

    const iframe = this.iframes.get(app.id);
    if (iframe) {
      if (app.keepAlive) {
        iframe.remove();
      } else {
        this.pool.release(iframe);
      }
      this.iframes.delete(app.id);
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

    // Then permanently remove the iframe from the pool.
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
   * Set up automatic iframe height adjustment.
   * Uses postMessage-based protocol for cross-origin iframes,
   * plus ResizeObserver for same-origin iframes.
   */
  private setupAutoResize(appId: string, iframe: HTMLIFrameElement): void {
    // Message-based resize listener (cleaned up on unmount).
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframe.contentWindow) return;
      if (e.data?.__aiga_resize) {
        iframe.style.height = `${e.data.height}px`;
      }
    };
    window.addEventListener('message', onMessage);
    this.resizeListeners.set(appId, onMessage);

    // Same-origin ResizeObserver fallback (one-time setup on load).
    const onLoad = () => {
      iframe.removeEventListener('load', onLoad);
      try {
        const doc = iframe.contentDocument;
        if (doc) {
          const ro = new ResizeObserver(() => {
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
  }
}

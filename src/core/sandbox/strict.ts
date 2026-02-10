import type { SandboxAdapter } from './adapter.js';
import type { AppInstance } from '../types.js';
import type { IframePool } from '../iframe-pool/pool.js';

/**
 * `sandbox="strict"` — Pooled iframe + Shadow DOM container + Overlay layer.
 *
 * The sub-application runs in a pooled iframe for full JS isolation.
 * The iframe is visually embedded within a Shadow DOM container so it
 * participates in the host document's layout flow (no double scrollbars).
 * Communication uses postMessage via the RPC layer.
 *
 * Memory overhead: ~15-20 MB per sub-app.
 */
export class StrictSandbox implements SandboxAdapter {
  readonly name = 'strict';
  private iframes = new Map<string, HTMLIFrameElement>();
  private shadowRoots = new Map<string, ShadowRoot>();
  private messageListeners = new Map<string, (e: MessageEvent) => void>();
  private resizeObservers = new Map<string, ResizeObserver>();

  constructor(private pool: IframePool) {}

  async mount(app: AppInstance, container: HTMLElement): Promise<void> {
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

    // Set up auto-resizing: listen for height changes from the iframe.
    this.setupAutoResize(app.id, iframe);

    // Navigate the iframe to the sub-app URL.
    // Remove default restrictive sandbox to allow the app to function.
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
    const iframe = this.iframes.get(app.id);
    const shadow = this.shadowRoots.get(app.id);

    // Clean up resize observer.
    const observer = this.resizeObservers.get(app.id);
    if (observer) {
      observer.disconnect();
      this.resizeObservers.delete(app.id);
    }

    // Remove message listener.
    const listener = this.messageListeners.get(app.id);
    if (listener) {
      window.removeEventListener('message', listener);
      this.messageListeners.delete(app.id);
    }

    if (iframe) {
      if (app.keepAlive) {
        // Move iframe back to the hidden pool host without resetting.
        iframe.remove();
      } else {
        this.pool.release(iframe);
      }
      this.iframes.delete(app.id);
    }

    if (shadow) {
      (shadow.host as HTMLElement).remove();
      this.shadowRoots.delete(app.id);
    }
  }

  async destroy(app: AppInstance): Promise<void> {
    const iframe = this.iframes.get(app.id);
    if (iframe) {
      this.pool.remove(iframe);
      this.iframes.delete(app.id);
    }
    await this.unmount(app);
  }

  postMessage(app: AppInstance, message: unknown): void {
    const iframe = this.iframes.get(app.id);
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage(
        { __aiga: true, payload: message },
        '*',
      );
    }
  }

  onMessage(app: AppInstance, handler: (data: unknown) => void): () => void {
    const iframe = this.iframes.get(app.id);
    const listener = (e: MessageEvent) => {
      // Only accept messages from our iframe.
      if (iframe?.contentWindow && e.source === iframe.contentWindow) {
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
   * Uses postMessage-based protocol for cross-origin iframes.
   */
  private setupAutoResize(appId: string, iframe: HTMLIFrameElement): void {
    // Listen for resize messages from the iframe content.
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframe.contentWindow) return;
      if (e.data?.__aiga_resize) {
        iframe.style.height = `${e.data.height}px`;
      }
    };
    window.addEventListener('message', onMessage);

    // Also try to set up a ResizeObserver for same-origin iframes.
    iframe.addEventListener('load', () => {
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
        // Inject a resize reporter script if possible.
      }
    });
  }
}

import type { SandboxAdapter } from './adapter.js';
import type { AppInstance } from '../types.js';

/** Derive origin from a URL for secure postMessage. Throws on invalid URL. */
function getOrigin(url: string): string {
  try {
    return new URL(url, window.location.href).origin;
  } catch {
    throw new Error(`[aiga] Invalid URL for sandbox: ${url}`);
  }
}

/**
 * `sandbox="remote"` — Pure iframe with no bridge.
 *
 * The sub-application is loaded in a standalone iframe with no DOM
 * or JS bridging. This provides the strongest isolation guarantee
 * and is appropriate for fully untrusted third-party content.
 *
 * Communication is limited to `postMessage`.
 * Memory overhead: ~20-30 MB per sub-app.
 *
 * Security note: `allow-same-origin` is intentionally omitted.
 * Without it the iframe gets a unique opaque origin, which prevents:
 * - Access to the parent's cookies/storage
 * - Escaping the sandbox via frameElement manipulation
 * This means sub-apps lose localStorage/cookies — this is by design
 * for untrusted content. Use `strict` for apps that need storage.
 */
export class RemoteSandbox implements SandboxAdapter {
  readonly name = 'remote';
  private iframes = new Map<string, HTMLIFrameElement>();
  private messageListeners = new Map<string, (e: MessageEvent) => void>();
  private resizeListeners = new Map<string, (e: MessageEvent) => void>();
  private resizeObservers = new Map<string, ResizeObserver>();
  private loadListeners = new Map<string, () => void>();
  private appOrigins = new Map<string, string>();

  async mount(app: AppInstance, container: HTMLElement): Promise<void> {
    const origin = getOrigin(app.src);
    this.appOrigins.set(app.id, origin);

    // Reuse existing iframe (keepAlive restore) or create new one.
    let iframe = this.iframes.get(app.id);
    const isRestore = !!iframe;

    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.setAttribute('data-aiga-remote', app.name);
      iframe.style.cssText = 'border:none;width:100%;height:100%;min-height:200px;display:block;';

      // Security: omit allow-same-origin for untrusted content.
      iframe.setAttribute(
        'sandbox',
        'allow-scripts allow-forms allow-popups allow-modals',
      );
      iframe.setAttribute('allow', 'clipboard-read; clipboard-write');
      iframe.setAttribute('loading', 'lazy');
      this.iframes.set(app.id, iframe);
    }

    // Expose iframe reference on AppInstance for RPC setup.
    app.iframe = iframe;
    container.appendChild(iframe);

    // Only navigate on fresh mount (not keepAlive restore).
    if (!isRestore) {
      iframe.src = app.src;

      // Wait for load.
      await new Promise<void>((resolve, reject) => {
        const onLoad = () => {
          iframe.removeEventListener('load', onLoad);
          iframe.removeEventListener('error', onError);
          resolve();
        };
        const onError = () => {
          iframe.removeEventListener('load', onLoad);
          iframe.removeEventListener('error', onError);
          reject(new Error(`Failed to load remote iframe for ${app.src}`));
        };
        iframe.addEventListener('load', onLoad);
        iframe.addEventListener('error', onError);
      });
    }

    // Auto-resize for same-origin, message-based for cross-origin.
    this.setupAutoResize(app.id, iframe);
  }

  /** Common cleanup for listeners/observers. */
  private cleanupListeners(appId: string): void {
    const resizeListener = this.resizeListeners.get(appId);
    if (resizeListener) {
      window.removeEventListener('message', resizeListener);
      this.resizeListeners.delete(appId);
    }

    const resizeObserver = this.resizeObservers.get(appId);
    if (resizeObserver) {
      resizeObserver.disconnect();
      this.resizeObservers.delete(appId);
    }

    // Clean up load listener from setupAutoResize.
    const iframe = this.iframes.get(appId);
    const loadListener = this.loadListeners.get(appId);
    if (loadListener && iframe) {
      iframe.removeEventListener('load', loadListener);
      this.loadListeners.delete(appId);
    }

    const listener = this.messageListeners.get(appId);
    if (listener) {
      window.removeEventListener('message', listener);
      this.messageListeners.delete(appId);
    }
  }

  async unmount(app: AppInstance): Promise<void> {
    this.cleanupListeners(app.id);

    // Preserve iframe reference for keepAlive restore.
    const iframe = this.iframes.get(app.id);
    if (iframe) {
      app.iframe = iframe;
    }

    this.appOrigins.delete(app.id);
  }

  async destroy(app: AppInstance): Promise<void> {
    this.cleanupListeners(app.id);

    const iframe = this.iframes.get(app.id);
    if (iframe) {
      iframe.src = 'about:blank';
      iframe.remove();
      this.iframes.delete(app.id);
    }
    app.iframe = null;

    this.appOrigins.delete(app.id);
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

  private setupAutoResize(appId: string, iframe: HTMLIFrameElement): void {
    const expectedOrigin = this.appOrigins.get(appId);

    // Message-based resize (cleaned up on unmount/destroy).
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframe.contentWindow) return;
      if (expectedOrigin && expectedOrigin !== '*' && e.origin !== expectedOrigin) return;
      if (e.data?.__aiga_resize) {
        iframe.style.height = `${e.data.height}px`;
      }
    };
    window.addEventListener('message', onMessage);
    this.resizeListeners.set(appId, onMessage);

    // Same-origin fallback (one-time setup on load).
    const onLoad = () => {
      iframe.removeEventListener('load', onLoad);
      this.loadListeners.delete(appId);
      try {
        const doc = iframe.contentDocument;
        if (doc) {
          const ro = new ResizeObserver(() => {
            iframe.style.height = `${doc.documentElement.scrollHeight}px`;
          });
          ro.observe(doc.documentElement);
          this.resizeObservers.set(appId, ro);
        }
      } catch {
        // Cross-origin — rely on message-based resize.
      }
    };
    iframe.addEventListener('load', onLoad);
    this.loadListeners.set(appId, onLoad);
  }
}

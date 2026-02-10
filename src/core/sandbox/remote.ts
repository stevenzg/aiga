import type { SandboxAdapter } from './adapter.js';
import type { AppInstance } from '../types.js';

/**
 * `sandbox="remote"` — Pure iframe with no bridge.
 *
 * The sub-application is loaded in a standalone iframe with no DOM
 * or JS bridging. This provides the strongest isolation guarantee
 * and is appropriate for fully untrusted third-party content.
 *
 * Communication is limited to `postMessage`.
 * Memory overhead: ~20-30 MB per sub-app.
 */
export class RemoteSandbox implements SandboxAdapter {
  readonly name = 'remote';
  private iframes = new Map<string, HTMLIFrameElement>();
  private messageListeners = new Map<string, (e: MessageEvent) => void>();

  async mount(app: AppInstance, container: HTMLElement): Promise<void> {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('data-aiga-remote', app.name);
    iframe.style.cssText = 'border:none;width:100%;min-height:200px;display:block;';
    iframe.setAttribute(
      'sandbox',
      'allow-scripts allow-same-origin allow-forms allow-popups allow-modals',
    );
    iframe.setAttribute('allow', 'clipboard-read; clipboard-write');
    iframe.setAttribute('loading', 'lazy');

    this.iframes.set(app.id, iframe);
    container.appendChild(iframe);

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

    // Auto-resize for same-origin, message-based for cross-origin.
    this.setupAutoResize(app.id, iframe);
  }

  async unmount(app: AppInstance): Promise<void> {
    const iframe = this.iframes.get(app.id);
    const listener = this.messageListeners.get(app.id);

    if (listener) {
      window.removeEventListener('message', listener);
      this.messageListeners.delete(app.id);
    }

    if (iframe) {
      if (!app.keepAlive) {
        iframe.src = 'about:blank';
        iframe.remove();
      }
      this.iframes.delete(app.id);
    }
  }

  async destroy(app: AppInstance): Promise<void> {
    const iframe = this.iframes.get(app.id);
    if (iframe) {
      iframe.src = 'about:blank';
      iframe.remove();
      this.iframes.delete(app.id);
    }
    const listener = this.messageListeners.get(app.id);
    if (listener) {
      window.removeEventListener('message', listener);
      this.messageListeners.delete(app.id);
    }
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

  private setupAutoResize(appId: string, iframe: HTMLIFrameElement): void {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframe.contentWindow) return;
      if (e.data?.__aiga_resize) {
        iframe.style.height = `${e.data.height}px`;
      }
    };
    window.addEventListener('message', onMessage);

    // Same-origin fallback.
    iframe.addEventListener('load', () => {
      try {
        const doc = iframe.contentDocument;
        if (doc) {
          const ro = new ResizeObserver(() => {
            iframe.style.height = `${doc.documentElement.scrollHeight}px`;
          });
          ro.observe(doc.documentElement);
        }
      } catch {
        // Cross-origin — rely on message-based resize.
      }
    });
  }
}

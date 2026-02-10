import type { SandboxAdapter } from './adapter.js';
import type { AppInstance } from '../types.js';

/**
 * `sandbox="none"` — Direct mount with zero isolation.
 *
 * The sub-application is fetched as HTML, and its content is directly
 * injected into the host document flow. No Shadow DOM, no Proxy, no
 * iframe. Suitable only for fully trusted, same-team modules.
 *
 * Memory overhead: ~0 MB above the content itself.
 */
export class NoneSandbox implements SandboxAdapter {
  readonly name = 'none';
  private containers = new Map<string, HTMLElement>();
  private messageHandlers = new Map<string, Set<(data: unknown) => void>>();
  private listenerCleanups = new Map<string, Set<() => void>>();
  private errorHandlers = new Map<string, { error: (e: ErrorEvent) => void; rejection: (e: PromiseRejectionEvent) => void }>();

  async mount(app: AppInstance, container: HTMLElement): Promise<void> {
    this.containers.set(app.id, container);

    // Set up error boundary (ERR-01).
    this.setupErrorBoundary(app);

    // Fetch the sub-app HTML.
    const html = await this.fetchAppHtml(app.src);

    // Parse safely using DOMParser instead of innerHTML (prevents XSS).
    const parsed = new DOMParser().parseFromString(html, 'text/html');

    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-aiga-none', app.id);
    while (parsed.body.firstChild) {
      wrapper.appendChild(wrapper.ownerDocument.importNode(parsed.body.firstChild, true));
      parsed.body.removeChild(parsed.body.firstChild);
    }
    container.appendChild(wrapper);

    // Execute any inline scripts.
    const scripts = wrapper.querySelectorAll('script');
    for (const script of scripts) {
      const newScript = document.createElement('script');
      if (script.src) {
        newScript.src = script.src;
        newScript.onerror = () => console.error(`[aiga] Failed to load script: ${script.src}`);
      } else {
        newScript.textContent = script.textContent;
      }
      for (const attr of script.attributes) {
        if (attr.name !== 'src') {
          newScript.setAttribute(attr.name, attr.value);
        }
      }
      script.replaceWith(newScript);
    }
  }

  async unmount(app: AppInstance): Promise<void> {
    const container = this.containers.get(app.id);
    if (container) {
      const wrapper = container.querySelector(`[data-aiga-none="${app.id}"]`);
      wrapper?.remove();
    }
    // Clean up event listeners for this app.
    this.listenerCleanups.get(app.id)?.forEach((unsub) => unsub());
    this.listenerCleanups.delete(app.id);

    // Clean up error boundary.
    this.cleanupErrorBoundary(app.id);
  }

  async destroy(app: AppInstance): Promise<void> {
    await this.unmount(app);
    this.containers.delete(app.id);
    this.messageHandlers.delete(app.id);
  }

  postMessage(app: AppInstance, message: unknown): void {
    const container = this.containers.get(app.id);
    container?.dispatchEvent(
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

    const container = this.containers.get(app.id);
    const listener = (e: Event) => handler((e as CustomEvent).detail);
    container?.addEventListener('aiga-message-up', listener);

    // Track for cleanup on unmount.
    let cleanups = this.listenerCleanups.get(app.id);
    if (!cleanups) {
      cleanups = new Set();
      this.listenerCleanups.set(app.id, cleanups);
    }
    const unsub = () => {
      handlers!.delete(handler);
      container?.removeEventListener('aiga-message-up', listener);
    };
    cleanups.add(unsub);

    return () => {
      unsub();
      cleanups!.delete(unsub);
    };
  }

  /** Set up global error boundary for uncaught errors (ERR-01). */
  private setupErrorBoundary(app: AppInstance): void {
    const onError = (e: ErrorEvent) => {
      console.error(`[aiga] Uncaught error in none sandbox "${app.name}":`, e.error);
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      console.error(`[aiga] Unhandled rejection in none sandbox "${app.name}":`, e.reason);
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

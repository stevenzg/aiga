import type { SandboxAdapter } from './adapter.js';
import type { AppInstance } from '../types.js';
import { fetchAppHtml } from '../utils/fetch-html.js';
import { setupErrorBoundary, cleanupErrorBoundary, type ErrorHandlers } from '../utils/error-boundary.js';

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
  private errorHandlers = new Map<string, ErrorHandlers>();

  async mount(app: AppInstance, container: HTMLElement): Promise<void> {
    this.containers.set(app.id, container);

    // Set up error boundary (ERR-01).
    const handlers = setupErrorBoundary(this.name, app.name);
    this.errorHandlers.set(app.id, handlers);

    // Fetch the sub-app HTML.
    const html = await fetchAppHtml(app.src);

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
    const handlers = this.errorHandlers.get(app.id);
    if (handlers) {
      cleanupErrorBoundary(handlers);
      this.errorHandlers.delete(app.id);
    }
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
}
